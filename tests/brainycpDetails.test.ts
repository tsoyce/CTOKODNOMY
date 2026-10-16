import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const scripts = resolve(import.meta.dirname, "../scripts");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ctokodnomy-details-"));
  roots.push(root);
  const bin = join(root, "bin"), app = join(root, "app"), home = join(root, "home");
  const etc = join(root, "etc"), php = join(root, "php");
  for (const path of [bin, app, home, php, join(etc, "httpd/vhost.d"), join(etc, "nginx/conf.d"), join(etc, "brainy/conf/server_control"), join(home, ".config/ctokodnomy"), join(app, "releases/previous")]) mkdirSync(path, { recursive: true });
  symlinkSync(join(app, "releases/previous"), join(app, "current"));
  writeFileSync(join(home, ".config/ctokodnomy/native-3003.env"), "CTOKODNOMY_MANAGED_CONFIG=1\nDATABASE_URL=DO_NOT_PRINT_DATABASE_SECRET\n", { mode: 0o600 });
  writeFileSync(join(etc, "brainy/conf/server_control/main"), "# back_server=old\nback_server=apache\nPANEL_SECRET=DO_NOT_PRINT_PANEL_SECRET\n");
  writeFileSync(join(etc, "nginx/conf.d/game.example-game.conf"), "# DO_NOT_PRINT_NGINX_SECRET\n");
  writeFileSync(join(etc, "httpd/vhost.d/php.example.conf"), `<VirtualHost *:443>\nServerName php.example\nDocumentRoot ${php}\n<FilesMatch \\.php$>\nSetHandler \"proxy:unix:/run/php-fpm/php84-player.sock|fcgi://localhost\"\n</FilesMatch>\n</VirtualHost>\n`);
  writeFileSync(join(php, "index.php"), "<?php $password='DO_NOT_PRINT_PHP_SOURCE'; echo 'ok';");
  const command = (name: string, body: string) => { const path = join(bin, name); writeFileSync(path, `#!/usr/bin/env bash\nset -eu\n${body}\n`); chmodSync(path, 0o755); };
  command("systemctl", `printf '%s\\n' 'ExecStart={ path=/opt/production-node/bin/node ; argv[]=/opt/production-node/bin/node --password=DO_NOT_PRINT_EXEC_SECRET ; }' 'MainPID=${process.pid}' 'EnvironmentFiles=${home}/.config/ctokodnomy/native-3003.env (ignore_errors=no)'`);
  command("getent", `printf '%s\\n' 'player:x:1000:1000::${home}:/bin/bash'`);
  command("nginx", `printf '%s\\n' '# configuration file ${etc}/nginx/conf.d/game.example-game.conf:' 'DO_NOT_PRINT_OTHER_SITES_CONFIG'`);
  command("curl", `printf '%s\\n' "$@" > "$FIXTURE_CURL"; printf '200\\ttext/html; charset=UTF-8\\t0'`);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, APP_ROOT: app, APP_USER: "player", APP_PORT: "3003", APP_DOMAIN: "game.example", PROBE_DOMAIN: "php.example", FIXTURE_CURL: join(root, "curl-args") };
  return { root, bin, app, home, etc, php, command, env };
}

describe("read-only BrainyCP details", () => {
  test("uses effective service and process paths, checks dynamic PHP, and excludes private data", () => {
    const f = fixture();
    const source = readFileSync(join(scripts, "brainycp-details.sh"), "utf8");
    const block = source.match(/APP_ROOT=.*node --input-type=module <<'NODE'\n([\s\S]*?)\nNODE/)?.[1];
    expect(block).toBeTruthy();
    // Relocate only fixed server files; execute the real diagnostics with fake
    // systemctl/nginx/curl, never access a remote host or privileged config.
    const relocated = block!.replaceAll("/etc/", `${f.etc}/`);
    const result = spawnSync(process.execPath, ["--input-type=module"], { input: relocated, encoding: "utf8", env: f.env });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Effective ExecStart executable: /opt/production-node/bin/node");
    expect(result.stdout).toContain("Running executable realpath:");
    expect(result.stdout).toContain(`Current release realpath: ${f.app}/releases/previous`);
    expect(result.stdout).toContain(`EnvironmentFiles paths: ${f.home}/.config/ctokodnomy/native-3003.env`);
    expect(result.stdout).toContain("regular=true symlink=false mode=600");
    expect(result.stdout).toContain("Managed configuration marker present: true");
    expect(result.stdout).toContain("active_count=1; single_nonempty_supported=true");
    expect(result.stdout).toContain("Dedicated proxy loaded count: 1");
    expect(result.stdout).toContain("DocumentRoot identified=true; index.php regular_exists=true; php_prefix=true");
    expect(result.stdout).toContain("Selected PHP handler socket: /run/php-fpm/php84-player.sock");
    expect(result.stdout).toContain("status=200; content_type=text/html; charset=UTF-8; tls_verify=0; redirects_followed=false");
    expect(result.stdout + result.stderr).not.toContain("DO_NOT_PRINT");
    const curl = readFileSync(f.env.FIXTURE_CURL, "utf8").trim().split("\n");
    expect(curl).toContain("https://php.example/index.php");
    expect(curl).toContain("/dev/null");
    expect(curl).not.toContain("--location");
    expect(curl).not.toContain("--insecure");
    expect(curl).not.toContain("-k");
  });

  test.each([
    ["exit 137"],
    ['kill -KILL "$$"'],
  ])("stops immediately when a diagnostic child is killed: %s", (failure) => {
    const f = fixture();
    f.command("systemctl", `${failure}\nprintf 'DO_NOT_PRINT_AFTER_KILL'`);
    const source = readFileSync(join(scripts, "brainycp-details.sh"), "utf8");
    const block = source.match(/APP_ROOT=.*node --input-type=module <<'NODE'\n([\s\S]*?)\nNODE/)![1].replaceAll("/etc/", `${f.etc}/`);
    const result = spawnSync(process.execPath, ["--input-type=module"], { input: block, encoding: "utf8", env: f.env });
    expect(result.status).toBe(137);
    expect(result.stderr).toBe("Read-only check aborted: systemctl SIGKILL/exit137; no retry.\n");
    expect(result.stdout).not.toContain("Effective ExecStart executable");
    expect(result.stdout + result.stderr).not.toContain("DO_NOT_PRINT");
    expect(() => readFileSync(f.env.FIXTURE_CURL)).toThrow();
  });

  test.each([
    ["/tmp", "player", "3003", "game.example", "php.example';touch /tmp/unwanted"],
    ["/tmp", "player", "65536", "game.example"],
    ["/tmp", "player", "3003", "game.example", "php..example"],
  ])("rejects invalid arguments before inspection: %j", (...args) => {
    const result = spawnSync("bash", [join(scripts, "brainycp-details.sh"), ...args], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  });

  test("dispatches the optional probe to details and preserves four-argument basic preflight", () => {
    const f = fixture();
    f.command("ssh-agent", `if [[ $1 == -s ]]; then printf 'SSH_AUTH_SOCK=/fixture; export SSH_AUTH_SOCK;\\n'; fi`);
    f.command("ssh-add", "exit 0");
    f.command("ssh", `printf '%s\\n' "\u0024{!#}" > "$FIXTURE_SSH"; cat > "$FIXTURE_SCRIPT"; printf 'read-only mock report\\n'`);
    for (const details of ["true", "false"]) {
      const result = spawnSync("bash", [join(scripts, "check-brainycp-ssh.sh")], { encoding: "utf8", env: { ...f.env, RUNNER_TEMP: f.root, DEPLOY_HOST: "server.example", DEPLOY_USER: "root", DEPLOY_SSH_KEY: "fake-private-key", SSH_KNOWN_HOSTS: "server.example ssh-ed25519 fake-public-key", CHECK_DETAILS: details, CHECK_WEB_SERVICES: "false", CHECK_PROBE_DOMAIN: "php.example", FIXTURE_SSH: join(f.root, "ssh-args"), FIXTURE_SCRIPT: join(f.root, "script") } });
      expect(result.status, result.stderr).toBe(0);
      const command = readFileSync(join(f.root, "ssh-args"), "utf8").trim();
      expect(command).toBe(`bash -s -- '${f.app}' 'player' '3003' 'game.example'${details === "true" ? " 'php.example'" : ""}`);
      expect(readFileSync(join(f.root, "script"), "utf8")).toContain(details === "true" ? "Effective runtime and release" : "Read-only diagnostics for one");
      expect(result.stdout + result.stderr).not.toContain("fake-private-key");
    }
  });
});
