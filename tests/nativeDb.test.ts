import { spawnSync } from "node:child_process";
import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const helper = resolve("scripts/native-db.mjs");
const temporary: string[] = [];
const appUser = process.getuid?.() === 0 ? "nobody" : userInfo().username;
const appUid = Number(spawnSync("id", ["-u", appUser], { encoding: "utf8" }).stdout.trim());
const appGid = Number(spawnSync("id", ["-g", appUser], { encoding: "utf8" }).stdout.trim());
const secret = "d".repeat(64);
const database = "ctokodnomy_test_3003";

function snapshot(directory: string): unknown {
  const entry = lstatSync(directory);
  return {
    mode: entry.mode,
    uid: entry.uid,
    gid: entry.gid,
    ...(entry.isSymbolicLink()
      ? { link: readlinkSync(directory) }
      : entry.isDirectory()
        ? { entries: Object.fromEntries(readdirSync(directory).sort().map((name) => [name, snapshot(join(directory, name))])) }
        : { contents: readFileSync(directory).toString("base64") }),
  };
}

function fixture(overrides: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "ctokodnomy-native-db-"));
  temporary.push(directory);
  const configDirectory = join(directory, "config");
  mkdirSync(configDirectory, { mode: 0o700 });
  const config = join(configDirectory, "native.env");
  const media = join(directory, "uploads");
  const values = {
    CTOKODNOMY_MANAGED_CONFIG: "1",
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "3003",
    APP_ORIGIN: "https://game.example.test",
    DATABASE_URL: `postgresql://${database}:${secret}@127.0.0.1:5432/${database}`,
    MEDIA_DIR: media,
    TRUST_PROXY: "1",
    ...overrides,
  };
  writeFileSync(config, Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"), { mode: 0o600 });
  if (process.getuid?.() === 0) {
    chownSync(configDirectory, appUid, appGid);
    chownSync(config, appUid, appGid);
  }
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const calls = join(directory, "unexpected-commands");
  for (const command of ["psql", "runuser", "pg_dump", "pg_restore"]) {
    writeFileSync(join(bin, command), '#!/bin/sh\nprintf "%s\\n" forbidden >> "$NATIVE_DB_TEST_CALLS"\nexit 91\n', { mode: 0o700 });
  }
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    NATIVE_DB_TEST_CALLS: calls,
  };
  const args = [config, appUser, "https://game.example.test", "3003", media, database];
  return {
    directory,
    configDirectory,
    config,
    media,
    bin,
    calls,
    env,
    args,
    run(operation = "check", parameters = args) {
      return spawnSync(process.execPath, [helper, operation, ...parameters], { env, encoding: "utf8" });
    },
  };
}

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("native deployment database guard", () => {
  test("checks existing app-owned private config without writes or database commands", () => {
    const f = fixture();
    const before = snapshot(f.directory);
    const result = f.run();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("CONFIG_READY");
    expect(result.stderr).toBe("");
    expect(snapshot(f.directory)).toEqual(before);
    expect(existsSync(f.calls)).toBe(false);
  });

  test("missing config parent is never provisioned", () => {
    const f = fixture();
    const missing = join(f.directory, "missing", "native.env");
    const before = snapshot(f.directory);
    const result = f.run("check", [missing, ...f.args.slice(1)]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("directory does not exist");
    expect(snapshot(f.directory)).toEqual(before);
  });

  test("missing config file is never created", () => {
    const f = fixture();
    const before = snapshot(f.directory);
    const result = f.run("check", [join(f.configDirectory, "missing.env"), ...f.args.slice(1)]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ENOENT");
    expect(snapshot(f.directory)).toEqual(before);
  });

  test.each(["file mode", "parent mode", "file symlink", "parent symlink", "owner"])("rejects unsafe %s without writes", (kind) => {
    const f = fixture();
    let args = f.args;
    if (kind === "file mode") chmodSync(f.config, 0o644);
    if (kind === "parent mode") chmodSync(f.configDirectory, 0o755);
    if (kind === "file symlink") {
      const link = join(f.configDirectory, "link.env");
      symlinkSync(f.config, link);
      args = [link, ...f.args.slice(1)];
    }
    if (kind === "parent symlink") {
      const link = join(f.directory, "config-link");
      symlinkSync(f.configDirectory, link);
      args = [join(link, "native.env"), ...f.args.slice(1)];
    }
    if (kind === "owner") {
      writeFileSync(join(f.bin, "id"), `#!/bin/sh\nprintf '%s\\n' '${appUid + 1}'\n`, { mode: 0o700 });
    }
    const before = snapshot(f.directory);
    const result = f.run("check", args);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("CONFIG_READY");
    expect(snapshot(f.directory)).toEqual(before);
    expect(existsSync(f.calls)).toBe(false);
  });

  test.each<Record<string, string>>([
    { CTOKODNOMY_MANAGED_CONFIG: "0" },
    { HOST: "0.0.0.0" },
    { APP_ORIGIN: "https://other.example.test" },
    { PORT: "3004" },
    { MEDIA_DIR: "/different/uploads" },
    { DATABASE_URL: `postgresql://${database}:${secret}@remote.example.test:5432/${database}` },
    { DATABASE_URL: `postgresql://other:${secret}@127.0.0.1:5432/other` },
  ])("rejects incompatible existing config %j without writes", (overrides) => {
    const f = fixture(overrides);
    const before = snapshot(f.directory);
    const result = f.run();
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
    expect(snapshot(f.directory)).toEqual(before);
    expect(existsSync(f.calls)).toBe(false);
  });

  test("reports killed pg_dump safely, removes partial backup, and never retries", () => {
    const f = fixture();
    writeFileSync(join(f.bin, "pg_dump"), '#!/bin/sh\nprintf "%s\\n" "$PGPASSWORD" >&2\nprintf "%s\\n" pg_dump >> "$NATIVE_DB_TEST_CALLS"\nprintf partial\nkill -KILL "$$"\n', { mode: 0o700 });
    const destination = join(f.directory, "database.dump");
    const result = f.run("backup", [f.config, destination]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pg_dump terminated by SIGKILL; no retry was attempted");
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
    expect(readFileSync(f.calls, "utf8")).toBe("pg_dump\n");
    expect(existsSync(destination)).toBe(false);
    expect(existsSync(f.config)).toBe(true);
  });

  test("reports child exit status without exposing child stderr or credentials", () => {
    const f = fixture();
    writeFileSync(join(f.bin, "pg_dump"), '#!/bin/sh\nprintf "%s\\n" "$PGPASSWORD" >&2\nexit 17\n', { mode: 0o700 });
    const destination = join(f.directory, "database.dump");
    const result = f.run("backup", [f.config, destination]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pg_dump exited with status 17; no retry was attempted");
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
    expect(existsSync(destination)).toBe(false);
  });
});
