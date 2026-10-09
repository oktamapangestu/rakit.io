// Proses AI selama job berjalan (event dari server, lihat go/internal/ai/activity.go): proses berpikir, teks jawaban,
// dan langkah-langkahnya (menulis file — dengan isi yang sedang ditulis —, membuat tabel, menghapus file). Setelah
// selesai diringkas jadi "Lihat proses AI". Ditampilkan Activity.svelte; dipakai panel AI dan kanvas Diagram.
import { DIAGRAM_NAMES } from '../diagram/info.js';

export const STEP_LABEL = { write_file: 'Menulis', delete_file: 'Menghapus', create_table: 'Tabel', diagram: 'Menggambar diagram' };

// scroller: fungsi yang mengembalikan elemen yang digulir mengikuti isi baru (daftar pesan AI, atau panel proses di
// kanvas diagram) — hanya bila pengguna tidak sedang menggulir ke atas membaca.
export function createActivity(scroller) {
  // parts: urutan bagian seperti munculnya — 'thinking' (sekali), 'say' (teks; baru lagi setiap putaran model),
  // 'list' (sekali, berisi items: langkah & catatan).
  const a = $state({
    open: true, summary: 'Proses AI', removed: false, finished: false,
    thinking: '', thinkingOpen: true, parts: [], items: [], count: 0, version: 0,
  });
  const started = Date.now(); // tidak diulang saat reset (sambung ulang): durasi dihitung sejak job dimulai
  let say = null; // bagian 'say' yang sedang ditulis
  const steps = new Map(); // id -> langkah (proxy di a.items)

  const part = (kind) => {
    a.parts.push({ kind, raw: '', key: a.parts.length });
    return a.parts.at(-1);
  };
  const ensureList = () => { if (!a.parts.some((p) => p.kind === 'list')) part('list'); };

  function reset() {
    Object.assign(a, { open: true, summary: 'Proses AI', removed: false, finished: false, thinking: '', thinkingOpen: true, parts: [], items: [], count: 0 });
    say = null;
    steps.clear();
    a.version += 1;
  }

  function handle(ev) {
    if (ev.type === 'reasoning') {
      if (!a.parts.some((p) => p.kind === 'thinking')) part('thinking');
      a.thinking += ev.text;
    } else if (ev.type === 'say') {
      say ??= part('say');
      // Mode Plan menjawab di dalam <message>…</message>; tag-nya tidak perlu terlihat.
      say.raw += ev.text;
    } else if (ev.type === 'round') {
      // Model dipanggil lagi: proses berpikir & teks berikutnya mulai di paragraf baru.
      if (a.parts.some((p) => p.kind === 'thinking')) a.thinking += '\n\n';
      say = null;
      for (const step of steps.values()) if (step.code) step.open = false;
    } else if (ev.type === 'step') {
      let step = steps.get(ev.id);
      if (!step) {
        // Mulai menulis: proses berpikir dilipat, tempat untuk isi file yang sedang ditulis disiapkan.
        a.thinkingOpen = false;
        a.count += 1;
        const target = ev.tool === 'diagram' ? DIAGRAM_NAMES[ev.target] || ev.target : ev.target;
        ensureList();
        a.items.push({
          key: `s${ev.id}`, kind: 'step', state: 'run', label: STEP_LABEL[ev.tool] || ev.tool, target: target || '…',
          code: ev.tool === 'write_file' || ev.tool === 'diagram', draft: '', open: true, notes: [],
        });
        step = a.items.at(-1);
        steps.set(ev.id, step);
      }
      if (ev.state && ev.state !== 'run') {
        step.state = ev.state;
        step.open = false;
        const note = ev.state === 'cancel' ? 'terputus, diulang' : ev.note;
        if (note) step.notes.push(ev.state === 'warn' ? `${note} — AI memperbaikinya` : note);
      }
    } else if (ev.type === 'draft') {
      const step = steps.get(ev.id);
      if (step?.code) step.draft += ev.text;
    } else if (ev.type === 'note') {
      ensureList();
      a.items.push({ key: `n${a.items.length}`, kind: 'note', text: ev.text });
    }
    a.version += 1;
  }

  // Selesai: dilipat jadi ringkasan; dibuang bila tidak ada yang bisa dilihat (model tanpa proses berpikir).
  function finish() {
    a.finished = true;
    if (!a.parts.length) {
      a.removed = true;
      return;
    }
    const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
    a.summary = `Lihat proses AI · ${a.count ? `${a.count} langkah · ` : ''}${secs} dtk`;
    a.open = false;
    a.thinkingOpen = false;
    for (const step of steps.values()) step.open = false;
  }

  // Dibuka/ditutup pengguna (key: 'open' = seluruh proses, 'thinkingOpen' = proses berpikir).
  function setOpen(key, open) {
    a[key] = open;
  }

  return { state: a, scroller, reset, handle, finish, setOpen };
}
