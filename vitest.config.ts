import "./server/env";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // API tests deliberately use PostgreSQL. A missing dedicated test database is
    // a setup error rather than a reason to silently skip the integration suite.
    env: { APP_ORIGIN: "http://127.0.0.1:3000", NODE_ENV: "test" },
  },
});
