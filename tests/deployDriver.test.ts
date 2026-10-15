import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const roots: string[] = [];
const driver = resolve(import.meta.dirname, "../scripts/deploy-brainycp-ssh.sh");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(scenario: string, overrides: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "ctokodnomy-deploy-driver-"));
  roots.push(root);
  const bin = join(root, "bin");
  const runner = join(root, "runner");
  const panel = join(root, "panel-main");
  const sshLog = join(root, "ssh-commands");
  const curlLog = join(root, "curl-requests");
  mkdirSync(bin);
  mkdirSync(runner);
  const panelText = scenario === "missing-back-server" ? "front_server=nginx\n" : "back_server=apache\n";
  writeFileSync(panel, panelText);
  writeFileSync(sshLog, "");
  writeFileSync(curlLog, "");
  const command = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/usr/bin/env bash\nset -eu\n${body}\n`);
    chmodSync(path, 0o755);
  };
  command("ssh-agent", `if [[ $1 == -s ]]; then printf 'SSH_AUTH_SOCK=/fixture-socket; export SSH_AUTH_SOCK;\\n'; else [[ $1 == -k ]]; fi`);
  command("ssh-add", "exit 0");
  command("curl", `
url="\u0024{!#}"
printf '%s\\n' "$url" >> "$FIXTURE_CURL_LOG"
[[ $url == https://php.example/health.php ]]
case "$FIXTURE_SCENARIO" in
  php-503) printf 503 ;;
  curl-137) exit 137 ;;
  *) printf 200 ;;
esac`);
  // Only the first, read-only command may execute. Feed it the real driver's
  // stdin guard script with its panel path relocated into this fixture.
  // Even a successful guard is deliberately stopped before PREPARE can run.
  command("ssh", `
remote_command="\u0024{!#}"
printf '%s\\n' "$remote_command" >> "$FIXTURE_SSH_LOG"
[[ $remote_command == "bash -s -- '/etc/brainy/conf/server_control/main' '"* ]] || exit 96
remote_command=\u0024{remote_command//\\/etc\\/brainy\\/conf\\/server_control\\/main/$FIXTURE_PANEL}
status=0
bash -c "$remote_command" || status=$?
if (( status == 0 )); then exit 77; fi
exit "$status"`);
  const result = spawnSync("bash", [driver], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: runner,
      DEPLOY_HOST: "server.example",
      DEPLOY_USER: "root",
      APP_ROOT: "/home/player/game",
      APP_USER: "player",
      APP_PORT: "3003",
      APP_DOMAIN: "game.example",
      GITHUB_SHA: "a".repeat(40),
      APP_NODE_BIN: "/opt/node/bin/node",
      PHP_HEALTHCHECK_URLS: "https://php.example/health.php",
      DEPLOY_SSH_KEY: "fixture-private-key-with-no-credentials",
      SSH_KNOWN_HOSTS: "server.example ssh-ed25519 fixture-public-key",
      FIXTURE_SCENARIO: scenario,
      FIXTURE_PANEL: panel,
      FIXTURE_SSH_LOG: sshLog,
      FIXTURE_CURL_LOG: curlLog,
      ...overrides,
    },
  });
  const lines = (path: string) => readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  return { result, ssh: lines(sshLog), curls: lines(curlLog), panel: readFileSync(panel, "utf8"), panelText, runnerFiles: readdirSync(runner) };
}

describe("BrainyCP deployment driver pre-upload boundary", () => {
  test.each([
    ["missing-back-server", 1, "back_server setting is missing"],
    ["php-503", 1, "PHP health check failed"],
    ["curl-137", 137, "SIGKILL, exit 137"],
  ] as const)("refuses %s using only the read-only SSH stdin guard", (scenario, status, error) => {
    const f = fixture(scenario);
    expect(f.result.status, f.result.stderr).toBe(status);
    expect(f.result.stderr).toContain(error);
    expect(f.ssh).toEqual(["bash -s -- '/etc/brainy/conf/server_control/main' 'https://php.example/health.php'"]);
    expect(f.curls).toEqual(scenario === "missing-back-server" ? [] : ["https://php.example/health.php"]);
    expect(f.panel).toBe(f.panelText);
    expect(f.runnerFiles).toEqual([]);
    expect(f.result.stdout).not.toContain("Private incoming directory prepared");
  });

  test.each([
    ["invalid PHP URL", { PHP_HEALTHCHECK_URLS: "https://php.example/health.php';touch /tmp/unwanted;#" }],
    ["missing Node executable input", { APP_NODE_BIN: "" }],
  ])("rejects %s locally before SSH or authentication files", (_, overrides) => {
    const f = fixture("success", overrides as Record<string, string>);
    expect(f.result.status, f.result.stderr).toBe(2);
    expect(f.ssh).toEqual([]);
    expect(f.curls).toEqual([]);
    expect(f.panel).toBe(f.panelText);
    expect(f.runnerFiles).toEqual([]);
  });

  test("actually evaluates the valid stdin guard before the fixture stops further deployment", () => {
    const f = fixture("success");
    expect(f.result.status, f.result.stderr).toBe(77);
    expect(f.ssh).toHaveLength(1);
    expect(f.curls).toEqual(["https://php.example/health.php"]);
    expect(f.panel).toBe(f.panelText);
    expect(f.runnerFiles).toEqual([]);
  });
});
