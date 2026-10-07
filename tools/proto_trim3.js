// Prototipe 3: bandingkan strategi pangkas konteks pada agent loop, ukur penghematan NYATA.
// TIDAK mengubah produksi.

import fs from 'fs';
import path from 'path';
const tok = (s) => Math.ceil((typeof s === 'number' ? s : (s || '').length) / 4);
const BASE = '/srv/rakit/data/sites';

function projectFiles(slug, limitChars = 200000) {
  const root = path.join(BASE, slug); const out = [];
  const allow = /\.(html|css|js|json|md|txt|svg)$/i;
  (function walk(dir) {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!allow.test(e.name)) continue;
      try { out.push({ path: path.relative(root, p), content: fs.readFileSync(p, 'utf8') }); } catch {}
    }
  })(root);
  out.sort((a, b) => a.content.length - b.content.length);
  let budget = limitChars; const keep = [];
  for (const f of out) { if (f.content.length > budget) break; budget -= f.content.length; keep.push(f); }
  return keep;
}

const SYSTEM = 8754, TOOLS = 3000;

// Strategi:
//  A "asli"        : setiap putaran kirim [system+tools+context+convo]
//  B "ringkas-arg" : idem tapi argumen tool (echo isi file) diringkas
//  C "ctx-sekali"  : konteks project HANYA di putaran 1; putaran berikutnya system+tools+convo
//  D "B+C"         : keduanya
function run({ files, writeSizes, strategy }) {
  const context = files.map((f) => `### ${f.path}\n${f.content}`).join('\n\n');
  const ctxOnce = strategy === 'C' || strategy === 'D';
  const trimArg = strategy === 'B' || strategy === 'D';
  const convo = []; let total = 0; const per = [];

  for (let r = 0; r < writeSizes.length; r++) {
    const convoChars = convo.reduce((s, m) => s + m.length, 0);
    const includeCtx = ctxOnce ? (r === 0) : true;
    const sent = SYSTEM + TOOLS + (includeCtx ? context.length : 0) + convoChars;
    total += sent;
    per.push(sent);
    const size = writeSizes[r];
    convo.push(trimArg ? `Tulis ${(size/1024).toFixed(1)}KB` : 'X'.repeat(size));
    convo.push(`OK ${(size/1024).toFixed(1)}KB`);
  }
  return { total, tok: tok(total), per };
}

const slugs = fs.readdirSync(BASE).filter((s) => { try { return fs.statSync(path.join(BASE, s)).isDirectory(); } catch { return false; } });
const info = slugs.map((s) => ({ slug: s, files: projectFiles(s) })).filter((x) => x.files.length >= 4);
const writeSizes = [4000, 6000, 8000, 12000, 20000]; // 5 file

console.log('=== 4 STRATEGI PANGKAS KONTEKS (5 file ditulis per job) ===\n');
const sums = { A: 0, B: 0, C: 0, D: 0 };
const rows = [];
for (const x of info) {
  const A = run({ files: x.files, writeSizes, strategy: 'A' });
  const B = run({ files: x.files, writeSizes, strategy: 'B' });
  const C = run({ files: x.files, writeSizes, strategy: 'C' });
  const D = run({ files: x.files, writeSizes, strategy: 'D' });
  sums.A += A.tok; sums.B += B.tok; sums.C += C.tok; sums.D += D.tok;
  rows.push({ slug: x.slug, n: x.files.length, ctx: x.files.reduce((s,f)=>s+f.content.length,0), A: A.tok, B: B.tok, C: C.tok, D: D.tok });
}
rows.sort((a,b)=>b.ctx-a.ctx).slice(0,6).forEach(r => {
  console.log(`${r.slug.padEnd(26)} ctx=${(r.ctx/1000).toFixed(0).padStart(3)}kb | asli=${r.A.toString().padStart(7)} | ringkasarg=${r.B.toString().padStart(7)} | ctxsekali=${r.C.toString().padStart(7)} | B+C=${r.D.toString().padStart(7)}`);
});
const n = info.length;
console.log(`\n=== RATA-RATA PER JOB (${n} project) ===`);
console.log(`  A asli            : ${Math.round(sums.A/n).toLocaleString().padStart(9)} token input`);
console.log(`  B ringkas-argumen : ${Math.round(sums.B/n).toLocaleString().padStart(9)} token  (hemat ${(100*(1-sums.B/sums.A)).toFixed(1)}%)`);
console.log(`  C konteks-sekali  : ${Math.round(sums.C/n).toLocaleString().padStart(9)} token  (hemat ${(100*(1-sums.C/sums.A)).toFixed(1)}%)`);
console.log(`  D B+C             : ${Math.round(sums.D/n).toLocaleString().padStart(9)} token  (hemat ${(100*(1-sums.D/sums.A)).toFixed(1)}%)`);

// Proyeksi ke data nyata: total input 30 hari = 68,1 juta tok untuk 1511 request
console.log('\n=== PROYEKSI KE PEMAKAIAN NYATA (68,1 juta token input / 30 hari) ===');
const realIn = 68094186;
for (const [k, v] of [['B', sums.B/sums.A], ['C', sums.C/sums.A], ['D', sums.D/sums.A]]) {
  const saved = realIn * (1 - v);
  console.log(`  Strategi ${k}: hemat ~${(saved/1e6).toFixed(1)} juta token input/bulan (${((1-v)*100).toFixed(0)}%)`);
}
