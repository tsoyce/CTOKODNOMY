import { existsSync } from "node:fs";

// Node's .env loader preserves variables already injected by the runtime or CI.
// Values are never logged and .env is not part of the repository.
if (existsSync(".env")) process.loadEnvFile(".env");
