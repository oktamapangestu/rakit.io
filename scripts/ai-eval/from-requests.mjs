// Mengubah job AI Builder yang gagal sungguhan menjadi kasus evaluasi: job yang selesai tapi masih menyisakan
// masalah kode (ai_requests.checks.left), diambil dari data server (rakit.db, riwayat versi, database project).
// Setiap kasus disimpan di <out>/<id>/: case.json (prompt, riwayat percakapan, asal), site/ (file project
// sebelum AI bekerja), db.sqlite (struktur database project, TANPA isi baris). Jalankan kasusnya dengan
// `npm run ai:eval -- --real`.
//
//   node scripts/ai-eval/from-requests.mjs [--data data] [--days 14] [--limit 20] [--kind loss,claim] [--out data/ai-eval/real]
//
// Isi file & prompt pengguna ikut tersalin: simpan hanya di data/ (tidak masuk git), jangan dibagikan.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const dataDir = path.resolve(ROOT, opt('data', 'data'));
const days = Number(opt('days', 14)) || 14;
const limit = Number(opt('limit', 20)) || 20;
const kinds = opt('kind', '').split(',').filter(Boolean);
const outDir = path.resolve(ROOT, opt('out', path.join('data', 'ai-eval', 'real')));
const MAX_HISTORY = 10; // sama dengan maxHistory di go/internal/ai/service.go

const mainDb = path.join(dataDir, 'rakit.db');
if (!fs.existsSync(mainDb)) {
  console.error(`${path.relative(ROOT, mainDb)} tidak ada. Pakai --data <folder data server>.`);
  process.exit(1);
}
const db = new DatabaseSync(mainDb, { readOnly: true });

const requests = db.prepare(`
  SELECT r.id, r.user_id, r.project_id, r.created_at, r.model, r.checks, p.slug
  FROM ai_requests r JOIN projects p ON p.id = r.project_id
  WHERE r.action = 'build' AND r.status = 'ok' AND r.checks LIKE '%"left"%' AND r.created_at >= ?
  ORDER BY r.created_at DESC`).all(Date.now() - days * 86400_000)
  .filter((r) => !kinds.length || Object.keys(JSON.parse(r.checks).left ?? {}).some((k) => kinds.includes(k)))
  .slice(0, limit);

// Pesan AI job ini: pesan Builder terakhir di project itu yang dibuat sebelum request dicatat (dicatat saat selesai).
const assistantOf = db.prepare(`
  SELECT m.* FROM ai_messages m JOIN ai_threads t ON t.id = m.thread_id
  WHERE t.project_id = ? AND m.user_id = ? AND m.role = 'assistant' AND m.mode = 'build' AND m.created_at <= ?
  ORDER BY m.created_at DESC, m.id DESC LIMIT 1`);
const promptOf = db.prepare("SELECT * FROM ai_messages WHERE thread_id = ? AND id < ? AND role = 'user' ORDER BY id DESC LIMIT 1");
const historyOf = db.prepare(`
  SELECT role, mode, content, status, changes, apply_state, snapshot, attachments FROM ai_messages
  WHERE thread_id = ? AND id < ? AND status IN ('sent', 'done') ORDER BY id DESC LIMIT ?`);
// Isi project sebelum AI bekerja: versi 'ai' yang dibuat tepat sebelum perubahannya diterapkan (pasti), atau versi
// pertama sesudahnya — dibuat sebelum perubahan berikutnya, jadi biasanya sama (perkiraan).
const versionAi = db.prepare("SELECT * FROM versions WHERE project_id = ? AND kind = 'ai' AND created_at BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 1");
const versionAfter = db.prepare('SELECT * FROM versions WHERE project_id = ? AND created_at > ? ORDER BY created_at, id LIMIT 1');
const versionBefore = db.prepare('SELECT * FROM versions WHERE project_id = ? AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 1');

function description(raw) {
  try {
    return JSON.parse(raw ?? 'null')?.description || '';
  } catch {
    return '';
  }
}

// Struktur database project tanpa isi baris (kiriman pengunjung tidak ikut tersalin).
function copySchema(slug, dest) {
  const src = path.join(dataDir, 'db', `${slug}.db`);
  if (!fs.existsSync(src)) return false;
  const from = new DatabaseSync(src, { readOnly: true });
  from.exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
  from.close();
  const copy = new DatabaseSync(dest);
  for (const { name } of copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_rakit%' ESCAPE '\\'").all()) {
    copy.exec(`DELETE FROM "${name.replaceAll('"', '""')}"`);
  }
  copy.exec('VACUUM');
  copy.close();
  return true;
}

let written = 0;
for (const r of requests) {
  const id = `r${r.id}`;
  const assistant = assistantOf.get(r.project_id, r.user_id, r.created_at);
  const user = assistant && promptOf.get(assistant.thread_id, assistant.id);
  if (!user) {
    console.log(`- ${id}: pesan percakapannya sudah tidak ada, dilewati`);
    continue;
  }
  let version = versionAi.get(r.project_id, assistant.created_at, r.created_at);
  let source = 'pasti';
  if (!version) [version, source] = [versionAfter.get(r.project_id, r.created_at), 'perkiraan (versi sesudahnya)'];
  if (!version) [version, source] = [versionBefore.get(r.project_id, r.created_at), 'perkiraan (versi sebelumnya)'];
  if (!version) {
    console.log(`- ${id}: tidak ada riwayat versi project ${r.slug}, dilewati`);
    continue;
  }

  const caseDir = path.join(outDir, id);
  fs.rmSync(caseDir, { recursive: true, force: true });
  const siteDir = path.join(caseDir, 'site');
  let missing = 0;
  for (const [rel, entry] of Object.entries(JSON.parse(version.manifest).files ?? {})) {
    const blob = path.join(dataDir, 'versions', r.slug, entry.h.slice(0, 2), entry.h);
    if (!fs.existsSync(blob)) {
      missing++;
      continue;
    }
    fs.mkdirSync(path.dirname(path.join(siteDir, rel)), { recursive: true });
    fs.copyFileSync(blob, path.join(siteDir, rel));
  }
  fs.mkdirSync(siteDir, { recursive: true });
  const hasDb = copySchema(r.slug, path.join(caseDir, 'db.sqlite'));

  // Prompt seperti yang dibaca model: deskripsi gambar lampiran ikut (gambarnya sendiri tidak bisa diputar ulang).
  let prompt = user.content;
  const seen = description(user.attachments);
  if (seen) prompt += `\n\n[Gambar yang dilampirkan pengguna — deskripsi dari AI penglihatan]\n${seen}`;
  const history = historyOf.all(assistant.thread_id, user.id, MAX_HISTORY).reverse().map((m) => ({
    role: m.role, mode: m.mode, content: m.content, status: m.status, changes: m.changes, apply_state: m.apply_state,
    snapshot: m.snapshot, description: description(m.attachments) || undefined,
  }));
  const checks = JSON.parse(r.checks);
  const meta = {
    id,
    prompt,
    history,
    site: 'site',
    db: hasDb ? 'db.sqlite' : undefined,
    source: { request: r.id, project: r.slug, createdAt: new Date(r.created_at).toISOString(), files: source, missingFiles: missing || undefined },
    original: { model: r.model, checks, reply: assistant.content },
    blocks: (() => { try { return JSON.parse(user.attachments ?? 'null')?.blocks; } catch { return undefined; } })(),
  };
  fs.writeFileSync(path.join(caseDir, 'case.json'), JSON.stringify(meta, null, 2));
  written++;
  console.log(`✓ ${id} · ${r.slug} · tersisa ${JSON.stringify(checks.left)} · isi file ${source}${missing ? ` · ${missing} file hilang` : ''}`);
}
db.close();
console.log(`\n${written} kasus di ${path.relative(ROOT, outDir)} (dari ${requests.length} job bermasalah, ${days} hari terakhir).`);
console.log('Jalankan: npm run ai:eval -- --real');
