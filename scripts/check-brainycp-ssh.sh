#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'Error: %s\n' "$*" >&2; exit 2; }
[[ ${DEPLOY_HOST:-} =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || fail 'Set a valid SSH server.'
[[ ${DEPLOY_USER:-} =~ ^[a-z_][a-z0-9_-]*$ ]] || fail 'Set a valid SSH user.'
[[ ${APP_ROOT:-} =~ ^/[A-Za-z0-9_/-]+$ && $APP_ROOT != / && $APP_ROOT != */ ]] || fail 'Set an absolute application directory without spaces or a trailing slash.'
[[ ${APP_USER:-} =~ ^[a-z_][a-z0-9_-]*$ ]] || fail 'Set a valid application user.'
[[ ${APP_PORT:-} =~ ^[0-9]{1,5}$ ]] || fail 'Set a valid application port.'
(( 10#$APP_PORT >= 1 && 10#$APP_PORT <= 65535 )) || fail 'Port must be between 1 and 65535.'
[[ ${APP_DOMAIN:-} =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || fail 'Set a hostname without a scheme or path.'
[[ -n ${DEPLOY_SSH_KEY:-} && -n ${SSH_KNOWN_HOSTS:-} ]] || fail 'Set DEPLOY_SSH_KEY and verified SSH_KNOWN_HOSTS secrets; see docs/SSH_DEPLOY_GUIDE.md.'

export DEPLOY_SSH_PASSPHRASE=${DEPLOY_SSH_PASSPHRASE:-}
umask 077
auth_dir=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ctokodnomy-ssh.XXXXXX")
agent_started=0
cleanup() {
  if [[ $agent_started == 1 ]]; then ssh-agent -k >/dev/null 2>&1 || true; fi
  rm -rf -- "$auth_dir"
}
trap cleanup EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" | tr -d '\r' > "$auth_dir/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" | tr -d '\r' > "$auth_dir/known_hosts"
chmod 600 "$auth_dir/key" "$auth_dir/known_hosts"
cat > "$auth_dir/askpass" <<'ASKPASS'
#!/usr/bin/env bash
printf '%s\n' "$DEPLOY_SSH_PASSPHRASE"
ASKPASS
chmod 700 "$auth_dir/askpass"
eval "$(ssh-agent -s)" >/dev/null
agent_started=1
export SSH_ASKPASS="$auth_dir/askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=ctokodnomy-check
ssh-add "$auth_dir/key" </dev/null
ssh_opts=(
  -F /dev/null
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$auth_dir/known_hosts"
  -o GlobalKnownHostsFile=/dev/null
  -o IdentitiesOnly=yes
  -o ConnectTimeout=15
  -o ConnectionAttempts=1
  -o ForwardAgent=no
  -o ClearAllForwardings=yes
  -i "$auth_dir/key"
)
ssh "${ssh_opts[@]}" "$DEPLOY_USER@$DEPLOY_HOST" \
  "bash -s -- '$APP_ROOT' '$APP_USER' '$APP_PORT' '$APP_DOMAIN'" \
  < "$(dirname "${BASH_SOURCE[0]}")/brainycp-preflight.sh"
