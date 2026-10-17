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
  mkdirSync(join(root, "dist"));
  writeFileSync(join(root, "dist/ctokodnomy-native.tar.gz"), "fixture upload\n");
  mkdirSync(join(root, "scripts"));
  for (const helper of ["brainycp-guards.sh", "brainycp-stage.sh", "native-unpack.mjs", "native-db.mjs", "brainycp-activate.sh"]) {
    writeFileSync(join(root, "scripts", helper), "fixture helper upload\n");
  }
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
  // Feed the first read-only command the real stdin guard, relocated into this
  // fixture. Later SSH boundaries are only recorded, never run on a server.
  command("ssh", `
remote_command="\u0024{!#}"
printf '%s\\n' "$remote_command" >> "$FIXTURE_SSH_LOG"
case "$remote_command" in
  "bash -s -- '/etc/brainy/conf/server_control/main' '"*)
    remote_command=\u0024{remote_command//\\/etc\\/brainy\\/conf\\/server_control\\/main/$FIXTURE_PANEL}
    status=0
    bash -c "$remote_command" || status=$?
    if (( status == 0 )) && [[ $FIXTURE_SCENARIO != *-transfer-* ]]; then exit 77; fi
    exit "$status" ;;
  "bash -s -- '/home/player/game' 'player' '"*)
    [[ $FIXTURE_SCENARIO == *-transfer-* ]]
    [[ $remote_command == "bash -s -- '/home/player/game' 'player' '$FIXTURE_INCOMING' '3003' 'game.example' '/opt/node/bin/node'" ]]
    cat >/dev/null ;;
  "cat > '$FIXTURE_INCOMING/"*)
    [[ $FIXTURE_SCENARIO == *-transfer-* ]]
    cat >/dev/null
    case "$FIXTURE_SCENARIO" in
      archive-transfer-255) exit 255 ;;
      archive-transfer-137) exit 137 ;;
      helper-transfer-255)
        [[ $remote_command == "cat > '$FIXTURE_INCOMING/app.tar.gz'" ]] || exit 255 ;;
      *) exit 97 ;;
    esac ;;
  *) exit 96 ;;
esac`);
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
      GITHUB_RUN_ID: "39035775715",
      GITHUB_RUN_ATTEMPT: "1",
      APP_NODE_BIN: "/opt/node/bin/node",
      PHP_HEALTHCHECK_URLS: "https://php.example/health.php",
      DEPLOY_SSH_KEY: "fixture-private-key-with-no-credentials",
      SSH_KNOWN_HOSTS: "server.example ssh-ed25519 fixture-public-key",
      FIXTURE_SCENARIO: scenario,
      FIXTURE_PANEL: panel,
      FIXTURE_SSH_LOG: sshLog,
      FIXTURE_CURL_LOG: curlLog,
      FIXTURE_INCOMING: `/var/lib/ctokodnomy-deploy/player-3003/${"a".repeat(40)}-${overrides.GITHUB_RUN_ID ?? "39035775715"}-${overrides.GITHUB_RUN_ATTEMPT ?? "1"}`,
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
    ["missing GitHub run", { GITHUB_RUN_ID: "" }],
    ["non-numeric GitHub run", { GITHUB_RUN_ID: "39035/775715" }],
    ["zero GitHub run", { GITHUB_RUN_ID: "0" }],
    ["missing GitHub attempt", { GITHUB_RUN_ATTEMPT: "" }],
    ["non-numeric GitHub attempt", { GITHUB_RUN_ATTEMPT: "1;exit 0" }],
    ["zero GitHub attempt", { GITHUB_RUN_ATTEMPT: "0" }],
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

  test.each([
    ["archive-transfer-255", 255, "app.tar.gz", 3],
    ["archive-transfer-137", 137, "app.tar.gz", 3],
    ["helper-transfer-255", 255, "brainycp-guards.sh", 4],
  ] as const)("reports %s and stops before activation without retrying", (scenario, status, destination, calls) => {
    const f = fixture(scenario);
    expect(f.result.status, f.result.stderr).toBe(status);
    expect(f.ssh).toHaveLength(calls);
    expect(f.ssh.at(-1)).toBe(`cat > '/var/lib/ctokodnomy-deploy/player-3003/${"a".repeat(40)}-39035775715-1/${destination}'`);
    expect(f.result.stdout).toContain(`::error title=BrainyCP deployment transfer::Upload of ${destination} failed (SSH exit ${status}).`);
    expect(f.result.stdout).toContain("private incoming directory was retained; activation was not started");
    expect(f.result.stdout).not.toContain("Verified SSH transfer complete");
    expect(f.runnerFiles).toEqual([]);
    if (status === 137) expect(f.result.stderr).toContain("SIGKILL, exit 137");
  });

  test("uses a fresh incoming path for each run or attempt of the same commit", () => {
    const first = fixture("archive-transfer-255");
    const repeated = fixture("archive-transfer-255", { GITHUB_RUN_ATTEMPT: "2" });
    const nextRun = fixture("archive-transfer-255", { GITHUB_RUN_ID: "39035775716" });
    for (const f of [first, repeated, nextRun]) expect(f.result.status, f.result.stderr).toBe(255);
    expect(new Set([first.ssh[2], repeated.ssh[2], nextRun.ssh[2]]).size).toBe(3);
    expect(repeated.ssh[2]).toContain(`${"a".repeat(40)}-39035775715-2/app.tar.gz`);
    expect(nextRun.ssh[2]).toContain(`${"a".repeat(40)}-39035775716-1/app.tar.gz`);
  });
});
