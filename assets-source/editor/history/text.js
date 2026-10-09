// Teks riwayat versi dalam bahasa sehari-hari: "versi" = potret semua file project pada satu waktu.
import { SPARK } from '../icons.js';

export const HIST_ICON = {
  manual: 'M4 1.5h8l.5.5v12.3l-.8.4L8 12.1l-3.7 2.6-.8-.4V2zM5 2.5v10.8l2.7-1.9h.6l2.7 1.9V2.5z',
  ai: SPARK,
  edit: 'M11.1 1.6a1.6 1.6 0 0 1 2.3 0l1 1a1.6 1.6 0 0 1 0 2.3L5.3 14H2v-3.3zm1.6.7a.6.6 0 0 0-.9 0l-1 1 1.9 1.9 1-1a.6.6 0 0 0 0-.9zM11.9 5.9 10 4 3 11v2h2z',
  restore: 'M8 1a7 7 0 1 1-7 7h1a6 6 0 1 0 1.76-4.24L5.5 5.5H1V1l1.76 1.76A6.98 6.98 0 0 1 8 1',
};

// Label versi dipotong server di 80 karakter (lihat versions.go: labelMax).
const VERSION_LABEL_MAX = 80;

// Isi permintaan ke AI dari label versi "Sebelum AI: …" (tanda kutip di ujungnya dibuang).
export function aiPrompt(v) {
  const prompt = v.label.replace(/^Sebelum AI:\s*/, '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (!prompt) return '';
  return `${prompt[0].toUpperCase()}${prompt.slice(1)}${v.label.length >= VERSION_LABEL_MAX ? '…' : ''}`;
}

// Judul & keterangan tiap versi.
export function versionText(v) {
  if (v.kind === 'manual') return { title: v.label || 'Versi yang kamu simpan', sub: 'Disimpan olehmu' };
  if (v.kind === 'ai') {
    // Judul = isi permintaan ke AI, supaya versi yang satu bisa dibedakan dari yang lain.
    const prompt = aiPrompt(v);
    return prompt ? { title: prompt, sub: 'Sebelum AI mengubah file' } : { title: 'Sebelum AI mengubah', sub: '' };
  }
  if (v.kind === 'restore') return { title: 'Sebelum dikembalikan', sub: v.label.replace(/^Sebelum dikembalikan ke\s*/, 'Lalu dikembalikan ke ') };
  return { title: 'Simpanan otomatis', sub: 'Disimpan sendiri sebelum kamu lanjut mengedit' };
}

export const timeOf = (ms) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
export function dayLabel(ms) {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Hari ini';
  if (d.toDateString() === yesterday.toDateString()) return 'Kemarin';
  return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
}
export const fullTime = (ms) => new Date(ms).toLocaleString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export const STATUS_TEXT = {
  changed: { label: 'Berbeda', hint: 'Isinya berubah sejak versi ini' },
  missing: { label: 'Sudah dihapus', hint: 'Ada di versi ini, tapi sekarang sudah tidak ada' },
  new: { label: 'File baru', hint: 'Dibuat setelah versi ini' },
  same: { label: 'Sama', hint: 'Tidak berubah' },
};

// Teks tombol & konfirmasi mengembalikan versi. latest: versi ini yang paling baru (untuk versi AI = batalkan
// perubahan AI terakhir).
export function restoreText(version, latest) {
  const when = fullTime(version.createdAt);
  const keep = 'Kondisi sekarang disimpan dulu sebagai versi baru, jadi kamu bisa kembali lagi kapan saja.';
  if (version.kind !== 'ai') {
    return {
      title: 'Kembalikan semua file ke versi ini?',
      text: 'Tenang, kondisi sekarang disimpan dulu sebagai versi baru. Jadi kalau berubah pikiran, kamu bisa kembali lagi.',
      button: 'Kembalikan ke versi ini', confirm: `Semua file akan dibuat sama seperti pada ${when}. ${keep}`, done: 'Project dikembalikan ke versi ini',
    };
  }
  const prompt = aiPrompt(version);
  const what = prompt ? `“${prompt}”` : 'ini';
  if (latest) {
    return {
      title: 'Batalkan perubahan AI ini?',
      text: `File dikembalikan ke kondisi sebelum AI mengerjakan permintaan ${what}. ${keep}`,
      button: 'Batalkan perubahan AI', confirm: `File dikembalikan ke kondisi sebelum AI mengerjakan permintaan ${what}. ${keep}`, done: 'Perubahan AI dibatalkan',
    };
  }
  return {
    title: 'Kembali ke sebelum permintaan ini?',
    text: `Perubahan dari permintaan ${what} dan semua perubahan sesudahnya ikut dibatalkan. ${keep}`,
    button: 'Kembalikan ke sebelum ini', confirm: `Semua file dibuat sama seperti pada ${when}, sebelum AI mengerjakan permintaan ${what}. Perubahan sesudahnya ikut dibatalkan. ${keep}`, done: 'Project dikembalikan ke sebelum permintaan ini',
  };
}
