// Sambungan komponen Svelte ke editor (context 'editor') dan dialog di #modal.
import { unmount, mount } from 'svelte';
import { core as state } from '../files/state.svelte.js';
import { toast } from '../shell/state.svelte.js';
import { pageName } from '../preview/state.svelte.js';
import { db } from '../database/state.svelte.js';
import { ai } from '../ai/state.svelte.js';
import { renderMarkdown } from '../markdown.js';
import { $, HOME, ICON, autoFocus, formatBytes, storage } from './util.js';
import { api, readEvents } from './api.js';
import { copyText, expandTo, imageUrl, loadTree, openFile, saveAll, showDiff, syncFromServer, uploadImages } from './files.js';
import { pick, previewBase, reloadPreview, removeBlock, schedulePreviewReload, setPick, toPicker } from './preview.js';
import { ask, askAi, consoleActive, loadCredits, loadMermaid, modal, setMode } from './shell.js';
import { isDark, openTopup, projectUrl, schedulePublishCheck } from './project.js';

// ---------- Komponen Svelte (assets-source/editor) ----------
// Sambungan komponen ke editor, dipasang sebagai context 'editor' (getContext('editor') di komponen).
export let svelteContext;
export function editorContext() {
  svelteContext ??= new Map([['editor', {
    api,
    toast,
    ask,
    confirm: modal,
    copyText,
    askAi,
    saveAll,
    loadTree,
    fileExists: (path) => state.entries.some((e) => e.path === path),
    openCode: async (path) => { setMode('code'); expandTo(path); await openFile(path); },
    topupEnabled: () => Boolean(ai.credits?.topupEnabled),
    openTopup,
    openDialog,
    previewBase,
    formatBytes,
    schedulePublishCheck,
    projectHeaders: () => (state.projectSlug ? { 'X-Project': state.projectSlug } : {}),
    syncFromServer,
    showDiff,
    imageUrl,
    schedulePreviewReload,
    reloadPreview,
    consoleActive,
    renderMarkdown,
    loadMermaid,
    autoFocus,
    isDark,
    readEvents,
    loadCredits,
    setCredits: (credits) => { ai.credits = credits; },
    costPerPrompt: () => ai.credits?.costPerPrompt ?? 1,
    storageGet: (key, fallback) => storage.get(key, fallback),
    storageSet: (key, value) => storage.set(key, value),
    projectSlug: () => state.project.slug,
    sessionExpired: () => { location.href = HOME; },
    openTable: (name) => { db.active = name; setMode('data'); },
    openProviders: () => setMode('providers'),
    focusInput: () => autoFocus($('#aiInput')),
    pickedBlocks: () => pick.blocks.map((b) => ({ page: b.page, selector: b.selector, label: b.label, html: b.html, css: b.css })),
    endPick: () => { if (pick.on) setPick(false); },
    activePath: () => state.active,
    projectUrl,
    pageName,
    pickParent: (b) => toPicker({ type: 'parent', selector: b.selector }),
    pickRemove: removeBlock,
    uploadImages,
    icons: { refresh: ICON.refresh, trash: ICON.trash, table: ICON.table, gear: ICON.gear, lock: ICON.lock, close: ICON.close, flow: ICON.flow, block: ICON.block },
  }]]);
  return svelteContext;
}

// Dialog dari komponen Svelte di #modal: Esc atau klik di luar dialog menutupnya. Komponen menerima prop close.
// Hanya satu dialog sekaligus: membuka dialog baru menutup yang lama.
// keepEscapeIn: elemen (nama tag) tempat Esc tidak menutup dialog, mis. ['TEXTAREA'] untuk isian panjang.
// onClose: dipanggil setelah dialog ditutup (dengan cara apa pun).
export let closeDialog = null;
export function openDialog(Component, props = {}, { keepEscapeIn = [], onClose = null } = {}) {
  closeDialog?.();
  const root = $('#modal');
  let app;
  const onKey = (e) => {
    if (e.key === 'Escape' && !keepEscapeIn.includes(e.target.tagName)) { e.preventDefault(); close(); }
  };
  function close() {
    if (!app) return;
    unmount(app);
    app = null;
    if (closeDialog === close) closeDialog = null;
    root.hidden = true;
    root.replaceChildren();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  }
  root.replaceChildren();
  root.hidden = false;
  root.onmousedown = (e) => { if (e.target === root) close(); };
  document.addEventListener('keydown', onKey, true);
  app = mount(Component, { target: root, props: { ...props, close }, context: editorContext() });
  closeDialog = close;
  return close;
}
