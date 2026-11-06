// Kerangka editor: status simpan, dialog tanya/konfirmasi, Simple/Coding, panel file & preview, tampilan HP, mode
// (tab) aktif beserta tab yang dipasang saat pertama dibuka, dan jembatan ke panel AI.
import { flushSync } from 'svelte';
import { core as state } from '../files/state.svelte.js';
import { ui, toast, showMenu, views } from '../shell/state.svelte.js';
import ConfirmDialog from '../shell/ConfirmDialog.svelte';
import { connect as connectDb, load as loadDb } from '../database/state.svelte.js';
import FeatureInfo from '../FeatureInfo.svelte';
import { setMode as setAiModeState, setInput as setAiInput, ai, newConversation, guardBusy, openThread, clearHistory, connect as connectAi } from '../ai/state.svelte.js';
import { FEATURE_INFO } from '../features.js';
import { connect as connectDiagram, load as loadDiagram } from '../diagram/state.svelte.js';
import { loadMermaid as loadMermaidFor } from '../mermaid.js';
import { connect as connectConsole, add as addConsoleLog, open as openConsole } from '../console/state.svelte.js';
import { $, autoFocus, isSimple, mobileQuery, storage } from './util.js';
import { api } from './api.js';
import { applyResponsiveEditor, editor } from './monaco.js';
import { editorContext, openDialog } from './context.js';
import { isDark } from './project.js';

// ---------- Toast & status ----------
// toast(): assets-source/editor/shell/state.svelte.js (ditampilkan App.svelte).
export function setSaveStatus(text, kind = '') {
  ui.save = { text, kind };
}

// ---------- Modal ----------
// Dialog tanya/konfirmasi (ConfirmDialog.svelte). Hasil: nilai tombol, isi input (bila ada), atau null (Esc / klik
// di luar dialog). Sesudahnya fokus kembali ke editor kode.
export function modal({ title, message, input, buttons }) {
  return new Promise((resolve) => {
    let result = null;
    const close = openDialog(ConfirmDialog, {
      title, message, input, buttons,
      answer: (value) => { result = value; close(); },
    }, { onClose: () => { resolve(result); autoFocus(editor); } });
  });
}

export const ask = (title, placeholder, value = '') =>
  modal({ title, input: { placeholder, value }, buttons: [{ label: 'OK', primary: true }, { label: 'Batal', value: null }] });

export function togglePreview() {
  if (isSimple()) return;
  ui.previewHidden = !ui.previewHidden;
  storage.set('rakit.previewHidden', ui.previewHidden);
}

export function toggleSidebar() {
  if (isSimple()) return;
  // Panel file ada di dalam mode Code: dari mode lain, Ctrl+B membuka Code dengan panel file tampil.
  if (ui.mode !== 'code') {
    ui.sidebarHidden = false;
    setMode('code');
    return;
  }
  ui.sidebarHidden = !ui.sidebarHidden;
}

export function setLayout(layout) {
  document.body.dataset.layout = layout;
  ui.layout = layout;
  storage.set('rakit.layout', layout);
  // Di Simple preview selalu tampil; kembali ke Coding = ikuti pilihan tampil/sembunyi sebelumnya.
  ui.previewHidden = !(layout === 'simple' || !storage.get('rakit.previewHidden', false));
  if (layout === 'simple') {
    if (document.body.dataset.mobileView === 'files') setMobileView('editor');
    if (ui.mode !== 'ai') setMode('ai');
  }
}

export function setMobileView(view) {
  document.body.dataset.mobileView = view;
  ui.mobileView = view;
}

// ---------- Asisten AI ----------
// Panel AI: komponen Svelte di assets-source/editor/ai (keadaan & aksi di state.svelte.js: ai). Di sini tinggal
// lencana kredit & paket di header, tombol "Tanya AI" dari fitur lain, dan menu riwayat percakapan.
export const setAiMode = (mode) => setAiModeState(mode);

// ---------- Penjelasan fitur (tombol ⓘ) ----------
// Data penjelasan: assets-source/editor/features.js; dialognya FeatureInfo.svelte.

export function askAi(text, mode = 'build') {
  setMode('ai');
  setAiMode(mode);
  setAiInput(text);
  autoFocus($('#aiInput'));
}

export function showFeatureInfo(key) {
  if (FEATURE_INFO[key]) openDialog(FeatureInfo, { key });
}

// Area editor punya dua mode: 'code' (Monaco) dan 'ai' (chat asisten).
export function setMode(mode) {
  // Mis. "buka tabel" dari hasil AI: tampilannya hanya ada di Coding, jadi pindah ke sana.
  if (mode !== 'ai' && isSimple()) {
    setLayout('coding');
    toast('Pindah ke mode Coding');
  }
  ui.mode = mode; // panel yang tampil & tab yang terpilih mengikuti (App.svelte)
  if (mode === 'data') {
    dbLoad();
  } else if (mode === 'diagram') {
    diagramLoad();
  } else if (mode === 'fn') {
    fnLoad();
  } else if (mode === 'history') {
    historyView().showList();
    historyView().load();
  } else if (mode === 'console') {
    devConsoleOpen();
  } else if (mode === 'docs') {
    docsLoad();
  } else if (mode === 'providers') {
    providersLoad();
  } else if (mode === 'ai') {
    autoFocus($('#aiInput'));
  } else if (state.active) {
    autoFocus(editor);
  }
}

export const toggleAi = () => { if (!isSimple()) setMode(ui.mode === 'ai' ? 'code' : 'ai'); };

export async function loadCredits() {
  try {
    ai.credits = await api('GET', '/api/ai/credits');
  } catch {
    ai.credits = null;
  }
}

// ---------- Riwayat percakapan ----------
export async function showHistoryMenu(anchor) {
  let data;
  try {
    data = await api('GET', '/api/ai/threads');
  } catch (err) {
    return toast(err.message, 'error');
  }
  const when = (ms) => new Date(ms).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const rect = anchor.getBoundingClientRect();
  showMenu(rect.left, rect.bottom + 6, [
    { label: 'Percakapan baru', run: newConversation },
    data.threads.length ? '-' : null,
    ...data.threads.slice(0, 20).map((t) => ({
      label: `${t.id === ai.threadId ? '● ' : ''}${t.title}`,
      hint: when(t.updatedAt),
      run: () => { if (!guardBusy()) openThread(t.id); },
    })),
    data.threads.length ? '-' : null,
    data.threads.length ? { label: 'Hapus semua riwayat', danger: true, run: clearHistory } : null,
  ], { wide: true });
}

export function bindAiEvents() {
  connectAi(editorContext().get('editor'));
  setMobileView(document.body.dataset.mobileView || 'editor');
  mobileQuery.addEventListener('change', applyResponsiveEditor);
}

// ---------- Database (mode Data) ----------
// Tab Data: komponen Svelte di assets-source/editor/database, dipasang ke kerangka #dataView di editor.html saat
// tab pertama kali dibuka. Keadaannya (db) dipakai bersama lewat database/state.svelte.js.
export let dbMounted = false;
export function dbLoad() {
  if (!dbMounted) {
    dbMounted = true;
    connectDb(editorContext().get('editor'));
    ui.loaded.data = true;
    flushSync();
  }
  return loadDb();
}

// ---------- Diagram (UML, ERD, peta halaman, alur data) ----------
// Tab Diagram: komponen Svelte di assets-source/editor/diagram (keadaan & aksi di state.svelte.js), dipasang saat
// tab pertama kali dibuka. Mermaid dimuat dari CDN saat pertama dipakai, dengan tema mengikuti tema editor.
export const loadMermaid = () => loadMermaidFor(isDark());
export let diagramMounted = false;
export function diagramLoad() {
  if (!diagramMounted) {
    diagramMounted = true;
    connectDiagram(editorContext().get('editor'));
    ui.loaded.diagram = true;
    flushSync();
  }
  return loadDiagram();
}

// ---------- Console ----------
// Tab Console: assets-source/editor/console (log & saringan di state.svelte.js, tampilan Console.svelte). Log dari
// preview diterima sejak awal, jadi sambungannya disiapkan saat log pertama tiba.
export let consoleConnected = false;
export const consoleActive = () => ui.mode === 'console';
export function connectConsoleOnce() {
  if (consoleConnected) return;
  consoleConnected = true;
  connectConsole(editorContext().get('editor'));
}
export function devConsoleAdd(raw) {
  connectConsoleOnce();
  addConsoleLog(raw);
}
export function devConsoleOpen() {
  connectConsoleOnce();
  ui.loaded.console = true;
  flushSync();
  openConsole();
}
// ---------- Fungsi serverless ----------
// Tab Fungsi: komponen Svelte assets-source/editor/functions/Functions.svelte, dipasang sekali lalu dimuat
// ulang setiap tab dibuka.
export function fnLoad() {
  ui.loaded.fn = true;
  flushSync();
  views.fn.load();
}

// ---------- Riwayat versi ----------
// Tab Riwayat: komponen Svelte assets-source/editor/history/History.svelte, dipasang saat pertama dibuka.
export function historyView() {
  ui.loaded.history = true;
  flushSync();
  return views.history;
}

// ---------- Provider AI ----------
// Tab Provider AI: komponen Svelte assets-source/editor/providers/Providers.svelte (AI pribadi + provider fungsi).
export function providersLoad() {
  ui.loaded.providers = true;
  flushSync();
  views.providers.load();
}

// ---------- Dokumentasi ----------
// Tab Dokumentasi: komponen Svelte assets-source/editor/docs/Docs.svelte, dipasang sekali lalu dimuat ulang setiap
// tab dibuka (dokumentasi selalu mengikuti keadaan project terbaru).
export function docsLoad() {
  ui.loaded.docs = true;
  flushSync();
  views.docs.load();
}
