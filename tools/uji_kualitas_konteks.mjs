// UJI A/B KUALITAS: apakah "konteks hanya di putaran 1" merusak hasil?
// Menguji ke model nyata dengan skenario build realistis (agent loop 3 putaran).
// Mode A: konteks project dikirim tiap putaran. Mode C: hanya putaran 1.
// Bandingkan: apakah model tetap menghasilkan file benar + konsisten.

import fs from 'fs';
import path from 'path';

const env = {};
for (const line of fs.readFileSync('/srv/rakit/.env', 'utf8').split('\n')) {
  const t = line.trim();
  if (t && !t.startsWith('#') && t.includes('=')) {
    const i = t.indexOf('='); env[t.slice(0, i).trim()] = t.slice(i + 1);
  }
}
const BASE = (env.AI_BASE_URL || '').replace(/\/$/, '');
const KEY = env.AI_API_KEY;
const MODEL = 'deepseek-v4-pro';

async function chat(messages, tools) {
  const body = { model: MODEL, messages, temperature: 0 };
  if (tools) body.tools = tools;
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  return j.choices?.[0]?.message || {};
}

const TOOLS = [{
  type: 'function',
  function: {
    name: 'write_file',
    description: 'Tulis satu file lengkap ke project.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
}];

// Konteks project sintetis (mirip project nyata kecil)
const PROJECT = `### index.html
<!doctype html><html><head><title>Toko Kue</title></head><body><h1>Toko Kue</h1><div id="app"></div></body></html>

### css/style.css
body{font-family:sans-serif;margin:0;padding:20px;background:#fafafa}

### js/app.js
console.log('toko kue siap');`;

const SYS = 'Kamu asisten pembuat website. Tulis file lengkap via tool write_file. Satu file per panggilan.';

async function runJob(mode) {
  const convo = [];
  const results = [];
  const tasks = [
    'Tambahkan file about.html berisi halaman "Tentang Kami" dengan judul dan paragraf singkat.',
    'Sekarang tambahkan file js/menu.js yang menampilkan daftar 3 menu kue (array + render ke #app... abaikan jika tidak relevan).',
    'Terakhir tambahkan css/about.css untuk halaman about.',
  ];
  for (let round = 0; round < tasks.length; round++) {
    const msgs = [{ role: 'system', content: SYS }];
    // konteks project
    if (mode === 'A' || round === 0) msgs.push({ role: 'user', content: `Isi project sekarang:\n${PROJECT}` });
    else msgs.push({ role: 'user', content: '(Isi project tidak dikirim ulang. Ingat dari percakapan.)' });
    msgs.push(...convo);
    msgs.push({ role: 'user', content: tasks[round] });
    const reply = await chat(msgs, TOOLS);
    const tc = reply.tool_calls?.[0];
    convo.push({ role: 'assistant', content: reply.content || '', tool_calls: reply.tool_calls || [] });
    if (tc) {
      let args = {}; try { args = JSON.parse(tc.function.arguments); } catch {}
      convo.push({ role: 'tool', tool_call_id: tc.id, content: `File ${args.path || '?'} tersimpan.` });
      results.push({ round: round + 1, path: args.path, contentLen: (args.content || '').length, preview: (args.content || '').slice(0, 120) });
    } else {
      results.push({ round: round + 1, path: null, contentLen: 0, preview: reply.content?.slice(0, 120) });
    }
  }
  return results;
}

console.log('=== UJI A/B KUALITAS: konteks tiap putaran (A) vs sekali (C) ===\n');
for (const mode of ['A', 'C']) {
  console.log(`\n----- MODE ${mode} -----`);
  const r = await runJob(mode);
  r.forEach((x) => console.log(`  putaran ${x.round}: path=${x.path} len=${x.contentLen}  | ${x.preview?.replace(/\n/g, ' ').slice(0, 90)}`));
  const okCount = r.filter((x) => x.path && x.contentLen > 50).length;
  console.log(`  >> ${okCount}/${r.length} putaran menghasilkan file valid`);
}
