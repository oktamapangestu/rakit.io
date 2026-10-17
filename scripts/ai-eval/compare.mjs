// Gabungkan hasil beberapa run evaluasi (report.json dari run.mjs) jadi satu perbandingan per mesin dan per kasus,
// mis. Builder & Pi dari satu run dan OpenHands dari run lain dengan model yang sama.
//
//   node scripts/ai-eval/compare.mjs data/ai-eval/<run-1> data/ai-eval/<run-2> …
//
// Kalau satu kasus dari satu mesin muncul di beberapa run (mis. dijalankan ulang), yang dipakai run terakhir di
// daftar. Model yang berbeda antar-run ditandai, karena hasilnya tidak bisa dibandingkan langsung.
import fs from 'node:fs';
import path from 'node:path';

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('Pakai: node scripts/ai-eval/compare.mjs <folder run> [<folder run> …]');
  process.exit(1);
}

const byEngine = new Map(); // mesin → Map(id kasus → hasil)
for (const dir of dirs) {
  const { results } = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'));
  for (const r of results) {
    const engine = r.engine ?? 'builder';
    if (!byEngine.has(engine)) byEngine.set(engine, new Map());
    byEngine.get(engine).set(r.id, r);
  }
}
const engines = [...byEngine.keys()];
const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const failures = (r) => [
  r.status !== 'ok' ? r.status : '',
  sum(r.left) ? `tersisa ${Object.keys(r.left).join('/')}` : '',
  r.must?.some((m) => !m.ok) ? 'cek isi' : '',
  r.missingTable ? 'tanpa tabel' : '',
  r.outOfScope?.length ? 'luar lingkup' : '',
].filter(Boolean);

const models = new Set();
const rows = [];
for (const engine of engines) {
  const list = [...byEngine.get(engine).values()];
  const ok = list.filter((r) => r.status === 'ok');
  list.forEach((r) => r.model && models.add(r.model));
  const avg = (fn) => ok.reduce((a, r) => a + fn(r), 0) / Math.max(1, ok.length);
  rows.push({
    engine,
    model: [...new Set(list.map((r) => r.model).filter(Boolean))].join(', '),
    'lolos semua cek': `${list.filter((r) => !failures(r).length).length}/${list.length}`,
    'masalah kode tersisa': ok.reduce((a, r) => a + sum(r.left), 0),
    'cek isi gagal': ok.filter((r) => r.must?.some((m) => !m.ok)).length,
    'tanpa tabel': ok.filter((r) => r.missingTable).length,
    'luar lingkup': ok.filter((r) => r.outOfScope?.length).length,
    'uji sendiri (kasus)': list[0]?.sandbox ? ok.filter((r) => r.sandbox?.selfTests).length : '-',
    'masalah runtime': list.some((r) => r.runtime) ? ok.reduce((a, r) => a + (r.runtime?.problems ?? 0), 0) : '-',
    'rata-rata token': Math.round(avg((r) => r.inTokens + r.outTokens)),
    'rata-rata waktu': `${Math.round(avg((r) => r.secs))} dtk`,
  });
}

const col = 22;
const labels = Object.keys(rows[0]).filter((k) => k !== 'engine');
console.log(`${''.padEnd(24)}${engines.map((e) => e.padEnd(col)).join('')}`);
for (const label of labels) console.log(`${label.padEnd(24)}${rows.map((r) => String(r[label]).padEnd(col)).join('')}`);
if (models.size > 1) console.log(`\n⚠ Model berbeda antar-mesin (${[...models].join(', ')}): hasil tidak sebanding langsung.`);

console.log('\nPer kasus (✓ = lolos semua cek):');
const ids = [...new Set(engines.flatMap((e) => [...byEngine.get(e).keys()]))].sort();
console.log(`${''.padEnd(24)}${engines.map((e) => e.padEnd(col)).join('')}`);
for (const id of ids) {
  console.log(`${id.padEnd(24)}${engines.map((e) => {
    const r = byEngine.get(e).get(id);
    if (!r) return '-'.padEnd(col);
    const f = failures(r);
    return (f.length ? `✗ ${f.join(', ')}` : '✓').slice(0, col - 1).padEnd(col);
  }).join('')}`);
}
