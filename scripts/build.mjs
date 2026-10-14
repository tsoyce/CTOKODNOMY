import { spawnSync } from "node:child_process";
import { build as bundle } from "esbuild";

// Build production React even when the local .env describes development.
process.env.NODE_ENV = "production";
for (const args of [
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  ["node_modules/vite/bin/vite.js", "build"],
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await bundle({
  entryPoints: ["server/index.ts", "server/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outdir: "dist/server",
  logLevel: "info",
});
