import pg from "pg";
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

export type Database = pg.Pool;
export type Transaction = pg.PoolClient;
const scrypt = promisify(scryptCallback);
export function createDatabase(
  databaseUrl = process.env.DATABASE_URL,
): Database {
  if (!databaseUrl)
    throw new Error(
      "DATABASE_URL is required. Configure PostgreSQL before starting the application.",
    );
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}
export async function transaction<T>(
  pool: Database,
  operation: (client: Transaction) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const [method, salt, expected] = hash.split(":");
  if (
    method !== "scrypt" ||
    !salt ||
    !expected ||
    !/^[a-f0-9]{128}$/.test(expected)
  )
    return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(key, Buffer.from(expected, "hex"));
}

// Applied under a PostgreSQL advisory lock; scripts and application startup can safely run together.
const initialSchema = `
CREATE TABLE IF NOT EXISTS app_settings (
  id integer PRIMARY KEY CHECK (id = 1), initialized boolean NOT NULL DEFAULT false,
  brand jsonb NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE admins (
  id uuid PRIMARY KEY, username text NOT NULL UNIQUE, password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE setup_grants (
  token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE TABLE admin_sessions (
  token_hash text PRIMARY KEY, admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX admin_sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE questions (
  id uuid PRIMARY KEY, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE games (
  id uuid PRIMARY KEY, state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE participants (
  id uuid PRIMARY KEY, game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team_id text NOT NULL, name text NOT NULL, role text NOT NULL CHECK (role IN ('player','captain')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX participants_game ON participants(game_id);
CREATE UNIQUE INDEX one_captain_per_team ON participants(game_id, team_id) WHERE role = 'captain';
CREATE TABLE participant_sessions (
  token_hash text PRIMARY KEY, participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX participant_sessions_expiry ON participant_sessions(expires_at);
CREATE TABLE game_commands (
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  request_id text NOT NULL, actor text NOT NULL, input_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(game_id,request_id)
);
`;
export async function migrate(pool: Database): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(734621910)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const applied = await client.query(
      "SELECT version FROM schema_migrations WHERE version = 1",
    );
    if (!applied.rowCount) {
      await client.query(initialSchema);
      await client.query("INSERT INTO schema_migrations(version) VALUES(1)");
    }
  });
}
export async function issueSetupToken(pool: Database): Promise<string> {
  const token = newToken();
  await transaction(pool, async (client) => {
    const settings = await client.query(
      "SELECT initialized FROM app_settings WHERE id = 1 FOR UPDATE",
    );
    if (settings.rows[0]?.initialized)
      throw new Error(
        "Application is already initialized. Use reset-password to restore administrator access.",
      );
    await client.query("DELETE FROM setup_grants");
    await client.query(
      "INSERT INTO setup_grants(token_hash,expires_at) VALUES($1,now() + interval '1 hour')",
      [tokenHash(token)],
    );
  });
  return token;
}
