#!/usr/bin/env bash
set -euo pipefail
fail() { printf '::error title=BrainyCP deployment::%s\n' "$*"; exit 2; }
[[ ${DEPLOY_HOST:-} =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || fail 'Invalid SSH server.'
[[ ${DEPLOY_USER:-} =~ ^[a-z_][a-z0-9_-]*$ ]] || fail 'Invalid SSH user.'
[[ ${APP_ROOT:-} =~ ^/[A-Za-z0-9_/-]+$ && $APP_ROOT != / && $APP_ROOT != */ ]] || fail 'Invalid application directory.'
[[ ${APP_USER:-} =~ ^[a-z_][a-z0-9_-]*$ && ${APP_PORT:-} =~ ^[1-9][0-9]{0,4}$ ]] || fail 'Invalid application user/port.'
(( APP_PORT <= 65535 )) || fail 'Invalid port.'
[[ ${APP_DOMAIN:-} =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ && ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ ]] || fail 'Invalid domain/commit.'
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
node_version=$(node -p 'process.versions.node')
[[ $node_version =~ ^24\.[0-9]+\.[0-9]+$ ]] || fail 'Build must use Node.js 24.'
node_name="node-v$node_version-linux-x64.tar.xz"
curl --disable --fail --silent --show-error "https://nodejs.org/dist/v$node_version/$node_name" -o "$auth_dir/node.tar.xz"
curl --disable --fail --silent --show-error "https://nodejs.org/dist/v$node_version/SHASUMS256.txt" -o "$auth_dir/checksums"
node_digest=$(awk -v name="$node_name" '$2 == name {print $1}' "$auth_dir/checksums")
[[ $node_digest =~ ^[a-f0-9]{64}$ ]] || fail 'Official Node.js checksum not found.'
printf '%s  %s\n' "$node_digest" "$auth_dir/node.tar.xz" | sha256sum --check --status
app_digest=$(sha256sum dist/ctokodnomy-native.tar.gz)
app_digest=${app_digest%% *}
incoming="/var/lib/ctokodnomy-deploy/${APP_USER}-${APP_PORT}/$GITHUB_SHA"
ssh "${opts[@]}" "$target" "bash -s -- '$APP_ROOT' '$APP_USER' '$incoming'" <<'PREPARE'
set -euo pipefail
base=$1 app_user=$2 incoming=$3
[[ -d $base && ! -L $base && $(readlink -e "$base") == "$base" && $(stat -c %U "$base") == "$app_user" ]]
parent=$(dirname "$incoming")
install -d -m 700 "$parent"
[[ ! -L $parent && $(stat -c %u "$parent") == 0 ]]
[[ ! -e $incoming ]]
mkdir -m 700 "$incoming"
PREPARE
scp "${opts[@]}" "$auth_dir/node.tar.xz" "$target:$incoming/node.tar.xz"
scp "${opts[@]}" dist/ctokodnomy-native.tar.gz "$target:$incoming/app.tar.gz"
scp "${opts[@]}" scripts/brainycp-stage.sh scripts/native-db.mjs scripts/brainycp-activate.sh "$target:$incoming/"
if report=$(ssh "${opts[@]}" "$target" \
  "bash '$incoming/brainycp-activate.sh' '$APP_ROOT' '$APP_USER' '$APP_PORT' '$APP_DOMAIN' '$GITHUB_SHA' '$node_version' '$node_digest' '$app_digest' '$incoming'" 2>&1); then
  report_type=notice
else
  report_type=error
fi
printf '%s\n' "$report"
escaped=${report//%/%25}
escaped=${escaped//$'\r'/%0D}
escaped=${escaped//$'\n'/%0A}
printf '::%s title=BrainyCP deployment report::%s\n' "$report_type" "$escaped"
[[ $report_type == notice ]]
