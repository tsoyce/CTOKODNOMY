import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const roots: string[] = [];
const sha = "a".repeat(40);
const previousSha = "b".repeat(40);
const repository = resolve(import.meta.dirname, "..");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Run the shipped transaction, not a second implementation. The temporary copy
// relocates its two absolute infrastructure roots; PATH commands stand in for
// the server/privilege/network boundary. Nothing contacts a server or needs root.
function fixture(scenario = "success") {
  const root = mkdtempSync(join(tmpdir(), "ctokodnomy-activation-"));
  roots.push(root);
  const scripts = join(root, "scripts");
  const bin = join(root, "bin");
  const base = join(root, "application");
  const home = join(root, "home", "player");
  const oldRelease = join(base, "releases", previousSha);
  const newRelease = join(base, "releases", sha);
  const incoming = join(root, "var/lib/ctokodnomy-deploy/player-3003", `${sha}-39035775715-1`);
  const panel = join(root, "etc/brainy/conf/server_control/main");
  const site = join(root, "etc/nginx/conf.d/game.example-game.conf");
  const service = join(root, "etc/systemd/system/nodejs@3003.service.d/game.conf");
  const config = join(home, ".config/ctokodnomy/native-3003.env");
  const backups = join(dirname(incoming), "backups");
  const events = join(root, "events");
  const node = join(bin, "node-runtime");
  const current = join(base, "current");
  const put = (path: string, body: string, executable = false) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    chmodSync(path, executable ? 0o755 : 0o600);
  };
  for (const directory of [scripts, bin, oldRelease, incoming]) {
    mkdirSync(directory, { recursive: true });
  }
  if (scenario === "release-exists") mkdirSync(newRelease);
  put(panel, scenario === "missing-back-server" ? "front_server=nginx\n" : "front_server=nginx\nback_server=apache\n");
  put(site, "# Existing, operator-provisioned game proxy\n");
  put(service, "[Service]\n# Existing game unit owned by the operator\n");
  put(config, "DATABASE_URL=postgresql://fixture/fixture\n");
  let configuredHome = home;
  if (scenario === "home-dot-segment") configuredHome = `${dirname(home)}/./player`;
  if (scenario === "home-repeated-dot-segments") configuredHome = `${dirname(home)}/././player/./.`;
  if (scenario === "home-trailing-slashes") configuredHome = `${home}///`;
  if (scenario === "home-parent-segment") configuredHome = `${home}/../player`;
  if (scenario === "home-double-slash") configuredHome = `${dirname(home)}//player`;
  if (scenario === "home-root") configuredHome = "/./";
  if (scenario === "home-symlink" || scenario === "home-symlink-with-dot") {
    const alias = join(root, "home-alias");
    symlinkSync(home, alias);
    configuredHome = scenario === "home-symlink-with-dot" ? `${root}/./home-alias/.` : alias;
  }
  if (scenario !== "old-entry-missing") put(join(oldRelease, "app.mjs"), "// previous working release\n");
  if (scenario !== "old-server-missing") put(join(oldRelease, "dist/server/index.js"), "// previous server entry\n");
  const oldEnvironment = scenario === "old-environment-wrong" ? `${config}.wrong` : config;
  if (oldEnvironment !== config) put(oldEnvironment, "DATABASE_URL=postgresql://fixture/wrong\n");
  symlinkSync(oldEnvironment, join(oldRelease, ".env"));
  put(join(incoming, "app.tar.gz"), "fixture archive boundary\n");
  put(events, "");
  symlinkSync(oldRelease, current);
  put(node, `#!/usr/bin/env bash\nif [[ $1 == --version ]]; then echo v24.1.0; else exec "$FIXTURE_REAL_NODE" "$@"; fi\n`, true);
  copyFileSync(join(repository, "scripts/brainycp-guards.sh"), join(scripts, "brainycp-guards.sh"));
  const activation = readFileSync(join(repository, "scripts/brainycp-activate.sh"), "utf8")
    .replaceAll("/etc/", `${root}/etc/`)
    .replaceAll("/var/", `${root}/var/`);
  put(join(scripts, "brainycp-activate.sh"), activation);
  put(join(scripts, "native-db.mjs"), `
import { appendFileSync, writeFileSync } from "node:fs";
const [mode, , destination] = process.argv.slice(2);
appendFileSync(process.env.FIXTURE_EVENTS, "db-" + mode + "\\n");
if (mode === "backup") {
  if (process.env.FIXTURE_SCENARIO === "backup-fail") process.exit(1);
  writeFileSync(destination, "fixture database dump");
}
`);
  put(join(scripts, "brainycp-stage.sh"), `#!/usr/bin/env bash
set -eu
echo stage >> "$FIXTURE_EVENTS"
if [[ $FIXTURE_SCENARIO == stage-137 ]]; then exit 137; fi
mkdir "$1/releases/$3"
echo '// candidate release' > "$1/releases/$3/app.mjs"
if [[ $FIXTURE_SCENARIO == panel-changed ]]; then echo '# concurrent panel update' >> "$FIXTURE_PANEL"; fi
`);
  const command = (name: string, body: string) => put(join(bin, name), `#!/usr/bin/env bash\nset -eu\n${body}\n`, true);
  command("id", 'if [[ $1 == -u && $# == 1 ]]; then echo 0; elif [[ $1 == -u && $2 == player ]]; then echo 1001; else exit 91; fi');
  command("stat", `
case "$2" in
  %u) echo 0 ;;
  %U) echo player ;;
  %a) if [[ $3 == "$FIXTURE_DEPLOY_ROOT"* ]]; then echo 700; else echo 755; fi ;;
  *) exec "$FIXTURE_REAL_STAT" "$@" ;;
esac`);
  command("getent", '[[ $1 == passwd && $2 == player ]]\nprintf "player:x:1001:1001::%s:/bin/bash\\n" "$FIXTURE_HOME"');
  command("cp", 'if [[ $FIXTURE_SCENARIO == copy-137 ]]; then exit 137; fi\nexec "$FIXTURE_REAL_CP" "$@"');
  command("systemctl", `
printf 'systemctl %s\\n' "$*" >> "$FIXTURE_EVENTS"
case "$1" in
  show)
    if [[ $* == *--value ]]; then
      case "$4" in
        User) echo player ;;
        RootDirectory) echo ;;
        WorkingDirectory) echo "$FIXTURE_BASE/current" ;;
        ExecStart)
          printf '{ path=%s ; argv[]=%s %s/current/app.mjs ; }' "$FIXTURE_NODE" "$FIXTURE_NODE" "$FIXTURE_BASE"
          if [[ $FIXTURE_SCENARIO == multiple-exec-start ]]; then printf ' ; { path=/bin/another ; argv[]=/bin/another ; }'; fi
          printf '\\n' ;;
        EnvironmentFiles) echo "$FIXTURE_CONFIG (ignore_errors=no)" ;;
        *) exit 92 ;;
      esac
    else
      printf 'User=player\\nWorkingDirectory=%s/current\\n' "$FIXTURE_BASE"
    fi ;;
  cat) cat "$FIXTURE_SERVICE" ;;
  is-active) exit 0 ;;
  restart) [[ $2 == nodejs@3003.service && $# == 2 ]] ;;
  *) echo 'Unexpected systemd mutation' >&2; exit 93 ;;
esac`);
  command("nginx", `
printf 'nginx %s\\n' "$*" >> "$FIXTURE_EVENTS"
case "$1" in
  -t) exit 0 ;;
  -T) printf '# configuration file %s:\\n' "$FIXTURE_SITE" ;;
  *) echo 'Unexpected nginx mutation' >&2; exit 94 ;;
esac`);
  command("runuser", `[[ $1 == -u && $2 == player && $3 == -- ]]
shift 3
if [[ $FIXTURE_SCENARIO == link-137 && $1 == ln ]]; then exit 137; fi
exec "$@"`);
  for (const name of ["pg_dump", "pg_restore"]) command(name, "exit 0");
  command("curl", `
url="\u0024{!#}"
target=$(readlink "$FIXTURE_CURRENT")
if [[ $url == https://php.example/health.php ]]; then
  echo php-check >> "$FIXTURE_EVENTS"
  if [[ $FIXTURE_SCENARIO == php-baseline-fail || ( $FIXTURE_SCENARIO == php-post-fail && $target == "$FIXTURE_NEW_RELEASE" ) ]]; then
    printf 503
  else
    printf 200
  fi
else
  if [[ $FIXTURE_SCENARIO == readiness-137 && $target == "$FIXTURE_NEW_RELEASE" ]]; then
    echo readiness-killed >> "$FIXTURE_EVENTS"
    exit 137
  fi
  if [[ $FIXTURE_SCENARIO == app-post-fail && $target == "$FIXTURE_NEW_RELEASE" && $url == https://game.example/api/health ]]; then exit 22; fi
  printf '{"ok":true}'
fi`);
  const protectedFiles = [panel, site, service, config];
  const fingerprint = () => protectedFiles.map((file) => createHash("sha256").update(readFileSync(file)).digest("hex"));
  const before = fingerprint();
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FIXTURE_REAL_NODE: process.execPath,
    FIXTURE_REAL_STAT: spawnSync("which", ["stat"], { encoding: "utf8" }).stdout.trim(),
    FIXTURE_REAL_CP: spawnSync("which", ["cp"], { encoding: "utf8" }).stdout.trim(),
    FIXTURE_SCENARIO: scenario,
    FIXTURE_EVENTS: events,
    FIXTURE_PANEL: panel,
    FIXTURE_SITE: site,
    FIXTURE_SERVICE: service,
    FIXTURE_BASE: base,
    FIXTURE_HOME: configuredHome,
    FIXTURE_NODE: node,
    FIXTURE_CONFIG: config,
    FIXTURE_CURRENT: current,
    FIXTURE_NEW_RELEASE: newRelease,
    FIXTURE_DEPLOY_ROOT: join(root, "var/lib/ctokodnomy-deploy"),
  };
  return {
    base, backups, incoming, panel, config, current, oldRelease, newRelease, before, fingerprint,
    run: (incomingPath = incoming) => spawnSync("bash", [join(scripts, "brainycp-activate.sh"), base, "player", "3003", "game.example", sha, "c".repeat(64), incomingPath, node, "https://php.example/health.php"], { env, encoding: "utf8", timeout: 10_000 }),
    events: () => readFileSync(events, "utf8").trim().split("\n"),
  };
}

function expectOnlyGameRestarts(events: string[], count: number) {
  const mutations = events.filter((event) => event.startsWith("systemctl ") && !/^systemctl (show|cat|is-active) /.test(event));
  expect(mutations).toEqual(Array(count).fill("systemctl restart nodejs@3003.service"));
  expect(events.filter((event) => event.startsWith("nginx "))).toEqual(["nginx -t", "nginx -T"]);
}

describe("BrainyCP release activation transaction", () => {
  test.each([
    sha,
    `${sha}-39035775715`,
    `${sha}-39035775715-0`,
    `${sha}-0-1`,
    `${sha}-39035775715-1-extra`,
    `${previousSha}-39035775715-1`,
    `${sha}-39035775715-1/nested`,
    `../other-3003/${sha}-39035775715-1`,
  ])("rejects an invalid or foreign incoming path before mutations: %s", (leaf) => {
    const f = fixture();
    const candidate = `${dirname(f.incoming)}/${leaf}`;
    mkdirSync(candidate, { recursive: true });
    const result = f.run(candidate);
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("Invalid private incoming directory");
    expect(readlinkSync(f.current)).toBe(f.oldRelease);
    expect(existsSync(f.newRelease)).toBe(false);
    expect(existsSync(f.backups)).toBe(false);
    expect(f.events().filter(Boolean)).toEqual([]);
    expect(f.fingerprint()).toEqual(f.before);
  });

  test("refuses an already staged release even when the incoming attempt is fresh", () => {
    const f = fixture("release-exists");
    const result = f.run();
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("Release already exists");
    expect(readlinkSync(f.current)).toBe(f.oldRelease);
    expect(existsSync(f.backups)).toBe(false);
    expect(f.events().filter(Boolean)).toEqual([]);
    expect(f.fingerprint()).toEqual(f.before);
  });

  test.each(["home-dot-segment", "home-repeated-dot-segments", "home-trailing-slashes"])("accepts harmless lexical home spelling: %s", (scenario) => {
    const f = fixture(scenario);
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(readlinkSync(f.current)).toBe(f.newRelease);
    expect(readlinkSync(join(f.newRelease, ".env"))).toBe(f.config);
    expect(f.fingerprint()).toEqual(f.before);
    expect(f.events().indexOf("db-backup")).toBeLessThan(f.events().indexOf("stage"));
    expectOnlyGameRestarts(f.events(), 1);
    expect(result.stdout).toContain("Release verified");
  });

  test.each(["home-symlink", "home-symlink-with-dot", "home-parent-segment", "home-double-slash", "home-root"])("rejects unsafe home without changing the release or services: %s", (scenario) => {
    const f = fixture(scenario);
    const result = f.run();
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("Application home must be physical");
    expect(readlinkSync(f.current)).toBe(f.oldRelease);
    expect(existsSync(f.newRelease)).toBe(false);
    expect(existsSync(f.backups)).toBe(false);
    expect(f.events().filter(Boolean)).toEqual([]);
    expect(f.fingerprint()).toEqual(f.before);
  });

  test.each(["old-entry-missing", "old-server-missing", "old-environment-wrong", "multiple-exec-start"])("refuses unsafe rollback prerequisites: %s", (scenario) => {
    const f = fixture(scenario);
    const result = f.run();
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain("Activation refused");
    expect(readlinkSync(f.current)).toBe(f.oldRelease);
    expect(f.events()).not.toContain("stage");
    expect(f.events()).not.toContain("db-backup");
    expect(f.events().some((event) => event.startsWith("systemctl restart"))).toBe(false);
    expect(existsSync(f.backups)).toBe(false);
    expect(f.fingerprint()).toEqual(f.before);
  });

  test.each(["missing-back-server", "php-baseline-fail"])("refuses %s before staging, backup or service changes", (scenario) => {
    const f = fixture(scenario);
    const result = f.run();
    expect(result.status, result.stderr).not.toBe(0);
    expect(readlinkSync(f.current)).toBe(f.oldRelease);
    expect(f.events()).not.toContain("stage");
    expect(f.events()).not.toContain("db-backup");
    expect(f.events().some((event) => event.startsWith("systemctl restart"))).toBe(false);
    expect(existsSync(f.backups)).toBe(false);
    expect(result.stderr).toContain(scenario === "missing-back-server" ? "back_server setting is missing" : "PHP health check failed");
    expect(f.fingerprint()).toEqual(f.before);
  });

  test("refuses an incomplete database backup before staging or restart", () => {
    const f = fixture("backup-fail");
    const result = f.run();
    expect(result.status, result.stderr).not.toBe(0);
    expect(f.events()).toContain("db-backup");
    expect(f.events()).not.toContain("stage");
    expect(readlinkSync(f.current)).toBe(f.oldRelease);
    expectOnlyGameRestarts(f.events(), 0);
    expect(f.fingerprint()).toEqual(f.before);
  });

  test("aborts a backup copy SIGKILL without staging, utility bypass or service changes", () => {
    const f = fixture("copy-137");
    const result = f.run();
    expect(result.status, result.stderr).toBe(137);
    expect(result.stderr).toContain("SIGKILL, exit 137");
    expect(f.events()).not.toContain("db-backup");
    expect(f.events()).not.toContain("stage");
    expect(readlinkSync(f.current)).toBe(f.oldRelease);
    expectOnlyGameRestarts(f.events(), 0);
    expect(f.fingerprint()).toEqual(f.before);
  });

  test("detects a concurrent panel change and leaves the working release running", () => {
    const f = fixture("panel-changed");
    const result = f.run();
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("configuration changed during deployment");
    expect(f.events()).toContain("stage");
    expect(readlinkSync(f.current)).toBe(f.oldRelease);
    expect(readFileSync(f.panel, "utf8")).toContain("concurrent panel update");
    expect(f.fingerprint().slice(1)).toEqual(f.before.slice(1));
    expectOnlyGameRestarts(f.events(), 0);
  });

  test.each(["stage-137", "link-137"])("stops on %s instead of retrying or switching the working release", (scenario) => {
    const f = fixture(scenario);
    const result = f.run();
    expect(result.status, result.stderr).toBe(137);
    expect(result.stderr).toContain("SIGKILL, exit 137");
    expect(f.events().filter((event) => event === "stage")).toHaveLength(1);
    expect(readlinkSync(f.current)).toBe(f.oldRelease);
    expectOnlyGameRestarts(f.events(), 0);
    expect(f.fingerprint()).toEqual(f.before);
  });

  test("does not retry SIGKILL during readiness and restores the previous game release", () => {
    const f = fixture("readiness-137");
    const result = f.run();
    expect(result.status, result.stderr).toBe(137);
    expect(result.stderr).toContain("SIGKILL, exit 137");
    expect(f.events().filter((event) => event === "readiness-killed")).toHaveLength(1);
    expect(readlinkSync(f.current)).toBe(f.oldRelease);
    expectOnlyGameRestarts(f.events(), 2);
    expect(f.fingerprint()).toEqual(f.before);
  });

  test.each(["app-post-fail", "php-post-fail"])("restores only game code when %s occurs after restart", (scenario) => {
    const f = fixture(scenario);
    const result = f.run();
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("Previous game code restored");
    expect(readlinkSync(f.current)).toBe(f.oldRelease);
    expectOnlyGameRestarts(f.events(), 2);
    expect(f.fingerprint()).toEqual(f.before);
    expect(existsSync(f.newRelease)).toBe(true);
  });

  test("backs up before staging, switches the release, and never rewrites shared infrastructure", () => {
    const f = fixture();
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(readlinkSync(f.current)).toBe(f.newRelease);
    expect(readlinkSync(join(f.newRelease, ".env"))).toBe(f.config);
    expect(f.fingerprint()).toEqual(f.before);
    expectOnlyGameRestarts(f.events(), 1);
    expect(f.events().indexOf("db-backup")).toBeLessThan(f.events().indexOf("stage"));
    expect(f.events().filter((event) => event === "php-check")).toHaveLength(3);
    const [backup] = readdirSync(f.backups);
    expect(readdirSync(join(f.backups, backup)).sort()).toEqual([
      "application.env", "brainy-main.conf", "configuration.sha256", "database.dump", "nginx-game.conf",
      "php-health.txt", "previous-release.txt", "service-state.txt", "service.conf",
    ]);
    expect(readFileSync(join(f.backups, backup, "previous-release.txt"), "utf8").trim()).toBe(f.oldRelease);
    expect(readFileSync(join(f.oldRelease, "app.mjs"), "utf8")).toBe("// previous working release\n");
    expect(result.stdout).toContain("Release verified");
  });
});
