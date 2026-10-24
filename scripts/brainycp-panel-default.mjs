import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const TARGET = '/etc/nginx/conf.d/00-ctokodnomy-panel-default.conf';
const HTTP = '/etc/nginx/sites-available/!!default.conf';
const HTTPS = '/etc/nginx/sites-available/!!ssl.default.conf';
const PANEL = '/etc/brainy/conf/server_control/main';
const sha = value => createHash('sha256').update(value).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const hostPattern = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
function assert(ok, message) { if (!ok) throw new Error(message); }
function validHost(value) { return typeof value === 'string' && value.length <= 253 && hostPattern.test(value) && !value.includes('..'); }
function validUrl(value, protocol) {
  try { const u = new URL(value); return u.protocol === protocol && validHost(u.hostname) && !u.username && !u.password && !u.port && !u.search && !u.hash && /^\/[A-Za-z0-9/_.~-]*$/.test(u.pathname); } catch { return false; }
}
export function validateConfig(c, mode) {
  assert(['plan', 'apply'].includes(mode), 'Expected plan or apply mode.');
  assert(c && typeof c === 'object' && !Array.isArray(c), 'Expected configuration object.');
  assert(/^[a-z_][a-z0-9_-]*$/.test(c.app_user ?? '') && /^[1-9][0-9]{0,4}$/.test(String(c.port ?? '')) && Number(c.port) <= 65535, 'Invalid application identity.');
  assert(validHost(c.domain), 'Invalid application domain.');
  assert(typeof c.address === 'string' && c.address.split('.').length === 4 && c.address.split('.').every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255) && c.address !== '0.0.0.0', 'Expected concrete IPv4 address.');
  for (const key of ['http_sha256', 'https_sha256', 'game_sha256']) assert(hashPattern.test(c[key] ?? ''), `Missing valid ${key}.`);
  if (mode === 'apply') assert(hashPattern.test(c.expected_candidate_sha256 ?? ''), 'Apply requires reviewed candidate SHA-256.');
  assert(Array.isArray(c.php_checks) && c.php_checks.length > 0 && c.php_checks.length <= 10 && c.php_checks.every(u => validUrl(u, 'https:')), 'Expected bounded HTTPS PHP checks.');
  assert(Array.isArray(c.named_checks) && c.named_checks.length >= 2 && c.named_checks.length <= 8 && c.named_checks.every(u => validUrl(u, 'http:')), 'Expected at least two named HTTP controls.');
  assert(Array.isArray(c.unknown_hosts) && c.unknown_hosts.length >= 2 && c.unknown_hosts.length <= 5 && c.unknown_hosts.every(validHost) && !c.unknown_hosts.includes(c.domain), 'Expected at least two unknown Host probes.');
  assert(/^[1-9][0-9]*$/.test(String(c.run_id ?? '')) && /^[1-9][0-9]*$/.test(String(c.run_attempt ?? '')), 'Expected positive run and attempt identifiers.');
}

/** Preserve the reviewed panel body, changing only its default selector. */
export function clonePanelBlock(source, address, port) {
  assert((source.match(/^\s*server\s*\{/gm) ?? []).length === 1, 'Panel source must contain one server block.');
  let tcp = 0, names = 0, droppedQuic = 0;
  let result = source.replace(/^([ \t]*)listen[ \t]+([^;\r\n]+);[^\r\n]*(?:\r?\n|$)/gm, (line, indent, value) => {
    const tokens = value.trim().split(/\s+/);
    assert(tokens[0] === `${address}:${port}`, 'Unexpected panel listen address.');
    assert(!tokens.includes('default_server'), 'Panel already declares an explicit default.');
    if (tokens.includes('quic')) { assert(port === 443, 'Unexpected QUIC listener.'); droppedQuic++; return ''; }
    assert(!tokens.includes('udp') && !tokens.includes('reuseport'), 'Unexpected TCP listen options.');
    tcp++;
    return line.replace(/;/, ' default_server;');
  });
  result = result.replace(/^([ \t]*)server_name[ \t]+([^;\r\n]+);/gm, (line, indent, name) => {
    assert(name.trim() === 'default', 'Unexpected panel server_name.'); names++; return `${indent}server_name _;`;
  });
  assert(tcp === 1 && names === 1 && droppedQuic <= 1, 'Unexpected panel server structure.');
  return result;
}

export function repairDefault(config, mode, dependencies = {}) {
  validateConfig(config, mode);
  const io = dependencies.fs ?? fs;
  const spawn = dependencies.spawn ?? spawnSync;
  const expectedUid = dependencies.expectedUid ?? 0;
  const actualUid = dependencies.actualUid ?? process.getuid?.();
  assert(actualUid === expectedUid, 'Repair must run as root.');
  const map = dependencies.mapPath ?? (p => p);
  const report = dependencies.report ?? (value => console.log(value));
  const fixed = { http: map(HTTP), https: map(HTTPS), panel: map(PANEL), game: map(`/etc/nginx/conf.d/${config.domain}-game.conf`), target: map(TARGET) };
  const guardSource = dependencies.guardSource ?? (typeof CTOK_GUARD_SOURCE !== 'undefined' ? CTOK_GUARD_SOURCE : fs.readFileSync(new URL('./brainycp-guards.sh', import.meta.url), 'utf8'));
  const fail = message => { throw new Error(message); };
  if (mode === 'plan' && config.inspect_native === true) {
    const clean = line => /password|passwd|secret|token|cookie|authorization|ssl_certificate_key|license/i.test(line) ? '[sensitive line omitted]' : line.replace(/(https?:\/\/)[^\s/@]+@/g, '$1[redacted]@');
    const show = (file, pattern, context = 1, maximum = 45) => {
      report(`NATIVE_SOURCE ${file}`);
      try {
        const stat = io.lstatSync(file); assert(stat.isFile() && stat.size < 1024 * 1024, 'Not a bounded regular file.');
        const lines = io.readFileSync(file, 'utf8').split('\n'); const selected = new Set();
        lines.forEach((line, index) => { if (pattern.test(line)) for (let n = Math.max(0,index-context); n <= Math.min(lines.length-1,index+context); n++) selected.add(n); });
        for (const n of [...selected].slice(0,maximum)) report(`${n+1}: ${clean(lines[n]).slice(0,380)}`);
      } catch { report('Unavailable'); }
    };
    for(const file of ['/etc/brainy/main.conf','/etc/brainy/globals.php','/usr/local/brainycp/globals.php'])show(file,/path|dir|config|user|data|site|vhost/i,0,75);
    for (const root of ['/usr/local/brainycp','/usr/local/brainycp/conf','/var/brainycp','/var/lib/brainycp','/etc/brainy/conf/server_control','/etc/brainy/isp']) {
      try { report(`NATIVE_DIRECTORY ${root}: ${io.readdirSync(root).slice(0,100).join(', ')}`); } catch { report(`Unavailable ${root}`); }
    }
    let count=0, printed=0;
    const walk=(root,depth)=>{if(depth>5 || count>8000 || printed>100)return; let entries;try{entries=io.readdirSync(root,{withFileTypes:true});}catch{return;}
      for(const entry of entries){if(++count>8000)break;const file=path.join(root,entry.name);if(entry.isDirectory() && !/^(mod_security|streams|ssl|certs|backup|backup_conf|cache|logs|i18n|src|jail)$/.test(entry.name))walk(file,depth+1);else if(entry.isFile() && /utmns|nodejs|nginx.*access|nginx.*loct|tsoy|user.*conf/i.test(entry.name)){report(`NATIVE_CONFIG_FILE ${file}`);printed++;}}
    };walk('/etc/brainy',0);
    for(const root of ['/usr/local/brainycp/tpl/basic/server_control','/usr/local/brainycp/tpl/basic/js']) {
      try{report(`NATIVE_TEMPLATES ${root}: ${io.readdirSync(root).filter(x=>/site|domain|server|node|web/i.test(x)).slice(0,80).join(', ')}`);}catch{}
    }
    return {mode:'native-inspection'};
  }
  function physical(file, directory = false) {
    const stat = io.lstatSync(file);
    assert(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()) && io.realpathSync(file) === file && stat.uid === expectedUid && !(stat.mode & 0o022), 'Unsafe physical file or directory metadata.');
    return stat;
  }
  function read(file) { const stat = physical(file); assert(stat.size <= 2 * 1024 * 1024, 'Configuration file exceeds size bound.'); return io.readFileSync(file); }
  function run(command, args, options = {}) {
    const result = spawn(command, args, { encoding: 'utf8', timeout: 20000, maxBuffer: 13 * 1024 * 1024, ...options });
    if (result.signal === 'SIGKILL' || result.status === 137) { const error = new Error(`${path.basename(command)} was killed; no retry.`); error.code = 137; throw error; }
    assert(!result.error && !result.signal && result.status === 0, `${path.basename(command)} failed (exit ${result.status ?? 'unavailable'}).`);
    return result.stdout ?? '';
  }
  function guard() { run('bash', ['-s', '--', fixed.panel, config.php_checks.join(',')], { input: guardSource }); }
  function response(url, hostOverride = null, allowTlsError = false) {
    const u = new URL(url);
    const args = ['--disable', '--noproxy', '*', '--proto', '=http,https', '--request', 'GET', '--connect-timeout', '5', '--max-time', '15', '--max-filesize', String(12 * 1024 * 1024), '--silent', '--include'];
    if (u.hostname !== config.address) args.push('--resolve', `${u.hostname}:${u.protocol === 'https:' ? 443 : 80}:${config.address}`);
    if (hostOverride) args.push('--header', `Host: ${hostOverride}`);
    args.push('--write-out', '\nCTOK_DEFAULT\t%{http_code}\t%{ssl_verify_result}', '--url', url);
    const result = spawn('curl', args, { encoding: null, timeout: 20000, maxBuffer: 13 * 1024 * 1024 });
    if (result.signal === 'SIGKILL' || result.status === 137) { const error = new Error('curl was killed; no retry.'); error.code = 137; throw error; }
    if (allowTlsError && result.status === 60) return { tls_error: true };
    assert(!result.error && !result.signal && result.status === 0, `HTTP control failed (curl ${result.status ?? 'unavailable'}).`);
    const output = Buffer.from(result.stdout ?? ''); const marker = output.lastIndexOf('\nCTOK_DEFAULT\t');
    assert(marker >= 0, 'Missing HTTP response metadata.');
    const [statusText, tls] = output.subarray(marker + 14).toString('utf8').trim().split('\t');
    const endHeaders = output.indexOf('\r\n\r\n'); assert(endHeaders >= 0 && endHeaders < marker, 'Missing response header boundary.');
    const headers = output.subarray(0, endHeaders).toString('latin1'); const body = output.subarray(endHeaders + 4, marker);
    const location = headers.match(/^location:\s*([^\r\n]+)/im)?.[1] ?? '';
    assert(/^\d{3}$/.test(statusText) && (u.protocol !== 'https:' || tls === '0'), 'Invalid HTTP/TLS status metadata.');
    return { status: Number(statusText), location, body_sha256: sha(body), bytes: body.length, body };
  }
  function publicMetadata(value) { const { body, location, ...safe } = value; return { ...safe, has_location: Boolean(location) }; }
  guard(); physical(path.dirname(fixed.target), true); run('nginx', ['-t']);
  const sources = Object.fromEntries(Object.entries(fixed).filter(([key]) => key !== 'target').map(([key, file]) => [key, read(file)]));
  assert(sha(sources.http) === config.http_sha256 && sha(sources.https) === config.https_sha256 && sha(sources.game) === config.game_sha256, 'Inspected source fingerprint changed.');
  const candidate = `# Managed panel default routing; cloned from reviewed BrainyCP defaults.\n${clonePanelBlock(sources.http.toString(), config.address, 80)}\n${clonePanelBlock(sources.https.toString(), config.address, 443)}\n`;
  const candidateHash = sha(candidate);
  if (mode === 'apply') assert(candidateHash === config.expected_candidate_sha256, 'Candidate differs from reviewed plan.');
  function unchanged() { for (const [key, bytes] of Object.entries(sources)) assert(sha(read(fixed[key])) === sha(bytes), 'Original panel/game configuration changed concurrently.'); guard(); }
  const defaultBefore = response(`http://${config.address}/`, 'default');
  assert(defaultBefore.status < 500 && !defaultBefore.location, 'Panel default is unavailable or redirects.');
  const namedBefore = config.named_checks.map(url => response(url));
  assert(namedBefore.every(r => r.status < 500), 'A named site is already failing.');
  const appBefore = response(`https://${config.domain}/api/health`);
  assert(appBefore.status === 200 && JSON.parse(appBefore.body.toString()).ok === true, 'Game API is unhealthy.');
  const appPid = run('systemctl', ['show', `nodejs@${config.port}.service`, '--property=MainPID', '--value']).trim();
  assert(/^[1-9][0-9]*$/.test(appPid), 'Game service is not running.');
  const plan = { mode, candidate_sha256: candidateHash, panel_http_sha256: sha(sources.http), panel_https_sha256: sha(sources.https), default_response: publicMetadata(defaultBefore), named_statuses: namedBefore.map(publicMetadata) };
  report(`PANEL_DEFAULT_PLAN ${JSON.stringify(plan)}`);
  function verify() {
    assert(io.existsSync(fixed.target) && sha(read(fixed.target)) === candidateHash, 'Owned default target changed during verification.');
    unchanged();
    const panelNow = response(`http://${config.address}/`, 'default');
    assert(panelNow.status === defaultBefore.status && panelNow.body_sha256 === defaultBefore.body_sha256 && !panelNow.location, 'Original panel response changed.');
    for (const host of config.unknown_hosts) {
      const result = response(`http://${host}/`);
      assert(result.status === defaultBefore.status && result.body_sha256 === defaultBefore.body_sha256 && !result.location, 'Unknown Host did not reach the original panel page.');
    }
    config.named_checks.forEach((url, index) => { const current = response(url); assert(current.status === namedBefore[index].status && current.location === namedBefore[index].location, 'Named site routing changed.'); });
    const game = response(`https://${config.domain}/api/health`);
    assert(game.status === 200 && JSON.parse(game.body.toString()).ok === true, 'Game API failed after reload.');
    assert(run('systemctl', ['show', `nodejs@${config.port}.service`, '--property=MainPID', '--value']).trim() === appPid, 'Game process changed during routing repair.');
  }
  if (io.existsSync(fixed.target)) {
    assert(sha(read(fixed.target)) === candidateHash, 'Owned default target already exists with different contents.');
    if (mode === 'apply') verify();
    report('PANEL_DEFAULT_ALREADY_PRESENT'); return plan;
  }
  if (mode === 'plan') return plan;
  const parent = map(`/var/lib/ctokodnomy-deploy/${config.app_user}-${config.port}`); physical(parent, true);
  const lock = path.join(parent, 'deploy.lock'); physical(lock); const lockFd = io.openSync(lock, 'r');
  let written = false, reloadAttempted = false, temp;
  try {
    run('flock', ['--nonblock', '3'], { stdio: ['ignore', 'pipe', 'pipe', lockFd] });
    unchanged(); assert(!io.existsSync(fixed.target), 'Default target appeared concurrently.');
    const backups = path.join(parent, 'routing-backups');
    if (!io.existsSync(backups)) io.mkdirSync(backups, { mode: 0o700 }); physical(backups, true);
    const backup = path.join(backups, `${new Date().toISOString().replace(/[-:.]/g, '')}-${config.run_id}-${config.run_attempt}`);
    io.mkdirSync(backup, { mode: 0o700 });
    for (const [key, bytes] of Object.entries(sources)) io.writeFileSync(path.join(backup, `${key}.conf`), bytes, { flag: 'wx', mode: 0o600 });
    io.writeFileSync(path.join(backup, 'candidate.conf'), candidate, { flag: 'wx', mode: 0o600 });
    io.writeFileSync(path.join(backup, 'plan.json'), JSON.stringify(plan, null, 2), { flag: 'wx', mode: 0o600 });
    report(`PANEL_DEFAULT_BACKUP ${backup}`);
    temp = path.join(path.dirname(fixed.target), `.ctok-panel-default-${config.run_id}-${config.run_attempt}.tmp`);
    const fd = io.openSync(temp, 'wx', 0o600); try { io.writeFileSync(fd, candidate); io.fsyncSync(fd); } finally { io.closeSync(fd); }
    unchanged(); io.linkSync(temp, fixed.target); written = true; io.unlinkSync(temp); temp = null;
    run('nginx', ['-t']); unchanged(); reloadAttempted = true; run('nginx', ['-s', 'reload']);
    // nginx -s reload returns after sending the signal, before new workers
    // necessarily accept connections. Allow its graceful handover to finish.
    run('sleep', ['1']);
    verify(); report(`PANEL_DEFAULT_APPLIED ${candidateHash}`); return plan;
  } catch (error) {
    if (written) {
      assert(io.existsSync(fixed.target) && sha(read(fixed.target)) === candidateHash, 'Rollback refused: owned target changed externally.');
      io.unlinkSync(fixed.target); report('PANEL_DEFAULT_ROLLBACK_FILE_REMOVED');
      if (error.code !== 137) { run('nginx', ['-t']); if (reloadAttempted) run('nginx', ['-s', 'reload']); report('PANEL_DEFAULT_ROLLBACK_VERIFIED'); }
      else report('PANEL_DEFAULT_SIGKILL_STOP: source file removed; live runtime requires inspection before another action.');
    }
    throw error;
  } finally { if (temp && io.existsSync(temp)) io.unlinkSync(temp); io.closeSync(lockFd); }
}

if (process.argv[1] === '-') {
  try { const mode = process.argv[2]; const config = JSON.parse(Buffer.from(process.argv[3] ?? '', 'base64').toString('utf8')); repairDefault(config, mode); }
  catch (error) { console.error(`Panel default repair stopped: ${error.message}`); process.exitCode = error.code === 137 ? 137 : 2; }
}
