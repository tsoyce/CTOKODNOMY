import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function assert(ok, message) { if (!ok) throw new Error(message); }
function restoreNative(c, mode) {
  assert(process.getuid() === 0 && ['plan','apply'].includes(mode), 'Expected root and plan/apply.');
  assert(/^[a-z_][a-z0-9_-]*$/.test(c.app_user) && /^[a-z0-9][a-z0-9.-]*$/.test(c.domain) && !c.domain.includes('..'), 'Invalid site identity.');
  assert(/^[1-9][0-9]{0,4}$/.test(String(c.port)) && Number(c.port)<65536 && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(c.address), 'Invalid endpoint.');
  assert(/^[1-9][0-9]*$/.test(c.run_id) && /^[1-9][0-9]*$/.test(c.run_attempt), 'Invalid run identifiers.');
  for(const key of ['http_sha256','https_sha256','game_sha256']) assert(/^[a-f0-9]{64}$/.test(c[key]), 'Expected reviewed original hashes.');
  assert(Array.isArray(c.php_checks) && c.php_checks.length && Array.isArray(c.named_checks) && c.named_checks.length>=2 && Array.isArray(c.unknown_hosts) && c.unknown_hosts.length>=2, 'Expected site controls.');
  for(const host of c.unknown_hosts) assert(/^[a-z0-9][a-z0-9.-]*$/.test(host) && host!==c.domain && !host.includes('..'), 'Invalid unknown host.');
  for(const url of [...c.php_checks,...c.named_checks]) { const u=new URL(url); assert(['http:','https:'].includes(u.protocol) && !u.username && !u.password && !u.port && !u.search && !u.hash && /^[a-z0-9][a-z0-9.-]*$/.test(u.hostname) && /^\/[a-zA-Z0-9/_.~-]*$/.test(u.pathname), 'Invalid control URL.'); }
  const main='/etc/brainy/conf/server_control/main';
  const record=`/var/brainycp/data/vhosts/${c.domain}.conf`;
  const http=`/etc/nginx/sites-available/${c.domain}.conf`, https=`/etc/nginx/sites-available/ssl.${c.domain}.conf`;
  const hook=`/var/brainycp/data/webserver_config/user_includes/${c.app_user}/${c.domain}.nginx`;
  const game=`/etc/nginx/conf.d/${c.domain}-game.conf`, clone='/etc/nginx/conf.d/00-ctokodnomy-panel-default.conf', legacy='/etc/nginx/conf.d/xyux.ru-redirect.conf';
  const read = (file, absent=false, requireRoot=true) => {
    if(absent && !fs.existsSync(file)) { try { fs.lstatSync(file); throw new Error('Dangling target link.'); } catch(error) { if(error.code==='ENOENT') return null; throw error; } }
    const s=fs.lstatSync(file); assert(s.isFile() && !s.isSymbolicLink() && fs.realpathSync(file)===file && s.size<=2*1024*1024 && (!requireRoot || s.uid===0) && !(s.mode&0o022), `Unsafe configuration metadata: ${file}`);
    return {data:fs.readFileSync(file),uid:s.uid,gid:s.gid,mode:s.mode&0o777};
  };
  function run(command,args,options={}) {
    const r=spawnSync(command,args,{encoding:'utf8',timeout:20000,maxBuffer:15*1024*1024,...options});
    if(r.signal==='SIGKILL' || r.status===137) { const e=new Error(`${command} killed; stopped without retry.`);e.code=137;throw e; }
    if(command==='openssl' && r.status!==0)console.log(`NATIVE_TLS_DIAGNOSTIC ${(r.stdout??'').slice(0,1800)} ${(r.stderr??'').slice(0,1800)}`);
    assert(!r.error && !r.signal && r.status===0, `${command} failed (${r.status ?? r.signal ?? 'unavailable'}).`); return r.stdout??'';
  }
  const guard=()=>run('bash',['-s','--',main,c.php_checks.join(',')],{input:CTOK_GUARD_SOURCE});
  function response(url,host=null) {
    const u=new URL(url); const args=['--disable','--noproxy','*','--proto','=http,https','--http1.1','--connect-timeout','5','--max-time','15','--max-filesize','12582912','--silent','--include'];
    if(u.hostname!==c.address)args.push('--resolve',`${u.hostname}:${u.protocol==='https:'?443:80}:${c.address}`);
    if(host)args.push('--header',`Host: ${host}`);
    const output=Buffer.from(run('curl',[...args,'--write-out','\nCTOK_NATIVE\t%{http_code}\t%{ssl_verify_result}','--url',url],{encoding:null}));
    const marker=output.lastIndexOf('\nCTOK_NATIVE\t'), end=output.indexOf('\r\n\r\n');assert(marker>0 && end>=0 && end<marker,'Invalid HTTP response.');
    const [status,tls]=output.subarray(marker+13).toString().trim().split('\t');assert(/^\d{3}$/.test(status) && (u.protocol!=='https:' || tls==='0'),'Invalid HTTP/TLS control.');
    const headers=output.subarray(0,end).toString('latin1'),body=output.subarray(end+4,marker);
    return {status:Number(status),location:headers.match(/^location:\s*([^\r\n]+)/im)?.[1]??'',body,hash:sha(body)};
  }
  const safe=r=>({status:r.status,has_location:Boolean(r.location),body_sha256:r.hash});
  guard();run('nginx',['-t']);
  const source=read(record).data.toString(); assert(/^AllowOverride=1\r?$/m.test(source) && source.includes(`domain="${c.domain}"`) && source.includes(`user="${c.app_user}"`),'Native per-site overrides are not enabled.');
  const template=read('/etc/brainy/vhosts/vhosts.tpl').data.toString();
  assert(template.includes('include {$patf_nginx_access};') && template.includes('include {$aassl};') && template.includes("$patf_nginx_access|cat:'.ssl'"),'Installed panel does not support the reviewed native hook.');
  const nativeDefault=read('/etc/nginx/sites-available/!!default.conf'),nativeSslDefault=read('/etc/nginx/sites-available/!!ssl.default.conf');
  assert(sha(nativeDefault.data)===c.http_sha256 && sha(nativeSslDefault.data)===c.https_sha256,'Original panel default changed.');
  const originals=new Map([http,https,hook,`${hook}.ssl`,game,clone,legacy].map(file=>[file,read(file,file===`${hook}.ssl`,file!==hook)]));
  assert(sha(originals.get(game).data)===c.game_sha256 && sha(originals.get(clone).data)==='cdb5ba70c207fa83a9250252728c9a947e7081f089cba866e3114680959b99f9' && sha(originals.get(legacy).data)==='797971c5a5221b713bdccd6fc082c0deefd34bed905309c55db7835b78bbba34','Reviewed legacy configuration changed.');
  assert(originals.get(hook).data.length===0 && originals.get(`${hook}.ssl`)===null,'Native hooks are already populated; review them first.');
  for(const directory of [path.dirname(hook),path.dirname(http),path.dirname(game)]) {const s=fs.lstatSync(directory);assert(s.isDirectory() && !s.isSymbolicLink() && fs.realpathSync(directory)===directory && s.uid===0 && !(s.mode&0o022),'Unsafe native configuration parent.');}
  const text=originals.get(game).data.toString();
  const match=text.match(/location\s+\/\s*\{([^{}]+)\}\s*\}\s*$/);assert(match && match[1].includes(`proxy_pass http://127.0.0.1:${c.port};`) && !/\b(?:include|location|listen|server_name)\b/.test(match[1]),'Unexpected original game proxy body.');
  const upstream=match[1].trim().split('\n').map(line=>`    ${line.trim()}`).join('\n');
  const httpHook=`# Individual site settings managed through BrainyCP Webserver VHOST configurator.\nreturn 301 https://${c.domain}$request_uri;\n`;
  const sslHook=`# Individual site settings managed through BrainyCP Webserver VHOST configurator.\nif ($host = www.${c.domain}) { return 301 https://${c.domain}$request_uri; }\nlocation ~ ^/ {\n${upstream}\n}\n`;
  const include=(outer,file)=>{const body=outer.data.toString();const anchor=/^([ \t]*)location \^~ \/\.well-known\/acme-challenge\/ \{ allow all; \}$/gm; const hits=[...body.matchAll(anchor)];assert(hits.length===1 && !body.includes(file) && new RegExp(`server_name\\s+${c.domain.replaceAll('.','\\.')}\\s+www\\.${c.domain.replaceAll('.','\\.')}\\s*;`).test(body),'Unexpected native virtual-host structure.');return body.slice(0,hits[0].index)+`            include ${file};\n\n`+body.slice(hits[0].index);};
  const candidates=new Map([[http,Buffer.from(include(originals.get(http),hook))],[https,Buffer.from(include(originals.get(https),`${hook}.ssl`))],[hook,Buffer.from(httpHook)],[`${hook}.ssl`,Buffer.from(sslHook)],[game,null],[clone,null],[legacy,null]]);
  const certificate=originals.get(https).data.toString().match(/^\s*ssl_certificate\s+([^;\s]+);/m)?.[1];
  const nativeKey=originals.get(https).data.toString().match(/^\s*ssl_certificate_key\s+([^;\s]+);/m)?.[1];
  const profile={};for(const key of ['crt','key','chein'])profile[key]=source.match(new RegExp(`^${key}="([^"\r\n]+)"`,'m'))?.[1];
  for(const value of Object.values(profile))assert(value && value.startsWith(`/etc/certs/${c.app_user}/${c.domain}_`) && /^\/[A-Za-z0-9_.:/-]+$/.test(value),'Unexpected native certificate profile.');
  assert(certificate===`${profile.crt}_v2` && [profile.key,`${profile.key}_v2`].includes(nativeKey),'Native certificate paths differ from the reviewed panel format.');
  console.log(`NATIVE_TLS_PUBLIC ${run('openssl',['x509','-in',certificate,'-noout','-dates','-ext','subjectAltName'])}`);
  const expiry=spawnSync('openssl',['x509','-in',certificate,'-noout','-checkend','86400'],{encoding:'utf8',timeout:5000});
  if(expiry.signal==='SIGKILL' || expiry.status===137){const e=new Error('Certificate check killed; stopped.');e.code=137;throw e;}
  assert(!expiry.error && !expiry.signal && expiry.status===1,'Native certificate no longer needs the reviewed refresh; inspect it again.');
  const fullchain=[...new Set([...text.matchAll(/^\s*ssl_certificate\s+([^;\s]+);/gm)].map(m=>m[1]))];
  const keys=[...new Set([...text.matchAll(/^\s*ssl_certificate_key\s+([^;\s]+);/gm)].map(m=>m[1]))];
  assert(fullchain.length===1 && keys.length===1 && fullchain[0].startsWith('/etc/letsencrypt/live/') && fullchain[0].endsWith('/fullchain.pem') && keys[0]===path.join(path.dirname(fullchain[0]),'privkey.pem'),'Unexpected working certificate source.');
  const leaf=path.join(path.dirname(fullchain[0]),'cert.pem'),chain=path.join(path.dirname(fullchain[0]),'chain.pem');
  const trustedSources=new Map();
  for(const file of [fullchain[0],keys[0],leaf,chain]) {const physical=fs.realpathSync(file);assert(physical.startsWith('/etc/letsencrypt/archive/'),'Working certificate does not resolve into the root-managed archive.');let parent=path.dirname(physical);while(parent!=='/'){const st=fs.lstatSync(parent);assert(st.isDirectory() && !st.isSymbolicLink() && st.uid===0 && !(st.mode&0o022),'Untrusted working certificate parent.');parent=path.dirname(parent);}trustedSources.set(physical,read(physical));}
  run('openssl',['x509','-in',fullchain[0],'-noout','-checkend','86400']);
  for(const hostname of [c.domain,`www.${c.domain}`])run('openssl',['verify','-purpose','sslserver','-verify_hostname',hostname,'-CApath','/etc/ssl/certs','-untrusted',chain,leaf]);
  assert(run('openssl',['x509','-in',leaf,'-noout','-pubkey'])===run('openssl',['pkey','-in',keys[0],'-pubout']),'Working TLS certificate and key differ.');
  assert(run('openssl',['x509','-in',leaf,'-noout','-fingerprint','-sha256'])===run('openssl',['x509','-in',fullchain[0],'-noout','-fingerprint','-sha256']),'Working certificate files are inconsistent.');
  const certData=file=>trustedSources.get(fs.realpathSync(file)).data;
  const privateTargets=new Set([profile.key,nativeKey]);
  const certCandidates=new Map([[profile.crt,certData(leaf)],[profile.chein,certData(chain)],[profile.key,certData(keys[0])],[certificate,certData(fullchain[0])],[nativeKey,certData(keys[0])]]);
  for(const [file,bytes]of certCandidates){assert(!originals.has(file),'Certificate target conflicts with routing files.');originals.set(file,read(file,true));candidates.set(file,bytes);}
  console.log(`NATIVE_TLS_REFRESH from_existing_working_certificate=true profile_unchanged=true ${run('openssl',['x509','-in',leaf,'-noout','-dates']).trim().replaceAll('\n',' ')}`);
  function websocket() {
    const args=['--disable','--noproxy','*','--http1.1','--silent','--connect-timeout','5','--max-time','3','--max-filesize','65536','--resolve',`${c.domain}:443:${c.address}`,'--header','Connection: Upgrade','--header','Upgrade: websocket','--header','Sec-WebSocket-Version: 13','--header','Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==','--header',`Origin: https://${c.domain}`,'--output','/dev/null','--write-out','%{http_code}',`https://${c.domain}/api/ws/games/codex-routing-probe`];
    const r=spawnSync('curl',args,{encoding:'utf8',timeout:8000,maxBuffer:65536});
    if(r.signal==='SIGKILL' || r.status===137){const e=new Error('WebSocket curl killed; stopped without retry.');e.code=137;throw e;}
    assert(!r.error && !r.signal && [0,28,52].includes(r.status) && r.stdout==='101','WebSocket upgrade failed.');return 101;
  }
  const otherFiles=[main,record,'/etc/brainy/vhosts/vhosts.tpl','/etc/nginx/nginx.conf'];
  for(const directory of ['/etc/nginx/conf.d','/etc/nginx/sites-available','/etc/httpd/vhost.d','/var/brainycp/data/vhosts'])for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('.conf'))) {const file=path.join(directory,name);if(!originals.has(file))otherFiles.push(file);}
  for(const file of otherFiles.filter(file=>file.startsWith('/var/brainycp/data/vhosts/') && file!==record)){const data=read(file).data.toString();for(const value of Object.values(profile))assert(!data.includes(value),'Native certificate is shared with another site; automatic refresh refused.');}
  const protectedFiles=new Map([...new Set(otherFiles)].map(file=>[file,read(file)]));
  for(const [file,value]of trustedSources)protectedFiles.set(file,value);
  const same=(a,b)=>a===null?b===null:b!==null && a.uid===b.uid && a.gid===b.gid && a.mode===b.mode && sha(a.data)===sha(b.data);
  const unchanged=()=>{for(const [file,before]of protectedFiles)assert(same(before,read(file)),`Unrelated configuration changed: ${file}`);guard();};
  const originalsUnchanged=()=>{for(const [file,before]of originals)assert(same(before,read(file,before===null,file!==hook)),`Target configuration changed: ${file}`);};
  const baseline=response(`http://${c.address}/`,'default');assert(baseline.status===200 && !baseline.location,'Original panel page unavailable.');
  const named=c.named_checks.map(url=>response(url));assert(named.every(r=>r.status<500),'A named site is already failing.');
  const health=response(`https://${c.domain}/api/health`);assert(health.status===200 && JSON.parse(health.body).ok===true,'Game API is not healthy.');
  const home=response(`https://${c.domain}/`);assert(home.status===200,'Game landing page unavailable.');
  const asset=home.body.toString().match(/href=["'](\/assets\/[A-Za-z0-9_.\/-]+\.css)["']/)?.[1];assert(asset,'Could not identify the current game stylesheet.');
  const css=response(`https://${c.domain}${asset}`);assert(css.status===200,'Game stylesheet is not healthy.');
  websocket();
  const acmePath=`/.well-known/acme-challenge/ctok-native-${c.run_id}-${c.run_attempt}`;
  const acmeBefore=response(`https://${c.domain}${acmePath}`);assert(acmeBefore.status===404,'ACME control path unexpectedly exists.');
  const pid=run('systemctl',['show',`nodejs@${c.port}.service`,'--property=MainPID','--value']).trim();assert(/^[1-9][0-9]*$/.test(pid),'Game service is not running.');
  const plan={sources:[...originals].map(([file,v])=>({file,sha256:v?sha(v.data):null,uid:v?.uid,gid:v?.gid,mode:v?.mode})),targets:[...candidates].map(([file,v])=>({file,sha256:v?sha(v):null})),protected:[...protectedFiles].map(([file,v])=>({file,sha256:sha(v.data)}))};
  const fingerprint=sha(JSON.stringify(plan));console.log(`NATIVE_ROUTING_PLAN ${fingerprint}`);console.log(JSON.stringify(plan.targets));console.log(`NATIVE_HTTP_HOOK\n${httpHook}NATIVE_HTTPS_HOOK\n${sslHook}`);console.log(`NATIVE_BASELINE ${JSON.stringify({panel:safe(baseline),named:named.map(safe),game:safe(health),stylesheet:safe(css)})}`);
  if(mode==='plan') {unchanged();originalsUnchanged();return;}
  assert(c.expected_candidate_sha256===fingerprint,'Native routing plan differs from reviewed fingerprint.');
  const parent=`/var/lib/ctokodnomy-deploy/${c.app_user}-${c.port}`;
  const dir=fs.lstatSync(parent);assert(dir.isDirectory() && !dir.isSymbolicLink() && fs.realpathSync(parent)===parent && dir.uid===0 && (dir.mode&0o777)===0o700,'Unsafe private deployment directory.');
  const lockFile=path.join(parent,'deploy.lock');read(lockFile);const lock=fs.openSync(lockFile,'r');let backup, reload=false;
  const written=[];
  function put(file,bytes,metadata={uid:0,gid:0,mode:0o644}) {const tmp=path.join(path.dirname(file),`.ctok-native-${c.run_id}-${c.run_attempt}.tmp`);const fd=fs.openSync(tmp,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fchownSync(fd,metadata.uid,metadata.gid);fs.fchmodSync(fd,metadata.mode);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}try{fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
  try {
    run('flock',['--nonblock','3'],{stdio:['ignore','pipe','pipe',lock]});unchanged();originalsUnchanged();
    const backups=path.join(parent,'routing-backups');if(!fs.existsSync(backups))fs.mkdirSync(backups,{mode:0o700});const s=fs.lstatSync(backups);assert(s.isDirectory() && !s.isSymbolicLink() && s.uid===0 && (s.mode&0o777)===0o700,'Unsafe routing backup directory.');
    backup=path.join(backups,`${new Date().toISOString().replace(/[-:.]/g,'')}-${c.run_id}-${c.run_attempt}`);fs.mkdirSync(backup,{mode:0o700});let n=0;for(const [file,value]of originals){if(value)fs.writeFileSync(path.join(backup,`${n}.conf`),value.data,{flag:'wx',mode:0o600});n++;}fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify(plan,null,2),{flag:'wx',mode:0o600});console.log(`NATIVE_ROUTING_BACKUP ${backup}`);
    unchanged();originalsUnchanged();
    for(const [file,value]of candidates){if(value===null)fs.unlinkSync(file);else put(file,value,privateTargets.has(file)?{uid:0,gid:0,mode:0o600}:undefined);written.push(file);}
    run('nginx',['-t']);unchanged();reload=true;run('nginx',['-s','reload']);run('sleep',['1']);
    unchanged();for(const [file,value]of candidates){const now=read(file,value===null);assert(value===null?now===null:now && sha(now.data)===sha(value),'A repaired target changed during verification.');}
    const currentDefault=response(`http://${c.address}/`,'default');assert(currentDefault.hash===baseline.hash && currentDefault.status===baseline.status && !currentDefault.location,'Native panel page changed.');
    for(const host of c.unknown_hosts){const r=response(`http://${host}/`);assert(r.hash===baseline.hash && r.status===baseline.status && !r.location,'Unknown host did not reach the original panel page.');console.log(`NATIVE_UNKNOWN ${host} ${JSON.stringify(safe(r))}`);}
    c.named_checks.forEach((url,i)=>{const r=response(url);assert(r.status===named[i].status && r.location===named[i].location,'Named site routing changed.');});
    const r=response(`https://${c.domain}/api/health`);assert(r.status===200 && JSON.parse(r.body).ok===true,'Game API failed.');assert(response(`https://${c.domain}${asset}`).hash===css.hash,'Game stylesheet changed.');assert(response(`https://${c.domain}/`).hash===home.hash,'Game landing page changed.');websocket();
    const acmeNow=response(`https://${c.domain}${acmePath}`);assert(acmeNow.status===404 && acmeNow.hash!==acmeBefore.hash,'Native ACME location is not serving through the new workers.');console.log('NATIVE_LIVE_ACME_CONFIRMED 404 websocket=101');
    const www=response(`https://www.${c.domain}/`);assert(www.status===301 && www.location===`https://${c.domain}/`,'Canonical www redirect failed.');
    assert(run('systemctl',['show',`nodejs@${c.port}.service`,'--property=MainPID','--value']).trim()===pid,'Game process changed.');
    const loaded=run('nginx',['-T']);for(const file of [http,https,hook,`${hook}.ssl`])assert(loaded.split(`\n# configuration file ${file}:`).length===2,'Native file not loaded exactly once.');
    assert(loaded.indexOf('# configuration file /etc/nginx/sites-available/!!default.conf:')<loaded.indexOf(`# configuration file ${http}:`),'Native default is not first.');
    assert(loaded.indexOf('# configuration file /etc/nginx/sites-available/!!ssl.default.conf:')<loaded.indexOf(`# configuration file ${https}:`),'Native TLS default is not first.');
    console.log(`NATIVE_ROUTING_APPLIED ${fingerprint} game_pid_unchanged=${pid} stylesheet_unchanged=true original_defaults_unchanged=true unrelated_configuration_unchanged=true`);
  } catch(error) {
    for(const file of written.reverse()){const expected=candidates.get(file),now=read(file,expected===null);assert(expected===null?now===null:now && sha(now.data)===sha(expected),`Rollback refused: external change to ${file}`);const before=originals.get(file);if(before===null)fs.unlinkSync(file);else put(file,before.data,before);}
    console.log('NATIVE_ROUTING_FILES_ROLLED_BACK');
    if(error.code!==137){run('nginx',['-t']);if(reload){run('nginx',['-s','reload']);run('sleep',['1']);}console.log('NATIVE_ROUTING_ROLLBACK_VERIFIED');}else console.log('NATIVE_ROUTING_SIGKILL_STOP: files restored; inspect live runtime before another action.');throw error;
  } finally {fs.closeSync(lock);}
}
try {const mode=process.argv[2],config=JSON.parse(Buffer.from(process.argv[3]??'','base64'));restoreNative(config,mode);}catch(error){console.error(`Native routing correction stopped: ${error.message}`);process.exitCode=error.code===137?137:2;}
