#!/usr/bin/env bash
# Incident diagnostics only: do not modify files, services, databases or processes.
set -euo pipefail
[[ $# -eq 5 ]] || exit 2
app_root=$1 app_user=$2 app_port=$3 app_domain=$4 probe_domain=$5
[[ $app_root =~ ^/[A-Za-z0-9_/-]+$ && $app_root != / ]] || exit 2
[[ $app_user =~ ^[a-z_][a-z0-9_-]*$ ]] || exit 2
[[ $app_port =~ ^[0-9]{1,5}$ ]] || exit 2
[[ $app_domain =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || exit 2
[[ -z $probe_domain || $probe_domain =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || exit 2
runtime=/opt/ctokodnomy-node/node-v24.21.0-linux-x64/bin/node
if [[ ! -x $runtime ]]; then runtime=$(command -v node) || exit 2; fi
"$runtime" --input-type=module - "$app_root" "$app_user" "$app_port" "$app_domain" "$probe_domain" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const [appRoot, appUser, appPort, appDomain, probeDomain] = process.argv.slice(2);
const domains = [...new Set([appDomain, probeDomain].filter(Boolean))];
let outputBytes = 0;
const maximumOutput = 12 * 1024;
function out(value = '') {
  const line = String(value).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, 500);
  const size = Buffer.byteLength(line) + 1;
  if (outputBytes + size > maximumOutput) return;
  outputBytes += size;
  console.log(line);
}
function run(binary, args, options = {}) {
  try {
    return spawnSync(binary, args, {
      encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C', SYSTEMD_COLORS: '0', SYSTEMD_PAGER: 'cat' },
      ...options,
    });
  } catch { return { status: null, stdout: '', stderr: '', error: true }; }
}
function section(title, callback) {
  out(`\n${title}`);
  try { callback(); } catch { out('Unavailable (read-only check could not complete).'); }
}
function readLimited(file, limit = 2 * 1024 * 1024) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > limit) throw new Error('Unsupported diagnostic input');
  return fs.readFileSync(file, 'utf8');
}
function safeDirective(line) {
  const trimmed = line.trim().replace(/\s+#.*$/, '');
  if (!/^(?:listen|server_name|root|proxy_pass|fastcgi_pass|include|ServerName|DocumentRoot|ProxyPass)\s/i.test(trimmed)) return null;
  if (/^include\s/i.test(trimmed) && /(?:env|secret|passwd|credential|private|\.key(?:\W|$))/i.test(trimmed)) return null;
  return trimmed
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s;?]+)\?[^\s;]*/gi, '$1?[redacted]')
    .slice(0, 240);
}
function configMetadata(file) {
  if (!fs.existsSync(file)) { out(`${file}: absent`); return; }
  const stat = fs.statSync(file);
  out(`${file}: modified=${stat.mtime.toISOString()} bytes=${stat.size}`);
  const directives = readLimited(file).split('\n').map(safeDirective).filter(Boolean);
  for (const line of directives.slice(0, 34)) out(`  ${line}`);
  if (directives.length > 34) out(`  Additional selected directives: ${directives.length - 34}`);
}

out('READ-ONLY WEB SERVICE DIAGNOSTICS');
out(`UTC: ${new Date().toISOString()}`);
out(`Host platform: ${os.type()} ${os.release()} ${os.arch()}`);

section('Memory and storage metadata', () => {
  out(`Memory MiB: total=${Math.round(os.totalmem() / 1048576)} free=${Math.round(os.freemem() / 1048576)}; load=${os.loadavg().map(value => value.toFixed(2)).join(',')}`);
  const free = run('free', ['-m']);
  if (free.status === 0) for (const line of free.stdout.trim().split('\n').slice(0, 4)) out(line);
  for (const target of [...new Set(['/', '/var', appRoot])]) {
    try {
      const stat = fs.statfsSync(target);
      out(`${target}: totalMiB=${Math.round(Number(stat.blocks) * Number(stat.bsize) / 1048576)} availableMiB=${Math.round(Number(stat.bavail) * Number(stat.bsize) / 1048576)} freeInodes=${stat.ffree}`);
    } catch { out(`${target}: filesystem metadata unavailable`); }
  }
});

section('Web, PHP, database and panel service state', () => {
  const units = new Set([`nodejs@${appPort}.service`]);
  const discovery = [
    run('systemctl', ['list-units', '--all', '--type=service', '--no-pager', '--plain', '--no-legend']),
    run('systemctl', ['list-unit-files', '--type=service', '--no-pager', '--no-legend']),
  ];
  for (const result of discovery) {
    if (result.status !== 0) continue;
    for (const line of result.stdout.split('\n')) {
      const unit = line.trim().replace(/^●\s*/, '').split(/\s+/)[0];
      if (/^[A-Za-z0-9_.@-]+\.service$/.test(unit) && /nginx|httpd|apache|php.*fpm|fpm.*php|mysql|mariadb|brainy/i.test(unit) && !unit.includes('@.')) units.add(unit);
    }
  }
  const properties = 'Id,Names,ActiveState,SubState,Result,ExecMainStatus,ExecMainCode,MainPID,MemoryCurrent,NRestarts,StateChangeTimestamp,ExecMainExitTimestamp,FragmentPath';
  const sorted = [...units].sort();
  out(`Discovered matching units: ${sorted.length}`);
  for (const unit of sorted.slice(0, 24)) {
    out(`[${unit}]`);
    const result = run('systemctl', ['show', unit, `--property=${properties}`, '--no-pager']);
    if (result.status !== 0) { out('  Unit metadata unavailable'); continue; }
    const values = Object.fromEntries(result.stdout.trim().split('\n').filter(line => /^[A-Za-z]+=/.test(line)).map(line => {
      const split = line.indexOf('=');
      return [line.slice(0, split), line.slice(split + 1)];
    }));
    out(`  state=${values.ActiveState}/${values.SubState} result=${values.Result} exit=${values.ExecMainCode}/${values.ExecMainStatus} pid=${values.MainPID} restarts=${values.NRestarts} memory=${values.MemoryCurrent}`);
    out(`  changed=${values.StateChangeTimestamp} exited=${values.ExecMainExitTimestamp} unit=${values.FragmentPath}`);
  }
});

section('Listening web and PHP ports (no process arguments)', () => {
  const result = run('ss', ['-ltn', 'sport = :80 or sport = :443 or sport = :8080 or sport = :8081 or sport = :9000']);
  if (result.status === 0) for (const line of result.stdout.trim().split('\n').slice(0, 18)) out(line);
  else out('Socket metadata unavailable');
});

section('Nginx configuration syntax', () => {
  const result = run('nginx', ['-t']);
  const message = `${result.stdout || ''}\n${result.stderr || ''}`;
  out(`Exit status: ${result.status ?? 'unavailable'}`);
  for (const [label, pattern] of [
    ['syntax is ok', /syntax is ok/i], ['configuration test successful', /test is successful/i],
    ['configuration test failed', /test failed/i], ['permission denied', /permission denied/i],
    ['missing file or directory', /no such file or directory/i], ['duplicate listen', /duplicate.*listen/i],
    ['address already in use', /address already in use/i], ['invalid configuration directive', /unknown directive|invalid.*directive/i],
    ['certificate loading failed', /cannot load certificate|BIO_new_file/i],
  ]) if (pattern.test(message)) out(`  ${label}`);
});

section('Selected current virtual-host routing directives', () => {
  for (const domain of domains) {
    for (const directory of ['/etc/nginx/sites-available', '/etc/httpd/vhost.d']) {
      try { configMetadata(`${directory}/${domain}.conf`); } catch { out(`${directory}/${domain}.conf: metadata unavailable`); }
    }
  }
});

section('Loaded Nginx listen/server_name inventory (routing metadata only)', () => {
  const result = run('nginx', ['-T'], { maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) { out('Loaded configuration unavailable (nginx syntax test failed or command unavailable)'); return; }
  const files = new Map();
  let current;
  for (const line of result.stdout.split('\n')) {
    const header = line.match(/^# configuration file (\/[^\r\n]+):$/);
    if (header) {
      current = header[1];
      continue;
    }
    const match = line.trim().match(/^(listen|server_name)\s+([^;]+);/);
    if (!current || !match) continue;
    const value = match[2].replace(/\s+#.*$/, '').slice(0, 180);
    if (!/^[A-Za-z0-9_.:$*\[\]~^()|+?=\s\\/-]+$/.test(value)) continue;
    if (!files.has(current)) files.set(current, []);
    const rendered = `${match[1]} ${value};`;
    if (!files.get(current).includes(rendered)) files.get(current).push(rendered);
  }
  out(`Loaded files containing routing metadata: ${files.size}`);
  let emitted = 0;
  for (const [file, directives] of files) {
    if (emitted++ >= 40) break;
    out(`${file}: ${directives.join(' | ')}`);
  }
});

section('Local HTTPS GET probes (TLS verification enabled; response bodies discarded)', () => {
  const sockets = run('ss', ['-ltn', 'sport = :443']);
  const listenAddresses = [...(sockets.stdout || '').matchAll(/(?:\s|^)((?:\d{1,3}\.){3}\d{1,3}):443(?:\s|$)/g)].map(match => match[1]);
  const interfaces = run('ip', ['-o', '-4', 'addr', 'show', 'scope', 'global']);
  const interfaceAddresses = [...(interfaces.stdout || '').matchAll(/\binet\s+((?:\d{1,3}\.){3}\d{1,3})\//g)].map(match => match[1]);
  const address = [...listenAddresses, ...interfaceAddresses].find(value => !value.startsWith('127.') && value !== '0.0.0.0');
  if (!address) { out('No concrete local IPv4 listen/interface address found; HTTPS probes skipped'); return; }
  out(`Local destination: ${address}:443`);
  for (const domain of domains) {
    const result = run('curl', ['--silent', '--noproxy', '*', '--connect-timeout', '5', '--max-time', '10', '--resolve', `${domain}:443:${address}`, '--output', '/dev/null', '--write-out', 'http_status=%{http_code} tls_verify=%{ssl_verify_result}', `https://${domain}/`]);
    const metadata = (result.stdout || '').match(/http_status=\d{3} tls_verify=\d+/)?.[0] || 'response metadata unavailable';
    out(`${domain}: ${metadata} curl_exit=${result.status ?? 'unavailable'}`);
  }
});

section('Application-managed Nginx backup routing directives', () => {
  const account = run('getent', ['passwd', appUser]);
  if (account.status !== 0) { out('Application account home unavailable'); return; }
  const home = account.stdout.trim().split(':')[5];
  if (!home || !path.isAbsolute(home)) { out('Application account home unavailable'); return; }
  const backupRoot = path.join(home, '.local/share/ctokodnomy', appPort, 'backups');
  if (!fs.existsSync(backupRoot)) { out('No application-managed backup directory'); return; }
  const backups = [];
  for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(backupRoot, entry.name, 'nginx.conf');
    if (fs.existsSync(candidate)) backups.push({ file: candidate, modified: fs.statSync(candidate).mtimeMs });
  }
  backups.sort((left, right) => left.modified - right.modified);
  out(`Matching backups: ${backups.length}`);
  const selected = backups.length <= 8 ? backups : [backups[0], ...backups.slice(-7)];
  for (const backup of selected) { try { configMetadata(backup.file); } catch { out(`${backup.file}: metadata unavailable`); } }
});

section('Last 24 hours: failure categories only (no raw journal messages)', () => {
  const result = run('journalctl', ['--since', '24 hours ago', '--no-pager', '-o', 'json', '-n', '5000'], { maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) { out('Journal metadata unavailable'); return; }
  const categories = [
    ['OOM', /out of memory|oom-kill|oom killer|memory cgroup out/i],
    ['SIGKILL', /sigkill|signal=killed|status=9\/KILL|killed process/i],
    ['START_FAILED', /failed to start|failed with result|start request repeated too quickly/i],
    ['PERMISSION_DENIED', /permission denied|operation not permitted/i],
    ['CONNECTION_REFUSED', /connection refused|connect\(\) failed/i],
    ['UPSTREAM_TIMEOUT', /upstream timed out|upstream.*timeout/i],
    ['ADDRESS_IN_USE', /address already in use|cannot assign requested address/i],
    ['NO_SPACE', /no space left on device|disk quota exceeded/i],
    ['SEGFAULT', /segfault|segmentation fault/i],
  ];
  const events = [];
  const counts = new Map();
  for (const line of result.stdout.split('\n')) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const message = typeof item.MESSAGE === 'string' ? item.MESSAGE : '';
    const unit = typeof item.UNIT === 'string' ? item.UNIT : typeof item._SYSTEMD_UNIT === 'string' ? item._SYSTEMD_UNIT : '';
    const safeUnit = /^[A-Za-z0-9_.@-]+\.service$/.test(unit) ? unit : '(system)';
    for (const [category, pattern] of categories) {
      if (!pattern.test(message)) continue;
      if (!/nginx|httpd|apache|php|fpm|mysql|mariadb|brainy|nodejs/i.test(unit) && !['OOM', 'SIGKILL', 'NO_SPACE'].includes(category) && item.SYSLOG_IDENTIFIER !== 'systemd') continue;
      counts.set(category, (counts.get(category) || 0) + 1);
      const date = new Date(Number(item.__REALTIME_TIMESTAMP) / 1000);
      events.push(`${Number.isNaN(date.valueOf()) ? '(time unavailable)' : date.toISOString()} ${safeUnit} ${category}`);
    }
  }
  out(`Scanned recent journal records: ${result.stdout.split('\n').filter(Boolean).length} (bounded at 5000)`);
  out(`Category counts: ${[...counts].map(([category, count]) => `${category}=${count}`).join(', ') || 'none'}`);
  for (const event of events.slice(-15)) out(event);
});

section('Error-log pattern counts only (last 128 KiB each; no requests or raw lines)', () => {
  for (const file of ['/var/log/nginx/error.log', '/var/log/httpd/error_log']) {
    let descriptor;
    try {
      descriptor = fs.openSync(file, 'r');
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile()) throw new Error('Not a regular file');
      const length = Math.min(stat.size, 128 * 1024);
      const buffer = Buffer.alloc(length);
      fs.readSync(descriptor, buffer, 0, length, stat.size - length);
      const content = buffer.toString('utf8');
      const patterns = [
        ['CONNECTION_REFUSED', /connection refused/gi], ['UPSTREAM_TIMEOUT', /upstream timed out/gi],
        ['PERMISSION_DENIED', /permission denied/gi], ['PRIMARY_SCRIPT_UNKNOWN', /primary script unknown/gi],
      ];
      out(`${file}: bytes=${length} modified=${stat.mtime.toISOString()} ${patterns.map(([label, pattern]) => `${label}=${[...content.matchAll(pattern)].length}`).join(' ')}`);
    } catch { out(`${file}: unavailable`); }
    finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  }
});
out('\nRead-only inspection complete. No services restarted; no configuration or application files changed.');
NODE
