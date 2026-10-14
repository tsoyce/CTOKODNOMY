#!/usr/bin/env bash
# Read-only diagnostics for one BrainyCP Node.js application.
# Usage: bash brainycp-preflight.sh APP_ROOT APP_USER PORT DOMAIN
# Run with the same SSH identity that will prepare the release. This script
# never reads .env/keys, changes files, or starts/stops application processes.
set -euo pipefail

fail() { printf 'Error: %s\n' "$*" >&2; exit 2; }
[[ $# -eq 4 ]] || fail 'Expected APP_ROOT APP_USER PORT DOMAIN'
app_root=$1
app_user=$2
app_port=$3
app_domain=$4
[[ $app_root == /* && $app_root != / && $app_root != *$'\n'* && $app_root != *$'\r'* ]] || fail 'APP_ROOT must be an absolute application directory'
[[ $app_user =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] || fail 'Invalid APP_USER'
[[ $app_port =~ ^[0-9]{1,5}$ ]] || fail 'Invalid PORT'
app_port=$((10#$app_port))
(( app_port >= 1 && app_port <= 65535 )) || fail 'PORT must be between 1 and 65535'
[[ $app_domain =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && $app_domain != *..* ]] || fail 'DOMAIN must be a hostname without a scheme or path'

printf 'SSH user: %s (uid %s)\n' "$(id -un)" "$(id -u)"
if id "$app_user" >/dev/null 2>&1; then
  printf 'Application user: %s (uid %s, primary group %s)\n' "$app_user" "$(id -u "$app_user")" "$(id -gn "$app_user")"
else
  printf 'Application user: missing\n'
fi

printf '\nApplication directory metadata (no file contents):\n'
for path in "$app_root" "$app_root/current" "$app_root/app.mjs" "$app_root/.env" "$app_root/shared" "$app_root/releases"; do
  if [[ -e $path || -L $path ]]; then
    stat --printf='%A %U:%G ' -- "$path"
    printf '%q\n' "$path"
    if [[ -L $path ]]; then
      printf '  link target: %q\n' "$(readlink -- "$path")"
    fi
  fi
done
if [[ ! -d $app_root ]]; then
  printf 'Application directory does not exist.\n'
elif [[ -r $app_root && -x $app_root ]]; then
  printf 'Top-level entries (names and permissions only):\n'
  while IFS= read -r -d '' path; do
    stat --printf='  %A %U:%G ' -- "$path"
    printf '%q\n' "${path##*/}"
  done < <(find "$app_root" -mindepth 1 -maxdepth 1 -print0)
else
  printf 'Application directory cannot be inspected by this SSH user.\n'
fi

printf '\nNode.js candidates (bounded standard/panel locations):\n'
declare -A seen_nodes=()
shopt -s nullglob
node_candidates=(
  /usr/bin/node /usr/local/bin/node
  /opt/node*/bin/node /opt/nodejs/*/bin/node
  /usr/local/node*/bin/node /usr/local/nodejs/*/bin/node
  /usr/local/brainycp/node*/bin/node
  /usr/local/brainycp/nodejs/*/bin/node
  /usr/local/brainycp/bin/nodejs/*/bin/node
)
if command -v node >/dev/null 2>&1; then node_candidates+=("$(command -v node)"); fi
for node_path in "${node_candidates[@]}"; do
  [[ -x $node_path && -f $node_path ]] || continue
  real_node=$(readlink -f -- "$node_path")
  [[ ! ${seen_nodes[$real_node]+present} ]] || continue
  seen_nodes[$real_node]=1
  printf '  %q: ' "$node_path"
  "$node_path" --version
  npm_path="${node_path%/*}/npm"
  if [[ -x $npm_path ]]; then
    printf '    npm: '
    PATH="${node_path%/*}:$PATH" "$npm_path" --version
  fi
done
if [[ ${#seen_nodes[@]} -eq 0 ]]; then printf '  No Node.js binary found in these locations.\n'; fi
printf 'The selected BrainyCP application runtime must be Node.js 24.\n'

printf '\nListener on application port %s:\n' "$app_port"
if command -v ss >/dev/null 2>&1; then
  ss -ltnp "sport = :$app_port"
else
  printf 'ss is unavailable.\n'
fi
if command -v curl >/dev/null 2>&1; then
  printf 'Local /api/health: '
  if ! curl --silent --show-error --connect-timeout 3 --max-time 5 --output /dev/null \
    --write-out 'HTTP %{http_code}; content type %{content_type}\n' \
    "http://127.0.0.1:$app_port/api/health"; then
    printf 'Local application health request failed.\n'
  fi
fi

printf '\nWeb configuration files mentioning the supplied hostname (paths only):\n'
config_roots=()
for config_root in /etc/nginx /usr/local/nginx/conf /etc/apache2 /etc/httpd /usr/local/apache/conf /usr/local/apache2/conf /usr/local/brainycp/conf; do
  [[ ! -d $config_root ]] || config_roots+=("$config_root")
done
if [[ ${#config_roots[@]} -gt 0 ]]; then
  if command -v rg >/dev/null 2>&1; then
    while IFS= read -r -d '' config_path; do printf '  %q\n' "$config_path"; done < <(
      rg --files-with-matches --null --follow --fixed-strings --glob '*.conf' --glob '*.vhost' \
        -- "$app_domain" "${config_roots[@]}" 2>/dev/null || :
    )
  else
    while IFS= read -r -d '' config_path; do
      if grep --quiet --fixed-strings -- "$app_domain" "$config_path" 2>/dev/null; then
        printf '  %q\n' "$config_path"
      fi
    done < <(find "${config_roots[@]}" -maxdepth 4 -type f \( -name '*.conf' -o -name '*.vhost' \) -print0 2>/dev/null)
  fi
fi
printf 'Proxy directives and panel restart settings still need an inspection of the matching site.\n'

printf '\nSystemd service files mentioning this application directory (paths only):\n'
for service_path in /etc/systemd/system/*.service /usr/lib/systemd/system/*.service /lib/systemd/system/*.service; do
  if [[ -r $service_path ]] && grep --quiet --fixed-strings -- "$app_root" "$service_path"; then
    printf '  %q\n' "$service_path"
  fi
done
printf 'No process manager is assumed or restarted.\n'

printf '\nPostgreSQL client/server availability:\n'
if command -v psql >/dev/null 2>&1; then
  psql --version
  if [[ $(id -u) -eq 0 ]] && id postgres >/dev/null 2>&1 && command -v runuser >/dev/null 2>&1; then
    if postgres_version=$(runuser -u postgres -- env -u PGPASSWORD -u PGSERVICE -u PGOPTIONS \
      PGCONNECT_TIMEOUT=3 psql --no-psqlrc --no-password --quiet --tuples-only --no-align \
      --command='SHOW server_version;' 2>/dev/null); then
      printf 'Local server version (postgres peer connection): %s\n' "$postgres_version"
    else
      printf 'Default postgres peer connection unavailable; use panel database settings.\n'
    fi
  fi
else
  printf 'psql is not on PATH; PostgreSQL may use a panel-specific location.\n'
fi
printf '\nPreflight complete. No files, database objects, processes, or proxy settings were changed.\n'
