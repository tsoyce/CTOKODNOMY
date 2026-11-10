#!/usr/bin/env bash
# Temporary workflow helper. Never print the survey, key, or decrypted payload.
set -Eeuo pipefail
set +x
umask 077
fail() { printf '::error title=Survey transfer::%s\n' "$1" >&2; exit 2; }
[[ ${SURVEY_MODE:-} == public-key || ${SURVEY_MODE:-} == import ]] || fail 'Invalid operation.'
[[ -n ${DEPLOY_SSH_KEY:-} ]] || fail 'Deployment SSH identity is unavailable.'
[[ ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ ]] || fail 'A verified checkout SHA is required.'
[[ ${GITHUB_RUN_ID:-} =~ ^[1-9][0-9]*$ && ${GITHUB_RUN_ATTEMPT:-} =~ ^[1-9][0-9]*$ ]] || fail 'Invalid run identifier.'
auth_dir=$(mktemp -d "${RUNNER_TEMP:?}/ctokodnomy-survey.XXXXXX")
agent_started=0
cleanup() {
  if [[ $agent_started == 1 ]]; then ssh-agent -k >/dev/null 2>&1 || true; fi
  rm -rf -- "$auth_dir"
}
trap cleanup EXIT
printf '%s\n' "$DEPLOY_SSH_KEY" | tr -d '\r' > "$auth_dir/key"
chmod 600 "$auth_dir/key"
cat > "$auth_dir/askpass" <<'ASKPASS'
#!/usr/bin/env bash
printf '%s\n' "${DEPLOY_SSH_PASSPHRASE:-}"
ASKPASS
chmod 700 "$auth_dir/askpass"
eval "$(ssh-agent -s)" >/dev/null
agent_started=1
export SSH_ASKPASS="$auth_dir/askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=ctokodnomy-survey
ssh-add "$auth_dir/key" </dev/null >/dev/null 2>&1 || fail 'Unable to load the authorized SSH key.'
ssh-add -L > "$auth_dir/agent-public" || fail 'Unable to read the public SSH key.'
[[ $(wc -l < "$auth_dir/agent-public") == 1 ]] || fail 'Expected exactly one public SSH key.'
read -r algorithm key_data _ < "$auth_dir/agent-public"
[[ $algorithm == ssh-ed25519 && $key_data =~ ^[A-Za-z0-9+/]+={0,2}$ ]] || fail 'Expected an Ed25519 public key.'
printf '%s %s\n' "$algorithm" "$key_data" > "$auth_dir/public"
fingerprint=$(ssh-keygen -lf "$auth_dir/public" -E sha256 | awk '{print $2}')
[[ $fingerprint == 'SHA256:ZaFMjTkNZ29RHhJFXNCidugze8MGk+XGimAIjJs0r4Q' ]] || fail 'Deployment public key differs from the independently verified recipient.'
if [[ $SURVEY_MODE == public-key ]]; then
  printf '::notice title=Survey encryption public key::%s %s\n' "$algorithm" "$key_data"
  exit 0
fi

[[ ${DEPLOY_HOST:-} =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || fail 'Invalid SSH host.'
[[ ${APP_ROOT:-} =~ ^/[A-Za-z0-9_/-]+$ && $APP_ROOT != / && $APP_ROOT != */ ]] || fail 'Invalid application root.'
[[ ${APP_USER:-} =~ ^[a-z_][a-z0-9_-]*$ ]] || fail 'Invalid application user.'
[[ ${APP_PORT:-} =~ ^[1-9][0-9]{0,4}$ ]] && (( APP_PORT <= 65535 )) || fail 'Invalid port.'
[[ ${APP_DOMAIN:-} =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || fail 'Invalid application domain.'
[[ ${APP_NODE_BIN:-} =~ ^/[A-Za-z0-9_./-]+$ ]] || fail 'Invalid Node.js binary.'
[[ -n ${SSH_KNOWN_HOSTS:-} ]] || fail 'An independently verified server host key is required.'
source scripts/brainycp-guards.sh
validate_php_checks "${PHP_HEALTHCHECK_URLS:-}" || fail 'Invalid PHP health endpoint.'
validate_php_checks "https://$APP_DOMAIN/" || fail 'Invalid application endpoint.'
[[ ${SURVEY_ENVELOPE:-} =~ ^([a-f0-9]{64}):([A-Za-z0-9+/]+={0,2})$ ]] || fail 'Expected a SHA-256 and base64 age ciphertext.'
expected_sha=${BASH_REMATCH[1]}
ciphertext=${BASH_REMATCH[2]}
[[ ${#ciphertext} -le 60000 ]] || fail 'Encrypted payload is too large.'
[[ -x ${AGE_BIN:-} ]] || fail 'Verified age client is unavailable.'
printf '%s' "$ciphertext" | base64 -d > "$auth_dir/payload.age" || fail 'Invalid ciphertext encoding.'
[[ $(head -c 22 "$auth_dir/payload.age") == 'age-encryption.org/v1' ]] || fail 'Payload must be encrypted with age.'
cp -- "$auth_dir/key" "$auth_dir/decrypt-key"
chmod 600 "$auth_dir/decrypt-key"
setsid ssh-keygen -q -p -N '' -f "$auth_dir/decrypt-key" </dev/null >/dev/null 2>&1 || fail 'Unable to unlock the SSH identity for decryption.'
"$AGE_BIN" -d -i "$auth_dir/decrypt-key" -o "$auth_dir/payload.gz" "$auth_dir/payload.age" 2>/dev/null || fail 'Cannot decrypt payload for the verified recipient.'
python3 - "$auth_dir/payload.gz" "$auth_dir/survey.json" "$expected_sha" <<'PY'
import gzip, hashlib, json, os, sys
try:
    with gzip.open(sys.argv[1], 'rb') as f:
        data = f.read(3 * 1024 * 1024 + 1)
    assert len(data) <= 3 * 1024 * 1024
    assert hashlib.sha256(data).hexdigest() == sys.argv[3]
    obj = json.loads(data)
    assert isinstance(obj, dict) and obj.get('format') == 'ctokodnomy-questions-v1'
    assert isinstance(obj.get('questions'), list) and 1 <= len(obj['questions']) <= 500
    with open(sys.argv[2], 'xb') as f:
        os.fchmod(f.fileno(), 0o600)
        f.write(data)
except Exception:
    raise SystemExit('Survey payload failed bounded decompression or validation.')
PY
printf '%s\n' "$SSH_KNOWN_HOSTS" | tr -d '\r' > "$auth_dir/known_hosts"
chmod 600 "$auth_dir/known_hosts"
ssh-keygen -F "$DEPLOY_HOST" -f "$auth_dir/known_hosts" >/dev/null || fail 'No matching pinned server host key.'
ssh_opts=(-F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$auth_dir/known_hosts" -o GlobalKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ForwardAgent=no -o ClearAllForwardings=yes -o ConnectTimeout=15 -i "$auth_dir/key")
target="root@$DEPLOY_HOST"
ssh "${ssh_opts[@]}" "$target" "bash -s -- '/etc/brainy/conf/server_control/main' '$PHP_HEALTHCHECK_URLS'" < scripts/brainycp-guards.sh >/dev/null
incoming="/var/lib/ctokodnomy-deploy/${APP_USER}-${APP_PORT}/survey-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
ssh "${ssh_opts[@]}" "$target" "bash -s -- '$incoming'" <<'PREPARE'
set -euo pipefail
incoming=$1
[[ $(id -u) == 0 && $incoming =~ ^/var/lib/ctokodnomy-deploy/[a-z_][a-z0-9_-]*-[1-9][0-9]*/survey-[1-9][0-9]*-[1-9][0-9]*$ ]]
for directory in /var/lib/ctokodnomy-deploy "$(dirname "$incoming")"; do
  [[ -d $directory && ! -L $directory && $(readlink -e "$directory") == "$directory" && $(stat -c %u "$directory") == 0 ]]
  (( (8#$(stat -c %a "$directory") & 8#022) == 0 ))
done
[[ $(stat -c %a "$(dirname "$incoming")") == 700 && ! -e $incoming && ! -L $incoming ]]
mkdir -m 700 -- "$incoming"
PREPARE
for helper in survey-import-remote.sh survey-import-worker.mjs brainycp-guards.sh native-db.mjs; do
  [[ -f scripts/$helper && ! -L scripts/$helper ]] || fail 'Required importer helper is unavailable.'
  ssh "${ssh_opts[@]}" "$target" "cat > '$incoming/$helper'" < "scripts/$helper"
  digest=$(sha256sum "scripts/$helper"); digest=${digest%% *}
  ssh "${ssh_opts[@]}" "$target" "printf '%s  %s\n' '$digest' '$incoming/$helper' | sha256sum -c - >/dev/null" || fail 'Importer helper transfer verification failed.'
done
worker_digest=$(sha256sum scripts/survey-import-worker.mjs); worker_digest=${worker_digest%% *}
ssh "${ssh_opts[@]}" "$target" "bash '$incoming/survey-import-remote.sh' '$APP_ROOT' '$APP_USER' '$APP_PORT' '$APP_DOMAIN' '$APP_NODE_BIN' '$PHP_HEALTHCHECK_URLS' '$incoming' '$expected_sha' '$worker_digest' '$GITHUB_SHA'" < "$auth_dir/survey.json"
ssh "${ssh_opts[@]}" "$target" "rm -- '$incoming/survey-import-remote.sh' '$incoming/survey-import-worker.mjs' '$incoming/brainycp-guards.sh' '$incoming/native-db.mjs' && rmdir -- '$incoming'" || fail 'Import completed, but temporary helper cleanup needs attention.'
