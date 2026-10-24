import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const scripts = resolve(import.meta.dirname, "../scripts");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ctokodnomy-routing-")); roots.push(root);
  const bin = join(root, "bin"), etc = join(root, "etc"), app = join(root, "app"), privateRoot = join(root, "var/lib"), records = join(root, "var/brainycp/data/vhosts"), hooks = join(root, "var/brainycp/data/webserver_config/user_includes/player");
  for (const directory of [bin, app, records, hooks, join(etc, "nginx/conf.d"), join(etc, "nginx/sites-available"), join(etc, "httpd/vhost.d")]) mkdirSync(directory, { recursive: true });
  const configuration = `server { listen 45.131.40.141:80; server_name game.example; location / { return 301 https://game.example\${request_uri}; } }\nserver { listen 45.131.40.141:443 ssl; server_name game.example; ssl_certificate_key /private/DO_NOT_PRINT_KEY; include /private/DO_NOT_PRINT_ENV.env; location / { proxy_pass http://user:DO_NOT_PRINT_PASSWORD@127.0.0.1:3003/; proxy_set_header Host $host; proxy_set_header Authorization DO_NOT_PRINT_AUTH; proxy_set_header Cookie DO_NOT_PRINT_COOKIE; } }\n`;
  const [http, https] = configuration.trimEnd().split("\n");
  const nativeHttp = join(etc, "nginx/sites-available/game.example.conf"); writeFileSync(nativeHttp, http + "\n");
  const nativeHttps = join(etc, "nginx/sites-available/ssl.game.example.conf"); writeFileSync(nativeHttps, https + "\n");
  writeFileSync(join(records, "game.example.conf"), "PANEL_PARAMETER=DO_NOT_PRINT_RECORD_SECRET\n");
  const httpInclude = join(hooks, "game.example.nginx"), httpsInclude = httpInclude + ".ssl";
  const httpFragment = "return 301 https://game.example$request_uri;\n";
  const httpsFragment = "if ($host = www.game.example) { return 301 https://game.example$request_uri; }\nlocation ~ ^/ { proxy_pass http://user:DO_NOT_PRINT_HOOK_PASSWORD@127.0.0.1:3003; proxy_set_header Host $host; proxy_set_header Authorization DO_NOT_PRINT_HOOK_AUTH; }\n";
  writeFileSync(httpInclude, httpFragment); writeFileSync(httpsInclude, httpsFragment);
  const panel = join(etc, "nginx/sites-available/other.example.conf"); writeFileSync(panel, "server { listen 45.131.40.141:80; server_name other.example; return 200 \"DO_NOT_PRINT_RESPONSE_BODY\"; }\n");
  const backup = join(privateRoot, "ctokodnomy-deploy/player-3003/backups/20261017T132411Z-" + "a".repeat(40)); mkdirSync(backup, { recursive: true }); writeFileSync(join(backup, "nginx-http.conf"), http + "\n"); writeFileSync(join(backup, "nginx-https.conf"), https + "\n"); writeFileSync(join(backup, "nginx-user-http.conf"), httpFragment); writeFileSync(join(backup, "nginx-user-https.conf"), httpsFragment);
  const loaded = join(root, "loaded-nginx"); writeFileSync(loaded, `# configuration file ${nativeHttp}:\n${http}\n# configuration file ${nativeHttps}:\n${https}\n# configuration file ${panel}:\n${readFileSync(panel, "utf8")}\n# configuration file ${httpInclude}:\n${httpFragment}\n# configuration file ${httpsInclude}:\n${httpsFragment}`);
  const curlLog = join(root, "curl-requests"); writeFileSync(curlLog, "");
  const command = (name: string, body: string) => { const file = join(bin, name); writeFileSync(file, `#!/usr/bin/env bash\nset -eu\n${body}\n`); chmodSync(file, 0o755); };
  command("nginx", 'cat "$FIXTURE_NGINX"');
  command("systemctl", `printf '%s\\n' 'ActiveState=active' 'SubState=running' 'ExecReload={ argv[]=DO_NOT_PRINT_SERVICE_ARG; start_time=Sat 2026-10-24 10:00:00 UTC ; stop_time=Sat 2026-10-24 10:00:00 UTC ; status=0 ; }'`);
  command("getent", "printf '45.131.40.141 STREAM fixture\\n2001:db8::1 STREAM fixture\\n'");
  command("ss", "printf 'LISTEN 0 511 45.131.40.141:80 0.0.0.0:*\\nLISTEN 0 511 45.131.40.141:443 0.0.0.0:*\\n'");
  command("ip", "printf '2: eth0 inet 45.131.40.141/24 scope global eth0\\n'");
  command("curl", `printf '%s\\n' "$@" >> "$FIXTURE_CURL"; printf 'HTTP/1.1 301 Moved\\r\\nSet-Cookie: DO_NOT_PRINT_COOKIE\\r\\nLocation: https://user:DO_NOT_PRINT_LOCATION_PASS@game.example/login?token=DO_NOT_PRINT_TOKEN\\r\\n\\r\\nDO_NOT_PRINT_BODY\\nCTOK_ROUTE\\t301\\t0\\t45.131.40.141'`);
  const source = readFileSync(join(scripts, "brainycp-routing.sh"), "utf8").match(/<<'NODE'\n([\s\S]*?)\nNODE/)![1].replaceAll("/etc/", `${etc}/`).replaceAll("/var/lib/", `${privateRoot}/`).replaceAll("/var/brainycp/", `${root}/var/brainycp/`);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_NGINX: loaded, FIXTURE_CURL: curlLog };
  return { root, bin, app, loaded, nativeHttp, nativeHttps, command, source, env, curlLog, run: () => spawnSync(process.execPath, ["--input-type=module", "-", app, "player", "3003", "game.example", "other.example"], { input: source, encoding: "utf8", env, timeout: 10000 }) };
}

describe("focused read-only BrainyCP routing diagnostics", () => {
  test("reports exact route blocks, backup comparison and redirects without leaking private data", () => {
    const f = fixture(); const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("listen 45.131.40.141:80;");
    expect(result.stdout).toContain("server_name other.example;");
    expect(result.stdout).toContain("location / => return 301 https://game.example${request_uri};");
    expect(result.stdout).toContain("proxy_set_header Host $host;");
    expect(result.stdout).toContain("return 200 [body omitted]");
    expect(result.stdout).toContain("HTTP matches current native site: true");
    expect(result.stdout).toContain("HTTPS matches current native site: true");
    expect(result.stdout).toContain("loaded native HTTP copies=1; HTTPS copies=1");
    expect(result.stdout).toContain("Native per-site routing includes");
    expect(result.stdout).toContain("location ~ ^/ => proxy_pass http://[redacted]@127.0.0.1:3003;");
    expect(result.stdout).toContain("Loaded native routing includes: HTTP=1; HTTPS=1");
    expect(result.stdout).toContain("HTTPS include matches current native site: true");
    expect(result.stdout).toContain("addresses=45.131.40.141,2001:db8::1");
    expect(result.stdout).toContain("LOCAL GET http://ctok-routing-probe.invalid/");
    expect(result.stdout).toContain("Location=https://game.example/login?[redacted]");
    expect(result.stdout + result.stderr).not.toContain("DO_NOT_PRINT");
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(20 * 1024);
    const curl = readFileSync(f.curlLog, "utf8").split("\n");
    expect(curl).toContain("--request"); expect(curl).toContain("GET"); expect(curl).toContain("--resolve"); expect(curl).toContain("/dev/null");
    for (const argument of ["--location", "-L", "--insecure", "-k"]) expect(curl).not.toContain(argument);
  });

  test("reports an unloaded HTTPS site separately from the loaded HTTP site", () => {
    const f = fixture();
    writeFileSync(f.loaded, `# configuration file ${f.nativeHttp}:\n${readFileSync(f.nativeHttp, "utf8")}`);
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("loaded native HTTP copies=1; HTTPS copies=0");
    expect(result.stdout + result.stderr).not.toContain("DO_NOT_PRINT");
  });

  test("keeps strict TLS and reports a certificate failure without an unsafe retry", () => {
    const f = fixture();
    f.command("curl", `printf '%s\\n' "$@" >> "$FIXTURE_CURL"; printf '\\nCTOK_ROUTE\\t000\\t62\\t45.131.40.141'; exit 60`);
    const result = f.run();
    expect(result.status).toBe(0); expect(result.stdout).toContain("curl=60 status=000 tls=62");
    expect(result.stdout).toContain("TLS validation failed; unsafe GET was not retried");
    expect(readFileSync(f.curlLog, "utf8").split("\n").filter(value => value === "--url")).toHaveLength(12);
  });

  test("stops when a diagnostic process is killed", () => {
    const f = fixture(); f.command("nginx", "exit 137"); const result = f.run();
    expect(result.status).toBe(137); expect(result.stderr).toContain("nginx SIGKILL/exit137; no retry");
    expect(readFileSync(f.curlLog, "utf8")).toBe("");
  });

  test.each([
    ["/tmp", "player", "65536", "game.example", "other.example"],
    ["/tmp", "player", "3003", "game.example", "other.example';touch /tmp/unwanted"],
  ])("rejects invalid arguments before diagnostics: %j", (...args) => {
    const result = spawnSync("bash", [join(scripts, "brainycp-routing.sh"), ...args], { encoding: "utf8" });
    expect(result.status).toBe(2); expect(result.stdout).toBe("");
  });

  test("routing mode takes priority while basic preflight keeps its four arguments", () => {
    const f = fixture();
    f.command("ssh-agent", "if [[ $1 == -s ]]; then printf 'SSH_AUTH_SOCK=/fixture; export SSH_AUTH_SOCK;\\n'; fi");
    f.command("ssh-add", "exit 0");
    f.command("ssh", 'printf "%s\\n" "${!#}" > "$FIXTURE_COMMAND"; cat > "$FIXTURE_SCRIPT"; printf "mock routing report\\n"');
    for (const routing of ["true", "false"]) {
      const result = spawnSync("bash", [join(scripts, "check-brainycp-ssh.sh")], { encoding: "utf8", env: { ...f.env, RUNNER_TEMP: f.root, APP_ROOT: f.app, APP_USER: "player", APP_PORT: "3003", APP_DOMAIN: "game.example", DEPLOY_HOST: "server.example", DEPLOY_USER: "root", DEPLOY_SSH_KEY: "fake-private-key", SSH_KNOWN_HOSTS: "server.example ssh-ed25519 fake-public-key", CHECK_DETAILS: routing, CHECK_WEB_SERVICES: routing, CHECK_ROUTING: routing, CHECK_PROBE_DOMAIN: "other.example", FIXTURE_COMMAND: join(f.root, "command"), FIXTURE_SCRIPT: join(f.root, "script") } });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(f.root, "script"), "utf8")).toContain(routing === "true" ? "READ-ONLY ROUTING DIAGNOSTICS" : "Read-only diagnostics for one");
      expect(readFileSync(join(f.root, "command"), "utf8")).toBe(`bash -s -- '${f.app}' 'player' '3003' 'game.example'${routing === "true" ? " 'other.example'" : ""}\n`);
    }
  });
});
