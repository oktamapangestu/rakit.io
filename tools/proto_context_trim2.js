// Prototipe: ukur & pangkas pembengkakan konteks pada agent loop runBuilder.
// TIDAK mengubah produksi. Simulasi atas data project nyata untuk membuktikan penghematan.
//
// Hipotesis: pada runBuilder, `convo` tumbuh tiap putaran. Setiap putaran mengirim ULANG
// seluruh convo ke API — termasuk argumen write_file (seluruh isi file) yang di-echo balik
// sebagai tool_calls assistant. Ini membuat biaya input membengkak dan berulang.

import fs from 'fs';
import path from 'path';

const tok = (s) => Math.ceil((typeof s === 'number' ? s : (s || '').length) / 4);
const BASE = '/srv/rakit/data/sites';

function projectFiles(slug, limitChars = 200000) {
  const root = path.join(BASE, slug);
  const out = [];
  const allow = /\.(html|css|js|json|md|txt|svg)$/i;
  const walk = (dir) => {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!allow.test(e.name)) continue;
      try { out.push({ path: path.relative(root, p), content: fs.readFileSync(p, 'utf8') }); } catch {}
    }
  };
  walk(root);
  out.sort((a, b) => a.content.length - b.content.length);
  let budget = limitChars; const keep = [];
  for (const f of out) { if (f.content.length > budget) break; budget -= f.content.length; keep.push(f); }
  return keep;
}

// Simulasi: model menulis beberapa file (ukuran realistis 4-20 KB). Setiap putaran mengirim
// ulang seluruh convo. 'asli' = echo seluruh isi file di tool_calls; 'ringkas' = hanya keterangan.
function simulate({ files, writeSizes, mode }) {
  const context = files.map((f) => `### ${f.path}\n${f.content}`).join('\n\n');
  const SYSTEM = 8754, TOOLS = 3000;
  const base = SYSTEM + TOOLS + context.length;
  const convo = [];
  let totalInputChars = 0; const perRound = [];

  for (let round = 0; round < writeSizes.length; round++) {
    const sizeChars = writeSizes[round];
    const convoChars = convo.reduce((s, m) => s + m.length, 0);
    const sentChars = base + convoChars;
    totalInputChars += sentChars;
    perRound.push({ round: round + 1, sizeChars, sentChars });
    convo.push(mode === 'asli' ? 'X'.repeat(sizeChars) : `Menulis file ${(sizeChars/1024).toFixed(1)} KB`);
    convo.push(`OK ${(sizeChars/1024).toFixed(1)} KB`);
  }
  return { totalInputChars, tokens: tok(totalInputChars), perRound };
}

const slugs = fs.readdirSync(BASE).filter((s) => { try { return fs.statSync(path.join(BASE, s)).isDirectory(); } catch { return false; } });
const info = slugs.map((s) => ({ slug: s, files: projectFiles(s) }))
  .filter((x) => x.files.length >= 4)
  .sort((a, b) => b.files.length - a.files.length).slice(0, 8);

const writeSizes = [4000, 6000, 8000, 12000, 20000];

console.log('=== SIMULASI AGENT LOOP: echo isi file (asli) vs ringkas ===\n');
let sumA = 0, sumB = 0;
for (const x of info) {
  const a = simulate({ files: x.files, writeSizes, mode: 'asli' });
  const b = simulate({ files: x.files, writeSizes, mode: 'ringkas' });
  sumA += a.tokens; sumB += b.tokens;
  const save = (100 * (1 - b.tokens / a.tokens)).toFixed(0);
  console.log(`${x.slug.padEnd(28)} file=${String(x.files.length).padStart(3)} konteks=${(x.files.reduce((s,f)=>s+f.content.length,0)/1000).toFixed(0).padStart(3)}kb  asli=${a.tokens.toString().padStart(7)} tok  ringkas=${b.tokens.toString().padStart(7)} tok  hemat ${save}%`);
}
console.log('\n=== TOTAL 8 PROJECT (5 file ditulis, ukuran 4-20 KB) ===');
console.log(`asli   : ${sumA.toLocaleString()} token input`);
console.log(`ringkas: ${sumB.toLocaleString()} token input`);
console.log(`HEMAT  : ${(100 * (1 - sumB / sumA)).toFixed(1)}%`);

const one = simulate({ files: info[0].files, writeSizes, mode: 'asli' });
const two = simulate({ files: info[0].files, writeSizes, mode: 'ringkas' });
console.log(`\n=== DETAIL per putaran (${info[0].slug}) ===`);
console.log(' putaran | file ditulis | asli (kchar) | ringkas (kchar)');
one.perRound.forEach((r, i) => {
  console.log(`    ${r.round}     | ${(r.sizeChars/1024).toFixed(1).padStart(7)} KB   | ${(r.sentChars/1000).toFixed(1).padStart(12)} | ${(two.perRound[i].sentChars/1000).toFixed(1).padStart(14)}`);
});
console.log(`\n>> Penghematan absolut: ${(sumA-sumB).toLocaleString()} token input untuk 8 job.`);
console.log(`>> = ${Math.round((sumA-sumB)/8).toLocaleString()} token rata-rata per job build.`);
