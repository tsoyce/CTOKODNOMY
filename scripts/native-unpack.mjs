// Usage: node native-unpack.mjs ARCHIVE_PATH EXPECTED_SHA256 [DESTINATION]
// Also supports execution from stdin with node --input-type=module -.
import { createHash } from "node:crypto";
import {
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const reject = (message) => {
  throw new Error(`Invalid native archive: ${message}`);
};

function optionalStat(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function requirePhysicalDirectory(path) {
  if (!isAbsolute(path) || resolve(path) !== path) {
    reject("destination must use an absolute physical directory path");
  }
  const root = parse(path).root;
  let current = root;
  for (const component of path.slice(root.length).split("/").filter(Boolean)) {
    current = join(current, component);
    const metadata = lstatSync(current);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      reject("destination or a parent is not a physical directory");
    }
  }
  if (!lstatSync(path).isDirectory() || realpathSync(path) !== path) {
    reject("destination must already be a physical directory");
  }
}

function validateArchive(archive, expected) {
  if (!/^[a-fA-F0-9]{64}$/.test(expected)) {
    reject("expected SHA-256 must contain 64 hexadecimal characters");
  }
  const archiveMetadata = lstatSync(archive);
  if (!archiveMetadata.isFile() || archiveMetadata.isSymbolicLink()) {
    reject("archive must be a regular file, not a symbolic link");
  }
  if (archiveMetadata.size > 128 * 1024 * 1024) {
    reject("compressed size exceeds 128 MiB");
  }
  const compressed = readFileSync(archive);
  if (
    createHash("sha256").update(compressed).digest("hex") !==
    expected.toLowerCase()
  ) {
    reject("SHA-256 does not match");
  }
  const data = gunzipSync(compressed, {
    maxOutputLength: 512 * 1024 * 1024,
  });
  const entries = new Map();
  const field = (header, start, length) =>
    header
      .subarray(start, start + length)
      .toString("utf8")
      .split("\0", 1)[0];
  const octal = (text) => {
    const clean = text.trim();
    if (!/^[0-7]+$/.test(clean)) reject("unsupported numeric header");
    return Number.parseInt(clean, 8);
  };
  let offset = 0;
  let ended = false;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (
        offset + 1024 > data.length ||
        !data.subarray(offset).every((byte) => byte === 0)
      ) {
        reject("invalid tar terminator");
      }
      ended = true;
      break;
    }
    const storedChecksum = octal(field(header, 148, 8));
    const checksum = header.reduce(
      (sum, byte, index) =>
        sum + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    if (storedChecksum !== checksum) reject("tar header checksum mismatch");
    const size = octal(field(header, 124, 12));
    const prefix = field(header, 345, 155);
    let name = `${prefix ? `${prefix}/` : ""}${field(header, 0, 100)}`;
    const type = header[156];
    const directory = type === 53;
    if (type !== 0 && type !== 48 && !directory) {
      reject("only regular files and directories are allowed");
    }
    if (directory) name = name.replace(/\/$/, "");
    if (
      !name ||
      name.startsWith("/") ||
      /[\\\x00-\x1f\x7f]/.test(name) ||
      name
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    ) {
      reject("unsafe entry path");
    }
    const rootFile = ["app.mjs", "package.json", "package-lock.json"].includes(
      name,
    );
    const codeDirectory = name === "dist/client" || name === "dist/server";
    const codeEntry =
      name.startsWith("dist/client/") || name.startsWith("dist/server/");
    if (
      !(rootFile || codeDirectory || codeEntry) ||
      (rootFile && directory) ||
      (codeDirectory && !directory)
    ) {
      reject("entry outside the production file whitelist");
    }
    if (directory && size !== 0) reject("directory has file data");
    if (entries.has(name)) reject("duplicate entry");
    entries.set(name, {
      directory,
      offset: offset + 512,
      size,
    });
    if (entries.size > 10000) reject("too many entries");
    offset += 512 + Math.ceil(size / 512) * 512;
    if (offset > data.length) reject("truncated entry");
  }
  if (!ended) reject("missing tar terminator");
  for (const name of entries.keys()) {
    const components = name.split("/");
    components.pop();
    while (components.length) {
      const parent = entries.get(components.join("/"));
      if (parent && !parent.directory) {
        reject("file used as a parent directory");
      }
      components.pop();
    }
  }
  for (const name of [
    "app.mjs",
    "package.json",
    "package-lock.json",
    "dist/client/index.html",
    "dist/server/index.js",
    "dist/server/cli.js",
  ]) {
    const entry = entries.get(name);
    if (!entry || entry.directory) {
      reject(`required file is missing: ${name}`);
    }
  }
  return { data, entries };
}

function unpack(destination, data, entries) {
  requirePhysicalDirectory(destination);
  const directories = new Set();
  for (const [name, entry] of entries) {
    let parent = entry.directory ? name : dirname(name);
    while (parent !== ".") {
      directories.add(parent);
      parent = dirname(parent);
    }
  }
  const orderedDirectories = [...directories].sort(
    (left, right) => left.split("/").length - right.split("/").length,
  );
  // Check all output paths before writing any entry. Existing directories may
  // be reused, but no existing file, link or special node is ever overwritten.
  for (const name of orderedDirectories) {
    const metadata = optionalStat(join(destination, name));
    if (metadata && (metadata.isSymbolicLink() || !metadata.isDirectory())) {
      reject("output parent is not a physical directory");
    }
  }
  for (const [name, entry] of entries) {
    if (!entry.directory && optionalStat(join(destination, name))) {
      reject("output file already exists");
    }
  }
  for (const name of orderedDirectories) {
    const output = join(destination, name);
    requirePhysicalDirectory(dirname(output));
    const metadata = optionalStat(output);
    if (metadata) {
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        reject("output parent is not a physical directory");
      }
    } else {
      mkdirSync(output, { mode: 0o755 });
    }
  }
  for (const [name, entry] of entries) {
    if (entry.directory) continue;
    const output = join(destination, name);
    requirePhysicalDirectory(dirname(output));
    writeFileSync(
      output,
      data.subarray(entry.offset, entry.offset + entry.size),
      {
        flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
          constants.O_NOFOLLOW,
        mode: 0o600,
      },
    );
  }
}

try {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length !== 2 && arguments_.length !== 3) {
    reject("expected ARCHIVE_PATH EXPECTED_SHA256 [DESTINATION]");
  }
  const [archive, expected, destination] = arguments_;
  const { data, entries } = validateArchive(archive, expected);
  if (destination !== undefined) unpack(destination, data, entries);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
