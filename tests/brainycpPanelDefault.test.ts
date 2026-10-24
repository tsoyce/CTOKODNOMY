import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
// The CLI takes only fixed production paths; fixtures inject a local mapper.
// @ts-expect-error Operational JavaScript helper is exercised through real filesystem fixtures.
import { clonePanelBlock, repairDefault, TARGET } from '../scripts/brainycp-panel-default.mjs';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function fixture(scenario = 'success') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-default-')); roots.push(root);
  const map = (p: string) => path.join(root, p);
  const http = 'server {\n listen 45.131.40.141:80;\n server_name default;\n root /var/www/html;\n location / { proxy_pass http://45.131.40.141:8080; proxy_set_header Host $host; }\n}\n';
  const https = 'server {\n listen 45.131.40.141:443 ssl;\n listen 45.131.40.141:443 quic reuseport;\n server_name default;\n ssl_certificate /etc/brainy/ssl/webserver.crt_v2;\n location / { proxy_pass http://45.131.40.141:8080; proxy_set_header Host $host; }\n}\n';
  const files = {
    http: map('/etc/nginx/sites-available/!!default.conf'),
    https: map('/etc/nginx/sites-available/!!ssl.default.conf'),
    game: map('/etc/nginx/conf.d/game.example-game.conf'),
    panel: map('/etc/brainy/conf/server_control/main'),
    lock: map('/var/lib/ctokodnomy-deploy/player-3003/deploy.lock'),
  };
  for (const [key, file] of Object.entries(files)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, key === 'http' ? http : key === 'https' ? https : key === 'panel' ? 'back_server=apache\n' : key === 'lock' ? '' : '# original game\n'); }
  const config = { app_user: 'player', port: '3003', domain: 'game.example', address: '45.131.40.141', http_sha256: digest(http), https_sha256: digest(https), game_sha256: digest('# original game\n'), php_checks: ['https://php.example/'], named_checks: ['http://one.example/', 'http://two.example/'], unknown_hosts: ['missing.example', 'ctok-probe.invalid'], run_id: '40077650996', run_attempt: '1', expected_candidate_sha256: '' };
  const calls: { command: string; args: string[] }[] = []; const logs: string[] = [];
  let reloads = 0, tests = 0;
  const spawn = (command: string, args: string[]) => {
    calls.push({ command, args });
    if (command === 'bash') return { status: fs.readFileSync(files.panel, 'utf8').includes('back_server=apache') ? 0 : 2, stdout: '' };
    if (command === 'flock' && scenario === 'source-race') fs.appendFileSync(files.https, '# concurrently changed\n');
    if (command === 'nginx') {
      if (args[0] === '-t') { tests++; if (scenario === 'syntax-fail' && tests === 2) return { status: 1 }; }
      if (args[0] === '-s') { reloads++; if (scenario === 'reload-fail' && reloads === 1) return { status: 1 }; if (scenario === 'reload-137') return { status: 137 }; }
      return { status: 0, stdout: '' };
    }
    if (command === 'systemctl') return { status: 0, stdout: '1234\n' };
    if (command === 'curl') {
      const url = args.at(-1)!; const host = new URL(url).hostname;
      const panelRequest = args.includes('Host: default');
      let status = 200, body = 'named page', location = '';
      if (url.endsWith('/api/health')) body = '{"ok":true}';
      else if (panelRequest || (config.unknown_hosts.includes(host) && fs.existsSync(map(TARGET)))) body = scenario === 'post-fail' && !panelRequest ? 'wrong page' : 'original panel page';
      else if (config.unknown_hosts.includes(host)) { status = 301; body = ''; location = 'https://game.example/'; }
      return { status: 0, stdout: Buffer.from(`HTTP/1.1 ${status} Status\r\n${location ? `Location: ${location}\r\n` : ''}Set-Cookie: PRIVATE_COOKIE\r\n\r\n${body}\nCTOK_DEFAULT\t${status}\t0`) };
    }
    return { status: 0, stdout: '' };
  };
  const deps = { mapPath: map, expectedUid: process.getuid!(), actualUid: process.getuid!(), guardSource: 'fixture guard', spawn, report: (value: string) => logs.push(value) };
  const run = (mode: string) => repairDefault(config, mode, deps);
  const plan = () => { const result = run('plan'); config.expected_candidate_sha256 = result.candidate_sha256; calls.splice(0); logs.splice(0); tests = 0; return result; };
  return { root, map, config, calls, logs, files, http, https, run, plan, reloads: () => reloads };
}

describe('BrainyCP panel default repair', () => {
  test('clones the original bodies, changes selectors and drops only cloned QUIC', () => {
    const f = fixture();
    const cloned = clonePanelBlock(f.https, f.config.address, 443);
    expect(cloned).toContain('listen 45.131.40.141:443 ssl default_server;');
    expect(cloned).toContain('server_name _;');
    expect(cloned).toContain('proxy_set_header Host $host;');
    expect(cloned).toContain('/etc/brainy/ssl/webserver.crt_v2');
    expect(cloned).not.toContain('quic');
    expect(cloned.replace(' default_server', '').replace('server_name _;', 'server_name default;')).toBe(f.https.replace(' listen 45.131.40.141:443 quic reuseport;\n', ''));
  });
  test('plan does not write or reload and does not print response bodies/cookies', () => {
    const f = fixture(); const plan = f.plan();
    expect(plan.default_response.body_sha256).toBe(digest('original panel page'));
    expect(fs.existsSync(f.map(TARGET))).toBe(false);
    expect(fs.existsSync(f.map('/var/lib/ctokodnomy-deploy/player-3003/routing-backups'))).toBe(false);
    expect(f.reloads()).toBe(0);
  });
  test('applies one new file and preserves panel/game source contents and game process', () => {
    const f = fixture(); f.plan(); f.run('apply');
    expect(fs.readFileSync(f.map(TARGET), 'utf8')).toContain('default_server');
    expect(fs.readFileSync(f.files.http, 'utf8')).toBe(f.http);
    expect(fs.readFileSync(f.files.https, 'utf8')).toBe(f.https);
    expect(fs.readFileSync(f.files.game, 'utf8')).toBe('# original game\n');
    expect(f.reloads()).toBe(1);
    expect(f.logs.join('\n')).toContain('PANEL_DEFAULT_APPLIED');
    expect(f.logs.join('\n')).not.toMatch(/PRIVATE_COOKIE|original panel page/);
    expect(f.calls.filter(c => c.command === 'systemctl').every(c => c.args[0] === 'show')).toBe(true);
  });
  test.each(['syntax-fail', 'reload-fail', 'post-fail'])('rolls back only the owned candidate after %s', scenario => {
    const f = fixture(scenario); f.plan(); expect(() => f.run('apply')).toThrow();
    expect(fs.existsSync(f.map(TARGET))).toBe(false);
    expect(fs.readFileSync(f.files.http, 'utf8')).toBe(f.http);
    expect(f.logs.join('\n')).toContain('PANEL_DEFAULT_ROLLBACK_VERIFIED');
    expect(f.reloads()).toBe(scenario === 'syntax-fail' ? 0 : 2);
  });
  test('stops on SIGKILL without re-running the killed utility', () => {
    const f = fixture('reload-137'); f.plan(); expect(() => f.run('apply')).toThrow('killed');
    expect(fs.existsSync(f.map(TARGET))).toBe(false); expect(f.reloads()).toBe(1);
    expect(f.logs.join('\n')).toContain('PANEL_DEFAULT_SIGKILL_STOP');
  });
  test.each(['wrong-hash', 'missing-guard', 'source-race', 'foreign-target', 'wrong-plan'])('refuses unsafe %s without overwriting anything', scenario => {
    const f = fixture(scenario); f.plan();
    if (scenario === 'wrong-hash') f.config.http_sha256 = '0'.repeat(64);
    if (scenario === 'missing-guard') fs.writeFileSync(f.files.panel, '# no backend\n');
    if (scenario === 'foreign-target') fs.writeFileSync(f.map(TARGET), '# operator file\n');
    if (scenario === 'wrong-plan') f.config.expected_candidate_sha256 = '0'.repeat(64);
    expect(() => f.run('apply')).toThrow();
    expect(f.reloads()).toBe(0);
    expect(fs.existsSync(f.map(TARGET))).toBe(scenario === 'foreign-target');
  });
});
