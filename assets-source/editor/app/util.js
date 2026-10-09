// Alat kecil yang dipakai semua bagian editor: query DOM, penyimpanan per browser, path file, bahasa, ukuran layar.
import { CLOSE } from '../icons.js';

// ---------- Util ----------
export const $ = (s, el = document) => el.querySelector(s);

export const ICON = {
  block: 'M1 1h4v1H2v3H1zm10 0h4v4h-1V2h-3zM1 11h1v3h3v1H1zm14 0v4h-4v-1h3v-3zM5 5h6v6H5z',
  close: CLOSE,
  table: 'M1.5 2h13l.5.5v11l-.5.5h-13l-.5-.5v-11zM2 3v3h5V3zm6 0v3h6V3zM2 7v3h5V7zm6 0v3h6V7zm-6 4v2h5v-2zm6 0v2h6v-2z',
  lock: 'M8 1a3 3 0 0 0-3 3v2H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1V4a3 3 0 0 0-3-3m2 5H6V4a2 2 0 1 1 4 0z',
  trash: 'M6 1h4l.5.5V3H14v1h-1v10.5l-.5.5h-9l-.5-.5V4H2V3h3.5V1.5zM6.5 3h3V2h-3zM4 4v10h8V4zm2 2h1v6H6zm3 0h1v6H9z',
  refresh: 'M13.45 5.17A6 6 0 1 0 14 8h-1a5 5 0 1 1-.8-2.73l-1.7.23.14 1 3.4-.5-.5-3.4-1 .14z',
  gear: 'M9.1 1l.4 1.9 1 .4 1.6-1.1 1.6 1.6-1.1 1.6.4 1 1.9.4v2.3l-1.9.4-.4 1 1.1 1.6-1.6 1.6-1.6-1.1-1 .4-.4 1.9H6.9l-.4-1.9-1-.4-1.6 1.1-1.6-1.6 1.1-1.6-.4-1L1 9.1V6.9l1.9-.4.4-1-1.1-1.6 1.6-1.6 1.6 1.1 1-.4L6.9 1zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5',
  flow: 'M2 1.5h5l.5.5v3l-.5.5H5v2h3.5V7l.5-.5h5l.5.5v3l-.5.5H9l-.5-.5v-.5H5v2.5h2l.5.5v2l-.5.5H2l-.5-.5v-2l.5-.5h2v-6H2l-.5-.5V2zm.5 1v2h4v-2zm7 5v2h4v-2zm-7 5v1h4v-1z',
};

export const storage = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* abaikan */ }
  },
};

export const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
export const extOf = (p) => (baseName(p).includes('.') ? baseName(p).split('.').pop().toLowerCase() : '');
export const joinPath = (dir, name) => (dir ? `${dir}/${name}` : name).replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
export const within = (p, base) => p === base || p.startsWith(`${base}/`);
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif'];
export const isImage = (p) => IMAGE_EXT.includes(extOf(p));
// Bahasa antarmuka: /en/editor memuat versi Inggris skrip ini (dibuat scripts/i18n.mjs dari teks di sini).
export const LANG = document.documentElement.lang === 'en' ? 'en' : 'id';
export const HOME = LANG === 'en' ? '/en' : '/';
export const EDITOR_PATH = LANG === 'en' ? '/en/editor' : '/editor';
export const formatBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// ---------- Tampilan HP ----------
export const mobileQuery = window.matchMedia('(max-width: 760px)');
// Layar sentuh: jangan fokuskan kotak teks/editor secara otomatis, karena keyboard langsung muncul
// dan menutupi separuh layar. Fokus hanya saat pengguna sendiri mengetuk kotaknya.
export const touchQuery = window.matchMedia('(pointer: coarse)');
export const autoFocus = (target) => { if (!touchQuery.matches) target?.focus(); };

// ---------- Tampilan editor: Simple / Coding ----------
// Simple: hanya chat AI dan preview, untuk yang cukup memberi perintah lalu melihat hasilnya.
// Coding: editor lengkap (file, kode, database, diagram, riwayat). Pilihan diingat per browser;
// atribut awalnya sudah dipasang skrip kecil di editor.html supaya halaman tidak berkedip.
export const isSimple = () => document.body.dataset.layout === 'simple';
