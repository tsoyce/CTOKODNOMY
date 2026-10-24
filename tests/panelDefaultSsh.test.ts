import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(exitStatus = 0) {
  const root = mkdtempSync(join(tmpdir(), "ctokodnomy-default-ssh-test-")); roots.push(root);
  const bin = join(root, "bin"), source = join(root, "scripts");
  mkdirSync(bin); mkdirSync(source);
  for (const name of ["fix-brainycp-default-ssh.sh", "brainycp-guards.sh"]) copyFileSync(resolve(import.meta.dirname, "../scripts", name), join(source, name));
  writeFileSync(join(source, "brainycp-panel-default.mjs"), "// fixture transaction, never executed\n");
  const command = (name: string, body: string) => { const path = join(bin, name); writeFileSync(path, `#!/usr/bin/env bash\nset -eu\n${body}\n`); chmodSync(path, 0o755); };
  command("ssh-agent", 'if [[ $1 == -s ]]; then printf "SSH_AUTH_SOCK=/fixture; export SSH_AUTH_SOCK;\\n"; fi');
  command("ssh-add", "exit 0");
  command("ssh", `printf '%s\\n' "$@" > "$FIXTURE_ARGS"; cat > "$FIXTURE_SCRIPT"; printf 'bounded fixture report\\n'; exit ${exitStatus}`);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: root, DEPLOY_HOST: "server.example", DEPLOY_USER: "root", DEPLOY_SSH_KEY: "DO_NOT_PRINT_PRIVATE_KEY", SSH_KNOWN_HOSTS: "server.example ssh-ed25519 fixture", REPAIR_MODE: "plan", REPAIR_CONFIGURATION: JSON.stringify({ node_bin: "/opt/node24/bin/node", domain: "game.example" }), GITHUB_RUN_ID: "12345", GITHUB_RUN_ATTEMPT: "2", FIXTURE_ARGS: join(root, "ssh-args"), FIXTURE_SCRIPT: join(root, "ssh-script") };
  return { root, env, run: (overrides: Record<string, string> = {}) => spawnSync("bash", [join(source, "fix-brainycp-default-ssh.sh")], { env: { ...env, ...overrides }, encoding: "utf8", timeout: 10000 }) };
}

test("sends the bounded transaction and guarded runtime over pinned SSH without leaking its key", () => {
  const f = fixture(); const result = f.run();
  expect(result.status, result.stderr).toBe(0);
  const args = readFileSync(f.env.FIXTURE_ARGS, "utf8");
  expect(args).toContain("StrictHostKeyChecking=yes");
  expect(args).toContain("ForwardAgent=no");
  expect(args).toContain('exec "$runtime" --input-type=module - "$2" "$3"');
  expect(args).toContain("stat -c %u");
  const script = readFileSync(f.env.FIXTURE_SCRIPT, "utf8");
  expect(script).toContain("const CTOK_GUARD_SOURCE =");
  expect(script).toContain("fixture transaction, never executed");
  expect(result.stdout + result.stderr).not.toContain("DO_NOT_PRINT");
  expect(readdirSync(f.root).some(name => name.startsWith("ctokodnomy-default-ssh."))).toBe(false);
});

test.each([137, 255])("preserves remote failure %s and removes runner credentials", (status) => {
  const f = fixture(status); const result = f.run();
  expect(result.status, result.stderr).toBe(status);
  expect(result.stdout).toContain("::error title=BrainyCP default repair part 1::bounded fixture report");
  expect(result.stdout + result.stderr).not.toContain("DO_NOT_PRINT");
  expect(readdirSync(f.root).some(name => name.startsWith("ctokodnomy-default-ssh."))).toBe(false);
});

test("rejects an unreviewed apply before creating SSH credentials or contacting the server", () => {
  const f = fixture(); const result = f.run({ REPAIR_MODE: "apply" });
  expect(result.status).toBe(2);
  expect(existsSync(f.env.FIXTURE_ARGS)).toBe(false);
  expect(readdirSync(f.root).some(name => name.startsWith("ctokodnomy-default-ssh."))).toBe(false);
});
