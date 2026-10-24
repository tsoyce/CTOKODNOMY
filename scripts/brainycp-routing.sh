#!/usr/bin/env bash
# Read-only, bounded HTTP routing diagnostics. Never writes configuration.
set -euo pipefail
[[ $# -eq 5 ]] || exit 2
app_root=$1 app_user=$2 app_port=$3 app_domain=$4 probe_domain=$5
[[ $app_root =~ ^/[A-Za-z0-9_/-]+$ && $app_root != / ]] || exit 2
[[ $app_user =~ ^[a-z_][a-z0-9_-]*$ ]] || exit 2
[[ $app_port =~ ^[0-9]{1,5}$ ]] && (( 10#$app_port >= 1 && 10#$app_port <= 65535 )) || exit 2
for hostname in "$app_domain" "$probe_domain"; do
  [[ -z $hostname || ( $hostname =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && $hostname != *..* ) ]] || exit 2
done
[[ -n $app_domain ]] || exit 2
runtime=/opt/ctokodnomy-node/node-v24.21.0-linux-x64/bin/node
if [[ ! -x $runtime ]]; then runtime=$(command -v node) || exit 2; fi
"$runtime" --input-type=module - "$app_root" "$app_user" "$app_port" "$app_domain" "$probe_domain" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const [appRoot, appUser, appPort, appDomain, probeDomain] = process.argv.slice(2);
const domains = [...new Set([appDomain, probeDomain].filter(Boolean))];
const maximumOutput = 19 * 1024;
let emitted = 0, sectionRemaining = 1000, omitted = false;
function out(value = '') {
  const line = String(value).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, 480);
  const bytes = Buffer.byteLength(line) + 1;
  if (bytes > sectionRemaining || emitted + bytes > maximumOutput) { omitted = true; return; }
  sectionRemaining -= bytes; emitted += bytes; console.log(line);
}
function section(title, budget, callback) {
  sectionRemaining = budget; omitted = false; out(`\n${title}`);
  try { callback(); } catch { out('Metadata unavailable.'); }
  if (omitted) { sectionRemaining = 100; out('Additional metadata omitted by this section budget.'); }
}
function run(command, args, maxBuffer = 1024 * 1024) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 12000, maxBuffer, env: { ...process.env, LC_ALL: 'C', SYSTEMD_COLORS: '0', SYSTEMD_PAGER: 'cat' } });
  if (result.signal === 'SIGKILL' || result.status === 137) {
    console.error(`Read-only routing check aborted: ${path.basename(command)} SIGKILL/exit137; no retry.`); process.exit(137);
  }
  return result;
}
const sensitive = /(?:\.env(?:\W|$)|secret|passwd|password|credential|private|id_ed25519|id_rsa|\.key(?:\W|$))/i;
function safeValue(value) {
  return value.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@;]+@/gi, '$1[redacted]@')
    .replace(/\?[^\s;"']*/g, '?[redacted]').replace(/#[^\s;"']*/g, '#[redacted]')
    .replace(/\/[^\s;"']*/g, (item) => sensitive.test(item) ? '/[redacted-path]' : item);
}
function directive(statement) {
  const match = statement.trim().match(/^(listen|server_name|return|rewrite|proxy_pass|include|ServerName|ProxyPass|ProxyPassMatch|proxy_set_header)\s+([\s\S]+)$/i);
  if (!match) return null;
  if (/^proxy_set_header$/i.test(match[1]) && !/^Host\s+/i.test(match[2])) return null;
  if (/^return$/i.test(match[1]) && !/^\d{3}(?:\s|$)/.test(match[2])) return 'return [non-status value omitted]';
  if (/^return$/i.test(match[1]) && !/^\d{3}(?:\s+(?:https?:\/\/|\/|\$)[^\s]+)?$/.test(match[2])) return `return ${match[2].match(/^\d{3}/)?.[0] ?? ''} [body omitted]`;
  if (/^include$/i.test(match[1]) && sensitive.test(match[2])) return 'include [private path omitted]';
  return `${match[1]} ${safeValue(match[2])};`;
}
// Tokenize quotes/comments before interpreting braces, so inline server blocks
// and quoted rewrite expressions do not corrupt the block inventory.
function servers(text) {
  const blocks = []; const stack = []; let pending = '', quote = '', comment = false, escaped = false, variable = false, line = 1;
  for (const character of text) {
    if (character === '\n') line++;
    if (comment) { if (character === '\n') comment = false; else continue; }
    if (escaped) { pending += character; escaped = false; continue; }
    if (character === '\\') { pending += character; escaped = true; continue; }
    if (quote) { pending += character; if (character === quote) quote = ''; continue; }
    if (variable) { pending += character; if (character === '}') variable = false; continue; }
    if (character === '"' || character === "'") { quote = character; pending += character; continue; }
    if (character === '#') { comment = true; continue; }
    if (character === '{' && pending.endsWith('$')) { pending += character; variable = true; continue; }
    if (character === '{') {
      const header = pending.trim(); pending = '';
      const block = /^server$/.test(header) ? { line, directives: [] } : null;
      if (block) blocks.push(block); stack.push({ block, context: /^location\s/.test(header) ? safeValue(header).slice(0, 120) : /^if\s*\(/.test(header) ? 'if [condition omitted]' : '' }); continue;
    }
    if (character === '}') { stack.pop(); pending = ''; continue; }
    if (character === ';') {
      const block = [...stack].reverse().find(frame => frame.block)?.block; const safe = directive(pending);
      const context = stack.filter(frame => !frame.block && frame.context).map(frame => frame.context).join(' / ');
      if (block && safe && block.directives.length < 30) block.directives.push(`${context ? `${context} => ` : ''}${safe}`);
      pending = ''; continue;
    }
    pending += character;
  }
  return blocks;
}
function read(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('Unsupported file');
  return { stat, text: fs.readFileSync(file, 'utf8') };
}
function fingerprint(file) {
  const item = read(file); return { ...item, hash: createHash('sha256').update(item.text).digest('hex') };
}
function describe(file, maxDirectives = 14) {
  try {
    const item = fingerprint(file);
    out(`${safeValue(file)}: mtime=${item.stat.mtime.toISOString()} bytes=${item.stat.size} sha256=${item.hash}`);
    const selected = servers(item.text).flatMap((block, index) => [`server#${index + 1} line=${block.line}`, ...block.directives]);
    for (const value of selected.slice(0, maxDirectives)) out(`  ${value}`);
    // Apache panel vhosts have no Nginx server{} blocks.
    if (!selected.length) for (const line of item.text.split('\n').map(directive).filter(Boolean).slice(0, maxDirectives)) out(`  ${line}`);
    return item.hash;
  } catch { out(`${safeValue(file)}: absent or unsupported`); return null; }
}
out('READ-ONLY ROUTING DIAGNOSTICS'); out(`UTC: ${new Date().toISOString()}`);
const dedicated = `/etc/nginx/conf.d/${appDomain}-game.conf`;
let dedicatedHash;
section('Dedicated game proxy (routing directives only)', 2400, () => { dedicatedHash = describe(dedicated, 24); });
section('Selected panel site files', 2000, () => {
  for (const domain of domains) for (const file of [`/etc/nginx/sites-available/${domain}.conf`, `/etc/httpd/vhost.d/${domain}.conf`]) describe(file, 10);
});
let loaded = [];
section('Loaded Nginx server blocks, in configuration order', 4800, () => {
  const result = run('nginx', ['-T'], 16 * 1024 * 1024);
  out(`nginx -T exit=${result.status ?? 'unavailable'}`);
  if (result.status !== 0) return;
  let file, lines = [], dedicatedCopies = 0;
  function save() { if (file) for (const block of servers(lines.join('\n'))) loaded.push({ file, ...block }); }
  for (const line of result.stdout.split('\n')) {
    const header = line.match(/^# configuration file (\/[^\r\n]+):$/);
    if (header) { save(); file = header[1]; lines = []; if (file === dedicated) dedicatedCopies++; } else lines.push(line);
  }
  save(); out(`server blocks=${loaded.length}; loaded dedicated copies=${dedicatedCopies}`);
  const relevant = loaded.filter(block => block.file === dedicated || block.directives.some(value => /^server_name /.test(value) && domains.some(domain => value.split(/[\s;]+/).includes(domain))));
  for (const block of relevant) { out(`${safeValue(block.file)} server line=${block.line}`); for (const value of block.directives) out(`  ${value}`); }
  out('Other server listen/name inventory (first block on an address is an implicit default if no explicit default):');
  for (const block of loaded.filter(block => !relevant.includes(block)).slice(0, 45)) out(`${safeValue(block.file)}:${block.line} ${block.directives.filter(value => /^(listen|server_name) /.test(value)).join(' | ')}`);
});
section('Recent private deployment proxy backups', 3200, () => {
  const root = `/var/lib/ctokodnomy-deploy/${appUser}-${appPort}/backups`;
  if (!fs.existsSync(root)) { out('No private backup directory.'); return; }
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^\d{8}T\d{6}Z-[a-f0-9]{40}$/.test(entry.name)).map(entry => entry.name).sort().slice(-5);
  for (const name of entries) {
    const file = path.join(root, name, 'nginx-game.conf'); const hash = describe(file, 10);
    out(`  matches current dedicated proxy: ${hash && dedicatedHash ? hash === dedicatedHash : 'unavailable'}`);
  }
});
section('Nginx service metadata (no reload or restart)', 900, () => {
  const result = run('systemctl', ['show', 'nginx.service', '--property=ActiveState,SubState,Result,MainPID,ActiveEnterTimestamp,StateChangeTimestamp,ExecReload', '--no-pager']);
  for (const line of (result.stdout ?? '').split('\n')) {
    if (/^(ActiveState|SubState|Result|MainPID|ActiveEnterTimestamp|StateChangeTimestamp)=/.test(line)) out(line);
    if (line.startsWith('ExecReload=')) out(`ExecReload metadata: ${line.match(/start_time=[^;}]*/)?.[0] ?? 'unavailable'}; ${line.match(/stop_time=[^;}]*/)?.[0] ?? 'unavailable'}; ${line.match(/status=[^;}]*/)?.[0] ?? 'unavailable'}`);
  }
});
function location(value, origin) {
  if (!value) return '(none)';
  try { const url = new URL(value, origin); if (!['http:', 'https:'].includes(url.protocol)) return '(non-http target omitted)'; return safeValue(`${url.protocol}//${url.host}${url.pathname}${url.search ? '?[redacted]' : ''}`); }
  catch { return '(unparseable target omitted)'; }
}
section('DNS and HTTP GET probes (no redirects followed, strict TLS, discarded bodies)', 4800, () => {
  for (const domain of domains) {
    const result = run('getent', ['ahosts', domain]);
    const addresses = [...new Set((result.stdout ?? '').split('\n').map(line => line.trim().split(/\s+/)[0]).filter(value => /^[a-f0-9:.]+$/i.test(value)))].slice(0, 6);
    out(`Resolver ${domain}: exit=${result.status ?? 'unavailable'} addresses=${addresses.join(',') || '(none)'}`);
  }
  const sockets = run('ss', ['-ltn', 'sport = :80 or sport = :443']);
  const candidates = [...(sockets.stdout ?? '').matchAll(/(?:^|\s)((?:\d{1,3}\.){3}\d{1,3}):(?:80|443)(?:\s|$)/g)].map(match => match[1]);
  const interfaces = run('ip', ['-o', '-4', 'addr', 'show', 'scope', 'global']);
  candidates.push(...[...(interfaces.stdout ?? '').matchAll(/\binet\s+((?:\d{1,3}\.){3}\d{1,3})\//g)].map(match => match[1]));
  const address = candidates.find(value => value !== '0.0.0.0' && !value.startsWith('127.'));
  out(`Local IPv4 destination: ${address ?? '(unavailable)'}`);
  for (const domain of [...domains, 'ctok-routing-probe.invalid']) for (const scheme of ['http', 'https']) {
    const port = scheme === 'https' ? '443' : '80'; const url = `${scheme}://${domain}/`;
    for (const local of domain.endsWith('.invalid') ? [true] : [false, true]) {
      if (local && !address) continue;
      const args = ['--disable', '--noproxy', '*', '--proto', '=http,https', '--request', 'GET', '--connect-timeout', '4', '--max-time', '8', '--max-filesize', '1048576', '--silent', '--output', '/dev/null', '--dump-header', '-', '--write-out', '\nCTOK_ROUTE\t%{http_code}\t%{ssl_verify_result}\t%{remote_ip}'];
      if (local) args.push('--resolve', `${domain}:${port}:${address}`); args.push('--url', url);
      const result = run('curl', args); const output = result.stdout ?? ''; const marker = output.lastIndexOf('\nCTOK_ROUTE\t');
      const [status, tls, remote] = marker >= 0 ? output.slice(marker + 12).trim().split('\t') : [];
      const headers = marker >= 0 ? output.slice(0, marker) : '';
      const target = headers.match(/^location:\s*([^\r\n]+)/im)?.[1];
      out(`${local ? 'LOCAL' : 'PUBLIC'} GET ${url}: curl=${result.status ?? 'unavailable'} status=${/^\d{3}$/.test(status ?? '') ? status : 'unavailable'} tls=${/^\d+$/.test(tls ?? '') ? tls : 'unavailable'} remote=${/^[a-f0-9:.]+$/i.test(remote ?? '') ? remote : 'unavailable'} Location=${location(target, url)}${result.status === 60 ? ' (TLS validation failed; unsafe GET was not retried)' : ''}`);
    }
  }
});
NODE
