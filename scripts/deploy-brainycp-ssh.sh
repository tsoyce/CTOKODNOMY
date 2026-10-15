#!/usr/bin/env bash
set -Eeuo pipefail
helper_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$helper_dir/brainycp-guards.sh"
trap 'deployment_error "$?" "$LINENO"' ERR
fail() { printf '::error title=BrainyCP deployment::%s\n' "$*"; exit 2; }
[[ ${DEPLOY_HOST:-} =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || fail 'Invalid SSH server.'
[[ ${DEPLOY_USER:-} =~ ^[a-z_][a-z0-9_-]*$ ]] || fail 'Invalid SSH user.'
[[ ${APP_ROOT:-} =~ ^/[A-Za-z0-9_/-]+$ && $APP_ROOT != / && $APP_ROOT != */ ]] || fail 'Invalid application directory.'
[[ ${APP_USER:-} =~ ^[a-z_][a-z0-9_-]*$ && ${APP_PORT:-} =~ ^[1-9][0-9]{0,4}$ ]] || fail 'Invalid application user/port.'
(( APP_PORT <= 65535 )) || fail 'Invalid port.'
[[ ${APP_DOMAIN:-} =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ && ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ ]] || fail 'Invalid domain/commit.'
[[ ${APP_NODE_BIN:-} =~ ^/[A-Za-z0-9_./-]+$ ]] || fail 'Select an existing physical Node.js 24 binary.'
validate_php_checks "https://$APP_DOMAIN/"
validate_php_checks "${PHP_HEALTHCHECK_URLS:-}"
[[ -n ${DEPLOY_SSH_KEY:-} && -n ${SSH_KNOWN_HOSTS:-} ]] || fail 'SSH credentials and verified host key are required.'
export DEPLOY_SSH_PASSPHRASE=${DEPLOY_SSH_PASSPHRASE:-}
umask 077
auth_dir=$(mktemp -d "$RUNNER_TEMP/ctokodnomy-ssh.XXXXXX")
agent_started=0
cleanup() {
  if [[ $agent_started == 1 ]]; then ssh-agent -k >/dev/null 2>&1 || true; fi
  rm -rf "$auth_dir"
}
trap cleanup EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" | tr -d '\r' > "$auth_dir/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" | tr -d '\r' > "$auth_dir/known_hosts"
cat > "$auth_dir/askpass" <<'ASKPASS'
#!/usr/bin/env bash
printf '%s\n' "$DEPLOY_SSH_PASSPHRASE"
ASKPASS
chmod 600 "$auth_dir/key" "$auth_dir/known_hosts"
chmod 700 "$auth_dir/askpass"
eval "$(ssh-agent -s)" >/dev/null
agent_started=1
export SSH_ASKPASS="$auth_dir/askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=ctokodnomy-deploy
ssh-add "$auth_dir/key" </dev/null
opts=(-F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$auth_dir/known_hosts" -o GlobalKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ForwardAgent=no -o ClearAllForwardings=yes -o ConnectTimeout=15 -i "$auth_dir/key")
target="$DEPLOY_USER@$DEPLOY_HOST"
# This check runs from stdin before creating any directory on the server.
# The panel file is parsed as data, never sourced or modified.
ssh "${opts[@]}" "$target" "bash -s -- '/etc/brainy/conf/server_control/main' '$PHP_HEALTHCHECK_URLS'" < "$helper_dir/brainycp-guards.sh"
echo '::notice title=BrainyCP deployment stage::Panel guard and PHP baseline passed before upload.'
app_digest=$(sha256sum dist/ctokodnomy-native.tar.gz)
app_digest=${app_digest%% *}
incoming="/var/lib/ctokodnomy-deploy/${APP_USER}-${APP_PORT}/$GITHUB_SHA"
ssh "${opts[@]}" "$target" "bash -s -- '$APP_ROOT' '$APP_USER' '$incoming' '$APP_PORT' '$APP_DOMAIN' '$APP_NODE_BIN'" <<'PREPARE'
set -euo pipefail
base=$1 app_user=$2 incoming=$3 port=$4 domain=$5 node_bin=$6
[[ $(id -u) == 0 && $(id -u "$app_user") -gt 0 ]]
[[ -x $node_bin && $(readlink -e "$node_bin") == "$node_bin" ]]
[[ -L $base/current && -d $base/current ]]
systemctl is-active --quiet "nodejs@$port.service"
for url in "http://127.0.0.1:$port/api/health" "https://$domain/api/health"; do
  body=$(curl --disable --noproxy '*' --connect-timeout 5 --max-time 15 --max-filesize 65536 --fail --silent --show-error "$url")
  [[ $body == *'"ok":true'* ]]
done
[[ -d $base && ! -L $base && $(readlink -e "$base") == "$base" && $(stat -c %U "$base") == "$app_user" ]]
# Existing parents must be physical and root-owned; never follow an app link.
parent=$(dirname "$incoming")
for directory in /var/lib/ctokodnomy-deploy "$parent"; do
  if [[ ! -e $directory && ! -L $directory ]]; then mkdir -m 700 "$directory"; fi
  [[ -d $directory && ! -L $directory && $(readlink -e "$directory") == "$directory" && $(stat -c %u "$directory") == 0 ]]
  (( (8#$(stat -c %a "$directory") & 8#022) == 0 ))
  if [[ $directory == "$parent" ]]; then [[ $(stat -c %a "$directory") == 700 ]]; fi
done
[[ ! -e $incoming && ! -L $incoming ]]
mkdir -m 700 "$incoming"
PREPARE
echo '::notice title=BrainyCP deployment stage::Private incoming directory prepared.'
ssh "${opts[@]}" "$target" "cat > '$incoming/app.tar.gz'" < dist/ctokodnomy-native.tar.gz
for helper in brainycp-guards.sh brainycp-stage.sh native-unpack.mjs native-db.mjs brainycp-activate.sh; do
  ssh "${opts[@]}" "$target" "cat > '$incoming/$helper'" < "scripts/$helper"
done
echo '::notice title=BrainyCP deployment stage::Verified SSH transfer complete.'
if report=$(ssh "${opts[@]}" "$target" \
  "bash '$incoming/brainycp-activate.sh' '$APP_ROOT' '$APP_USER' '$APP_PORT' '$APP_DOMAIN' '$GITHUB_SHA' '$app_digest' '$incoming' '$APP_NODE_BIN' '$PHP_HEALTHCHECK_URLS'" 2>&1); then
  report_type=notice
else
  report_type=error
fi
printf '%s\n' "$report"
# GitHub limits annotation messages; keep the final result and error details.
annotation_report=$report
if (( ${#report} > 3500 )); then annotation_report=${report: -3500}; fi
escaped=${annotation_report//%/%25}
escaped=${escaped//$'\r'/%0D}
escaped=${escaped//$'\n'/%0A}
printf '::%s title=BrainyCP deployment report::%s\n' "$report_type" "$escaped"
[[ $report_type == notice ]]
