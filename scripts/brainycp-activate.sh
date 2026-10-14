#!/usr/bin/env bash
# Activate one checked release in the existing BrainyCP service.
set -euo pipefail
umask 077
[[ $# -eq 9 && $(id -u) == 0 ]] || exit 2
base=$1 app_user=$2 port=$3 domain=$4 sha=$5 node_version=$6 node_digest=$7 app_digest=$8 incoming=$9
[[ $base =~ ^/[A-Za-z0-9_/-]+$ && $base != / && $(readlink -e "$base") == "$base" ]] || exit 2
[[ $app_user =~ ^[a-z_][a-z0-9_-]*$ && $port =~ ^[1-9][0-9]{0,4}$ ]] || exit 2
[[ $domain =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ && $sha =~ ^[a-f0-9]{40}$ ]] || exit 2
[[ $node_version =~ ^24\.[0-9]+\.[0-9]+$ && $node_digest =~ ^[a-f0-9]{64}$ && $app_digest =~ ^[a-f0-9]{64}$ ]] || exit 2
[[ $incoming == "/var/lib/ctokodnomy-deploy/${app_user}-${port}/$sha" && -d $incoming && ! -L $incoming && $(stat -c %u "$incoming") == 0 ]] || exit 2
[[ $(uname -m) == x86_64 && $(stat -c %U "$base") == "$app_user" ]] || exit 2
unit="nodejs@$port.service"
[[ $(systemctl show "$unit" -p RootDirectory --value) == '' ]] || { echo 'A jailed service needs a separate adapter.'; exit 1; }
working=$(systemctl show "$unit" -p WorkingDirectory --value)
[[ $working == "$base" || $working == "$base/current" ]] || { echo 'Service directory does not match this application.'; exit 1; }
site="/etc/nginx/sites-available/$domain.conf"
[[ -f $site && ! -L $site ]] || { echo 'Expected BrainyCP site configuration not found.'; exit 1; }
grep -Fq "$domain" "$site"
bind_ip=$(awk '$1 == "listen" && $2 ~ /^[0-9.]+:80;$/ {split($2, p, ":"); print p[1]; exit}' "$site")
listen_prefix=''
if [[ -n $bind_ip ]]; then listen_prefix="$bind_ip:"; fi
for command in certbot nginx psql pg_dump pg_restore runuser openssl curl; do command -v "$command" >/dev/null; done
app_group=$(id -gn "$app_user")
app_home=$(getent passwd "$app_user" | cut -d: -f6)
[[ $app_home =~ ^/[A-Za-z0-9_/-]+$ && $app_home != / ]] || exit 2
data="$app_home/.local/share/ctokodnomy/$port"
config="$app_home/.config/ctokodnomy/native-$port.env"
database="ctokodnomy_${app_user}_$port"
runtime="/opt/ctokodnomy-node"
node_root="$runtime/node-v$node_version-linux-x64"
node_bin="$node_root/bin/node"
release="$base/releases/$sha"
dropin="/etc/systemd/system/$unit.d/50-ctokodnomy.conf"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$data/backups/$stamp-$sha"
for dir in "$base/shared" "$base/shared/runtime" "$data" "$data/uploads" "$data/backups"; do
  [[ ! -L $dir ]] || exit 2
  if [[ ! -e $dir ]]; then install -d -o "$app_user" -g "$app_group" -m 700 "$dir"; fi
  [[ -d $dir && $(stat -c %U "$dir") == "$app_user" ]] || exit 2
done
[[ ! -L $runtime ]] || exit 2
if [[ ! -e $runtime ]]; then install -d -o root -g root -m 755 "$runtime"; fi
[[ -d $runtime && $(stat -c %u "$runtime") == 0 && $(stat -c %a "$runtime") == 755 ]] || exit 2
# The official runtime has a root-owned location outside writable app folders.
if [[ ! -e $node_root ]]; then
  printf '%s  %s\n' "$node_digest" "$incoming/node.tar.xz" | sha256sum --check --status
  tar -xJf "$incoming/node.tar.xz" -C "$runtime" --no-same-owner
  chown -R root:root "$node_root"
fi
[[ ! -L $node_root && $(stat -c %u "$node_root") == 0 ]] || exit 2
[[ $("$node_bin" --version) == "v$node_version" ]] || exit 2
[[ ! -e $base/shared/runtime/node24 || -L $base/shared/runtime/node24 ]] || exit 2
ln -sfnT "$node_root" "$base/shared/runtime/node24"
echo 'Application Node.js 24 runtime ready.'
bash "$incoming/brainycp-stage.sh" "$base" "$app_user" "$sha" "$incoming/app.tar.gz" "$app_digest" "$node_bin"
install -d -m 700 "$backup"
cp -p "$site" "$backup/nginx.conf"
if [[ -f $dropin ]]; then cp -p "$dropin" "$backup/service.conf"; fi
old_current=''
if [[ -L $base/current ]]; then old_current=$(readlink "$base/current"); elif [[ -e $base/current ]]; then echo 'current is not a release symlink.'; exit 1; fi
stopped=0
activated=0
rollback() {
  result=$?
  if (( result != 0 && stopped == 1 && activated == 0 )); then
    if [[ -f $backup/service.conf ]]; then cp -p "$backup/service.conf" "$dropin"; else rm -f "$dropin"; fi
    if [[ -n $old_current ]]; then ln -sfnT "$old_current" "$base/current"; else rm -f "$base/current"; fi
    systemctl daemon-reload
    systemctl start "$unit" || true
    echo 'The previous application service was restored; database/configuration were retained.'
  fi
  if (( result != 0 )); then cp -p "$backup/nginx.conf" "$site"; nginx -t && systemctl reload nginx || true; fi
  exit "$result"
}
trap rollback EXIT
# Give ACME an explicit static challenge location, while retaining the old app.
cat > "$site" <<NGINX
server {
    listen ${listen_prefix}80;
    server_name $domain;
    location ^~ /.well-known/acme-challenge/ { root $base; try_files \$uri =404; }
    location / {
        proxy_pass http://127.0.0.1:$port;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
    }
}
NGINX
nginx -t
systemctl reload nginx
cert_name="ctokodnomy-$port"
certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --webroot --webroot-path "$base" --cert-name "$cert_name" --domain "$domain" \
  --deploy-hook 'systemctl reload nginx'
echo 'Public HTTPS certificate ready.'
systemctl stop "$unit"
stopped=1
"$node_bin" "$incoming/native-db.mjs" prepare "$config" "$app_user" "https://$domain" "$port" "$data/uploads" "$database"
"$node_bin" "$incoming/native-db.mjs" backup "$config" "$backup/database.dump"
[[ ! -e $release/.env && ! -L $release/.env ]] || exit 2
ln -s "$config" "$release/.env"
ln -sfnT "$release" "$base/current"
install -d -m 755 "$(dirname "$dropin")"
cat > "$dropin" <<UNIT
[Service]
User=$app_user
Group=$app_group
WorkingDirectory=$base/current
ExecStart=
ExecStart=$node_bin $base/current/app.mjs
EnvironmentFile=
EnvironmentFile=$config
UNIT
cat > "$site" <<NGINX
server {
    listen ${listen_prefix}80;
    server_name $domain;
    location ^~ /.well-known/acme-challenge/ { root $base; try_files \$uri =404; }
    location / { return 301 https://$domain\$request_uri; }
}
server {
    listen ${listen_prefix}443 ssl;
    server_name $domain;
    ssl_certificate /etc/letsencrypt/live/$cert_name/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$cert_name/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 3m;
    location / {
        proxy_pass http://127.0.0.1:$port;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 90s;
    }
}
NGINX
nginx -t
systemctl daemon-reload
systemctl start "$unit"
systemctl enable "$unit"
for attempt in $(seq 1 30); do
  if curl --disable --noproxy '*' --fail --silent "http://127.0.0.1:$port/api/health" | grep -q '"ok":true'; then break; fi
  sleep 1
done
curl --disable --noproxy '*' --fail --silent "http://127.0.0.1:$port/api/health" | grep -q '"ok":true'
[[ $(systemctl show "$unit" -p User --value) == "$app_user" ]]
systemctl reload nginx
curl --disable --fail --silent "https://$domain/api/health" | grep -q '"ok":true'
curl --disable --fail --silent "https://$domain/" | grep -q 'id="root"'
activated=1
echo "Deployment verified: https://$domain; user $app_user; loopback port $port."
echo "Release: $sha. Private backups: $backup."
