#!/usr/bin/env bash
# Release-only update. Infrastructure is provisioned separately by its operator.
set -Eeuo pipefail
umask 077
helper_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$helper_dir/brainycp-guards.sh"
trap 'deployment_error "$?" "$LINENO"' ERR
fail() { printf 'Activation refused: %s\n' "$*" >&2; exit 2; }
[[ $# -eq 9 && $(id -u) == 0 ]] || fail 'Expected nine arguments and root.'
base=$1 app_user=$2 port=$3 domain=$4 sha=$5 app_digest=$6 incoming=$7 node_bin=$8 php_checks=$9
[[ $base =~ ^/[A-Za-z0-9_/-]+$ && $base != / && $(readlink -e "$base") == "$base" ]] || fail 'Application path must be physical.'
[[ $app_user =~ ^[a-z_][a-z0-9_-]*$ && $(id -u "$app_user") -gt 0 ]] || fail 'Expected an unprivileged application user.'
[[ $port =~ ^[1-9][0-9]{0,4}$ ]] && (( port <= 65535 )) || fail 'Invalid application port.'
[[ $domain =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ && $sha =~ ^[a-f0-9]{40}$ && $app_digest =~ ^[a-f0-9]{64}$ ]] || fail 'Invalid domain, commit or checksum.'
validate_php_checks "https://$domain/"
validate_php_checks "$php_checks"
[[ $incoming == "/var/lib/ctokodnomy-deploy/${app_user}-${port}/$sha" && -d $incoming && ! -L $incoming && $(readlink -e "$incoming") == "$incoming" && $(stat -c %u "$incoming") == 0 ]] || fail 'Invalid private incoming directory.'
for directory in /var/lib/ctokodnomy-deploy "$(dirname "$incoming")"; do
  [[ -d $directory && ! -L $directory && $(readlink -e "$directory") == "$directory" && $(stat -c %u "$directory") == 0 ]] && (( (8#$(stat -c %a "$directory") & 8#022) == 0 )) || fail 'Deployment parents must be physical, root-owned and not writable by group/others.'
  if [[ $directory == "$(dirname "$incoming")" ]]; then [[ $(stat -c %a "$directory") == 700 ]] || fail 'Private deployment parent must have mode 0700.'; fi
done
[[ -d $base && $(stat -c %U "$base") == "$app_user" ]] || fail 'Application directory owner does not match.'
[[ $node_bin =~ ^/[A-Za-z0-9_./-]+$ && -x $node_bin && -f $node_bin && $(readlink -e "$node_bin") == "$node_bin" ]] || fail 'Select the existing physical Node.js executable.'
# Helpers run as root: never execute a runtime writable by the application user.
runtime_path=$node_bin
while [[ $runtime_path != / ]]; do
  [[ $(stat -c %u "$runtime_path") == 0 ]] && (( (8#$(stat -c %a "$runtime_path") & 8#022) == 0 )) || fail 'Node.js and its parents must be root-owned and not writable by group/others.'
  runtime_path=$(dirname "$runtime_path")
done
[[ $("$node_bin" --version) =~ ^v24\.[0-9]+\.[0-9]+$ ]] || fail 'The existing application runtime must be Node.js 24.'
for utility in nginx pg_dump pg_restore runuser curl flock sha256sum cp ln mv; do command -v "$utility" >/dev/null; done
panel_main=/etc/brainy/conf/server_control/main
site="/etc/nginx/conf.d/$domain-game.conf"
[[ -f $site && ! -L $site && $(readlink -e "$site") == "$site" ]] || fail 'A separately provisioned conf.d/<domain>-game.conf is required.'
unit="nodejs@$port.service"
app_home=$(getent passwd "$app_user" | cut -d: -f6)
[[ $app_home =~ ^/[A-Za-z0-9_/-]+$ && $app_home != / && $(readlink -e "$app_home") == "$app_home" ]] || fail 'Application home must be physical.'
data="$app_home/.local/share/ctokodnomy/$port"
config="$app_home/.config/ctokodnomy/native-$port.env"
database="ctokodnomy_${app_user}_$port"
release="$base/releases/$sha"
[[ -L $base/current ]] || fail 'An existing working current release symlink is required.'
old_current=$(readlink -e "$base/current")
[[ $old_current =~ ^$base/releases/[a-f0-9]{40}$ && -d $old_current ]] || fail 'current must select an existing release under this application.'
[[ -f $old_current/app.mjs && ! -L $old_current/app.mjs && -f $old_current/dist/server/index.js && ! -L $old_current/dist/server/index.js && -L $old_current/.env && $(readlink -e "$old_current/.env") == "$config" ]] || fail 'Previous release files and environment must be available for rollback.'
[[ ! -e $release && ! -L $release ]] || fail 'Release already exists; review it before any retry.'
service_state() {
  systemctl show "$unit" -p User -p Group -p RootDirectory -p WorkingDirectory -p EnvironmentFiles -p FragmentPath -p DropInPaths
}
[[ $(systemctl show "$unit" -p User --value) == "$app_user" ]] || fail 'Service user does not match.'
[[ $(systemctl show "$unit" -p RootDirectory --value) == '' ]] || fail 'A jailed service needs a separate adapter.'
[[ $(systemctl show "$unit" -p WorkingDirectory --value) == "$base/current" ]] || fail 'Service must already run in APP_ROOT/current.'
validate_service_exec() {
  local exec_start
  exec_start=$(systemctl show "$unit" -p ExecStart --value)
  [[ $exec_start == "{ path=$node_bin ; argv[]=$node_bin $base/current/app.mjs ; "* && ${exec_start#?} != *'{'* ]] || fail 'Service must already run NODE_BIN APP_ROOT/current/app.mjs.'
}
validate_service_exec
[[ $(systemctl show "$unit" -p EnvironmentFiles --value) == "$config (ignore_errors=no)" ]] || fail 'Service must use the existing private application environment file.'
"$node_bin" "$helper_dir/native-db.mjs" check "$config" "$app_user" "https://$domain" "$port" "$data/uploads" "$database"
brainycp_guard "$panel_main"
if nginx -t >/dev/null 2>&1; then :; else
  status=$?
  printf 'Existing Nginx configuration check failed; ask its operator to investigate.\n' >&2
  deployment_error "$status" "$LINENO"
  exit "$status"
fi
# Inspect active includes without logging other sites' configuration.
nginx -T 2>/dev/null | awk -v expected="# configuration file $site:" '$0 == expected {found++} END {exit(found != 1)}' || {
  pipeline_status=("${PIPESTATUS[@]}")
  for status in "${pipeline_status[@]}"; do
    if (( status == 137 )); then deployment_error "$status" "$LINENO"; exit "$status"; fi
  done
  fail 'The dedicated proxy configuration must already be loaded exactly once.'
}
systemctl is-active --quiet "$unit" || fail 'The existing game service is not running.'
app_health() {
  local url body
  for url in "http://127.0.0.1:$port/api/health" "https://$domain/api/health"; do
    body=$(curl --disable --noproxy '*' --connect-timeout 5 --max-time 15 --max-filesize 65536 --fail --silent --show-error "$url") || return $?
    [[ $body == *'"ok":true'* ]] || return 1
  done
}
app_health
php_baseline=$(php_snapshot "$php_checks")
files_state=$(sha256sum "$panel_main" "$site" "$config")
file_modes=$(stat -c '%u:%g:%a' "$panel_main" "$site" "$config")
unit_state=$(service_state)
unit_text=$(systemctl cat "$unit")
assert_unchanged() {
  brainycp_guard "$panel_main"
  validate_service_exec
  [[ $(sha256sum "$panel_main" "$site" "$config") == "$files_state" && $(stat -c '%u:%g:%a' "$panel_main" "$site" "$config") == "$file_modes" ]] || fail 'Panel, proxy or application configuration changed during deployment.'
  [[ $(service_state) == "$unit_state" && $(systemctl cat "$unit") == "$unit_text" ]] || fail 'Service configuration changed during deployment.'
}
# Serialize even deployments started outside GitHub Actions, after read-only checks.
exec {lock_fd}> "$(dirname "$incoming")/deploy.lock"
flock --nonblock "$lock_fd" || fail 'Another deployment is in progress.'
assert_unchanged
[[ $(readlink -e "$base/current") == "$old_current" ]] || fail 'Current release changed during preflight.'
backup_parent="$(dirname "$incoming")/backups"
if [[ ! -e $backup_parent && ! -L $backup_parent ]]; then mkdir -m 700 "$backup_parent"; fi
[[ -d $backup_parent && ! -L $backup_parent && $(readlink -e "$backup_parent") == "$backup_parent" && $(stat -c %u "$backup_parent") == 0 && $(stat -c %a "$backup_parent") == 700 ]] || fail 'Backup parent must be a physical root-owned 0700 directory.'
backup="$backup_parent/$(date -u +%Y%m%dT%H%M%SZ)-$sha"
mkdir -m 700 "$backup"
cp --preserve=mode,ownership,timestamps --no-dereference -- "$panel_main" "$backup/brainy-main.conf"
cp --preserve=mode,ownership,timestamps --no-dereference -- "$site" "$backup/nginx-game.conf"
cp --preserve=mode,ownership,timestamps --no-dereference -- "$config" "$backup/application.env"
printf '%s\n' "$unit_state" > "$backup/service-state.txt"
printf '%s\n' "$unit_text" > "$backup/service.conf"
printf '%s\n' "$old_current" > "$backup/previous-release.txt"
printf '%s\n' "$files_state" > "$backup/configuration.sha256"
printf '%s\n' "$php_baseline" > "$backup/php-health.txt"
"$node_bin" "$helper_dir/native-db.mjs" backup "$config" "$backup/database.dump"
echo "Private backup verified: $backup."
# npm/extraction failures leave the working release and service untouched.
bash "$helper_dir/brainycp-stage.sh" "$base" "$app_user" "$sha" "$incoming/app.tar.gz" "$app_digest" "$node_bin"
assert_unchanged
php_snapshot "$php_checks" "$php_baseline" >/dev/null
[[ $(readlink -e "$base/current") == "$old_current" ]] || fail 'Current release changed while staging.'
[[ ! -e $release/.env && ! -L $release/.env ]] || fail 'Unexpected environment in the new release.'
runuser -u "$app_user" -- ln -s "$config" "$release/.env"
temporary="$base/.ctokodnomy-current-$sha"
rollback_temporary="$base/.ctokodnomy-rollback-$sha"
[[ ! -e $temporary && ! -L $temporary && ! -e $rollback_temporary && ! -L $rollback_temporary ]] || fail 'Unexpected pending release link; review it first.'
restart_attempted=0
rollback() {
  local result=$? rollback_result=0 current_target
  trap - EXIT ERR INT TERM HUP
  if (( result != 0 )); then
    set +e
    deployment_error "$result" 'release transaction'
    current_target=$(readlink -e "$base/current")
    if [[ $current_target == "$release" ]]; then
      runuser -u "$app_user" -- ln -s "$old_current" "$rollback_temporary" && runuser -u "$app_user" -- mv -Tf "$rollback_temporary" "$base/current"
      rollback_result=$?
      if (( rollback_result == 0 )); then
        systemctl restart "$unit"
        rollback_result=$?
        if (( rollback_result == 0 )); then app_health; rollback_result=$?; fi
      fi
      if (( rollback_result == 0 )); then
        echo 'Previous game code restored. Database was retained; startup migrations may already have run.' >&2
      else
        echo "GAME ROLLBACK FAILED. Review $backup; no other services or infrastructure were modified." >&2
      fi
    elif [[ $current_target != "$old_current" ]]; then
      echo 'Current release changed externally; automatic rollback refused to overwrite it.' >&2
    elif (( restart_attempted == 1 )); then
      echo 'Game restart failed before release verification; inspect the application service.' >&2
    fi
    runuser -u "$app_user" -- rm -f -- "$temporary"
    php_snapshot "$php_checks" "$php_baseline" >/dev/null || echo 'PHP health check still fails. No PHP or web-server recovery was attempted.' >&2
  fi
  exit "$result"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
runuser -u "$app_user" -- ln -s "$release" "$temporary"
assert_unchanged
runuser -u "$app_user" -- mv -Tf "$temporary" "$base/current"
restart_attempted=1
systemctl restart "$unit"
# Only connection/startup readiness is retried; command signal137 always aborts.
for (( attempt=1; attempt<=30; attempt++ )); do
  status=0
  body=$(curl --disable --noproxy '*' --connect-timeout 2 --max-time 3 --max-filesize 65536 --fail --silent "http://127.0.0.1:$port/api/health") || status=$?
  if (( status == 137 )); then exit 137; fi
  if (( status == 0 )) && [[ $body == *'"ok":true'* ]]; then break; fi
  if (( attempt == 30 )); then fail 'New game release did not become healthy.'; fi
  sleep 1
done
app_health
assert_unchanged
php_snapshot "$php_checks" "$php_baseline" >/dev/null
trap - EXIT INT TERM HUP
echo "Release verified: $sha; https://$domain; service $unit."
echo 'Nginx, BrainyCP, PHP, systemd configuration, certificates and runtime were left untouched.'
