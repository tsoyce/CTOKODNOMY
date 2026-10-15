import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const script = resolve("scripts/brainycp-stage.sh");
const releaseId = "1234567890abcdef1234567890abcdef12345678";
const realNode = process.execPath;
const appUser = userInfo().username;
let fixture: string;
let appRoot: string;
let source: string;
let archive: string;
let runtime: string;
let release: string;
let digest: string;

function executable(name: string, body: string) {
  writeFileSync(join(runtime, name), `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, { mode: 0o755 });
}

function packageSource() {
  const result = spawnSync("/usr/bin/tar", [
    "--format=ustar", "-czf", archive, "-C", source,
    "app.mjs", "package.json", "package-lock.json", "dist/client", "dist/server",
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  digest = createHash("sha256").update(readFileSync(archive)).digest("hex");
}

function stage(env: Record<string, string> = {}, checksum = digest) {
  return spawnSync("bash", [script, appRoot, appUser, releaseId, archive, checksum, join(runtime, "node")], {
    encoding: "utf8",
    env: {
      ...process.env, PATH: `${runtime}:/usr/local/bin:/usr/bin:/bin`,
      STAGE_LOG_ROOT: fixture, STAGE_REAL_NODE: realNode, ...env,
    },
  });
}

function unchangedApplication() {
  expect(readlinkSync(join(appRoot, "current"))).toBe("previous");
  expect(readFileSync(join(appRoot, "previous", "marker"), "utf8")).toBe("running release");
  expect(readFileSync(join(appRoot, "instance.env"), "utf8")).toBe("private instance configuration");
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "ctokodnomy-deploy-stage-"));
  appRoot = join(fixture, "application");
  source = join(fixture, "source");
  archive = join(fixture, "native.tar.gz");
  runtime = join(fixture, "runtime");
  release = join(appRoot, "releases", releaseId);
  mkdirSync(join(appRoot, "previous"), { recursive: true });
  mkdirSync(join(source, "dist", "client"), { recursive: true });
  mkdirSync(join(source, "dist", "server"), { recursive: true });
  mkdirSync(runtime);
  writeFileSync(join(appRoot, "previous", "marker"), "running release");
  writeFileSync(join(appRoot, "instance.env"), "private instance configuration");
  symlinkSync("previous", join(appRoot, "current"));
  writeFileSync(join(source, "app.mjs"), "export {};\n", { mode: 0o777 });
  writeFileSync(join(source, "package.json"), '{"name":"deployment-fixture","type":"module"}\n');
  writeFileSync(join(source, "package-lock.json"), '{"lockfileVersion":3}\n');
  writeFileSync(join(source, "dist", "client", "index.html"), "<!doctype html><p>game</p>\n");
  writeFileSync(join(source, "dist", "server", "index.js"), "export {};\n");
  writeFileSync(join(source, "dist", "server", "cli.js"), "export {};\n");
  executable("node", `printf '%s\\n' "$*" >> "$STAGE_LOG_ROOT/node.log"
exec "$STAGE_REAL_NODE" "$@"`);
  executable("cat", `printf '%s\\n' "$*" >> "$STAGE_LOG_ROOT/cat.log"
if [[ \${STAGE_KILL_CAT:-0} == 1 ]]; then kill -KILL $$; fi
exec /usr/bin/cat "$@"`);
  executable("tar", `printf '%s\\n' "$*" >> "$STAGE_LOG_ROOT/tar.log"
exec /usr/bin/tar "$@"`);
  executable("gzip", `if [[ \${STAGE_KILL_GZIP:-0} == 1 ]]; then kill -KILL $$; fi
exec /usr/bin/gzip "$@"`);
  executable("npm", `printf '%s\\n' "$*" >> "$STAGE_LOG_ROOT/npm.log"
prefix=''
while (( $# )); do
  if [[ $1 == --prefix ]]; then prefix=$2; shift 2; else shift; fi
done
[[ -n $prefix ]]
for dependency in fastify pg @fastify/static @fastify/websocket; do
  mkdir -p -- "$prefix/node_modules/$dependency"
  : > "$prefix/node_modules/$dependency/index.js"
done`);
  packageSource();
});

afterEach(() => rmSync(fixture, { recursive: true, force: true }));

describe("native release staging stops on ordinary utility failures", () => {
  test("uses an unprivileged standard cat stream and tar only after validating the complete archive", () => {
    const result = stage({ TAR_OPTIONS: "--invalid-inherited-option", GZIP: "--invalid-inherited-option" });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(release, "app.mjs"), "utf8")).toBe("export {};\n");
    expect(statSync(join(release, "app.mjs")).mode & 0o777).toBe(0o644);
    expect(statSync(join(release, "dist", "server")).mode & 0o777).toBe(0o755);
    expect(existsSync(join(release, ".native-release.tar.gz"))).toBe(false);
    expect(readFileSync(join(fixture, "cat.log"), "utf8")).toBe("\n");
    const tarLog = readFileSync(join(fixture, "tar.log"), "utf8");
    expect(tarLog).toContain("--no-same-owner --no-same-permissions --keep-old-files --delay-directory-restore");
    expect(tarLog.trim()).toMatch(/-- app\.mjs package\.json package-lock\.json dist\/client dist\/server$/);
    expect(readFileSync(join(fixture, "npm.log"), "utf8")).toContain("ci --omit=dev");
    const nodeLog = readFileSync(join(fixture, "node.log"), "utf8");
    const validations = nodeLog.split("\n").filter((line) => line.includes("native-unpack.mjs"));
    expect(validations).toEqual([`${resolve("scripts/native-unpack.mjs")} ${archive} ${digest}`]);
    expect(nodeLog).not.toContain("createReadStream");
    expect(nodeLog).not.toContain("createWriteStream");
    unchangedApplication();
  });

  test("a killed cat exits 137 before extraction, dependency installation or activation", () => {
    const result = stage({ STAGE_KILL_CAT: "1" });
    expect(result.status).toBe(137);
    expect(result.stderr).toContain("SIGKILL, exit 137");
    expect(result.stderr).toContain("do not retry or bypass");
    expect(readFileSync(join(fixture, "cat.log"), "utf8")).toBe("\n");
    expect(statSync(join(release, ".native-release.tar.gz")).mode & 0o777).toBe(0o600);
    expect(existsSync(join(fixture, "tar.log"))).toBe(false);
    expect(existsSync(join(fixture, "npm.log"))).toBe(false);
    expect(existsSync(join(release, "app.mjs"))).toBe(false);
    unchangedApplication();
  });

  test("exclusive shell creation refuses a destination symlink introduced after the path check", () => {
    const target = join(fixture, "untouched");
    writeFileSync(target, "do not overwrite");
    writeFileSync(join(runtime, "bash"), `#!/bin/bash
set -euo pipefail
if [[ \${1:-} == -c && \${2:-} == *noclobber* ]]; then
  /usr/bin/ln -s -- "$STAGE_LOG_ROOT/untouched" "$4"
fi
exec /bin/bash "$@"
`, { mode: 0o755 });
    const result = stage();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot overwrite existing file");
    expect(readFileSync(target, "utf8")).toBe("do not overwrite");
    expect(existsSync(join(fixture, "cat.log"))).toBe(false);
    expect(existsSync(join(fixture, "tar.log"))).toBe(false);
    expect(existsSync(join(fixture, "npm.log"))).toBe(false);
    unchangedApplication();
  });

  test("a killed gzip child makes tar fail and does not install dependencies or activate", () => {
    const result = stage({ STAGE_KILL_GZIP: "1" });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/signal 9|Killed/i);
    expect(result.stderr).toContain("Deployment aborted");
    expect(readFileSync(join(fixture, "tar.log"), "utf8").trim().split("\n")).toHaveLength(1);
    expect(existsSync(join(fixture, "npm.log"))).toBe(false);
    const nodeLog = readFileSync(join(fixture, "node.log"), "utf8");
    expect(nodeLog.trim().split("\n")).toHaveLength(2); // Version and read-only validation only.
    unchangedApplication();
  });

  test("a checksum mismatch is rejected before creating releases or copying files", () => {
    const result = stage({}, "0".repeat(64));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SHA-256 does not match");
    expect(existsSync(join(appRoot, "releases"))).toBe(false);
    expect(existsSync(join(fixture, "cat.log"))).toBe(false);
    expect(existsSync(join(fixture, "tar.log"))).toBe(false);
    expect(existsSync(join(fixture, "npm.log"))).toBe(false);
    unchangedApplication();
  });

  test("an archive containing a symbolic link is rejected before any release write", () => {
    symlinkSync("../../../../outside", join(source, "dist", "client", "escape"));
    packageSource();
    const result = stage();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("only regular files and directories are allowed");
    expect(existsSync(join(appRoot, "releases"))).toBe(false);
    expect(existsSync(join(fixture, "cat.log"))).toBe(false);
    expect(existsSync(join(fixture, "npm.log"))).toBe(false);
    unchangedApplication();
  });

  test("an existing release is never overwritten or repaired in place", () => {
    mkdirSync(release, { recursive: true });
    const marker = join(release, "existing");
    writeFileSync(marker, "keep release unchanged");
    const result = stage();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("existing releases are never replaced");
    expect(readFileSync(marker, "utf8")).toBe("keep release unchanged");
    expect(existsSync(join(fixture, "cat.log"))).toBe(false);
    expect(existsSync(join(fixture, "tar.log"))).toBe(false);
    expect(existsSync(join(fixture, "npm.log"))).toBe(false);
    unchangedApplication();
  });
});
