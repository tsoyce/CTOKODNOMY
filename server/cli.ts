import "./env.js";
import {
  createDatabase,
  migrate,
  issueSetupToken,
  passwordHash,
  transaction,
} from "./db.js";

async function readPassword(stdin: boolean): Promise<string> {
  if (stdin) {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk.toString();
      if (input.length > 1024) throw new Error("Password input is too long");
    }
    return input.replace(/\r?\n$/, "");
  }
  if (!process.stdin.isTTY)
    throw new Error(
      "Use --stdin to read a password from standard input, or run interactively. Password arguments are not accepted.",
    );
  process.stderr.write("New password (hidden): ");
  return new Promise((resolve, reject) => {
    let password = "";
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stderr.write("\n");
    };
    const onData = (data: string) => {
      for (const character of data) {
        if (character === "\u0003") {
          finish();
          reject(new Error("Cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          resolve(password);
          return;
        }
        if (character === "\u007f" || character === "\b")
          password = password.slice(0, -1);
        else if (character >= " " && password.length < 128)
          password += character;
      }
    };
    process.stdin.on("data", onData);
  });
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!["migrate", "setup-token", "reset-password"].includes(command ?? ""))
    throw new Error(
      "Usage: cli migrate | setup-token | reset-password <username> [--stdin]",
    );
  if (command !== "reset-password" && args.length)
    throw new Error("Unexpected command arguments");
  if (
    command === "reset-password" &&
    (!args[0] ||
      args[0] === "--stdin" ||
      args.length > 2 ||
      (args[1] && args[1] !== "--stdin"))
  )
    throw new Error(
      "Usage: cli reset-password <username> [--stdin]. Never pass a password as an argument.",
    );
  const pool = createDatabase();
  try {
    await migrate(pool);
    if (command === "migrate")
      process.stdout.write("Database migrations applied.\n");
    if (command === "setup-token") {
      // This deliberate administrator command is the only place a raw setup token is printed.
      process.stdout.write(`${await issueSetupToken(pool)}\n`);
      process.stderr.write(
        "One-time setup token expires in 1 hour. Enter it at /setup; keep it private.\n",
      );
    }
    if (command === "reset-password") {
      const username = args[0].toLowerCase();
      const existing = await pool.query(
        "SELECT id FROM admins WHERE username=$1",
        [username],
      );
      if (!existing.rowCount) throw new Error("Administrator not found");
      const password = await readPassword(args.includes("--stdin"));
      if (password.length < 1 || password.length > 128)
        throw new Error("Password must contain 1 to 128 characters");
      const hash = await passwordHash(password);
      await transaction(pool, async (client) => {
        await client.query("UPDATE admins SET password_hash=$2 WHERE id=$1", [
          existing.rows[0].id,
          hash,
        ]);
        await client.query("DELETE FROM admin_sessions WHERE admin_id=$1", [
          existing.rows[0].id,
        ]);
      });
      process.stdout.write(
        "Password updated. Existing administrator sessions revoked.\n",
      );
    }
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Command failed"}\n`,
  );
  process.exitCode = 1;
});
