import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const helper = resolve("scripts/brainycp-guards.sh");
const first = "https://php.example.test/index.php";
const second = "https://other.example.test/health.php";
let fixture: string;
let panel: string;
let bin: string;
let curlLog: string;

function run(command: string, args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync("bash", ["-c", `set -Eeuo pipefail; source "$1"; shift; ${command}`, "bash", helper, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, CURL_LOG: curlLog, ...env },
  });
}

function mock(name: string, body: string) {
  writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o700 });
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "ctokodnomy-deploy-guards-"));
  panel = join(fixture, "main");
  bin = join(fixture, "bin");
  curlLog = join(fixture, "curl-args");
  mkdirSync(bin);
  writeFileSync(panel, "back_server=apache\n");
  mock("curl", `printf '%s\\n' "$@" >> "$CURL_LOG"
if [[ \${MOCK_CURL_EXIT:-0} != 0 ]]; then exit "$MOCK_CURL_EXIT"; fi
printf '%s' "\${MOCK_HTTP_STATUS:-200}"`);
});

afterEach(() => rmSync(fixture, { recursive: true, force: true }));

describe("BrainyCP deployment safety guards", () => {
  test("sourcing the helper has no side effects", () => {
    const result = run(":");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(() => readFileSync(curlLog)).toThrow();
  });

  test.each([
    "back_server=apache\n",
    "back_server apache\n",
    '  back_server = "apache24" # panel comment\n',
    "back_server 'apache' ; panel comment\r\n",
    "# back_server=ignored\n; back_server ignored\nback_server=apache",
    "back_server_extra=ignored\nback_server=apache\n",
  ])("accepts exactly one supported nonempty setting: %j", (content) => {
    writeFileSync(panel, content);
    const result = run('brainycp_guard "$1"', [panel]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("");
  });

  test.each([
    "", "# back_server=apache\n", "back_server=\n", "back_server=   \n",
    'back_server=""\n', "back_server=''\n", "back_server # missing\n",
    "back_server: apache\n", "back_server apache extra\n", 'back_server="apache\n',
    "back_server=apache\nback_server nginx\n", "back_server=apache\nback_server=\n",
    "back_server=$(touch /tmp/never-evaluate-server-config)\n",
  ])("refuses missing, malformed or duplicate settings without leaking contents: %j", (content) => {
    writeFileSync(panel, content);
    const result = run('brainycp_guard "$1"', [panel]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("BrainyCP guard:");
    expect(result.stderr).not.toContain("never-evaluate");
    expect(() => readFileSync(curlLog)).toThrow();
  });

  test("refuses symlink files, symlink parents and missing paths", () => {
    const link = join(fixture, "main-link");
    symlinkSync(panel, link);
    const directory = join(fixture, "directory");
    mkdirSync(directory);
    writeFileSync(join(directory, "main"), "back_server=apache\n");
    const parentLink = join(fixture, "directory-link");
    symlinkSync(directory, parentLink);
    for (const candidate of [link, join(parentLink, "main"), directory, join(fixture, "absent")]) {
      const result = run('brainycp_guard "$1"', [candidate]);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
    }
  });

  test("preserves SIGKILL from a guard utility and explains why to stop", () => {
    mock("readlink", "exit 137");
    const result = run('brainycp_guard "$1"', [panel]);
    expect(result.status).toBe(137);
    expect(result.stderr).toContain("SIGKILL, exit 137");
    expect(result.stderr).toContain("do not retry or bypass");
    expect(() => readFileSync(curlLog)).toThrow();
  });

  test("checks HTTPS endpoints with fixed curl protections and no redirects", () => {
    const result = run('php_snapshot "$1"', [`${first},${second}`]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${first} 200\n${second} 200\n`);
    const args = readFileSync(curlLog, "utf8").trimEnd().split("\n");
    expect(args.slice(0, 17)).toEqual([
      "--disable", "--noproxy", "*", "--proto", "=https", "--max-time", "15",
      "--connect-timeout", "5", "--silent", "--show-error", "--output", "/dev/null",
      "--write-out", "%{http_code}", "--url", first,
    ]);
    expect(args).not.toContain("--location");
    expect(args).not.toContain("--insecure");
    expect(args.filter((arg) => arg === "--disable")).toHaveLength(2);
  });

  test.each([
    "", ",", `${first},`, `,${first}`, `${first},,${second}`, `${first},${first}`,
    "http://php.example.test/index.php", "https://user:pass@php.example.test/index.php",
    "https://php.example.test:443/index.php", "https://php.example.test/index.php?secret=x",
    "https://php.example.test/index.php#anchor", "https://localhost/index.php",
    "https://-php.example.test/index.php", "https://php..example.test/index.php",
    "https://php.example.test./index.php", "https://php.example.test/a b",
    "https://php.example.test/%0a", `${first}\n`, `${first}, ${second}`,
    "https://php.example.test/a'b", 'https://php.example.test/a"b',
    "https://php.example.test/a`b", "https://php.example.test/a$b", "https://php.example.test/a\\b",
    Array.from({ length: 11 }, (_, index) => `https://php${index}.example.test/index.php`).join(","),
  ])("validates the complete endpoint list before contacting any endpoint: %j", (checks) => {
    const result = run('php_snapshot "$1"', [checks]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(() => readFileSync(curlLog)).toThrow();
  });

  test.each(["301", "302", "403", "500", "000"])("rejects HTTP %j without a baseline", (status) => {
    const result = run('php_snapshot "$1"', [first], { MOCK_HTTP_STATUS: status });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("expected a direct 2xx response");
  });

  test("does not print unexpected curl output as status metadata", () => {
    const result = run('php_snapshot "$1"', [first], { MOCK_HTTP_STATUS: "200\nsecret-response-body" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("invalid status metadata");
    expect(result.stderr).not.toContain("secret-response-body");
  });

  test("requires matching endpoint statuses and accepts reordered baseline entries", () => {
    const baseline = `${second} 200\n${first} 200`;
    const result = run('php_snapshot "$1" "$2"', [`${first},${second}`, baseline]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${first} 200\n${second} 200\n`);
    const changed = run('php_snapshot "$1" "$2"', [first, `${first} 200`], { MOCK_HTTP_STATUS: "204" });
    expect(changed.status).toBe(1);
    expect(changed.stdout).toBe("");
    expect(changed.stderr).toContain("HTTP 200 became 204");
  });

  test.each([
    "", `${first} 302`, `${first} 200 extra`, `${second} 200`,
    `${first} 200\n${first} 200`, `${first} 200\n${second} 200`,
  ])("rejects invalid or mismatched baseline before curl: %j", (baseline) => {
    const result = run('php_snapshot "$1" "$2"', [first, baseline]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(() => readFileSync(curlLog)).toThrow();
  });

  test.each(["7", "28", "137"])("preserves curl exit %s rather than retrying or bypassing", (status) => {
    const result = run('php_snapshot "$1"', [first], { MOCK_CURL_EXIT: status });
    expect(result.status).toBe(Number(status));
    expect(result.stdout).toBe("");
    const args = readFileSync(curlLog, "utf8").trimEnd().split("\n");
    expect(args.filter((arg) => arg === "--disable")).toHaveLength(1);
    expect(result.stderr).toContain("PHP health check failed");
    if (status === "137") expect(result.stderr).toContain("SIGKILL, exit 137");
  });

  test("CLI refuses unsafe panel state before the first curl request", () => {
    writeFileSync(panel, "# back_server is absent\n");
    const result = spawnSync("bash", [helper, panel, first], {
      encoding: "utf8", env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, CURL_LOG: curlLog },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("back_server setting is missing");
    expect(() => readFileSync(curlLog)).toThrow();
  });

  test("CLI also works from SSH stdin under strict shell options", () => {
    const result = spawnSync("bash", ["-euo", "pipefail", "-s", "--", panel, first], {
      encoding: "utf8", input: readFileSync(helper, "utf8"),
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, CURL_LOG: curlLog },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${first} 200\n`);
  });
});
