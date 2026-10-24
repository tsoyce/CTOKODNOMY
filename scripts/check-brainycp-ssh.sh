#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'Error: %s\n' "$*" >&2
  if [[ ${GITHUB_ACTIONS:-} == true ]]; then printf '::error title=BrainyCP server check::%s\n' "$*"; fi
  exit 2
}
[[ ${DEPLOY_HOST:-} =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || fail 'Set a valid SSH server.'
[[ ${DEPLOY_USER:-} =~ ^[a-z_][a-z0-9_-]*$ ]] || fail 'Set a valid SSH user.'
[[ ${APP_ROOT:-} =~ ^/[A-Za-z0-9_/-]+$ && $APP_ROOT != / && $APP_ROOT != */ ]] || fail 'Set an absolute application directory without spaces or a trailing slash.'
[[ ${APP_USER:-} =~ ^[a-z_][a-z0-9_-]*$ ]] || fail 'Set a valid application user.'
[[ ${APP_PORT:-} =~ ^[0-9]{1,5}$ ]] || fail 'Set a valid application port.'
(( 10#$APP_PORT >= 1 && 10#$APP_PORT <= 65535 )) || fail 'Port must be between 1 and 65535.'
[[ ${APP_DOMAIN:-} =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || fail 'Set a hostname without a scheme or path.'
[[ -z ${CHECK_PROBE_DOMAIN:-} || ${CHECK_PROBE_DOMAIN:-} =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || fail 'Set a valid additional hostname without a scheme or path.'
[[ -n ${DEPLOY_SSH_KEY:-} ]] || fail 'DEPLOY_SSH_KEY secret is missing.'
[[ -n ${SSH_KNOWN_HOSTS:-} ]] || fail 'SSH_KNOWN_HOSTS secret is missing; add the verified public server key. See docs/DEPLOYMENT.md.'

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
ssh-add "$auth_dir/key" </dev/null || fail 'Cannot load DEPLOY_SSH_KEY; check its format and optional DEPLOY_SSH_PASSPHRASE.'
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
inspection_script="$(dirname "${BASH_SOURCE[0]}")/brainycp-preflight.sh"
if [[ ${CHECK_DETAILS:-false} == true ]]; then
  inspection_script="$(dirname "${BASH_SOURCE[0]}")/brainycp-details.sh"
fi
if [[ ${CHECK_WEB_SERVICES:-false} == true ]]; then
  inspection_script="$(dirname "${BASH_SOURCE[0]}")/brainycp-web-diagnostics.sh"
fi
if [[ ${CHECK_ROUTING:-false} == true ]]; then
  inspection_script="$(dirname "${BASH_SOURCE[0]}")/brainycp-routing.sh"
fi
inspection_command="bash -s -- '$APP_ROOT' '$APP_USER' '$APP_PORT' '$APP_DOMAIN'"
if [[ ${CHECK_WEB_SERVICES:-false} == true || ${CHECK_DETAILS:-false} == true || ${CHECK_ROUTING:-false} == true ]]; then
  inspection_command+=" '${CHECK_PROBE_DOMAIN:-}'"
fi
if report=$(ssh "${ssh_opts[@]}" "$DEPLOY_USER@$DEPLOY_HOST" \
    "$inspection_command" \
    < "$inspection_script" 2>&1); then
  report_type=notice
else
  report_type=error
fi
printf '%s\n' "$report"
if [[ ${GITHUB_ACTIONS:-} == true ]]; then
  # Publish this read-only metadata report via the check API as well as logs.
  # Escape workflow-command delimiters; diagnostic output excludes credentials.
  remaining=$report
  report_part=1
  while [[ -n $remaining ]]; do
    chunk=${remaining:0:2400}
    remaining=${remaining:2400}
    escaped=${chunk//%/%25}
    escaped=${escaped//$'\r'/%0D}
    escaped=${escaped//$'\n'/%0A}
    printf '::%s title=BrainyCP server report part %s::%s\n' "$report_type" "$report_part" "$escaped"
    report_part=$((report_part + 1))
  done
fi
[[ $report_type == notice ]]
