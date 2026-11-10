#!/usr/bin/env bash
# One-time library import. Reads survey JSON from stdin; never logs or stores it.
set +x
set -Eeuo pipefail
umask 077
# Ignore caller PostgreSQL variables; the managed config is the sole authority.
while IFS= read -r var; do if [[ $var =~ ^PG[A-Z0-9_]*$ ]]; then unset "$var"; fi; done < <(compgen -e)
helper_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$helper_dir/brainycp-guards.sh"
fail() { printf 'Survey import refused: %s\n' "$*" >&2; exit 2; }
trap 'deployment_error "$?" "$LINENO"' ERR
[[ $# == 10 && $(id -u) == 0 ]] || fail 'Expected ten arguments and root.'
base=$1 app_user=$2 port=$3 domain=$4 node_bin=$5 php_checks=$6 incoming=$7 expected_hash=$8 worker_hash=$9 release_sha=${10}
[[ $base =~ ^/[A-Za-z0-9_/-]+$ && $base != / && $(readlink -e "$base") == "$base" ]] || fail 'Application path must be physical.'
[[ $app_user =~ ^[a-z_][a-z0-9_-]*$ && $(id -u "$app_user") -gt 0 ]] || fail 'Expected non-root application user.'
[[ $port =~ ^[1-9][0-9]{0,4}$ ]] && (( port <= 65535 )) || fail 'Invalid application port.'
[[ $domain =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ && $expected_hash =~ ^[a-f0-9]{64}$ && $worker_hash =~ ^[a-f0-9]{64}$ && $release_sha =~ ^[a-f0-9]{40}$ ]] || fail 'Invalid hostname, hash or release.'
validate_php_checks "https://$domain/"
validate_php_checks "$php_checks"
pattern="^/var/lib/ctokodnomy-deploy/${app_user}-${port}/survey-[1-9][0-9]*-[1-9][0-9]*$"
[[ $incoming =~ $pattern && -d $incoming && ! -L $incoming && $(readlink -e "$incoming") == "$incoming" && $(stat -c %u "$incoming") == 0 && $(stat -c %a "$incoming") == 700 && $helper_dir == "$incoming" ]] || fail 'Invalid private incoming directory.'
for dir in /var/lib/ctokodnomy-deploy "$(dirname "$incoming")"; do
 [[ -d $dir && ! -L $dir && $(readlink -e "$dir") == "$dir" && $(stat -c %u "$dir") == 0 ]] && (( (8#$(stat -c %a "$dir") & 8#022) == 0 )) || fail 'Unsafe deployment parent.'
done
[[ $(stat -c %a "$(dirname "$incoming")") == 700 ]] || fail 'Deployment parent is not private.'
for file in survey-import-worker.mjs native-db.mjs brainycp-guards.sh; do
 [[ -f $incoming/$file && ! -L $incoming/$file && $(stat -c %u "$incoming/$file") == 0 ]] && (( (8#$(stat -c %a "$incoming/$file") & 8#022) == 0 )) || fail 'Unsafe helper file.'
done
[[ $(sha256sum "$incoming/survey-import-worker.mjs" | cut -d' ' -f1) == "$worker_hash" ]] || fail 'Worker hash differs from the reviewed build.'
[[ -d $base && $(stat -c %U "$base") == "$app_user" && -L $base/current ]] || fail 'Unknown application layout.'
release=$(readlink -e "$base/current")
[[ $release == "$base/releases/$release_sha" && -d $release && -f $release/package.json ]] || fail 'The expected release is not active.'
[[ $node_bin =~ ^/[A-Za-z0-9_./-]+$ && -x $node_bin && -f $node_bin && $(readlink -e "$node_bin") == "$node_bin" ]] || fail 'Expected an existing physical Node runtime.'
runtime_path=$node_bin
while [[ $runtime_path != / ]]; do
 [[ $(stat -c %u "$runtime_path") == 0 ]] && (( (8#$(stat -c %a "$runtime_path") & 8#022) == 0 )) || fail 'Unsafe Node runtime or parent.'
 runtime_path=$(dirname "$runtime_path")
done
[[ $("$node_bin" --version) =~ ^v24\.[0-9]+\.[0-9]+$ ]] || fail 'Node 24 is required.'
app_home=$(getent passwd "$app_user" | cut -d: -f6)
while [[ $app_home == *'/./'* ]]; do app_home=${app_home//\/.\//\/}; done
if [[ $app_home == */. ]]; then app_home=${app_home%.}; fi
while [[ $app_home == */ && $app_home != / ]]; do app_home=${app_home%/}; done
[[ $app_home =~ ^/[A-Za-z0-9_/-]+$ && $app_home != / && $(readlink -e "$app_home") == "$app_home" ]] || fail 'Application home is not physical.'
config="$app_home/.config/ctokodnomy/native-$port.env"
data="$app_home/.local/share/ctokodnomy/$port"
database="ctokodnomy_${app_user}_$port"
unit="nodejs@$port.service"
[[ -L $release/.env && $(readlink -e "$release/.env") == "$config" ]] || fail 'Release environment differs from the existing service.'
[[ $(systemctl show "$unit" -p User --value) == "$app_user" && $(systemctl show "$unit" -p WorkingDirectory --value) == "$base/current" ]] || fail 'Unexpected service identity.'
[[ $(systemctl show "$unit" -p EnvironmentFiles --value) == "$config (ignore_errors=no)" ]] || fail 'Unexpected service environment files.'
service_env=$(systemctl show "$unit" -p Environment --value)
pass_env=$(systemctl show "$unit" -p PassEnvironment --value)
if [[ $service_env =~ (PG[A-Z0-9_]*|DATABASE_URL)[[:space:]]*= || $pass_env =~ (PG[A-Z0-9_]*|DATABASE_URL) ]]; then
 fail 'Service has PostgreSQL overrides; inspect its configuration before importing.'
fi
systemctl is-active --quiet "$unit" || fail 'Game service is not running.'
service_pid=$(systemctl show "$unit" -p MainPID --value)
[[ $service_pid =~ ^[1-9][0-9]*$ && $(stat -c %u "/proc/$service_pid") == "$(id -u "$app_user")" ]] || fail 'Unexpected running game process.'
check_running_environment() {
 "$node_bin" -e '
 const fs=require("node:fs"),{parseEnv}=require("node:util");
 try {
  const [pid,file]=process.argv.slice(1); const conf=parseEnv(fs.readFileSync(file,"utf8"));
  const env=Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`).toString("utf8").split("\0").filter(Boolean).map(x=>{const i=x.indexOf("=");return [x.slice(0,i),x.slice(i+1)]}));
  const hasPg = obj => Object.keys(obj).some(k=>/^PG[A-Z0-9_]*$/.test(k));
  if(hasPg(env) || hasPg(conf) || !conf.DATABASE_URL || env.DATABASE_URL!==conf.DATABASE_URL) process.exit(1);
 } catch {process.exit(1)}
 ' "$service_pid" "$config" || fail 'Running process and managed config do not have the same safe database environment.'
}
check_running_environment
"$node_bin" "$incoming/native-db.mjs" check "$config" "$app_user" "https://$domain" "$port" "$data/uploads" "$database" >/dev/null
brainycp_guard /etc/brainy/conf/server_control/main
php_baseline=$(php_snapshot "$php_checks")
app_health() {
 local url body
 for url in "http://127.0.0.1:$port/api/health" "https://$domain/api/health"; do
  body=$(curl --disable --noproxy '*' --connect-timeout 5 --max-time 15 --max-filesize 65536 --fail --silent --show-error "$url") || return $?
  [[ $body == *'"ok":true'* ]] || return 1
 done
}
app_health
exec {lock_fd}> "$(dirname "$incoming")/deploy.lock"
flock --nonblock "$lock_fd" || fail 'Another deployment or import holds the game lock.'
[[ $(readlink -e "$base/current") == "$release" ]] || fail 'The current release changed during preflight.'
[[ -f $config && ! -L $config && $(readlink -e "$config") == "$config" && $(stat -c %u "$config") == "$(id -u "$app_user")" && $(stat -c %a "$config") == 600 ]] || fail 'Managed config is not a private physical app-owned file.'
config_hash=$(sha256sum "$config"); config_hash=${config_hash%% *}
config_meta=$(stat -c '%d:%i:%s:%Y:%Z:%u:%g:%a' "$config")
assert_config_unchanged() {
 [[ $(systemctl show "$unit" -p MainPID --value) == "$service_pid" && $(readlink -e "$base/current") == "$release" ]] || fail 'Game process or release changed.'
 [[ $(sha256sum "$config" | cut -d' ' -f1) == "$config_hash" && $(stat -c '%d:%i:%s:%Y:%Z:%u:%g:%a' "$config") == "$config_meta" ]] || fail 'Managed config changed while importing.'
 check_running_environment
}
"$node_bin" "$incoming/native-db.mjs" check "$config" "$app_user" "https://$domain" "$port" "$data/uploads" "$database" >/dev/null
assert_config_unchanged
brainycp_guard /etc/brainy/conf/server_control/main
php_snapshot "$php_checks" "$php_baseline" >/dev/null
backup_parent="$(dirname "$incoming")/backups"
[[ -d $backup_parent && ! -L $backup_parent && $(readlink -e "$backup_parent") == "$backup_parent" && $(stat -c %u "$backup_parent") == 0 && $(stat -c %a "$backup_parent") == 700 ]] || fail 'The private backup directory does not exist or is unsafe.'
backup="$backup_parent/${incoming##*/}"
[[ ! -e $backup && ! -L $backup ]] || fail 'This import backup already exists; inspect before retrying.'
mkdir -m 700 "$backup"
assert_config_unchanged
"$node_bin" "$incoming/native-db.mjs" backup "$config" "$backup/database.dump"
assert_config_unchanged
printf 'Verified private database backup created.\n'
# The worker runs with app-user privileges and receives the survey only via stdin.
# The temporary directory contains code only; even SIGKILL cannot leave JSON behind.
tmpdir=$(mktemp -d /tmp/ctokodnomy-survey-worker.XXXXXXXX)
cleanup() { rm -f -- "$tmpdir/worker.mjs"; rmdir -- "$tmpdir" 2>/dev/null || true; }
trap cleanup EXIT
chown "$app_user" "$tmpdir"
chmod 700 "$tmpdir"
install -o "$app_user" -m 600 "$incoming/survey-import-worker.mjs" "$tmpdir/worker.mjs"
[[ $(sha256sum "$tmpdir/worker.mjs" | cut -d' ' -f1) == "$worker_hash" ]] || fail 'Worker changed while preparing execution.'
assert_config_unchanged
runuser -u "$app_user" -- "$node_bin" "$tmpdir/worker.mjs" "$config" "$release" "$expected_hash" "$database" "$config_hash"
brainycp_guard /etc/brainy/conf/server_control/main
php_snapshot "$php_checks" "$php_baseline" >/dev/null
[[ $(readlink -e "$base/current") == "$release" ]] || fail 'Release changed during import; investigate.'
systemctl is-active --quiet "$unit" || fail 'Game service is no longer healthy.'
app_health
printf 'Survey import complete; service and shared infrastructure were not restarted.\n'
