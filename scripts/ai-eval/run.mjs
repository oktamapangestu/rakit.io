// Evaluasi AI Builder dengan provider AI sungguhan: kasus tetap di cases.mjs dijalankan di server Go sementara
// (data di folder sementara, bukan data/ produksi), lalu dirangkum — hasil pemeriksaan kode otomatis
// (ai_requests.checks), file di luar lingkup, cek isi kasar, token, dan waktu. Pakai ini untuk membandingkan
// perubahan prompt atau model dengan angka. Memakai kredit/biaya provider sungguhan.
//
//   npm run ai:eval -- [--only id,id] [--model nama] [--parallel 3] [--repeat 1] [--out folder] [--real [folder]]
//                      [--engine builder|claude|agent:claude|…] [--agents-md] [--skill]
//   (sama dengan: npm run build:go && node scripts/ai-eval/run.mjs …)
//
// --engine: mesin yang mengerjakan kasus. builder (default) = AI Builder; claude = Claude Agent SDK di container Docker
// dengan shell & uji halaman sendiri (lihat sandbox-engines.mjs; perlu Docker).
// agent:<mesin> = mode Agen di editor (go/internal/ai/agent.go) lewat /api/ai/prompt — jalur produksi lengkap (perlu
// image deploy/agent/build.sh). Beberapa mesin dipisah koma: semuanya mengerjakan kasus yang sama, lalu dibandingkan.
// --agents-md: untuk mesin sandbox, aturan rakit ditaruh di AGENTS.md (https://agents.md) di root project dan dimuat
// mesinnya sendiri, sebagai ganti tambahan prompt sistem. Builder tidak membaca AGENTS.md (aturannya di prompt).
// --skill: skill rakit (skills/rakit/SKILL.md, format Agent Skills) dipasang di mesin sandbox lewat cara bawaannya;
// Builder tidak punya sistem skill, jadi isinya ditambahkan ke prompt Builder (AI_BUILD_PROMPT_APPEND).
//
// --real: jalankan kasus dari kegagalan sungguhan (dibuat from-requests.mjs, default data/ai-eval/real) sebagai
// ganti cases.mjs. Hasilnya dibandingkan dengan masalah yang tersisa di jawaban aslinya.
//
// Pengaturan AI_* dibaca dari .env (atau variabel lingkungan). Hasil lengkap (file akhir tiap kasus, ringkasan AI,
// report.json) disimpan di data/ai-eval/<waktu>/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { CASES } from './cases.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.RAKIT_SERVER_CMD ||= 'go/bin/rakit';
const { startStack } = await import('../../tests/helpers/harness.mjs');

// ---------- Argumen & pengaturan ----------
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const only = opt('only', '').split(',').filter(Boolean);
const parallel = Math.max(1, Number(opt('parallel', 3)) || 1);
const repeat = Math.max(1, Number(opt('repeat', 1)) || 1);
const outDir = path.resolve(ROOT, opt('out', path.join('data', 'ai-eval', new Date().toISOString().replace(/[:.]/g, '-'))));
const engines = opt('engine', 'builder').split(',').filter(Boolean);
const ENGINES = ['builder', 'claude', 'agent:claude'];
if (!engines.length || engines.some((e) => !ENGINES.includes(e))) {
  console.error(`--engine harus salah satu atau gabungan dari: ${ENGINES.join(', ')}`);
  process.exit(1);
}
const useAgentsMd = args.includes('--agents-md');
const useSkill = args.includes('--skill');
// --runtime: setiap halaman hasil dibuka di Chromium headless (cek-halaman, image deploy/agent) selagi server evaluasi
// hidup — error JavaScript/Alpine, request gagal, dan file hilang dihitung per kasus.
const useRuntime = args.includes('--runtime');
const realIndex = args.indexOf('--real');
const realDir = realIndex < 0 ? null
  : path.resolve(ROOT, args[realIndex + 1] && !args[realIndex + 1].startsWith('--') ? args[realIndex + 1] : path.join('data', 'ai-eval', 'real'));

if (!fs.existsSync(path.join(ROOT, process.env.RAKIT_SERVER_CMD.split(' ')[0]))) {
  console.error(`${process.env.RAKIT_SERVER_CMD} belum ada. Jalankan dulu: npm run build:go`);
  process.exit(1);
}

// AI_* dari .env, kecuali pengaturan kredit/kuota yang diatur skrip ini.
const env = {};
const dotenv = path.join(ROOT, '.env');
if (fs.existsSync(dotenv)) {
  for (const line of fs.readFileSync(dotenv, 'utf8').split('\n')) {
    const m = /^\s*(AI_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
for (const [k, v] of Object.entries(process.env)) if (k.startsWith('AI_')) env[k] = v;
if (opt('model')) env.AI_MODEL = opt('model');
if (!env.AI_BASE_URL || !env.AI_API_KEY || !env.AI_MODEL) {
  console.error('AI_BASE_URL, AI_API_KEY, dan AI_MODEL harus diisi (di .env atau variabel lingkungan).');
  process.exit(1);
}
const agentEngines = engines.filter((e) => e.startsWith('agent:')).map((e) => e.slice(6));
if (agentEngines.length) {
  env.AI_AGENT_ENGINES = agentEngines.join(',');
  // Docker Desktop (macOS) tidak bisa membagi unix socket ke container: pakai tcp.
  env.AI_AGENT_TRANSPORT ||= process.platform === 'darwin' ? 'tcp' : 'unix';
  env.AI_AGENT_MAX_CONCURRENT ||= String(parallel);
}
if (useSkill) env.AI_BUILD_PROMPT_APPEND = path.join(ROOT, 'skills', 'rakit', 'SKILL.md');
Object.assign(env, { AI_DAILY_PROMPTS: '100000', AI_CREDITS_PER_PROMPT: '1', AI_MAX_CONCURRENT: String(parallel) });

// Kasus nyata: <realDir>/<id>/case.json; site/ dan db.sqlite di sebelahnya (lihat from-requests.mjs).
function realCases(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((id) => fs.existsSync(path.join(dir, id, 'case.json'))).map((id) => {
    const c = JSON.parse(fs.readFileSync(path.join(dir, id, 'case.json'), 'utf8'));
    return { ...c, siteDir: path.join(dir, id, c.site ?? 'site'), dbFile: c.db ? path.join(dir, id, c.db) : undefined };
  });
}
const pool = realDir ? realCases(realDir) : CASES;
const cases = pool.filter((c) => !only.length || only.includes(c.id));
if (!cases.length) {
  console.error(realDir && !pool.length
    ? `Belum ada kasus nyata di ${path.relative(ROOT, realDir)}. Buat dulu: node scripts/ai-eval/from-requests.mjs`
    : `Tidak ada kasus yang cocok. Pilihan: ${pool.map((c) => c.id).join(', ')}`);
  process.exit(1);
}

// ---------- Menjalankan satu kasus ----------
const matchesPath = (rule, file) => (rule.endsWith('/') ? file.startsWith(rule) : file === rule);

function listFiles(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? listFiles(path.join(dir, e.name), `${prefix}${e.name}/`)
    : [`${prefix}${e.name}`]));
}

const json = (v) => (v == null || typeof v === 'string' ? v ?? null : JSON.stringify(v));

// Riwayat percakapan sebelum prompt, langsung di database server: jawaban lama tidak perlu dibuat ulang dengan AI.
// Setiap pesan: { role, content, changes?, apply_state?, snapshot?, description? } (changes/snapshot boleh objek).
function seedHistory(stack, user, history) {
  const db = stack.db();
  const project = db.prepare('SELECT id FROM projects WHERE slug = ?').get(user.username);
  const start = Date.now() - history.length * 1000;
  const thread = db.prepare('INSERT INTO ai_threads (user_id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(user.userId, project.id, 'eval', start, start).lastInsertRowid;
  const insert = db.prepare(`INSERT INTO ai_messages (thread_id, user_id, role, mode, content, status, changes, apply_state, snapshot, attachments, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  history.forEach((m, i) => {
    const changes = json(m.changes);
    insert.run(thread, user.userId, m.role, m.mode ?? 'build', m.content ?? '', m.status ?? (m.role === 'user' ? 'sent' : 'done'),
      changes, m.apply_state ?? (m.role === 'assistant' && changes && changes !== '[]' ? 'kept' : null), json(m.snapshot),
      m.description ? JSON.stringify({ thumbs: [], description: m.description }) : null, start + i * 1000);
  });
  return Number(thread);
}

// Akun per kasus, masing-masing dengan "IP" sendiri (X-Forwarded-For dipercaya dari loopback): batas laju register
// server (30 per 15 menit per IP) tidak boleh menggagalkan evaluasi yang besar.
let accounts = 0;
async function register(stack, name) {
  const n = ++accounts;
  const client = stack.client({ ip: `10.77.${n >> 8}.${n & 255}` });
  const res = await client.post('/api/register', { username: name, email: `${name}@test.local`, password: 'rahasia-123' });
  if (res.status !== 201) throw new Error(`register ${name} gagal: ${res.status} ${JSON.stringify(res.body)}`);
  client.username = name;
  client.userId = stack.db().prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  return client;
}

async function runCase(stack, c, run, engine) {
  const tag = { builder: '', claude: 'c', 'agent:claude': 'ac' }[engine];
  const user = await register(stack, `eval${tag}${run}${c.id.replace(/[^a-z0-9]/g, '').slice(0, 20)}`);
  const root = path.join(stack.dataDir, 'sites', user.username);
  if (c.siteDir) {
    // Isi project kasus nyata menggantikan template.
    fs.rmSync(root, { recursive: true, force: true });
    fs.cpSync(c.siteDir, root, { recursive: true });
  }
  if (c.dbFile) {
    fs.mkdirSync(path.join(stack.dataDir, 'db'), { recursive: true });
    fs.copyFileSync(c.dbFile, path.join(stack.dataDir, 'db', `${user.username}.db`));
  }
  for (const [rel, content] of Object.entries(c.files ?? {})) {
    const full = path.join(root, rel);
    if (content === null) fs.rmSync(full, { force: true });
    else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  }

  const result = { id: c.id, run, engine, prompt: c.prompt };
  let outcome;
  if (engine !== 'builder' && !engine.startsWith('agent:')) {
    outcome = await runSandboxCase(engine, { repoRoot: ROOT, stack, client: user, root, prompt: c.prompt, history: c.history, env, useAgentsMd, useSkill });
  } else {
    const threadId = c.history?.length ? seedHistory(stack, user, c.history) : undefined;
    const t0 = Date.now();
    const extra = { ...(threadId ? { threadId } : {}), ...(engine.startsWith('agent:') ? { mode: 'agent', engine: engine.slice(6) } : {}) };
    const { started, final } = await user.build(c.prompt, extra);
    const secs = Math.round((Date.now() - t0) / 1000);
    if (started.status !== 201 || !final) {
      return { ...result, secs, status: `gagal mulai (${started.status})`, error: JSON.stringify(started.body) };
    }
    const row = stack.db().prepare("SELECT model, status, input_tokens AS inTokens, output_tokens AS outTokens, checks FROM ai_requests WHERE user_id = ? AND action IN ('build', 'agent') ORDER BY id DESC").get(user.userId);
    const checks = row?.checks ? JSON.parse(row.checks) : {};
    outcome = {
      status: final.type === 'done' ? row?.status ?? 'ok' : `error: ${final.error}`,
      secs,
      model: row?.model,
      inTokens: row?.inTokens ?? 0,
      outTokens: row?.outTokens ?? 0,
      rounds: checks.rounds ?? 0,
      found: checks.found ?? {},
      left: checks.left ?? {},
      tools: checks.tools,
      touched: (final.message?.changes ?? []).filter((x) => x.path).map((x) => x.path),
      message: final.message?.content ?? final.error ?? '',
    };
  }
  const { touched } = outcome;
  // AGENTS.md (mode --agents-md) memuat contoh kode seperti /api/db/ — jangan ikut dinilai "cek isi".
  const files = listFiles(root).filter((f) => f !== 'AGENTS.md');
  const read = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return ''; } };

  const must = (c.must ?? []).map(([where, re]) => {
    const targets = where === '*' ? files : files.filter((f) => matchesPath(where, f));
    return { where, pattern: String(re), ok: targets.some((f) => re.test(read(f))) };
  });
  for (const re of c.mustFiles ?? []) must.push({ where: 'file', pattern: String(re), ok: files.some((f) => re.test(f)) });
  const runtime = useRuntime ? runtimeCheck(stack, user, files) : undefined;
  let tables = [];
  const dbFile = path.join(stack.dataDir, 'db', `${user.username}.db`);
  if (fs.existsSync(dbFile)) {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_rakit%' ESCAPE '\\'").all().map((t) => t.name);
    db.close();
  }

  // Simpan hasil akhir untuk dilihat manusia.
  const caseDir = path.join(outDir, engines.length > 1 ? engine.replace(':', '-') : '', repeat > 1 ? `${c.id}-${run}` : c.id);
  fs.mkdirSync(caseDir, { recursive: true });
  fs.cpSync(root, path.join(caseDir, 'site'), { recursive: true });
  fs.writeFileSync(path.join(caseDir, 'ringkasan-ai.md'), `# ${c.id}\n\n**Prompt:** ${c.prompt}\n\n${outcome.message}\n`);
  if (outcome.transcript) fs.writeFileSync(path.join(caseDir, 'transcript.json'), JSON.stringify(outcome.transcript, null, 2));
  const { transcript, message, ...metrics } = outcome;

  return {
    ...result,
    ...metrics,
    outOfScope: c.allow ? touched.filter((p) => !c.allow.some((rule) => matchesPath(rule, p))) : [],
    must,
    tables,
    missingTable: Boolean(c.needsTable && !tables.length),
    runtime,
    originalLeft: c.original?.checks?.left,
  };
}

// Buka semua halaman HTML project di Chromium headless (cek-halaman di image agen, mode proxy evaluasi).
function runtimeCheck(stack, user, files) {
  const pages = files.filter((f) => f.endsWith('.html') && !f.startsWith('functions/')).map((f) => `/${f}`);
  if (!pages.length) return { pages: 0, problems: 0, details: [] };
  const res = spawnSync('docker', ['run', '--rm', '--add-host', 'host.docker.internal:host-gateway',
    '-e', `RAKIT_PORT=${new URL(stack.origin).port}`, '-e', `RAKIT_SLUG=${user.username}`, 'rakit-agent-claude', 'cek-halaman', ...pages],
  { encoding: 'utf8', timeout: 180_000 });
  const details = (res.stdout ?? '').split('\n').filter((l) => l.startsWith('  - ')).map((l) => l.slice(4));
  return { pages: pages.length, problems: details.length, details: details.slice(0, 15) };
}

// ---------- Main ----------
let runSandboxCase;
if (engines.some((e) => e !== 'builder')) {
  const sandbox = await import('./sandbox-engines.mjs');
  // Image yang sama untuk mesin sandbox evaluasi (claude) dan mode Agen (agent:claude).
  for (const e of new Set(engines.filter((x) => x !== 'builder').map((x) => x.replace(/^agent:/, '')))) {
    console.log(`Menyiapkan image Docker ${e}…`);
    sandbox.ensureImage(ROOT, e);
  }
  runSandboxCase = sandbox.runSandboxCase;
}
console.log(`Model: ${env.AI_MODEL} · mesin ${engines.join(' & ')}${useAgentsMd ? ' · AGENTS.md' : ''}${useSkill ? ' · skill' : ''} · ${cases.length} kasus × ${repeat} · paralel ${parallel}\nHasil: ${path.relative(ROOT, outDir)}\n`);
fs.mkdirSync(outDir, { recursive: true });
const stack = await startStack(env);
const queue = [];
for (let run = 1; run <= repeat; run++) for (const c of cases) for (const engine of engines) queue.push([c, run, engine]);
const results = [];
const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
try {
  await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    while (queue.length) {
      const [c, run, engine] = queue.shift();
      let r;
      try {
        r = await runCase(stack, c, run, engine);
      } catch (err) {
        r = { id: c.id, run, engine, status: `crash: ${err.message}` };
      }
      results.push(r);
      const flags = [
        sum(r.left) ? `TERSISA ${JSON.stringify(r.left)}` : '',
        r.outOfScope?.length ? `di luar lingkup: ${r.outOfScope.join(', ')}` : '',
        r.must?.some((m) => !m.ok) ? `cek isi gagal: ${r.must.filter((m) => !m.ok).map((m) => `${m.where} ${m.pattern}`).join('; ')}` : '',
        r.missingTable ? 'tidak membuat tabel' : '',
        r.runtime?.problems ? `runtime: ${r.runtime.problems} masalah di ${r.runtime.pages} halaman — ${r.runtime.details.slice(0, 3).join(' | ')}` : '',
        r.tools && !r.sandbox ? `tool: ${Object.entries(r.tools).map(([k, v]) => `${k} ${v}`).join(', ')}` : '',
        r.originalLeft ? `jawaban asli: tersisa ${JSON.stringify(r.originalLeft)}` : '',
        r.sandbox ? `${r.engine}: ${r.sandbox.shell} perintah shell (${r.sandbox.selfTests} uji sendiri) · ${r.sandbox.fixes} putaran perbaikan dari pemeriksaan server${r.sandbox.errors.length ? ` · error: ${r.sandbox.errors.join(' | ')}` : ''}` : '',
      ].filter(Boolean);
      const engineTag = engines.length > 1 ? `[${r.engine}] ` : '';
      console.log(`${r.status === 'ok' && !sum(r.left) && !r.outOfScope?.length && !r.must?.some((m) => !m.ok) && !r.missingTable ? '✓' : '✗'} ${engineTag}${r.id}${repeat > 1 ? ` #${r.run}` : ''} · ${r.status} · ${r.rounds ?? 0} putaran · ditemukan ${sum(r.found)} ${sum(r.found) ? JSON.stringify(r.found) : ''} · ${r.secs ?? 0} dtk · ${(r.inTokens ?? 0) + (r.outTokens ?? 0)} token${flags.length ? `\n    ${flags.join('\n    ')}` : ''}`);
    }
  }));
} finally {
  fs.writeFileSync(path.join(outDir, 'server.log'), stack.log());
  await stack.stop();
}

// ---------- Ringkasan ----------
function summarize(list) {
  const ok = list.filter((r) => r.status === 'ok');
  const avg = (fn) => ok.reduce((a, r) => a + fn(r), 0) / Math.max(1, ok.length);
  return {
    model: env.AI_MODEL,
    cases: list.length,
    ok: ok.length,
    hadProblems: ok.filter((r) => Object.keys(r.found).length).length,
    problemsLeft: ok.filter((r) => Object.keys(r.left).length).length,
    problemsLeftTotal: ok.reduce((a, r) => a + sum(r.left), 0),
    outOfScope: ok.filter((r) => r.outOfScope.length).length,
    mustFailed: ok.filter((r) => r.must.some((m) => !m.ok)).length,
    missingTable: ok.filter((r) => r.missingTable).length,
    runtimeProblems: useRuntime ? ok.reduce((a, r) => a + (r.runtime?.problems ?? 0), 0) : undefined,
    avgRounds: avg((r) => r.rounds),
    avgTokens: Math.round(avg((r) => r.inTokens + r.outTokens)),
    avgSeconds: Math.round(avg((r) => r.secs)),
    // Kasus nyata yang jawaban aslinya menyisakan masalah, kini selesai tanpa sisa.
    realCleaned: realDir ? ok.filter((r) => !Object.keys(r.left).length).length : undefined,
  };
}
const summaries = Object.fromEntries(engines.map((e) => [e, summarize(results.filter((r) => r.engine === e))]));
const summary = engines.length === 1 ? summaries[engines[0]] : summaries;
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ summary, agentsMd: useAgentsMd, skill: useSkill, results: results.sort((a, b) => a.id.localeCompare(b.id) || a.run - b.run || a.engine.localeCompare(b.engine)) }, null, 2));
const pct = (n, of) => `${n} (${Math.round((n / Math.max(1, of)) * 100)}%)`;
const rows = [
  ['selesai tanpa error', (s) => `${s.ok}/${s.cases}`],
  ['sempat ada masalah kode', (s) => pct(s.hadProblems, s.cases)],
  ['selesai MASIH bermasalah', (s) => `${pct(s.problemsLeft, s.cases)} · ${s.problemsLeftTotal} masalah`],
  ['mengubah file di luar lingkup', (s) => pct(s.outOfScope, s.cases)],
  ['cek isi gagal', (s) => pct(s.mustFailed, s.cases)],
  ['tidak membuat tabel', (s) => String(s.missingTable)],
  ...(useRuntime ? [['masalah runtime (Chromium)', (s) => String(s.runtimeProblems)]] : []),
  ...(realDir ? [['kasus nyata kini tanpa sisa', (s) => `${s.realCleaned}/${s.cases}`]] : []),
  ['rata-rata putaran', (s) => s.avgRounds.toFixed(1)],
  ['rata-rata token', (s) => String(s.avgTokens)],
  ['rata-rata waktu', (s) => `${s.avgSeconds} dtk`],
];
console.log(['', `Ringkasan (${env.AI_MODEL})`, `  ${''.padEnd(32)}${engines.map((e) => e.padEnd(28)).join('')}`,
  ...rows.map(([label, fn]) => `  ${label.padEnd(32)}${engines.map((e) => fn(summaries[e]).padEnd(28)).join('')}`),
  ...(engines.some((e) => e !== 'builder') ? ['  ("ditemukan" Builder = semua masalah yang dikembalikan saat menulis; mesin lain = yang dikirim balik setelah mesin selesai)'] : []),
  `Detail: ${path.relative(ROOT, path.join(outDir, 'report.json'))}`,
].join('\n'));
