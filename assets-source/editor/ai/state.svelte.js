// Panel AI: keadaan & aksi (percakapan, prompt, job, lampiran gambar, kartu perubahan). Dipakai komponen di folder ini
// dan editor.js (kredit di header, tombol "Tanya AI" dari fitur lain, menu riwayat). connect() dipanggil editor.js
// sebelum panel dipasang.
import { createActivity } from './activity.svelte.js';

export const AI_MODES = {
  build: {
    title: 'Mau bikin apa hari ini?',
    intro: 'AI membaca semua file proyekmu lalu menulis atau mengubah kodenya. Kamu bisa cek dulu sebelum menerapkan.',
    placeholder: 'Minta AI membuat atau mengubah kode… (Enter kirim, Shift+Enter baris baru)',
    suggestions: [
      'Buat landing page portofolio yang modern',
      'Tambahkan navbar responsif dengan menu hamburger',
      'Tambahkan tombol dark mode',
      'Jelaskan kode di file yang sedang dibuka',
    ],
  },
  plan: {
    title: 'Rencanakan dulu, bangun kemudian',
    intro: 'Diskusikan idemu dengan AI tanpa mengubah file apa pun. Kalau rencananya sudah pas, jalankan dengan satu klik.',
    placeholder: 'Ceritakan website yang ingin kamu buat… AI tidak akan mengubah file.',
    suggestions: [
      'Rencanakan website toko online sederhana',
      'Halaman apa saja yang dibutuhkan untuk portofolio?',
      'Beri saran tampilan yang lebih menarik untuk websiteku',
      'Rencanakan website undangan pernikahan',
    ],
  },
};

// credits: undefined = belum dimuat, null = gagal dimuat. messages: isi percakapan yang tampil, berurutan —
// { kind: 'user' | 'reply' | 'error' | 'job' | 'activity' | 'notice', key, ... }. pendingId: jawaban yang perubahannya
// menunggu Simpan/Batalkan.
export const ai = $state({
  credits: undefined,
  busy: false, // ada job AI yang sedang diikuti editor ini
  jobId: null, // id pesan AI yang sedang berjalan
  threadId: null, // percakapan yang sedang dibuka
  mode: 'build', // 'build' (Builder) | 'plan' (Plan)
  images: [], // lampiran prompt berikutnya: [{ full, thumb }] (data URL JPEG)
  applying: false, // sedang Simpan/Batalkan
  input: '',
  messages: [],
  pendingId: null,
  scrollTick: 0,
});

let host; // context 'editor' + sambungan panel AI dari editor.js
let stream = null; // AbortController koneksi event (menutupnya TIDAK membatalkan job)
let seq = 0;
export function connect(editor) {
  host = editor;
  setMode(host.storageGet('rakit.aiMode', 'build'));
}

// Unlimited menghitung prompt, bukan kredit: selama jatah hari ini masih ada, prompt apa pun (dengan gambar pun)
// cukup memakai 1 dari jatah itu. Setelah habis, kredit biasa yang dipakai.
export const unlimitedLeft = (c) => c?.plan?.id === 'unlimited' && c.plan.quotaRemaining > 0;
export const canAfford = (c, cost) => unlimitedLeft(c) || c.remaining >= cost;
// Biaya prompt yang sedang disusun: prompt dengan gambar memakai lebih banyak kredit.
export const promptCost = () => (ai.images.length && ai.credits?.images ? ai.credits.images.cost : ai.credits?.costPerPrompt ?? 1);

export function setMode(mode) {
  ai.mode = mode === 'plan' ? 'plan' : 'build';
  host?.storageSet('rakit.aiMode', ai.mode);
}

const scroll = () => { ai.scrollTick += 1; };
const threadKey = () => `rakit.aiThread.${host.projectSlug()}`;
function add(item) {
  ai.messages.push({ ...item, key: ++seq });
  return ai.messages.at(-1);
}
function addReply(m) {
  if (m.mode !== 'plan' && m.changes?.length && m.applyState === 'pending') ai.pendingId = m.id;
  return add({ kind: 'reply', m });
}
const addError = (text, code) => add({ kind: 'error', text, code });

export function guardBusy() {
  if (!ai.busy) return false;
  host.toast('Tunggu AI selesai, atau tekan Stop dulu.', 'error');
  return true;
}

// Prompt baru = perubahan sebelumnya yang belum dikonfirmasi dianggap disimpan (server juga begitu).
function markKept() {
  const item = ai.messages.find((x) => x.kind === 'reply' && x.m.id === ai.pendingId);
  if (item) item.m.applyState = 'kept';
  ai.pendingId = null;
}

// ---------- Percakapan ----------

export function newConversation() {
  if (guardBusy()) return;
  ai.threadId = null;
  ai.pendingId = null;
  host.storageSet(threadKey(), 'new');
  ai.messages = [];
  host.focusInput();
}

function renderMessage(m) {
  if (m.role === 'user') add({ kind: 'user', mode: m.mode, content: m.content, images: m.images, blocks: m.blocks });
  else if (m.status === 'queued' || m.status === 'running') attachJob(m);
  else if (m.status === 'done') addReply(m);
  else addError(m.error || 'Gagal.');
}

export async function openThread(id) {
  let data;
  try {
    data = await host.api('GET', `/api/ai/threads/${id}`);
  } catch (err) {
    return host.toast(err.message, 'error');
  }
  ai.threadId = data.thread.id;
  ai.pendingId = null;
  host.storageSet(threadKey(), ai.threadId);
  ai.messages = [];
  data.messages.forEach(renderMessage);
  scroll();
}

// Saat editor dibuka: lanjutkan job yang masih berjalan, atau buka percakapan terakhir.
export async function initHistory() {
  if (!ai.credits?.enabled) return;
  let data;
  try {
    data = await host.api('GET', '/api/ai/threads');
  } catch {
    return;
  }
  const saved = host.storageGet(threadKey(), null);
  const job = data.activeJob;
  if (job && job.projectSlug !== host.projectSlug()) {
    // Satu prompt berjalan per akun; beri tahu kalau sedang dipakai di project lain.
    ai.messages = [{ kind: 'notice', key: ++seq, slug: job.projectSlug, url: host.projectUrl(job.projectSlug) }];
  }
  const target = (job?.projectSlug === host.projectSlug() ? job.threadId : null)
    ?? (saved === 'new' ? null : data.threads.find((t) => t.id === saved)?.id ?? data.threads[0]?.id);
  if (target) await openThread(target);
}

export async function clearHistory() {
  if (guardBusy()) return;
  const ok = await host.confirm({
    title: 'Hapus semua riwayat percakapan?',
    message: 'Semua percakapan dengan AI akan dihapus permanen. File dan database proyekmu tidak ikut terhapus.',
    buttons: [{ label: 'Hapus riwayat', value: true, primary: true, danger: true }, { label: 'Batal', value: null }],
  });
  if (!ok) return;
  try {
    await host.api('DELETE', '/api/ai/threads');
  } catch (err) {
    return host.toast(err.message, 'error');
  }
  ai.threadId = null;
  ai.pendingId = null;
  host.storageSet(threadKey(), 'new');
  ai.messages = [];
  host.toast('Riwayat percakapan dihapus');
}

// ---------- Lampiran gambar di prompt ----------
// Gambar diperkecil di browser (sisi terpanjang 1280 px, JPEG) supaya cepat dikirim; thumbnail untuk riwayat chat.
async function shrinkImage(file, maxSide, quality) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // latar putih untuk gambar transparan
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}

export async function addImages(files) {
  const limit = ai.credits?.images;
  if (!limit) return;
  const list = [...files].filter((f) => /^image\/(png|jpe?g|webp|gif|bmp)$/i.test(f.type));
  if (!list.length) return host.toast('Lampirkan file gambar (PNG, JPG, atau WEBP)', 'error');
  for (const file of list) {
    if (ai.images.length >= limit.max) {
      host.toast(`Maksimal ${limit.max} gambar per prompt`, 'error');
      break;
    }
    try {
      let full = await shrinkImage(file, 1280, 0.85);
      if (full.length > 2.6e6) full = await shrinkImage(file, 1024, 0.7);
      ai.images.push({ full, thumb: await shrinkImage(file, 200, 0.7) });
    } catch {
      host.toast(`"${file.name}" tidak bisa dibaca sebagai gambar`, 'error');
    }
  }
  host.focusInput();
}

export const removeImage = (i) => { ai.images.splice(i, 1); };

// ---------- Prompt & job ----------

export async function send() {
  const prompt = ai.input.trim();
  if (!prompt || ai.busy || ai.applying) return;
  markKept();

  const mode = ai.mode;
  const attached = ai.images.map((i) => ({ full: i.full, thumb: i.thumb }));
  const picked = host.pickedBlocks();
  add({ kind: 'user', mode, content: prompt, images: attached.map((i) => i.thumb), blocks: picked });
  host.endPick(); // halaman akan berubah; pilih ulang untuk permintaan berikutnya
  ai.images = [];
  ai.input = '';
  scroll();
  ai.busy = true;

  let started;
  try {
    await host.saveAll(); // pastikan AI membaca versi terbaru
    started = await host.api('POST', '/api/ai/prompt', {
      prompt, mode, activePath: host.activePath(), threadId: ai.threadId,
      ...(attached.length ? { images: attached.map((i) => i.full), thumbs: attached.map((i) => i.thumb) } : {}),
      ...(picked.length ? { blocks: picked } : {}),
    });
  } catch (err) {
    ai.busy = false;
    addError(err.message, err.code);
    if (err.code === 'no_credits') host.loadCredits();
    scroll();
    return;
  }
  ai.threadId = started.threadId;
  host.storageSet(threadKey(), ai.threadId);
  host.setCredits(started.credits);
  attachJob(started.assistantMessage);
}

// Isi kotak prompt (mis. dari tombol "Tanya AI" fitur lain, atau saran di halaman sambutan).
export function setInput(text) {
  ai.input = text;
}

export async function stopJob(item) {
  item.stopping = true;
  await host.api('POST', `/api/ai/jobs/${item.id}/cancel`).catch((err) => host.toast(err.message, 'error'));
}

// Ikuti progres job di server. Koneksi yang putus disambung lagi; job tetap jalan di server.
async function attachJob(message) {
  ai.busy = true;
  ai.jobId = message.id;
  const activity = createActivity(() => document.getElementById('aiMessages'));
  const item = add({ kind: 'job', id: message.id, status: 'Menyiapkan…', stopping: false, activity });
  scroll();

  // Status diperbarui tiap detik sesuai fase: antre → berpikir → menulis (atau menunggu coba ulang).
  const started = message.createdAt || Date.now();
  let phase = { kind: 'prepare' };
  const renderStatus = () => {
    const secs = Math.max(0, Math.round((Date.now() - started) / 1000));
    item.status = {
      prepare: () => 'Menyiapkan…',
      vision: () => `AI sedang melihat gambar… ${secs} dtk`,
      queued: () => `Menunggu antrean AI… posisi ${phase.position} dari ${phase.total}`,
      thinking: () => `AI sedang berpikir… ${secs} dtk`,
      writing: () => `Menulis kode… ${(phase.chars / 1000).toFixed(1)}k karakter`,
      retry: () => `AI sedang sibuk, mencoba lagi (${phase.attempt}/${phase.max})…`,
    }[phase.kind]();
  };
  const statusTimer = setInterval(renderStatus, 1000);
  const setPhase = (next) => { phase = next; renderStatus(); };

  let final = null;
  for (let attempt = 0; attempt < 30 && !final; attempt++) {
    stream = new AbortController();
    try {
      const res = await fetch(`/api/ai/jobs/${message.id}/events`, { credentials: 'same-origin', signal: stream.signal });
      if (res.status === 401) {
        host.sessionExpired();
        return;
      }
      if (!res.ok) throw new Error(`Gagal (${res.status})`);
      activity.reset(); // server mengirim ulang semua event sejak awal job
      for await (const event of host.readEvents(res)) {
        activity.handle(event);
        if (event.credits) host.setCredits(event.credits);
        if (event.type === 'vision') setPhase({ kind: 'vision' });
        else if (event.type === 'queued') setPhase({ kind: 'queued', position: event.position, total: event.total });
        else if (event.type === 'running' || (event.type === 'thinking' && phase.kind !== 'writing')) setPhase({ kind: 'thinking' });
        else if (event.type === 'retry') setPhase({ kind: 'retry', attempt: event.attempt, max: event.max });
        else if (event.type === 'progress') setPhase({ kind: 'writing', chars: event.chars });
        else if (event.type === 'done' || event.type === 'error') final = event;
      }
    } catch { /* koneksi putus: sambung lagi di bawah */ }
    if (!final) await new Promise((r) => setTimeout(r, Math.min(1000 * (attempt + 1), 5000)));
  }

  clearInterval(statusTimer);
  // Status job hilang; ringkasan proses AI tetap di tempatnya (dibuang bila kosong).
  activity.finish();
  const at = ai.messages.findIndex((x) => x.key === item.key);
  if (at >= 0) {
    if (activity.state.removed) ai.messages.splice(at, 1);
    else ai.messages[at] = { kind: 'activity', key: item.key, activity };
  }
  ai.busy = false;
  ai.jobId = null;
  stream = null;
  if (!final) {
    addError('Koneksi ke server terputus. Muat ulang halaman untuk melihat hasilnya.');
  } else if (final.type === 'done') {
    addReply(final.message);
    if (final.touched?.length) await host.syncFromServer(final.touched, { openFirst: true });
  } else {
    addError(final.error);
  }
  scroll();
}

// Perubahan sudah diterapkan server (preview sudah berubah): Simpan atau Batalkan.
export async function settle(m, action) {
  ai.applying = true;
  try {
    const res = await host.api('POST', `/api/ai/messages/${m.id}/${action}`);
    if (ai.pendingId === m.id) ai.pendingId = null;
    m.applyState = res.message.applyState;
    if (action === 'revert') await host.syncFromServer(res.touched);
    return true;
  } catch (err) {
    host.toast(err.message, 'error');
    return false;
  } finally {
    ai.applying = false;
  }
}
