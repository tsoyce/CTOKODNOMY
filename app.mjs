import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (Number(process.versions.node.split(".")[0]) !== 24) {
  throw new Error("This application requires Node.js 24.");
}

// A hosting panel may start this file from another working directory, or
// through current/app.mjs. Resolve .env and frontend assets in this release.
const release = dirname(realpathSync(fileURLToPath(import.meta.url)));
process.chdir(release);
await import(pathToFileURL(join(release, "dist/server/index.js")).href);
