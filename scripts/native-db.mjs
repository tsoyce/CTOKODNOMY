import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  chown,
  lstat,
  mkdir,
  open,
  readFile,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";

const identifier = /^[a-z_][a-z0-9_]{0,62}$/;
const fail = (message) => {
  throw new Error(message);
};
const validPath = (value) => {
  if (
    !value ||
    !isAbsolute(value) ||
    resolve(value) !== value ||
    /[\x00-\x1f"\\]/.test(value)
  )
    fail("Invalid absolute file path.");
  return value;
};
const stat = async (path) => {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
const childEnv = (extra = {}) => {
  const env = { ...process.env, PGCONNECT_TIMEOUT: "5", ...extra };
  delete env.PGOPTIONS;
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  return env;
};
function command(
  file,
  args,
  options = {},
  message = "A required server command failed.",
) {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 1_048_576,
    ...options,
  });
  if (result.error || result.status !== 0) fail(message);
  return result.stdout?.trim() ?? "";
}
function peer(sql, database = "postgres") {
  return command(
    "runuser",
    [
      "-u",
      "postgres",
      "--",
      "psql",
      "-X",
      "--no-password",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
      "--dbname",
      database,
    ],
    {
      input: sql,
      env: childEnv({
        PGHOST: "/var/run/postgresql",
        PGPORT: "5432",
        PGUSER: "postgres",
        PGPASSWORD: "",
        PGDATABASE: database,
      }),
    },
    "PostgreSQL administration failed. The managed config was preserved for retry.",
  );
}
async function secureParent(file, owner) {
  const directory = dirname(file);
  let current = "/";
  for (const component of directory.split("/").filter(Boolean)) {
    current = resolve(current, component);
    let entry = await stat(current);
    if (!entry) {
      if (!owner) fail("The destination directory does not exist.");
      try {
        await mkdir(current, { mode: 0o700 });
        await chown(current, owner.uid, owner.gid);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      entry = await lstat(current);
    }
    if (!entry.isDirectory() || entry.isSymbolicLink())
      fail("A path contains a symbolic link or a non-directory.");
  }
  const entry = await lstat(directory);
  if (owner && (entry.uid !== owner.uid || (entry.mode & 0o777) !== 0o700))
    fail(
      "The dedicated config directory must be owned by the app user with mode 0700.",
    );
}
async function loadConfig(file, expectedOwner) {
  await secureParent(file);
  const entry = await lstat(file);
  if (
    !entry.isFile() ||
    entry.isSymbolicLink() ||
    (entry.mode & 0o777) !== 0o600 ||
    (expectedOwner !== undefined && entry.uid !== expectedOwner)
  )
    fail(
      "The managed config must be a regular private file owned by the app user.",
    );
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let env;
  try {
    env = parseEnv(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
  if (
    env.CTOKODNOMY_MANAGED_CONFIG !== "1" ||
    env.NODE_ENV !== "production" ||
    env.HOST !== "127.0.0.1" ||
    env.TRUST_PROXY !== "1"
  )
    fail("Refusing an unknown or incompatible config.");
  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    fail("Invalid database config.");
  }
  const name = url.pathname.slice(1);
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "5432" ||
    !identifier.test(name) ||
    url.username !== name ||
    !/^[a-f0-9]{64}$/.test(url.password) ||
    url.search ||
    url.hash
  )
    fail("Refusing a database outside the managed local app database.");
  return { env, url, name };
}
function postgresEnv(config) {
  return childEnv({
    PGHOST: config.url.hostname,
    PGPORT: config.url.port,
    PGUSER: config.name,
    PGPASSWORD: config.url.password,
    PGDATABASE: config.name,
  });
}
async function prepare(args) {
  if (args.length !== 6 || process.getuid?.() !== 0)
    fail(
      "prepare requires root and CONFIG_FILE APP_USER PUBLIC_ORIGIN APP_PORT MEDIA_DIR DATABASE_NAME.",
    );
  const [fileArg, appUser, originArg, port, mediaArg, name] = args;
  const file = validPath(fileArg),
    media = validPath(mediaArg);
  if (!/^[a-z_][a-z0-9_-]*[$]?$/.test(appUser) || !identifier.test(name))
    fail("Invalid app user or database name.");
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535)
    fail("Invalid app port.");
  let origin;
  try {
    origin = new URL(originArg);
  } catch {
    fail("Invalid public HTTPS origin.");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    fail("A public HTTPS origin without a path is required.");
  const owner = {
    uid: Number(command("id", ["-u", appUser])),
    gid: Number(command("id", ["-g", appUser])),
  };
  if (
    !Number.isSafeInteger(owner.uid) ||
    owner.uid <= 0 ||
    !Number.isSafeInteger(owner.gid)
  )
    fail("A non-root app user is required.");
  await secureParent(file, owner);
  const exists = await stat(file);
  const state = JSON.parse(
    peer(
      `SELECT json_build_object('role', (SELECT json_build_object('super', rolsuper, 'createdb', rolcreatedb, 'createrole', rolcreaterole, 'replication', rolreplication, 'bypassrls', rolbypassrls, 'login', rolcanlogin) FROM pg_roles WHERE rolname='${name}'), 'database', (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='${name}'));`,
    ),
  );
  if (!exists && (state.role || state.database))
    fail(
      "A database or role already exists without this managed config. Nothing was changed.",
    );
  let config;
  if (exists) {
    config = await loadConfig(file, owner.uid);
    if (
      config.name !== name ||
      config.env.APP_ORIGIN !== origin.origin ||
      config.env.PORT !== port ||
      config.env.MEDIA_DIR !== media
    )
      fail(
        "The existing config does not match this deployment. Nothing was changed.",
      );
  } else {
    const password = randomBytes(32).toString("hex");
    const env = {
      CTOKODNOMY_MANAGED_CONFIG: "1",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: port,
      APP_ORIGIN: origin.origin,
      DATABASE_URL: `postgresql://${name}:${password}@127.0.0.1:5432/${name}`,
      MEDIA_DIR: media,
      TRUST_PROXY: "1",
    };
    const handle = await open(
      file,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(
        Object.entries(env)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join("\n") + "\n",
      );
      await handle.chmod(0o600);
      await handle.chown(owner.uid, owner.gid);
      await handle.sync();
    } finally {
      await handle.close();
    }
    config = await loadConfig(file, owner.uid);
  }
  if (
    state.role &&
    (state.role.super ||
      state.role.createdb ||
      state.role.createrole ||
      state.role.replication ||
      state.role.bypassrls ||
      !state.role.login)
  )
    fail(
      "The managed database role has unexpected permissions. Nothing was altered.",
    );
  if (state.database && state.database !== name)
    fail("The database has another owner. Nothing was altered.");
  if (!state.role)
    peer(
      `CREATE ROLE "${name}" LOGIN PASSWORD '${config.url.password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`,
    );
  if (!state.database) peer(`CREATE DATABASE "${name}" OWNER "${name}";`);
  peer(
    `REVOKE CONNECT ON DATABASE "${name}" FROM PUBLIC; GRANT CONNECT ON DATABASE "${name}" TO "${name}";`,
  );
  peer(
    `REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE, CREATE ON SCHEMA public TO "${name}";`,
    name,
  );
  const connected = command(
    "psql",
    [
      "-X",
      "--no-password",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
    ],
    { input: "SELECT 1;", env: postgresEnv(config) },
    "The managed database could not be accessed with its app credentials. Config was preserved.",
  );
  if (connected !== "1") fail("Unexpected PostgreSQL connection result.");
  console.log("DATABASE_READY");
}
async function backup(args) {
  if (args.length !== 2) fail("backup requires CONFIG_FILE BACKUP_FILE.");
  const file = validPath(args[0]),
    destination = validPath(args[1]);
  if (file === destination) fail("Backup and config paths must differ.");
  const config = await loadConfig(file);
  await secureParent(destination);
  const handle = await open(
    destination,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  let complete = false;
  try {
    command(
      "pg_dump",
      ["--format=custom", "--no-password"],
      { env: postgresEnv(config), stdio: ["ignore", handle.fd, "pipe"] },
      "Database backup failed. No credential output was emitted.",
    );
    await handle.sync();
    if ((await handle.stat()).size === 0) fail("Database backup is empty.");
    command(
      "pg_restore",
      ["--list", destination],
      {},
      "Database backup validation failed.",
    );
    complete = true;
  } finally {
    await handle.close();
    if (!complete) await unlink(destination).catch(() => {});
  }
  console.log("BACKUP_READY");
}
try {
  const [operation, ...args] = process.argv.slice(2);
  if (operation === "prepare") await prepare(args);
  else if (operation === "backup") await backup(args);
  else fail("Usage: native-db.mjs prepare|backup ...");
} catch (error) {
  const safeErrors = new Set([
    "EACCES",
    "EPERM",
    "EEXIST",
    "ENOENT",
    "ENOTDIR",
    "ELOOP",
  ]);
  console.error(
    error.code
      ? safeErrors.has(error.code)
        ? `Server file operation failed (${error.code}). No existing file was overwritten.`
        : "Server file operation failed."
      : error instanceof SyntaxError
        ? "Invalid managed config or database metadata."
        : error.message,
  );
  process.exitCode = 1;
}
