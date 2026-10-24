#!/usr/bin/env bash
# A separate, explicitly requested repair; ordinary deployments never call it.
set -euo pipefail
fail() { printf '::error title=BrainyCP default repair::%s\n' "$*" >&2; exit 2; }
[[ ${DEPLOY_HOST:-} =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || fail 'Invalid SSH server.'
[[ ${DEPLOY_USER:-} =~ ^[a-z_][a-z0-9_-]*$ ]] || fail 'Invalid SSH user.'
[[ ${REPAIR_MODE:-} == plan || ${REPAIR_MODE:-} == apply ]] || fail 'Choose plan or apply.'
[[ -n ${DEPLOY_SSH_KEY:-} && -n ${SSH_KNOWN_HOSTS:-} ]] || fail 'SSH key and verified host pin are required.'
helper_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

# Configuration is data, never shell code. Only a base64 encoding crosses the
# remote shell boundary; the remote transaction validates it again.
encoded_config=$(node --input-type=module <<'NODE'
try {
  const config = JSON.parse(process.env.REPAIR_CONFIGURATION ?? '');
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error();
  if (!/^\/[A-Za-z0-9_./-]+$/.test(config.node_bin ?? '')) throw new Error();
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) if (!/^[1-9][0-9]*$/.test(process.env[key] ?? '')) throw new Error();
  config.run_id = process.env.GITHUB_RUN_ID;
  config.run_attempt = process.env.GITHUB_RUN_ATTEMPT;
  if (process.env.REPAIR_MODE === 'apply' && !/^[a-f0-9]{64}$/.test(config.expected_candidate_sha256 ?? '')) throw new Error();
  process.stdout.write(Buffer.from(JSON.stringify(config)).toString('base64'));
} catch { console.error('Invalid repair configuration or run identifiers.'); process.exit(2); }
NODE
) || fail 'Configuration validation failed before SSH.'
node_bin=$(node --input-type=module - "$encoded_config" <<'NODE'
process.stdout.write(JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8')).node_bin);
NODE
)

umask 077
auth_dir=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ctokodnomy-default-ssh.XXXXXX")
agent_started=0
cleanup() {
  if [[ $agent_started == 1 ]]; then ssh-agent -k >/dev/null 2>&1 || true; fi
  rm -rf -- "$auth_dir"
}
trap cleanup EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" | tr -d '\r' > "$auth_dir/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" | tr -d '\r' > "$auth_dir/known_hosts"
chmod 600 "$auth_dir/key" "$auth_dir/known_hosts"
export DEPLOY_SSH_PASSPHRASE=${DEPLOY_SSH_PASSPHRASE:-}
cat > "$auth_dir/askpass" <<'ASKPASS'
#!/usr/bin/env bash
printf '%s\n' "$DEPLOY_SSH_PASSPHRASE"
ASKPASS
chmod 700 "$auth_dir/askpass"
eval "$(ssh-agent -s)" >/dev/null
agent_started=1
export SSH_ASKPASS="$auth_dir/askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=ctokodnomy-default-repair
ssh-add "$auth_dir/key" </dev/null || fail 'Cannot load the configured SSH key.'

node --input-type=module - "$helper_dir" > "$auth_dir/repair.mjs" <<'NODE'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
process.stdout.write(`const CTOK_GUARD_SOURCE = ${JSON.stringify(readFileSync(join(root, 'brainycp-guards.sh'), 'utf8'))};\n`);
process.stdout.write(readFileSync(join(root, 'brainycp-panel-default.mjs'), 'utf8'));
NODE
runtime_check=$(cat <<'RUNTIME'
set -euo pipefail
runtime=$1
[[ -x $runtime && -f $runtime && $(readlink -e -- "$runtime") == "$runtime" ]]
current=$runtime
while :; do
  [[ $(stat -c %u -- "$current") == 0 ]]
  permissions=$(stat -c %a -- "$current")
  (( (8#$permissions & 8#022) == 0 ))
  [[ $current != / ]] || break
  current=$(dirname -- "$current")
done
exec "$runtime" --input-type=module - "$2" "$3"
RUNTIME
)
# The static prelude contains no single quotes; every interpolated argument has
# a restricted alphabet (path, enum, or base64).
[[ $runtime_check != *"'"* ]] || fail 'Unexpected quoting in runtime validation.'
remote_command="bash -c '$runtime_check' -- '$node_bin' '$REPAIR_MODE' '$encoded_config'"
ssh_opts=(-F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$auth_dir/known_hosts" -o GlobalKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ForwardAgent=no -o ClearAllForwardings=yes -o ConnectTimeout=15 -o ConnectionAttempts=1 -i "$auth_dir/key")
if report=$(ssh "${ssh_opts[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$remote_command" < "$auth_dir/repair.mjs" 2>&1); then report_type=notice; status=0; else status=$?; report_type=error; fi
printf '%s\n' "$report"
remaining=$report
part=1
while [[ -n $remaining ]]; do
  chunk=${remaining:0:2400}; remaining=${remaining:2400}
  escaped=${chunk//%/%25}; escaped=${escaped//$'\r'/%0D}; escaped=${escaped//$'\n'/%0A}
  printf '::%s title=BrainyCP default repair part %s::%s\n' "$report_type" "$part" "$escaped"
  part=$((part + 1))
done
exit "$status"
