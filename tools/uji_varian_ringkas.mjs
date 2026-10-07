// Uji varian C2: konteks penuh di putaran 1, lalu konteks RINGKAS (daftar file saja) di putaran lanjut.
// Tujuan: pertahankan pemahaman struktur project tanpa mengirim isi file penuh berulang.
// Menguji apakah model tetap konsisten soal PATH file (masalah yang muncul di mode C).

import fs from 'fs';
const env = {};
for (const line of fs.readFileSync('/srv/rakit/.env', 'utf8').split('\n')) {
  const t = line.trim();
  if (t && !t.startsWith('#') && t.includes('=')) { const i = t.indexOf('='); env[t.slice(0, i).trim()] = t.slice(i + 1); }
}
const BASE = (env.AI_BASE_URL || '').replace(/\/$/, ''); const KEY = env.AI_API_KEY;
const MODEL = 'deepseek-v4-pro';

async function chat(messages, tools) {
  const body = { model: MODEL, messages, temperature: 0 };
  if (tools) body.tools = tools;
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body),
  });
  const j = await r.json(); return j.choices?.[0]?.message || {};
}
const TOOLS = [{ type: 'function', function: { name: 'write_file', description: 'Tulis satu file lengkap.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } }];

const PROJECT = `### index.html
<!doctype html><html><head><title>Toko Kue</title></head><body><h1>Toko Kue</h1><div id="app"></div><script src="js/app.js"></script></body></html>
### css/style.css
body{font-family:sans-serif;margin:0;padding:20px;background:#fafafa}
### js/app.js
console.log('toko kue siap');`;
const FILES_RINGKAS = `File project: index.html, css/style.css, js/app.js`;
const SYS = 'Kamu asisten pembuat website. Tulis file lengkap via tool write_file. Satu file per panggilan.';
const tasks = [
  'Tambahkan about.html (halaman Tentang Kami).',
  'Tambahkan js/menu.js yang menampilkan 3 menu kue ke #app.',
  'Tambahkan css/about.css untuk halaman about.',
];

async function run(strategy) {
  const convo = []; const out = [];
  for (let round = 0; round < tasks.length; round++) {
    const msgs = [{ role: 'system', content: SYS }];
    if (round === 0) msgs.push({ role: 'user', content: `Isi project:\n${PROJECT}` });
    else if (strategy === 'ringkas') msgs.push({ role: 'user', content: `Ingat struktur project. ${FILES_RINGKAS}. Ikuti struktur folder yang benar.` });
    else msgs.push({ role: 'user', content: '(Konteks tidak dikirim ulang.)' });
    msgs.push(...convo); msgs.push({ role: 'user', content: tasks[round] });
    const reply = await chat(msgs, TOOLS);
    const tc = reply.tool_calls?.[0];
    convo.push({ role: 'assistant', content: reply.content || '', tool_calls: reply.tool_calls || [] });
    let p = null; if (tc) { let a = {}; try { a = JSON.parse(tc.function.arguments); } catch {} p = a.path; convo.push({ role: 'tool', tool_call_id: tc.id, content: `File ${a.path} tersimpan.` }); }
    out.push({ round: round + 1, path: p });
  }
  return out;
}

console.log('=== UJI VARIAN: konteks hilang total vs konteks RINGKAS di putaran lanjut ===\n');
for (const s of ['hilang', 'ringkas']) {
  console.log(`--- strategi: ${s} ---`);
  const r = await run(s);
  r.forEach(x => console.log(`  putaran ${x.round}: path=${x.path}`));
  const paths = r.map(x => x.path);
  const benar = paths[1] === 'js/menu.js' && paths[2] === 'css/about.css';
  console.log(`  >> struktur path benar semua? ${benar ? 'YA ✓' : 'TIDAK ✗ (' + paths.join(', ') + ')'}\n`);
}
