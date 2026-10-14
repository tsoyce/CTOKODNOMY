import { randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  fchmodSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  futimesSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

// Copies only the selected small service/proxy configuration. Never prints
// file contents; atomically replaces regular destinations with original
// ownership, permissions and timestamps, for both backup and rollback.
const [source, destination, ...extra] = process.argv.slice(2);
if (
  extra.length ||
  ![source, destination].every(
    (value) => value && isAbsolute(value) && resolve(value) === value,
  )
)
  throw new Error("Expected two absolute configuration file paths.");
try {
  if (!lstatSync(destination).isFile())
    throw new Error("Configuration destination must be a regular file.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const input = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
let output;
const temporary = join(
  dirname(destination),
  `.ctokodnomy-copy-${randomUUID()}`,
);
try {
  const metadata = fstatSync(input);
  if (!metadata.isFile() || metadata.size > 1024 * 1024)
    throw new Error("Expected a regular configuration smaller than 1 MiB.");
  output = openSync(temporary, "wx", 0o600);
  writeFileSync(output, readFileSync(input));
  fchownSync(output, metadata.uid, metadata.gid);
  fchmodSync(output, metadata.mode & 0o777);
  futimesSync(output, metadata.atime, metadata.mtime);
  fsyncSync(output);
  closeSync(output);
  output = undefined;
  renameSync(temporary, destination);
} finally {
  closeSync(input);
  if (output !== undefined) closeSync(output);
  try {
    unlinkSync(temporary);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
