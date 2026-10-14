import "./env.js";
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be between 1 and 65535");
const app = await buildApp({ logger: true });
const shutdown = async () => {
  await app.close();
};
process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
