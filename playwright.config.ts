import "./server/env";
import { randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";

const databaseUrl = process.env.DATABASE_URL_TEST;
if (
  !databaseUrl ||
  !decodeURIComponent(new URL(databaseUrl).pathname).endsWith("_test")
) {
  throw new Error(
    "E2E tests require DATABASE_URL_TEST pointing to a dedicated database with a name ending in _test.",
  );
}
const schema =
  process.env.E2E_DATABASE_SCHEMA ?? `e2e_${randomUUID().replaceAll("-", "")}`;
if (!/^e2e_[a-f0-9]{32}$/.test(schema))
  throw new Error("Invalid E2E database schema.");
process.env.E2E_DATABASE_SCHEMA = schema;
// Browser checks use their own server alongside the development application.
const testPort = process.env.E2E_PORT ?? "4173";
if (!/^\d+$/.test(testPort) || Number(testPort) < 1 || Number(testPort) > 65535)
  throw new Error("E2E_PORT must be a TCP port number.");
const testOrigin = `http://127.0.0.1:${testPort}`;

// A new schema belongs to this test run only. Production tables are never
// truncated. The server wrapper removes its schema when Playwright shuts down.
const startServer = `
import pg from 'pg';
import { spawn } from 'node:child_process';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_TEST });
const schema = process.env.E2E_DATABASE_SCHEMA;
await pool.query('CREATE SCHEMA "' + schema + '"');
const child = spawn(process.execPath, ['dist/server/index.js'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL_TEST,
    PGOPTIONS: '-c search_path=' + schema,
    APP_ORIGIN: process.env.E2E_ORIGIN, PORT: process.env.E2E_PORT, HOST: '127.0.0.1', NODE_ENV: 'test' }
});
let stopping = false;
async function finish(code) {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 4000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await pool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
  await pool.end();
  process.exit(code);
}
child.once('exit', code => { void finish(code ?? 1); });
process.once('SIGTERM', () => { void finish(0); });
process.once('SIGINT', () => { void finish(0); });
`;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/e2e.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  reporter: process.env.CI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: testOrigin,
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    // Setup uses an ephemeral grant and a password. Do not retain browser
    // traces containing their request bodies; screenshots are sufficient here.
    trace: "off",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: `node --input-type=module -e '${startServer.replaceAll("'", "'\\''")}'`,
    url: `${testOrigin}/health`,
    reuseExistingServer: false,
    timeout: 45_000,
    env: {
      DATABASE_URL_TEST: databaseUrl,
      E2E_DATABASE_SCHEMA: schema,
      E2E_PORT: testPort,
      E2E_ORIGIN: testOrigin,
    },
  },
});
