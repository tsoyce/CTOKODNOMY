import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { parseQuestionPack, questionSchema } from '../shared/questionImport';
import type { QuestionPack } from '../shared/questionImport';

const fail = (message: string): never => { throw new Error(message); };
const cleanId = (input: unknown): unknown => {
 if (Array.isArray(input)) return input.map(cleanId);
 if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'id').map(([key, value]) => [key,cleanId(value)]).sort(([a],[b]) => String(a).localeCompare(String(b))));
 return input;
};
const keyFor = (s:string) => s.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
const uuid = (hash:string, path:string) => {
 const d = createHash('sha256').update('ctokodnomy-survey-import-v1\0').update(hash).update('\0').update(path).digest().subarray(0,16);
 d[6] = (d[6]! & 0x0f) | 0x50; d[8] = (d[8]! & 0x3f) | 0x80;
 const h=d.toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
async function run() {
 const [configPath, release, expectedHash, expectedDb, expectedConfigHash] = process.argv.slice(2);
 if (process.argv.length !== 7 || !configPath?.startsWith('/') || !release?.startsWith('/') || !/^[a-f0-9]{64}$/.test(expectedHash ?? '') || !/^[a-f0-9]{64}$/.test(expectedConfigHash ?? '') || !/^[a-z_][a-z0-9_]{0,62}$/.test(expectedDb ?? '')) fail('Invalid import invocation.');
 let size = 0; const chunks: Buffer[] = [];
 for await (const chunk of process.stdin) { const b = Buffer.from(chunk); size += b.length; if (size > 3*1024*1024) fail('Input exceeds the import size limit.'); chunks.push(b); }
 const data=Buffer.concat(chunks);
 const hash=createHash('sha256').update(data).digest('hex');
 if (hash !== expectedHash) fail('Input integrity check failed.');
 const parsed=parseQuestionPack(data.toString('utf8'));
 if (!parsed.success) fail('Input fails the application import schema.');
 const pack = parsed.data as QuestionPack;
 if (pack.questions.length !== 15 || pack.questions.some(q => q.id || q.respondentCount !== 154 || q.answers.some(a=>a.id || a.originals?.length) || q.answers.reduce((sum,a)=>sum+a.points,0)!==100)) fail('Input does not match the reviewed survey.');
 const prompts = new Set(pack.questions.map(q => keyFor(q.prompt)));
 if(prompts.size !== pack.questions.length) fail('Input contains duplicate question prompts.');
 const configBytes=await readFile(configPath);
 if(createHash('sha256').update(configBytes).digest('hex') !== expectedConfigHash) fail('Managed environment changed before connection.');
 const config=parseEnv(configBytes.toString('utf8'));
 if(config.CTOKODNOMY_MANAGED_CONFIG !== '1' || config.NODE_ENV !== 'production') fail('Unexpected managed environment.');
 if(Object.keys(config).some(name => /^PG[A-Z0-9_]*$/.test(name))) fail('Managed environment contains PostgreSQL connection or schema overrides.');
 for(const name of Object.keys(process.env)) if(/^PG[A-Z0-9_]*$/.test(name)) delete process.env[name];
 const url=new URL(config.DATABASE_URL ?? '');
 if(url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '5432' || url.username !== expectedDb || url.pathname !== '/'+expectedDb || url.search || url.hash) fail('Unexpected database.');
 const require = createRequire(resolve(release,'package.json'));
 const {Pool} = require('pg') as typeof import('pg');
 const pool = new Pool({connectionString:config.DATABASE_URL, connectionTimeoutMillis:5000, statement_timeout:30000, max:1});
 let client: Awaited<ReturnType<typeof pool.connect>> | undefined;
 let committed=false;
 try {
  client=await pool.connect();
  const ident=await client.query('SELECT current_database() AS db, current_user AS usr, current_schema() AS schema');
  if(ident.rows[0]?.db !== expectedDb || ident.rows[0]?.usr !== expectedDb || ident.rows[0]?.schema !== 'public') fail('Connected to an unexpected database or application schema.');
  await client.query('SET search_path TO public');
  const schema=await client.query('SELECT current_schema() AS schema');
  if(schema.rows[0]?.schema !== 'public') fail('Unable to lock the importer schema.');
  await client.query('BEGIN');
  await client.query('LOCK TABLE public.questions IN SHARE ROW EXCLUSIVE MODE');
  const existing=await client.query('SELECT id::text, data FROM public.questions');
  const requestedPacks = new Set(pack.questions.map(q=>keyFor(q.pack)).filter(Boolean));
  const expectedByPrompt = new Map(pack.questions.map(q=>[keyFor(q.prompt),q]));
  for(const row of existing.rows) {
   if(!row.data || typeof row.data.pack !== 'string' || !requestedPacks.has(keyFor(row.data.pack))) continue;
   const old = questionSchema.safeParse(row.data);
   const expected = typeof row.data.prompt === 'string' ? expectedByPrompt.get(keyFor(row.data.prompt)) : undefined;
   if(!old.success || !expected || JSON.stringify(cleanId(old.data)) !== JSON.stringify(cleanId(expected))) fail('A target pack contains another question; import was cancelled to prevent merging.');
  }
  let inserted=0, skipped=0; const insertedRecords: Array<{id:string; data:unknown}> = [];
  for(let i=0;i<pack.questions.length;i++) {
   const q=pack.questions[i]!;
   const question = {...q, id:uuid(hash,`question:${i}`), answers:q.answers.map((a,j)=>({...a,id:uuid(hash,`question:${i}:answer:${j}`)}))};
   const same=existing.rows.filter(row => row.data && typeof row.data.prompt==='string' && keyFor(row.data.prompt)===keyFor(q.prompt));
   if(same.length) {
    if(same.length !== 1) fail('A question with the same text already exists more than once; import was cancelled.');
    const old=questionSchema.safeParse(same[0]!.data);
    if(!old.success || JSON.stringify(cleanId(old.data)) !== JSON.stringify(cleanId(question))) fail('An existing question with the same text differs; import was cancelled to prevent duplicates or overwrites.');
    skipped++; continue;
   }
   const idConflict=existing.rows.some(row=>row.id===question.id);
   if(idConflict) fail('A deterministic question identifier already belongs to another record; import was cancelled.');
   await client.query('INSERT INTO public.questions(id,data,created_at) VALUES($1,$2::jsonb,clock_timestamp())',[question.id,JSON.stringify(question)]);
   inserted++; insertedRecords.push({id:question.id,data:question});
  }
  if(insertedRecords.length) {
   const verification=await client.query('SELECT id::text, data FROM public.questions WHERE id=ANY($1::uuid[])', [insertedRecords.map(row=>row.id)]);
   if(verification.rows.length !== insertedRecords.length) fail('Inserted question verification failed.');
   const byId = new Map(verification.rows.map(row => [row.id, row.data]));
   for(const row of insertedRecords) if(JSON.stringify(cleanId(byId.get(row.id))) !== JSON.stringify(cleanId(row.data))) fail('Inserted question verification failed.');
  }
  await client.query('COMMIT'); committed=true;
  console.log(`SURVEY_IMPORT_READY inserted=${inserted} already_present=${skipped} total=${pack.questions.length}`);
 } finally {
  if(client){ if(!committed) await client.query('ROLLBACK').catch(()=>{}); client.release(); }
  await pool.end();
 }
}
run().catch(() => { console.error('Survey import failed. Database changes were rolled back unless the connection failed during commit; verify the library before retrying. No answers or credentials were logged.'); process.exitCode=1; });
