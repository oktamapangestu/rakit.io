// Editor rakit.io: memasang kerangka (App.svelte) lalu memuat akun, project, dan file. Logikanya dibagi per bagian
// di assets-source/editor/app/; tampilannya komponen Svelte di assets-source/editor/.
import { mount, flushSync } from 'svelte';
import { core as state } from '../editor/files/state.svelte.js';
import App from '../editor/shell/App.svelte';
import { ui, toast } from '../editor/shell/state.svelte.js';
import CreateTableDialog from '../editor/database/CreateTableDialog.svelte';
import { clearHistory, newConversation, ai, initHistory as initAiHistory } from '../editor/ai/state.svelte.js';
import { flow } from '../editor/flow/state.svelte.js';
import { $, isSimple, mobileQuery, storage } from '../editor/app/util.js';
import { api } from '../editor/app/api.js';
import { startEditor } from '../editor/app/monaco.js';
import { activate, closeTab, copyText, createEntry, isDirty, loadTree, openFile, openStartFiles, pickImages, save, saveAll, treeEvents } from '../editor/app/files.js';
import { bindBlockPicker, currentRoute, pick, previewGo, reloadPreview, setDevice, setPick, setTextEdit, textEdit } from '../editor/app/preview.js';
import { bindAiEvents, loadCredits, setLayout, setMobileView, setMode, showFeatureInfo, showHistoryMenu, toggleAi, togglePreview, toggleSidebar } from '../editor/app/shell.js';
import { editorContext, openDialog } from '../editor/app/context.js';
import { openPublish, openTopup, projectUrl, refreshPublish, showAccountMenu, showProjectMenu } from '../editor/app/project.js';
import { askFlow, bindFlowEvents, explainFlow, flashFlowLines, flowGoBack, openFlowRef, selectFlowStep, stopFlowPlay, toggleFlow, toggleFlowPlay } from '../editor/app/flow.js';

// ---------- Event ----------
// Aksi tombol & panel di kerangka editor (App.svelte, prop actions).
function appActions() {
  return {
    toggleSidebar,
    togglePreview,
    setMode,
    setMobileView,
    setLayout: (layout) => {
      setLayout(layout);
      ui.layoutAttention = false;
      storage.set('rakit.layoutSeen', true);
    },
    projectMenu: showProjectMenu,
    accountMenu: showAccountMenu,
    copySite: () => copyText(state.project.siteUrl),
    publish: openPublish,
    topup: (tab) => openTopup(tab),
    info: showFeatureInfo,
    createEntry: (type, dir) => createEntry(type, dir),
    upload: () => pickImages(),
    refresh: () => loadTree().catch((err) => toast(err.message, 'error')),
    collapse: () => state.expanded.clear(),
    openIndex: () => {
      if (state.entries.some((x) => x.path === 'index.html')) openFile('index.html');
      else toast('index.html belum ada — buat dulu lewat "File baru"', 'error');
    },
    tree: treeEvents,
    selectTab: (path) => { setMode('code'); activate(path); },
    closeTab,
    toggleFlow: () => toggleFlow(),
    // ← / → di panel Baca Alur Kode (bukan saat mengetik pertanyaan) untuk pindah langkah; Esc menutup panel.
    flowKey: (e) => {
      if (e.target.closest('textarea, input')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); stopFlowPlay(); selectFlowStep(flow.step + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); stopFlowPlay(); selectFlowStep(flow.step - 1); }
      if (e.key === 'Escape') toggleFlow(false);
    },
    flow: {
      explain: explainFlow,
      select: selectFlowStep,
      stopPlay: stopFlowPlay,
      togglePlay: toggleFlowPlay,
      close: () => toggleFlow(false),
      goBack: flowGoBack,
      openRef: openFlowRef,
      flashLines: flashFlowLines,
      ask: askFlow,
      toggleWide: () => { flow.wide = !flow.wide; },
      saveShowChart: (open) => { flow.showChart = open; storage.set('rakit.flowChart', open); },
    },
    setAutosave: (on) => {
      state.autosave = on;
      storage.set('rakit.autosave', on);
      if (on) saveAll();
    },
    historyMenu: showHistoryMenu,
    clearHistory,
    newConversation,
    newTable: () => openDialog(CreateTableDialog),
    preview: {
      go: previewGo,
      currentRoute,
      reload: reloadPreview,
      info: () => showFeatureInfo('preview'),
      togglePick: () => setPick(!pick.on),
      toggleEdit: () => setTextEdit(!textEdit.on),
      pickGo: () => { setMobileView('editor'); setMode('ai'); },
      pickDone: () => setPick(false),
      textDone: () => setTextEdit(false),
      setDevice,
      isMobile: () => mobileQuery.matches,
    },
  };
}

function bindEvents() {
  bindBlockPicker();
  // Tombol Simple/Coding disorot (bercahaya) sampai pengguna pertama kali memakainya.
  ui.layoutAttention = !storage.get('rakit.layoutSeen', false);

  // Shortcut global (saat fokus di luar Monaco).
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      if (e.altKey) saveAll(); else if (state.active) save(state.active);
    } else if (key === 'b') {
      e.preventDefault();
      toggleSidebar();
    } else if (key === '\\') {
      e.preventDefault();
      togglePreview();
    } else if (key === 'i') {
      e.preventDefault();
      toggleAi();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.tabs.some(isDirty)) e.preventDefault();
  });
}

async function init() {
  // Kerangka editor (App.svelte) dipasang paling awal: Monaco & preview memakai elemen di dalamnya. Pohon file,
  // tab, dan panel AI baru tampil setelah data akun dimuat (ui.ready).
  mount(App, { target: $('.app'), context: editorContext(), props: { actions: appActions() } });
  startEditor();
  // Project aktif: dari URL (?project=), atau yang terakhir dibuka, atau project pertama.
  state.projectSlug = new URLSearchParams(location.search).get('project') || storage.get('rakit.project', null);
  let me;
  try {
    me = await api('GET', '/api/me');
  } catch {
    state.projectSlug = null; // project tidak ada / bukan milik akun ini
    me = await api('GET', '/api/me');
  }
  state.me = me.user;
  state.project = me.project;
  state.projects = me.projects;
  state.maxProjects = me.maxProjects;
  state.maxCustom = me.maxCustom ?? 0;
  state.projectSlug = me.project.slug;
  storage.set('rakit.project', state.projectSlug);
  history.replaceState(null, '', projectUrl(state.projectSlug));
  refreshPublish();

  if (storage.get('rakit.previewHidden', false) && !isSimple()) togglePreview();
  setLayout(isSimple() ? 'simple' : 'coding');
  setDevice(storage.get('rakit.device', 'desktop'));
  bindEvents();
  bindAiEvents();
  ui.ready = true;
  flushSync();
  bindFlowEvents();
  const credits = loadCredits();

  await loadTree();
  reloadPreview();
  // Editor dibuka di mode AI, kecuali user sudah pindah tab selama editor masih dimuat (mis. ke Diagram).
  if (ui.mode === 'ai') setMode('ai');
  openStartFiles().catch(() => { /* pesannya sudah ditampilkan openFile */ });
  // Tampilkan lagi percakapan terakhir (dan sambung ke job yang masih berjalan, bila ada).
  await credits;
  if (!ai.credits) await loadCredits();
  await initAiHistory();
}

init().catch((err) => {
  console.error(err);
  toast(`Gagal memuat editor: ${err.message}`, 'error');
});
