// Evaluasi AI Builder dengan provider AI sungguhan: kasus tetap di cases.mjs dijalankan di server Go sementara
// (data di folder sementara, bukan data/ produksi), lalu dirangkum — hasil pemeriksaan kode otomatis
// (ai_requests.checks), file di luar lingkup, cek isi kasar, token, dan waktu. Pakai ini untuk membandingkan
// perubahan prompt atau model dengan angka. Memakai kredit/biaya provider sungguhan.
//
//   npm run ai:eval -- [--only id,id] [--model nama] [--parallel 3] [--repeat 1] [--out folder] [--real [folder]]
//   (sama dengan: npm run build:go && node scripts/ai-eval/run.mjs …)
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
Object.assign(env, { AI_BONUS_CREDITS: '100000', AI_DAILY_CREDITS: '0', AI_CREDITS_PER_PROMPT: '1', AI_MAX_CONCURRENT: String(parallel) });

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

async function runCase(stack, c, run) {
  const user = await stack.register(`eval${run}${c.id.replace(/[^a-z0-9]/g, '').slice(0, 20)}`);
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

  const threadId = c.history?.length ? seedHistory(stack, user, c.history) : undefined;
  const t0 = Date.now();
  const { started, final } = await user.build(c.prompt, threadId ? { threadId } : undefined);
  const secs = Math.round((Date.now() - t0) / 1000);
  const result = { id: c.id, run, secs, prompt: c.prompt };
  if (started.status !== 201 || !final) {
    return { ...result, status: `gagal mulai (${started.status})`, error: JSON.stringify(started.body) };
  }
  const row = stack.db().prepare("SELECT model, status, input_tokens AS inTokens, output_tokens AS outTokens, checks FROM ai_requests WHERE user_id = ? AND action = 'build' ORDER BY id DESC").get(user.userId);
  const checks = row?.checks ? JSON.parse(row.checks) : {};
  const changes = final.message?.changes ?? [];
  const touched = changes.filter((x) => x.path).map((x) => x.path);
  const files = listFiles(root);
  const read = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return ''; } };

  const must = (c.must ?? []).map(([where, re]) => {
    const targets = where === '*' ? files : files.filter((f) => matchesPath(where, f));
    return { where, pattern: String(re), ok: targets.some((f) => re.test(read(f))) };
  });
  let tables = [];
  const dbFile = path.join(stack.dataDir, 'db', `${user.username}.db`);
  if (fs.existsSync(dbFile)) {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_rakit%' ESCAPE '\\'").all().map((t) => t.name);
    db.close();
  }

  // Simpan hasil akhir untuk dilihat manusia.
  const caseDir = path.join(outDir, repeat > 1 ? `${c.id}-${run}` : c.id);
  fs.mkdirSync(caseDir, { recursive: true });
  fs.cpSync(root, path.join(caseDir, 'site'), { recursive: true });
  fs.writeFileSync(path.join(caseDir, 'ringkasan-ai.md'), `# ${c.id}\n\n**Prompt:** ${c.prompt}\n\n${final.message?.content ?? final.error ?? ''}\n`);

  return {
    ...result,
    status: final.type === 'done' ? row?.status ?? 'ok' : `error: ${final.error}`,
    model: row?.model,
    inTokens: row?.inTokens ?? 0,
    outTokens: row?.outTokens ?? 0,
    rounds: checks.rounds ?? 0,
    found: checks.found ?? {},
    left: checks.left ?? {},
    touched,
    outOfScope: c.allow ? touched.filter((p) => !c.allow.some((rule) => matchesPath(rule, p))) : [],
    must,
    tables,
    missingTable: Boolean(c.needsTable && !tables.length),
    originalLeft: c.original?.checks?.left,
  };
}

// ---------- Main ----------
console.log(`Model: ${env.AI_MODEL} · ${cases.length} kasus × ${repeat} · paralel ${parallel}\nHasil: ${path.relative(ROOT, outDir)}\n`);
fs.mkdirSync(outDir, { recursive: true });
const stack = await startStack(env);
const queue = [];
for (let run = 1; run <= repeat; run++) for (const c of cases) queue.push([c, run]);
const results = [];
try {
  await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    while (queue.length) {
      const [c, run] = queue.shift();
      let r;
      try {
        r = await runCase(stack, c, run);
      } catch (err) {
        r = { id: c.id, run, status: `crash: ${err.message}` };
      }
      results.push(r);
      const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
      const flags = [
        sum(r.left) ? `TERSISA ${JSON.stringify(r.left)}` : '',
        r.outOfScope?.length ? `di luar lingkup: ${r.outOfScope.join(', ')}` : '',
        r.must?.some((m) => !m.ok) ? `cek isi gagal: ${r.must.filter((m) => !m.ok).map((m) => `${m.where} ${m.pattern}`).join('; ')}` : '',
        r.missingTable ? 'tidak membuat tabel' : '',
        r.originalLeft ? `jawaban asli: tersisa ${JSON.stringify(r.originalLeft)}` : '',
      ].filter(Boolean);
      console.log(`${r.status === 'ok' && !sum(r.left) && !r.outOfScope?.length && !r.must?.some((m) => !m.ok) && !r.missingTable ? '✓' : '✗'} ${r.id}${repeat > 1 ? ` #${r.run}` : ''} · ${r.status} · ${r.rounds ?? 0} putaran · ditemukan ${sum(r.found)} ${sum(r.found) ? JSON.stringify(r.found) : ''} · ${r.secs ?? 0} dtk · ${(r.inTokens ?? 0) + (r.outTokens ?? 0)} token${flags.length ? `\n    ${flags.join('\n    ')}` : ''}`);
    }
  }));
} finally {
  await stack.stop();
}

// ---------- Ringkasan ----------
const ok = results.filter((r) => r.status === 'ok');
const pct = (n) => `${Math.round((n / Math.max(1, results.length)) * 100)}%`;
const summary = {
  model: env.AI_MODEL,
  cases: results.length,
  ok: ok.length,
  hadProblems: ok.filter((r) => Object.keys(r.found).length).length,
  problemsLeft: ok.filter((r) => Object.keys(r.left).length).length,
  outOfScope: ok.filter((r) => r.outOfScope.length).length,
  mustFailed: ok.filter((r) => r.must.some((m) => !m.ok)).length,
  missingTable: ok.filter((r) => r.missingTable).length,
  avgRounds: ok.reduce((a, r) => a + r.rounds, 0) / Math.max(1, ok.length),
  avgTokens: Math.round(ok.reduce((a, r) => a + r.inTokens + r.outTokens, 0) / Math.max(1, ok.length)),
  avgSeconds: Math.round(ok.reduce((a, r) => a + r.secs, 0) / Math.max(1, ok.length)),
  // Kasus nyata yang jawaban aslinya menyisakan masalah, kini selesai tanpa sisa.
  realCleaned: realDir ? ok.filter((r) => !Object.keys(r.left).length).length : undefined,
};
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ summary, results: results.sort((a, b) => a.id.localeCompare(b.id) || a.run - b.run) }, null, 2));
const line = (label, value) => `  ${label.padEnd(32)}${value}`;
console.log([
  '',
  `Ringkasan (${summary.model})`,
  line('selesai tanpa error', `${summary.ok}/${summary.cases}`),
  line('sempat ada masalah kode', `${summary.hadProblems} (${pct(summary.hadProblems)})`),
  line('selesai MASIH bermasalah', `${summary.problemsLeft} (${pct(summary.problemsLeft)})`),
  line('mengubah file di luar lingkup', `${summary.outOfScope} (${pct(summary.outOfScope)})`),
  line('cek isi gagal', `${summary.mustFailed} (${pct(summary.mustFailed)})`),
  line('tidak membuat tabel', String(summary.missingTable)),
  ...(realDir ? [line('kasus nyata kini tanpa sisa', `${summary.realCleaned}/${summary.cases} (aslinya semua bersisa)`)] : []),
  line('rata-rata', `${summary.avgRounds.toFixed(1)} putaran · ${summary.avgTokens} token · ${summary.avgSeconds} dtk`),
  `Detail: ${path.relative(ROOT, path.join(outDir, 'report.json'))}`,
].join('\n'));
