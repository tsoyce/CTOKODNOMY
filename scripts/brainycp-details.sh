#!/usr/bin/env bash
# Read-only details for the Node application identified by the first preflight.
set -euo pipefail
[[ $# -eq 4 ]] || exit 2
app_root=$1 app_user=$2 app_port=$3 app_domain=$4
[[ $app_root =~ ^/[A-Za-z0-9_/-]+$ && $app_root != / ]] || exit 2
[[ $app_user =~ ^[a-z_][a-z0-9_-]*$ ]] || exit 2
[[ $app_port =~ ^[0-9]{1,5}$ ]] || exit 2
[[ $app_domain =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || exit 2

printf 'Operating system: '; uname -sm
getconf GNU_LIBC_VERSION
printf '\nAvailable disk:\n'; df -Ph -- "$app_root"
printf '\nMemory:\n'; free -m
printf '\nApplication unit:\n'
systemctl show "nodejs@$app_port.service" \
  --property=MainPID,User,Group,WorkingDirectory,FragmentPath,DropInPaths,ActiveState,SubState,Restart
printf '\nRuntime/entry paths in unit (no environment or arbitrary arguments):\n'
unit_path=$(systemctl show "nodejs@$app_port.service" --property=FragmentPath --value)
if [[ -r $unit_path ]]; then
  APP_ROOT="$app_root" UNIT_PATH="$unit_path" node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const content = readFileSync(process.env.UNIT_PATH, 'utf8');
const root = process.env.APP_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const line of content.split('\n')) {
  if (!line.startsWith('ExecStart=')) continue;
  const binary = line.match(/^ExecStart=([^\s]+)/)?.[1];
  console.log('Executable:', binary ?? '(not a plain path)');
  console.log('Application paths:', [...new Set(line.match(new RegExp(root + '/[A-Za-z0-9_./-]+', 'g')) ?? [])].join(', '));
}
NODE
fi
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
