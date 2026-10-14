import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  access,
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "dist");
const name = "ctokodnomy-native.tar.gz";
// Only production code and the dependency lockfile go into this archive.
// Instance configuration, uploaded media and node_modules stay on the server.
const entries = [
  "app.mjs",
  "package.json",
  "package-lock.json",
  "dist/client",
  "dist/server",
];
for (const file of [
  "dist/client/index.html",
  "dist/server/index.js",
  "dist/server/cli.js",
]) {
  await access(join(root, file)).catch(() => {
    throw new Error("Run npm run build before packaging a native release.");
  });
}
await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(output, ".native-"));

async function readableTree(directory) {
  await chmod(directory, 0o755);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await readableTree(path);
    else if (entry.isFile()) await chmod(path, 0o644);
    else
      throw new Error(
        "Native releases may contain only files and directories.",
      );
  }
}

try {
  const files = join(staging, "files");
  await mkdir(files);
  for (const entry of entries) {
    const destination = join(files, entry);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(root, entry), destination, { recursive: true });
  }
  await readableTree(files);
  const archive = join(staging, name);
  const result = spawnSync("tar", ["-czf", archive, "-C", files, ...entries], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Native archive creation failed.");
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  const checksum = `${name}.sha256`;
  await writeFile(join(staging, checksum), `${digest}  ${name}\n`);
  await chmod(archive, 0o644);
  await chmod(join(staging, checksum), 0o644);
  await rename(archive, join(output, name));
  await rename(join(staging, checksum), join(output, checksum));
  process.stdout.write(`Created dist/${name} and its SHA-256 checksum.\n`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
