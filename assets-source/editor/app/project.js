// Akun & project: menu akun, pengaturan per browser, ganti/buat/hapus project, publikasi manual (dev/prod),
// langganan & kredit, Asisten AI website.
import { core as state } from '../files/state.svelte.js';
import NewProjectDialog from '../files/NewProjectDialog.svelte';
import AddressDialog from '../files/AddressDialog.svelte';
import { showMenu, ui, toast } from '../shell/state.svelte.js';
import Topup from '../Topup.svelte';
import Assistant from '../assistant/Assistant.svelte';
import SettingsDialog from '../settings/SettingsDialog.svelte';
import PublishDialog from '../publish/PublishDialog.svelte';
import PublishModeDialog from '../publish/PublishModeDialog.svelte';
import CloudDialog from '../cloud/CloudDialog.svelte';
import { SPARK } from '../icons.js';
import { ai } from '../ai/state.svelte.js';
import { diagram, rerender as rerenderDiagram } from '../diagram/state.svelte.js';
import { $, EDITOR_PATH, HOME, ICON, LANG, storage } from './util.js';
import { api } from './api.js';
import { editor, monaco, monacoTheme } from './monaco.js';
import { copyText, saveAll } from './files.js';
import { pick, reloadPreview, setPick } from './preview.js';
import { ask, setMode } from './shell.js';
import { openDialog } from './context.js';

export function showAccountMenu() {
  const rect = $('#avatarBtn').getBoundingClientRect();
  showMenu(rect.right, rect.bottom + 8, [
    { label: `Project: ${state.project.name}`, hint: 'ganti ›', run: () => setTimeout(() => showProjectMenu($('#avatarBtn')), 0) },
    '-',
    { label: 'Buka website publik', run: () => window.open(state.project.siteUrl, '_blank', 'noopener') },
    { label: 'Salin URL website', run: () => copyText(state.project.siteUrl) },
    state.me.desktop && { label: 'Publikasikan ke rakit.io', run: () => openCloud('publish') },
    state.me.desktop && { label: 'Project di rakit.io', run: () => openCloud('projects') },
    state.me.desktop && { label: 'Periksa update aplikasi', run: checkUpdate },
    { label: 'Mode publikasi', hint: isManual() ? 'manual' : 'langsung', run: openPublishMode },
    { label: 'Simpan semua', hint: '⌥⌘S', run: saveAll },
    { label: 'Pengaturan', run: openSettings },
    { label: LANG === 'en' ? 'Bahasa Indonesia' : 'English', hint: LANG === 'en' ? 'ID' : 'EN', run: () => setLanguage(LANG === 'en' ? 'id' : 'en') },
    SHOW_ASSISTANT && { label: 'Asisten AI website', hint: 'baru', run: openAssistant },
    ai.credits?.topupEnabled && { label: 'Isi ulang kredit AI', hint: `${ai.credits.purchased} kredit`, run: () => openTopup() },
    state.me.isAdmin && { label: 'Dashboard pemilik', run: () => { location.href = '/admin'; } },
    '-',
    { label: 'Keluar', danger: true, run: logout },
  ], { align: 'right', label: { title: state.me.username, sub: state.me.email } });
}

// ---------- Pengaturan (per browser) ----------
export const settings = { complete: storage.get('rakit.autocomplete', true) };
export const isDark = () => document.documentElement.dataset.theme === 'dark';

// Tema editor: 'light' (default, kertas krem) atau 'dark'. Atribut awalnya dipasang skrip di editor.html.
export function setTheme(theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  storage.set('rakit.theme', theme);
  if (monaco) monaco.editor.setTheme(monacoTheme());
  if (diagram.saved && ui.mode === 'diagram') rerenderDiagram(); // warna Mermaid ikut tema
}

// Ganti bahasa: server memasang cookie lang dari ?lang= lalu membuka halaman editor bahasa itu.
export async function setLanguage(lang) {
  if (lang === LANG) return;
  await saveAll();
  const params = new URLSearchParams(location.search);
  params.set('lang', lang);
  location.href = `${lang === 'en' ? '/en/editor' : '/editor'}?${params}`;
}

// Dialog Pengaturan: komponen Svelte assets-source/editor/settings/SettingsDialog.svelte.
export function openSettings() {
  openDialog(SettingsDialog, {
    lang: LANG,
    dark: isDark(),
    complete: settings.complete,
    onTheme: setTheme,
    onLanguage: setLanguage,
    onComplete: (on) => { setAutocomplete(on); toast(on ? 'Prediksi kode aktif' : 'Prediksi kode dimatikan'); },
  });
}

export function setAutocomplete(on) {
  settings.complete = on;
  storage.set('rakit.autocomplete', on);
  editor?.updateOptions({ inlineSuggest: { enabled: on } });
}

export async function logout() {
  await saveAll();
  await api('POST', '/api/logout').catch(() => {});
  location.href = HOME;
}

// ---------- Project (workspace) ----------
// Setiap project punya subdomain, file, database, dan riwayat AI sendiri. Ganti project = muat ulang editor.

export function projectUrl(slug) {
  return `${EDITOR_PATH}?project=${encodeURIComponent(slug)}`;
}

export async function switchProject(slug) {
  if (slug === state.project.slug) return;
  await saveAll();
  location.href = projectUrl(slug);
}

export function showProjectMenu(anchor) {
  const rect = anchor.getBoundingClientRect();
  const canAdd = state.projects.length < state.maxProjects;
  showMenu(rect.left, rect.bottom + 6, [
    ...state.projects.map((p) => ({
      label: `${p.slug === state.project.slug ? '● ' : ''}${p.name}`,
      hint: p.siteHost,
      run: () => switchProject(p.slug),
    })),
    '-',
    canAdd
      ? { label: '+ Project baru', run: openNewProject }
      : { label: `Maksimal ${state.maxProjects} project`, run: () => toast(`Maksimal ${state.maxProjects} project per akun. Hapus project lama untuk membuat yang baru.`, 'error') },
    { label: 'Ganti nama project…', run: renameProject },
    { label: 'Ganti alamat website…', hint: state.project.custom ? 'custom' : 'acak', run: openAddress },
    state.projects.length > 1 ? { label: 'Hapus project ini…', danger: true, run: deleteProject } : null,
  ], { wide: true });
}

export function openNewProject() {
  openDialog(NewProjectDialog, {
    onCreated: async (project) => {
      await saveAll();
      location.href = projectUrl(project.slug);
    },
  });
}

// Ganti alamat (subdomain) project aktif; editor dimuat ulang di alamat baru.
export function openAddress() {
  openDialog(AddressDialog, {
    onChanged: async (project) => {
      storage.set('rakit.project', project.slug);
      location.href = projectUrl(project.slug);
    },
  });
}

export async function renameProject() {
  const name = await ask('Ganti nama project', 'Nama project', state.project.name);
  if (!name || name === state.project.name) return;
  try {
    const { project } = await api('PATCH', `/api/projects/${state.project.slug}`, { name });
    state.project = project;
    state.projects = state.projects.map((p) => (p.slug === project.slug ? project : p));
      toast('Nama project diganti');
  } catch (err) {
    toast(err.message, 'error');
  }
}

export async function deleteProject() {
  const typed = await ask(`Hapus project ${state.project.siteHost}?`,
    `Ketik "${state.project.slug}" untuk konfirmasi`, '');
  if (typed === null) return;
  if (typed !== state.project.slug) return toast('Nama yang diketik tidak cocok. Project tidak dihapus.', 'error');
  try {
    await api('DELETE', `/api/projects/${state.project.slug}`);
  } catch (err) {
    return toast(err.message, 'error');
  }
  const next = state.projects.find((p) => p.slug !== state.project.slug);
  storage.set('rakit.project', next.slug);
  location.href = projectUrl(next.slug);
}

// Info project di header & panel file: App.svelte (dari state.project).

// ---------- Publikasi manual (dev/prod) ----------
// Mode "manual": editor & AI mengubah versi dev (<slug>--dev); website publik baru berubah saat
// dipublikasikan. Database dev terpisah; struktur tabelnya ikut dipublikasikan, datanya tidak.
export const isManual = () => state.project?.mode === 'manual';
// Status publikasi (tombol Publikasikan di header) ada di ui.pubStatus.
export const pub = { timer: 0 };

export async function refreshPublish() {
  ui.pubStatus = null;
  if (isManual()) {
    try { ui.pubStatus = (await api('GET', '/api/publish')).publish; } catch { /* coba lagi nanti */ }
  }
}
// Dipanggil setelah file/tabel berubah; dikumpulkan supaya tidak memeriksa tiap ketikan.
export function schedulePublishCheck() {
  clearTimeout(pub.timer);
  if (isManual()) pub.timer = setTimeout(refreshPublish, 1500);
}

// Ganti data project (mode/alamat preview berubah): perbarui tampilan & muat ulang preview.
export function applyProject(project) {
  state.project = { ...state.project, ...project, mode: project.mode, previewUrl: project.previewUrl };
  state.projects = state.projects.map((p) => (p.slug === project.slug ? state.project : p));
  if (pick.on) setPick(false);
  reloadPreview();
}

// Dialog Publikasikan & Mode publikasi: komponen Svelte di assets-source/editor/publish.
export async function openPublish() {
  let st;
  try {
    await saveAll(); // yang belum tersimpan ikut terhitung
    st = (await api('GET', '/api/publish')).publish;
  } catch (err) {
    return toast(err.message, 'error');
  }
  ui.pubStatus = st;
  openDialog(PublishDialog, {
    status: st,
    onPublished: (status) => { ui.pubStatus = status; },
    onModeDialog: openPublishMode,
  });
}

export function openPublishMode() {
  openDialog(PublishModeDialog, {
    current: isManual() ? 'manual' : 'live',
    siteUrl: state.project.siteUrl,
    slug: state.project.slug,
    onApplied: (res) => { applyProject(res.project); ui.pubStatus = res.publish; },
  });
}

// ---------- Akun rakit.io (aplikasi desktop) ----------
// Login opsional, publikasi project lokal ke rakit.io, dan unduh project dari sana: komponen Svelte
// assets-source/editor/cloud/CloudDialog.svelte. tab: 'publish' | 'projects'.
export function openCloud(tab = 'publish') {
  openDialog(CloudDialog, { tab, onSwitch: switchProject });
}

// Periksa versi baru aplikasi desktop sekarang (tanpa cache); bila ada, halaman unduhannya dibuka di browser.
// Pemberitahuan otomatis: shell/UpdateNotice.svelte.
export async function checkUpdate() {
  try {
    const info = await api('GET', '/api/desktop/update?force=1');
    if (!info.current) return toast('Versi aplikasi tidak diketahui (mode pengembangan)');
    if (!info.available) return toast(`rakit desktop ${info.current} sudah versi terbaru`);
    toast(`Versi baru ${info.latest} tersedia. Membuka halaman unduhan…`);
    await api('POST', '/api/desktop/open', { url: info.url });
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Asisten AI untuk website pengguna ----------
// Disembunyikan sementara dari editor (menu & daftar keuntungan paket). Server, widget di website yang sudah
// mengaktifkannya, dan dashboard owner tetap berjalan; ubah ke true untuk menampilkannya lagi.
export const SHOW_ASSISTANT = false;
// Pengaturan asisten: komponen Svelte assets-source/editor/assistant/Assistant.svelte (Esc di kotak instruksi
// tidak menutupnya). Setelah isi saldo berhasil, dialog ini dibuka lagi.
export function openAssistant() {
  const close = openDialog(Assistant, { onTopup: () => { close(); openTopup('assistant', { after: openAssistant }); } }, { keepEscapeIn: ['TEXTAREA'] });
}

// ---------- Isi ulang kredit (QRIS) ----------
// Tampilan & alur pembayarannya: komponen Svelte assets-source/editor/Topup.svelte.
// tab: 'credits' (paket kredit) | 'assistant' (Saldo Asisten AI website).
// after: dipanggil setelah isi saldo asisten berhasil.
export function openTopup(tab = 'credits', { after = null } = {}) {
  const close = openDialog(Topup, {
    tab,
    api,
    showAssistant: SHOW_ASSISTANT,
    icons: { close: ICON.close, spark: SPARK },
    onCredits: (credits) => { ai.credits = credits; },
    onUseAI: () => { close(); setMode('ai'); },
    onAfter: () => { close(); after?.(); },
    onClose: () => close(),
  });
}
