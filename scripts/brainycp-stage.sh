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
for utility in tar sha256sum cp mkdir chmod stat readlink; do
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
"$node_bin" --input-type=module - "$archive_path" "$expected_sha" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const [, , archive, expected] = process.argv;
const reject = (message) => { throw new Error(`Invalid native archive: ${message}`); };
if (statSync(archive).size > 128 * 1024 * 1024) reject('compressed size exceeds 128 MiB');
const compressed = readFileSync(archive);
if (createHash('sha256').update(compressed).digest('hex') !== expected.toLowerCase()) reject('SHA-256 does not match');
const data = gunzipSync(compressed, { maxOutputLength: 512 * 1024 * 1024 });
const entries = new Map();
const field = (header, start, length) => header.subarray(start, start + length).toString('utf8').split('\0', 1)[0];
const octal = (text) => {
  const clean = text.trim();
  if (!/^[0-7]+$/.test(clean)) reject('unsupported numeric header');
  return Number.parseInt(clean, 8);
};
let offset = 0;
let ended = false;
while (offset + 512 <= data.length) {
  const header = data.subarray(offset, offset + 512);
  if (header.every((byte) => byte === 0)) {
    if (offset + 1024 > data.length || !data.subarray(offset).every((byte) => byte === 0)) reject('invalid tar terminator');
    ended = true;
    break;
  }
  const storedChecksum = octal(field(header, 148, 8));
  const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
  if (storedChecksum !== checksum) reject('tar header checksum mismatch');
  const size = octal(field(header, 124, 12));
  const prefix = field(header, 345, 155);
  let name = `${prefix ? `${prefix}/` : ''}${field(header, 0, 100)}`;
  const type = header[156];
  const directory = type === 53;
  if (type !== 0 && type !== 48 && !directory) reject('only regular files and directories are allowed');
  if (directory) name = name.replace(/\/$/, '');
  if (!name || name.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(name) || name.split('/').some((part) => !part || part === '.' || part === '..')) reject('unsafe entry path');
  const rootFile = ['app.mjs', 'package.json', 'package-lock.json'].includes(name);
  const codeDirectory = name === 'dist/client' || name === 'dist/server';
  const codeEntry = name.startsWith('dist/client/') || name.startsWith('dist/server/');
  if (!(rootFile || codeDirectory || codeEntry) || (rootFile && directory) || (codeDirectory && !directory)) reject('entry outside the production file whitelist');
  if (directory && size !== 0) reject('directory has file data');
  if (entries.has(name)) reject('duplicate entry');
  entries.set(name, directory ? 'directory' : 'file');
  if (entries.size > 10000) reject('too many entries');
  offset += 512 + Math.ceil(size / 512) * 512;
  if (offset > data.length) reject('truncated entry');
}
if (!ended) reject('missing tar terminator');
for (const name of entries.keys()) {
  const components = name.split('/');
  components.pop();
  while (components.length) {
    if (entries.get(components.join('/')) === 'file') reject('file used as a parent directory');
    components.pop();
  }
}
for (const name of ['app.mjs', 'package.json', 'package-lock.json', 'dist/client/index.html', 'dist/server/index.js', 'dist/server/cli.js']) {
  if (entries.get(name) !== 'file') reject(`required file is missing: ${name}`);
}
NODE

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
cp -- "$archive_path" "$staged_archive"
chmod 600 -- "$staged_archive"
if [[ $caller_uid -eq 0 ]]; then chown -- "$app_uid:$app_gid" "$staged_archive"; fi
copied_sha=$(sha256sum < "$staged_archive")
[[ ${copied_sha%% *} == "${expected_sha,,}" ]] || fail 'Copied archive checksum changed'
as_app_user tar --extract --gzip --file "$staged_archive" --directory "$release_path" --no-same-owner --no-same-permissions
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
