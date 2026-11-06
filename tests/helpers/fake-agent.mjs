// Mesin agen tiruan untuk test mode Agen (tests/agent.test.mjs): dijalankan server lewat AI_AGENT_CMD sebagai ganti
// container Docker, dengan env & layanan host yang sama (RAKIT_UPSTREAMS berisi unix socket di host). Berbicara
// dengan protokol driver (baris "@@RAKIT {...}", lihat deploy/agent/claude_driver.mjs).
//
// Prompt pertama: memanggil proxy AI, membuat tabel "tamu", menulis index.html (form buku tamu) + app.js, membuka
// halaman lewat layanan site, lalu selesai. Prompt berisi "[form-rusak]": form tidak menyimpan (app.js tanpa fetch) —
// pemeriksaan server harus mengembalikannya, dan prompt berikutnya memperbaikinya. Prompt berisi "[tanya]": agen
// bertanya lewat ask_user (sekali dengan argumen salah, lalu benar), menunggu jawaban, dan menulis judul sesuai jawaban.
// Prompt berisi "[catatan]": menjawab dengan isi <project-notes> di AGENTS.md (atau "tanpa catatan") tanpa mengubah file.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';

const ws = process.env.RAKIT_WORKSPACE;
// Alamat layanan: "unix:/path.sock" (container) atau "tcp:127.0.0.1:port" (runtime lokal tanpa Docker).
const upstream = Object.fromEntries(process.env.RAKIT_UPSTREAMS.split(',').map((e) => {
  const [name, target] = e.split('=');
  if (target.startsWith('tcp:')) {
    const [host, port] = target.slice(4).split(':');
    return [name, { host, port: Number(port) }];
  }
  return [name, { socketPath: target.replace(/^unix:/, '') }];
}));
const emit = (obj) => process.stdout.write(`@@RAKIT ${JSON.stringify(obj)}\n`);

function call(name, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...upstream[name], method, path: urlPath, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dari-container' } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<script defer src="/app.js"></script><script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.17.4/dist/cdn.min.js"></script></head>
<body><form x-data="tamu" @submit.prevent="kirim"><input x-model="nama"><textarea x-model="pesan"></textarea><button>Kirim</button></form></body></html>`;
const saving = "document.addEventListener('alpine:init', () => { Alpine.data('tamu', () => ({ nama: '', pesan: '', async kirim() { await fetch('/api/db/tamu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nama: this.nama, pesan: this.pesan }) }); } })); });\n";
const broken = "document.addEventListener('alpine:init', () => { Alpine.data('tamu', () => ({ nama: '', pesan: '', kirim() { this.nama = ''; } })); });\n";

let turn = 0;
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  const cmd = JSON.parse(line);
  if (cmd.type !== 'prompt') return;
  turn++;
  if (cmd.message.includes('[catatan]')) {
    const md = fs.readFileSync(path.join(ws, 'AGENTS.md'), 'utf8');
    const notes = /<project-notes>\n([\s\S]*?)\n<\/project-notes>/.exec(md)?.[1];
    emit({ type: 'settled', text: notes ? `Catatan: ${notes}` : 'tanpa catatan', usage: { prompt: 0, completion: 0 } });
    return;
  }
  if (turn === 1 && cmd.message.includes('[tanya]')) {
    emit({ type: 'tool', name: 'mcp__rakit__ask_user', args: { question: 'Satu pilihan saja?' }, response: 'q1' });
    const bad = await call('tools', 'POST', '/ask_user', { question: 'Satu pilihan saja?', options: [{ label: 'Ya' }] });
    emit({ type: 'result', name: '', error: bad.status !== 200, text: bad.text });
    emit({ type: 'tool', name: 'mcp__rakit__ask_user', args: { question: 'Judulnya mau apa?' }, response: 'q2' });
    const ask = await call('tools', 'POST', '/ask_user', { question: 'Judulnya mau apa?', options: [{ label: 'Halo Dunia', description: 'Sapaan singkat' }, { label: 'Selamat Datang' }] });
    emit({ type: 'result', name: '', error: ask.status !== 200, text: ask.text });
    if (ask.status !== 200) {
      emit({ type: 'settled', text: `Gagal bertanya: ${ask.status} ${ask.text}`, usage: { prompt: 0, completion: 0 } });
      return;
    }
    const title = /"(.*)"/.exec(ask.text)?.[1] ?? 'Tanpa jawaban';
    emit({ type: 'tool', name: 'Edit', args: { file_path: '/workspace/index.html' }, response: 'q3' });
    const html = fs.readFileSync(path.join(ws, 'index.html'), 'utf8').replace(/<h1>[\s\S]*?<\/h1>/, `<h1>${title}</h1>`);
    fs.writeFileSync(path.join(ws, 'index.html'), html);
    emit({ type: 'result', name: '', error: false, text: 'ok' });
    emit({ type: 'settled', text: `Judul diganti jadi "${title}". (${bad.status}: ${bad.text})`, usage: { prompt: 0, completion: 0 } });
    return;
  }
  if (turn === 1) {
    const ai = await call('ai', 'POST', '/v1/chat/completions', { model: 'model-dari-container', stream: true, messages: [{ role: 'user', content: cmd.message.slice(0, 200) }] });
    emit({ type: 'tool', name: 'Bash', args: { command: 'curl ai' }, response: 'r1' });
    emit({ type: 'result', name: '', error: ai.status !== 200, text: `ai ${ai.status}` });

    emit({ type: 'tool', name: 'mcp__rakit__create_table', args: { name: 'tamu' }, response: 'r2' });
    const table = await call('tools', 'POST', '/create_table', { name: 'tamu', columns: [{ name: 'nama', type: 'text' }, { name: 'pesan', type: 'text' }, { name: 'foto', type: 'picture' }], public: ['list', 'create'] });
    emit({ type: 'result', name: '', error: table.status !== 200, text: table.text });

    emit({ type: 'tool', name: 'Write', args: { file_path: '/workspace/index.html' }, response: 'r3' });
    fs.writeFileSync(path.join(ws, 'index.html'), page);
    fs.writeFileSync(path.join(ws, 'app.js'), cmd.message.includes('[form-rusak]') ? broken : saving);
    fs.writeFileSync(path.join(ws, 'catatan.md'), 'bukan file website'); // tidak didukung: diabaikan server
    emit({ type: 'result', name: '', error: false, text: 'ok' });

    const site = await call('site', 'GET', '/');
    const db = await call('site', 'GET', '/api/db/tamu');
    emit({ type: 'tool', name: 'Bash', args: { command: 'cek-halaman /' }, response: 'r4' });
    emit({ type: 'result', name: '', error: !site.text.includes('x-data="tamu"') || db.status !== 200, text: `site ${site.status} db ${db.status}` });
    emit({ type: 'settled', text: 'Buku tamu sudah dibuat.', usage: { prompt: 0, completion: 0 } });
    return;
  }
  // Prompt lanjutan dari pemeriksaan server: perbaiki form.
  emit({ type: 'tool', name: 'Edit', args: { file_path: '/workspace/app.js' }, response: `r${turn}0` });
  fs.writeFileSync(path.join(ws, 'app.js'), saving);
  emit({ type: 'result', name: '', error: false, text: 'ok' });
  emit({ type: 'settled', text: 'Form sekarang menyimpan ke database.', usage: { prompt: 0, completion: 0 } });
});
rl.on('close', () => process.exit(0));
