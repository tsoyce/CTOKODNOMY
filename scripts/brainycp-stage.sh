#!/usr/bin/env bash
# Stage a checked native release without changing the running application.
# Usage: bash brainycp-stage.sh APP_ROOT APP_USER RELEASE_ID ARCHIVE_PATH EXPECTED_SHA256 NODE_BIN
set -euo pipefail
umask 022

fail() { printf 'Error: %s\n' "$*" >&2; exit 2; }
[[ $# -eq 6 ]] || fail 'Expected APP_ROOT APP_USER RELEASE_ID ARCHIVE_PATH EXPECTED_SHA256 NODE_BIN'
app_root=${1%/}
app_user=$2
release_id=$3
archive_path=$4
expected_sha=$5
node_bin=$6
[[ $app_root == /* && $app_root != / && $app_root != *$'\n'* && $app_root != *$'\r'* ]] || fail 'APP_ROOT must be an absolute application directory'
[[ $app_user =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] || fail 'Invalid APP_USER'
[[ $release_id =~ ^[a-f0-9]{40}$ ]] || fail 'RELEASE_ID must be a lowercase Git commit SHA'
[[ $expected_sha =~ ^[a-fA-F0-9]{64}$ ]] || fail 'EXPECTED_SHA256 must contain 64 hexadecimal characters'
[[ $archive_path == /* && $archive_path != *$'\n'* && $archive_path != *$'\r'* ]] || fail 'ARCHIVE_PATH must be an absolute path'
[[ $node_bin == /* && $node_bin != *$'\n'* && $node_bin != *$'\r'* && -f $node_bin && -x $node_bin ]] || fail 'NODE_BIN must select an existing absolute executable'
[[ -d $app_root && ! -L $app_root ]] || fail 'APP_ROOT must already exist as a directory, not a symbolic link'
[[ $(readlink -e -- "$app_root") == "$app_root" ]] || fail 'APP_ROOT must use its physical path without symbolic links or dot components'
[[ -f $archive_path && ! -L $archive_path ]] || fail 'ARCHIVE_PATH must be a regular file, not a symbolic link'
id "$app_user" >/dev/null 2>&1 || fail 'APP_USER does not exist'
app_uid=$(id -u "$app_user")
app_gid=$(id -g "$app_user")
caller_uid=$(id -u)
[[ $caller_uid -eq 0 || $caller_uid -eq $app_uid ]] || fail 'Run staging as root or as APP_USER'
[[ $app_uid -ne 0 ]] || fail 'APP_USER must be an unprivileged account'
root_owner=$(stat --format='%u' -- "$app_root")
[[ $root_owner -eq 0 || $root_owner -eq $app_uid ]] || fail 'APP_ROOT has an unexpected owner'
[[ $("$node_bin" --version) =~ ^v24\. ]] || fail 'The selected runtime must be Node.js 24'
node_dir=${node_bin%/*}
npm_bin="$node_dir/npm"
[[ -f $npm_bin && -x $npm_bin ]] || fail 'The selected Node.js installation must include npm beside node'
runtime_path="$node_dir:/usr/local/bin:/usr/bin:/bin"
if [[ $caller_uid -eq 0 ]]; then
  command -v runuser >/dev/null 2>&1 || fail 'runuser is required to stage files as APP_USER'
fi
for utility in sha256sum mkdir chmod stat readlink; do
  command -v "$utility" >/dev/null 2>&1 || fail "Required utility is missing: $utility"
done

as_app_user() {
  if [[ $caller_uid -eq $app_uid ]]; then
    "$@"
  else
    runuser -u "$app_user" -- "$@"
  fi
}
as_app_user test -x "$app_root" || fail 'APP_USER cannot traverse APP_ROOT'
as_app_user test -x "$node_bin" || fail 'APP_USER cannot execute NODE_BIN'

# Validate the digest and tar headers together before creating a release.
# The producer emits ordinary files/directories, so extended headers, links,
# devices and paths outside the packaged production code are rejected.
helper_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
"$node_bin" "$helper_dir/native-unpack.mjs" "$archive_path" "$expected_sha"

releases="$app_root/releases"
if [[ -e $releases || -L $releases ]]; then
  [[ -d $releases && ! -L $releases ]] || fail 'Existing releases path must be a directory, not a symbolic link'
  releases_owner=$(stat --format='%u' -- "$releases")
  [[ $releases_owner -eq 0 || $releases_owner -eq $app_uid ]] || fail 'Existing releases directory has an unexpected owner'
else
  mkdir -- "$releases"
  if [[ $caller_uid -eq 0 ]]; then chown -- "$app_uid:$app_gid" "$releases"; fi
fi
as_app_user test -x "$releases" || fail 'APP_USER cannot traverse the releases directory'
release_path="$releases/$release_id"
[[ ! -e $release_path && ! -L $release_path ]] || fail 'This release already exists; existing releases are never replaced'
mkdir -- "$release_path"
if [[ $caller_uid -eq 0 ]]; then chown -- "$app_uid:$app_gid" "$release_path"; fi
staged_archive="$release_path/.native-release.tar.gz"
# Stream through the verified runtime as APP_USER. Root opens the private
# source; exclusive creation avoids following a destination link in the new
# application-owned directory, and stream buffers keep memory use bounded.
as_app_user "$node_bin" --input-type=module -e '
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
await pipeline(createReadStream(null, { fd: 0, autoClose: false }), createWriteStream(process.argv[1], { flags: "wx", mode: 0o600 }));
' "$staged_archive" < "$archive_path"
copied_sha=$(sha256sum < "$staged_archive")
[[ ${copied_sha%% *} == "${expected_sha,,}" ]] || fail 'Copied archive checksum changed'
as_app_user "$node_bin" --input-type=module - "$staged_archive" "$expected_sha" "$release_path" < "$helper_dir/native-unpack.mjs"
as_app_user rm -- "$staged_archive"

# Normalize only files just extracted into this new release. Never change the
# application root, existing releases, environment files or uploaded media.
as_app_user "$node_bin" --input-type=module - "$release_path" <<'NODE'
import { chmodSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
function normalize(directory) {
  chmodSync(directory, 0o755);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) normalize(path);
    else if (entry.isFile()) chmodSync(path, 0o644);
    else throw new Error('Unexpected link or special file in extracted release');
  }
}
normalize(process.argv[2]);
NODE
as_app_user env PATH="$runtime_path" "$node_bin" --check "$release_path/app.mjs"
as_app_user env PATH="$runtime_path" "$node_bin" --check "$release_path/dist/server/index.js"
as_app_user env PATH="$runtime_path" "$node_bin" --check "$release_path/dist/server/cli.js"
printf 'Installing locked production dependencies as %s.\n' "$app_user"
as_app_user env PATH="$runtime_path" "$npm_bin" ci --omit=dev --no-audit --no-fund \
  --prefix "$release_path" --cache "$release_path/.npm-cache"
as_app_user env PATH="$runtime_path" "$node_bin" --input-type=module - "$release_path" <<'NODE'
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(join(process.argv[2], 'package.json'));
for (const dependency of ['fastify', 'pg', '@fastify/static', '@fastify/websocket']) require.resolve(dependency);
NODE
printf 'Native release staged: %s\n' "$release_path"
printf 'Current release, configuration, database and running processes were not changed.\n'
