// Prototipe: ukur & pangkas pembengkakan konteks pada agent loop runBuilder.
// TIDAK mengubah produksi. Hanya simulasi atas data nyata untuk membuktikan penghematan.
//
// Hipotesis: pada runBuilder, `convo` tumbuh tiap putaran. Setiap putaran mengirim ULANG
// seluruh convo ke API — termasuk argumen write_file (seluruh isi file) yang di-echo balik
// sebagai tool_calls assistant + hasil tool. Ini membuat biaya input membengkak (kuadratik).
//
// Prototipe ini: (a) menghitung ukuran convo per putaran apa adanya, (b) menghitung ukuran
// jika isi file di riwayat DI-RINGKAS (karena model sudah tahu apa yang baru saja ia tulis).

import fs from 'fs';
import path from 'path';

// ---------- Estimasi token: ~4 karakter/token (konservatif untuk campuran kode) ----------
const tok = (s) => Math.ceil((s || '').length / 4);

// ---------- Ambil data file nyata dari project produksi ----------
function projectFiles(slug, limitChars = 200000) {
  const root = path.join('/srv/rakit/data/sites', slug);
  const out = [];
  const allow = /\.(html|css|js|json|md|txt|svg)$/i;
  const walk = (dir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!allow.test(e.name)) continue;
      try { out.push({ path: path.relative(root, p), content: fs.readFileSync(p, 'utf8') }); } catch {}
    }
  };
  walk(root);
  out.sort((a, b) => a.content.length - b.content.length); // kecil dulu (seperti projectContext)
  let budget = limitChars;
  const keep = [];
  for (const f of out) {
    if (f.content.length > budget) break;
    budget -= f.content.length;
    keep.push(f);
  }
  return keep;
}

// ---------- Simulasi satu job build ----------
// Model menulis N file (satu per putaran). Setiap putaran kirim ulang seluruh convo.
function simulate({ slug, filesToWrite, mode = 'asli' }) {
  const files = projectFiles(slug);
  const context = files.map((f) => `### ${f.path}\n${f.content}`).join('\n\n');
  const SYSTEM = 8754;              // PROMPTS[mode] ≈ 8.7k char
  const TOOLS = 3000;               // definisi 4 tools
  const base = SYSTEM + TOOLS + context.length;

  const convo = [];                 // riwayat yang tumbuh (di luar system+tools+context)
  let totalInputChars = 0;
  const perRound = [];

  // ambil N file terbesar dari project sebagai "yang ditulis model"
  const targets = [...files].sort((a, b) => b.content.length - a.content.length).slice(0, filesToWrite);

  for (let round = 0; round < targets.length; round++) {
    const t = targets[round];
    // ukuran yang DIKIRIM pada putaran ini = system + tools + context + seluruh convo sejauh ini
    const convoChars = convo.reduce((s, m) => s + (m.content?.length || 0), 0);
    const sentChars = base + convoChars;
    totalInputChars += sentChars;
    perRound.push({ round: round + 1, file: t.path, fileChars: t.content.length, sentChars });

    // --- dorong isi convo seperti runBuilder ---
    // assistant: teks + tool_calls (berisi ARGUMEN = seluruh isi file!)
    const asstContent = mode === 'asli'
      ? t.content.length                      // echo isi file penuh
      : `Menulis ${t.path} (${(t.content.length / 1024).toFixed(1)} KB)`;   // ringkas
    convo.push({ role: 'assistant', content: asstContent });
    // tool result: stageToolCall mengembalikan konfirmasi singkat (bukan isi file) -> sama di kedua mode
    convo.push({ role: 'tool', content: `Menulis ${t.path}: ${(t.content.length / 1024).toFixed(1)} KB` });
  }

  return { totalInputChars, perRound, tokens: tok(totalInputChars) };
}

// ---------- Jalankan pada beberapa project nyata ----------
const base = '/srv/rakit/data/sites';
const slugs = fs.readdirSync(base).filter((s) => {
  try { return fs.statSync(path.join(base, s)).isDirectory(); } catch { return false; }
});
// pilih project dengan >=4 file agar ada beberapa putaran
const sample = [];
for (const s of slugs) {
  const f = projectFiles(s);
  if (f.length >= 4) sample.push({ slug: s, n: f.length, chars: f.reduce((a, x) => a + x.content.length, 0) });
}
sample.sort((a, b) => b.chars - a.chars);
const picks = sample.slice(0, 8);

console.log('=== SIMULASI AGENT LOOP (asli vs ringkas) ===\n');
let sumA = 0, sumB = 0, sumToksA = 0, sumToksB = 0;
for (const p of picks) {
  const a = simulate({ slug: p.slug, filesToWrite: 5, mode: 'asli' });
  const b = simulate({ slug: p.slug, filesToWrite: 5, mode: 'ringkas' });
  sumA += a.totalInputChars; sumB += b.totalInputChars;
  sumToksA += a.tokens; sumToksB += b.tokens;
  const save = ((1 - b.totalInputChars / a.totalInputChars) * 100).toFixed(0);
  console.log(`${p.slug.padEnd(26)} file=${String(p.n).padStart(3)}  ` +
    `asli=${(a.tokens).toString().padStart(8)} tok  ringkas=${(b.tokens).toString().padStart(8)} tok  hemat ${save}%`);
}
console.log('\n=== TOTAL 8 PROJECT (5 file ditulis, 8 putaran maks) ===');
console.log(`asli   : ${sumToksA.toLocaleString()} token input`);
console.log(`ringkas: ${sumToksB.toLocaleString()} token input`);
console.log(`HEMAT  : ${((1 - sumToksB / sumToksA) * 100).toFixed(1)}%`);

// Detail satu contoh
console.log('\n=== DETAIL per putaran (project terbesar) ===');
const one = simulate({ slug: picks[0].slug, filesToWrite: 5, mode: 'asli' });
const two = simulate({ slug: picks[0].slug, filesToWrite: 5, mode: 'ringkas' });
console.log('putaran | file                     | asli(k char) | ringkas(k char)');
for (let i = 0; i < one.perRound.length; i++) {
  console.log(`   ${one.perRound[i].round}    | ${one.perRound[i].file.padEnd(24)} | ${(one.perRound[i].sentChars/1000).toFixed(1).padStart(12)} | ${(two.perRound[i].sentChars/1000).toFixed(1).padStart(14)}`);
}
