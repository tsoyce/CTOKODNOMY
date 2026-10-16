#!/usr/bin/env bash
# Read-only details for the Node application identified by the first preflight.
set -euo pipefail
[[ $# -eq 4 || $# -eq 5 ]] || exit 2
app_root=$1 app_user=$2 app_port=$3 app_domain=$4 probe_domain=${5:-}
[[ $app_root =~ ^/[A-Za-z0-9_/-]+$ && $app_root != / ]] || exit 2
[[ $app_user =~ ^[a-z_][a-z0-9_-]*$ ]] || exit 2
[[ $app_port =~ ^[0-9]{1,5}$ ]] || exit 2
(( 10#$app_port >= 1 && 10#$app_port <= 65535 )) || exit 2
[[ $app_domain =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && $app_domain != *..* ]] || exit 2
[[ -z $probe_domain || ( $probe_domain =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && $probe_domain != *..* ) ]] || exit 2

printf 'Operating system: '; uname -sm
getconf GNU_LIBC_VERSION
printf '\nAvailable disk:\n'; df -Ph -- "$app_root"
printf '\nMemory:\n'; free -m
printf '\nRecent kernel memory kills (last 30 minutes):\n'
if command -v journalctl >/dev/null 2>&1; then
  if journalctl -k --since '30 minutes ago' --no-pager -o cat 2>/dev/null |
    awk 'tolower($0) ~ /out of memory|oom-kill|killed process|memory cgroup out/ { print; found=1 } END { if (!found) print "No matching kernel messages." }' |
    tail -n 8; then :; else
    detail_status=$?
    if (( detail_status == 137 )); then
      printf 'Read-only check aborted: journal inspection SIGKILL/exit137; no retry.\n' >&2
      exit 137
    fi
  fi
fi
printf '\nSSH process memory limits:\n'
memory_cgroup=$(awk -F: '$1 == "0" { print $3 }' /proc/self/cgroup)
if [[ $memory_cgroup == /* && $memory_cgroup =~ ^/[A-Za-z0-9_./-]*$ ]]; then
  for metric in memory.max memory.current memory.events; do
    metric_file="/sys/fs/cgroup$memory_cgroup/$metric"
    if [[ -r $metric_file ]]; then printf '%s: ' "$metric"; cat -- "$metric_file"; fi
  done
fi
printf '\nArchive copy utility metadata:\n'
copy_path=$(command -v cp)
stat -Lc '%A %U:%G %s %n' -- "$copy_path"
printf '\nApplication unit:\n'
systemctl show "nodejs@$app_port.service" \
  --property=MainPID,User,Group,WorkingDirectory,FragmentPath,DropInPaths,ActiveState,SubState,Restart
printf '\nEffective runtime and release (paths only; applied drop-ins included):\n'
APP_ROOT="$app_root" APP_USER="$app_user" APP_PORT="$app_port" APP_DOMAIN="$app_domain" PROBE_DOMAIN="$probe_domain" node --input-type=module <<'NODE'
import { existsSync, lstatSync, readFileSync, realpathSync, openSync, readSync, closeSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const appRoot = process.env.APP_ROOT, appUser = process.env.APP_USER, port = process.env.APP_PORT;
const domain = process.env.APP_DOMAIN, probe = process.env.PROBE_DOMAIN;
const safePath = value => typeof value === 'string' && /^\/[A-Za-z0-9_./@:+-]+$/.test(value);
function run(file, args, maxBuffer = 1024 * 1024) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 15000, maxBuffer });
  if (result.signal === 'SIGKILL' || result.status === 137) {
    console.error(`Read-only check aborted: ${basename(file)} SIGKILL/exit137; no retry.`);
    process.exit(137);
  }
  return result;
}
function text(file) {
  const entry = lstatSync(file);
  if (!entry.isFile() || entry.size > 1024 * 1024) throw new Error('Not a bounded regular file');
  return readFileSync(file, 'utf8');
}
function resolved(file) { try { const path = realpathSync(file); return safePath(path) ? path : '(unavailable)'; } catch { return '(unavailable)'; } }
function metadata(file) {
  try { const s = lstatSync(file); return `regular=${s.isFile()} symlink=${s.isSymbolicLink()} mode=${(s.mode & 0o777).toString(8)} uid=${s.uid} gid=${s.gid}`; }
  catch { return '(unavailable)'; }
}
const shown = run('systemctl', ['show', `nodejs@${port}.service`, '--property=ExecStart,MainPID,EnvironmentFiles']);
const fields = new Map((shown.stdout ?? '').split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
// Never print argv[], arbitrary unit arguments or Environment= contents.
const binary = fields.get('ExecStart')?.match(/(?:^|[\s{])path=(\/[A-Za-z0-9_./@:+-]+)\s*;/)?.[1];
console.log(`Effective ExecStart executable: ${binary ?? '(not identified)'}`);
const pid = fields.get('MainPID');
if (/^[1-9][0-9]{0,9}$/.test(pid ?? '')) {
  console.log(`Running executable realpath: ${resolved(`/proc/${pid}/exe`)}`);
  console.log(`Running cwd realpath: ${resolved(`/proc/${pid}/cwd`)}`);
}
console.log(`Current release realpath: ${resolved(join(appRoot, 'current'))}`);
console.log(`EnvironmentFiles paths: ${(fields.get('EnvironmentFiles')?.match(/\/[A-Za-z0-9_./@:+-]+(?=\s|$)/g) ?? []).join(', ') || '(none identified)'}`);
const account = run('getent', ['passwd', appUser]);
const accountFields = account.status === 0 ? account.stdout.trim().split(':') : [];
const home = accountFields[0] === appUser ? accountFields[5] : '';
if (safePath(home)) {
  const config = join(home, '.config/ctokodnomy', `native-${port}.env`);
  console.log(`Expected private config: ${config}; ${metadata(config)}`);
  let marker = false;
  try { marker = /^\s*CTOKODNOMY_MANAGED_CONFIG\s*=\s*(?:1|"1"|'1')\s*(?:#.*)?$/m.test(text(config)); } catch {}
  console.log(`Managed configuration marker present: ${marker}`);
}
try {
  const panel = '/etc/brainy/conf/server_control/main';
  const lines = text(panel).split('\n').filter(line => !/^\s*[#;]/.test(line) && /^\s*back_server(?:[^A-Za-z0-9_]|$)/.test(line));
  const value = lines[0]?.match(/^\s*back_server(?:\s*=\s*|\s+)(.*)$/)?.[1] ?? '';
  const supported = /^(?:[A-Za-z0-9_./:+-]+|"[A-Za-z0-9_./:+-]+"|'[A-Za-z0-9_./:+-]+')\s*(?:[#;].*)?$/.test(value);
  console.log(`back_server active_count=${lines.length}; single_nonempty_supported=${lines.length === 1 && supported}; physical=${resolved(panel) === panel} (authoritative guard runs during deployment)`);
} catch { console.log('back_server metadata unavailable'); }
const dedicated = `/etc/nginx/conf.d/${domain}-game.conf`;
console.log(`Dedicated proxy: ${dedicated}; ${metadata(dedicated)}; physical=${resolved(dedicated) === dedicated}`);
const nginx = run('nginx', ['-T'], 16 * 1024 * 1024);
console.log(`Dedicated proxy loaded count: ${nginx.status === 0 ? (nginx.stdout ?? '').split('\n').filter(line => line === `# configuration file ${dedicated}:`).length : '(unavailable)'}`);
if (probe) {
  let root, handler;
  try {
    for (const block of text(`/etc/httpd/vhost.d/${probe}.conf`).matchAll(/<VirtualHost\b[^>]*>([\s\S]*?)<\/VirtualHost>/gi)) {
      const lines = block[1].split('\n').map(line => line.trim()).filter(line => !line.startsWith('#'));
      if (!lines.some(line => line.match(/^ServerName\s+([^\s]+)\s*$/i)?.[1] === probe)) continue;
      root = lines.map(line => line.match(/^DocumentRoot\s+["']?(\/[^"'\s]+)["']?\s*$/i)?.[1]).find(safePath) ?? root;
      handler = lines.filter(line => /^SetHandler\s+/i.test(line)).map(line => line.match(/unix:(\/[A-Za-z0-9_./@:+-]+\.sock)(?:\||["'\s]|$)/i)?.[1]).find(safePath) ?? handler;
    }
  } catch {}
  let indexExists = false, phpPrefix = false, fd;
  try {
    const index = root ? join(root, 'index.php') : '';
    indexExists = Boolean(root) && existsSync(index) && lstatSync(index).isFile();
    if (indexExists) { fd = openSync(index, 'r'); const buffer = Buffer.alloc(512); const count = readSync(fd, buffer, 0, buffer.length, 0); phpPrefix = /^(?:\uFEFF)?\s*<\?(?:php\b|=)/i.test(buffer.subarray(0, count).toString('utf8')); }
  } catch {} finally { if (fd !== undefined) closeSync(fd); }
  console.log(`PHP DocumentRoot identified=${Boolean(root)}; index.php regular_exists=${indexExists}; php_prefix=${phpPrefix}`);
  console.log(`Selected PHP handler socket: ${handler ?? '(not identified)'}`);
  const url = `https://${probe}/index.php`;
  const response = run('curl', ['--disable', '--noproxy', '*', '--proto', '=https', '--request', 'GET', '--connect-timeout', '5', '--max-time', '12', '--silent', '--output', '/dev/null', '--write-out', '%{http_code}\t%{content_type}\t%{ssl_verify_result}', '--url', url]);
  const [status, type, tls] = (response.stdout ?? '').split('\t');
  console.log(`PHP GET ${url}: curl_exit=${response.status ?? '(unavailable)'}; status=${/^\d{3}$/.test(status ?? '') ? status : '(unavailable)'}; content_type=${/^[A-Za-z0-9/+.;= _-]{0,160}$/.test(type ?? '') ? type || '(empty)' : '(unavailable)'}; tls_verify=${/^\d+$/.test(tls ?? '') ? tls : '(unavailable)'}; redirects_followed=false`);
}
NODE
printf '\nSelected proxy/certificate directives for this domain:\n'
APP_DOMAIN="$app_domain" node --input-type=module <<'NODE'
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const domain = process.env.APP_DOMAIN;
const certificates = new Set();
for (const file of [`/etc/nginx/sites-available/${domain}.conf`, `/etc/httpd/vhost.d/${domain}.conf`]) {
  if (!existsSync(file)) continue;
  console.log(file);
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!/^(listen|server_name|root|proxy_pass|ssl_certificate|ServerName|DocumentRoot|SSLCertificateFile|ProxyPass)\s/i.test(trimmed)) continue;
    if (/^(ssl_certificate_key|SSLCertificateKeyFile)\s/i.test(trimmed)) continue;
    console.log(' ', trimmed.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[redacted]@'));
    const match = trimmed.match(/^(?:ssl_certificate|SSLCertificateFile)\s+["']?([^;"'\s]+)/i);
    if (match && match[1].startsWith('/')) certificates.add(match[1]);
  }
}
for (const file of certificates) {
  console.log('Public certificate metadata:', file);
  const result = spawnSync('openssl', ['x509', '-in', file, '-noout', '-subject', '-issuer', '-dates', '-ext', 'subjectAltName'], { encoding: 'utf8' });
  console.log(result.status === 0 ? result.stdout.trim() : 'Certificate could not be inspected.');
}
NODE
printf '\nACME client availability (paths only):\n'
for program in certbot acme.sh; do command -v "$program" || true; done
for candidate in /root/.acme.sh/acme.sh /usr/local/brainycp/acme.sh/acme.sh /usr/local/brainy/acme.sh/acme.sh; do
  if [[ -f $candidate ]]; then stat -c '%A %U:%G %n' "$candidate"; fi
done
printf '\nDetailed inspection complete. No configuration contents, credentials or private keys were printed.\n'
