// Editor kode (Monaco dari CDN): pemuatan, tema, status bar (baris/kolom), dan prediksi kode dari AI.
// monaco & editor diisi setupEditor(); yang butuh Monaco menunggu editorReady.
import { core as state } from '../files/state.svelte.js';
import { toast, ui } from '../shell/state.svelte.js';
import { clipText } from '../handoff.js';
import { $, mobileQuery } from './util.js';
import { save, saveAll } from './files.js';
import { askAi, toggleAi } from './shell.js';
import { isDark, settings } from './project.js';

export let monaco;
export let editor;

// ---------- Prediksi kode (inline completion) ----------
// Setelah user berhenti mengetik sebentar, minta lanjutan kode ke server (/api/ai/complete) dan tampilkan
// sebagai teks abu-abu. Permintaan lama dibatalkan saat user lanjut mengetik.
export const COMPLETE_DELAY = 450;
export const completeState = { off: false }; // off: server menolak (fitur mati / kuota habis) — berhenti sampai reload

export function registerCompletion() {
  const wait = (ms, token) => new Promise((resolve) => {
    const t = setTimeout(() => resolve(true), ms);
    token.onCancellationRequested(() => { clearTimeout(t); resolve(false); });
  });
  monaco.languages.registerInlineCompletionsProvider({ pattern: '**' }, {
    async provideInlineCompletions(model, position, context, token) {
      if (!settings.complete || completeState.off || model !== editor.getModel() || !state.active) return { items: [] };
      // Hanya saat mengetik (bukan saat dipicu manual) dan bukan di tengah kata.
      const line = model.getLineContent(position.lineNumber);
      const after = line.slice(position.column - 1);
      if (/^\w/.test(after)) return { items: [] };
      if (!(await wait(COMPLETE_DELAY, token))) return { items: [] };
      const full = model.getFullModelRange();
      const prefix = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
      const suffix = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: full.endLineNumber, endColumn: full.endColumn });
      if (!prefix.trim()) return { items: [] };
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      try {
        const res = await fetch('/api/ai/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Project': state.projectSlug },
          body: JSON.stringify({ path: state.active, prefix: prefix.slice(-6000), suffix: suffix.slice(0, 2000) }),
          credentials: 'same-origin',
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 503 || data.code === 'complete_limit') {
            completeState.off = true;
            if (data.code === 'complete_limit') toast(data.error, 'error');
          }
          return { items: [] };
        }
        if (token.isCancellationRequested || !data.completion) return { items: [] };
        return { items: [{ insertText: data.completion, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] };
      } catch {
        return { items: [] }; // dibatalkan atau jaringan putus
      }
    },
    freeInlineCompletions() {},
  });
}

// Editor kode di layar kecil: tanpa minimap, font sedikit lebih kecil, baris panjang dibungkus.
export function applyResponsiveEditor() {
  editor?.updateOptions(mobileQuery.matches
    ? { minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', lineNumbersMinChars: 3, folding: false, glyphMargin: false }
    : { minimap: { enabled: true }, fontSize: 14, wordWrap: 'off', lineNumbersMinChars: 5, folding: true });
}

// ---------- Status bar ----------
export function updateStatus() {
  const model = state.active && state.models.get(state.active);
  if (!model) {
    ui.cursor = ui.lang = '';
    return;
  }
  const pos = editor.getPosition();
  ui.cursor = pos ? `Ln ${pos.lineNumber}, Col ${pos.column}` : '';
  ui.lang = { html: 'HTML', css: 'CSS', javascript: 'JavaScript' }[model.getLanguageId()] ?? model.getLanguageId();
}

// Tema warna editor, disamakan dengan palet UI.
// Tema Monaco mengikuti tema editor: 'rakit' (gelap) dan 'rakit-light' (kertas krem).
export const monacoTheme = () => (isDark() ? 'rakit' : 'rakit-light');

export function defineTheme() {
  monaco.editor.defineTheme('rakit', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'd8dde8' },
      { token: 'comment', foreground: '5b6478', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'c4a7ff' },
      { token: 'string', foreground: '86efac' },
      { token: 'number', foreground: 'fdba74' },
      { token: 'regexp', foreground: 'f9a8d4' },
      { token: 'type', foreground: '67e8f9' },
      { token: 'identifier', foreground: 'd8dde8' },
      { token: 'delimiter', foreground: '8b93a7' },
      { token: 'tag', foreground: '7dd3fc' },
      { token: 'metatag', foreground: 'c4a7ff' },
      { token: 'attribute.name', foreground: 'f9a8d4' },
      { token: 'attribute.value', foreground: '86efac' },
      { token: 'attribute.value.number.css', foreground: 'fdba74' },
      { token: 'attribute.value.unit.css', foreground: 'fdba74' },
    ],
    colors: {
      'editor.background': '#11151f',
      'editor.foreground': '#d8dde8',
      'editor.lineHighlightBackground': '#161b27',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#16a34a40',
      'editor.inactiveSelectionBackground': '#16a34a22',
      'editorCursor.foreground': '#4ade80',
      'editorLineNumber.foreground': '#5d6780',
      'editorLineNumber.activeForeground': '#4ade80',
      'editorIndentGuide.background1': '#1c2231',
      'editorIndentGuide.activeBackground1': '#2f3850',
      'editorBracketMatch.background': '#16a34a26',
      'editorBracketMatch.border': '#16a34a80',
      'editorWidget.background': '#161b27',
      'editorWidget.border': '#2a3244',
      'editorSuggestWidget.background': '#161b27',
      'editorSuggestWidget.border': '#2a3244',
      'editorSuggestWidget.selectedBackground': '#16a34a30',
      'editorHoverWidget.background': '#161b27',
      'editorHoverWidget.border': '#2a3244',
      'minimap.background': '#11151f',
      'scrollbarSlider.background': '#ffffff12',
      'scrollbarSlider.hoverBackground': '#ffffff20',
      'scrollbarSlider.activeBackground': '#16a34a60',
      'editorGutter.background': '#11151f',
    },
  });
  monaco.editor.defineTheme('rakit-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: '2b2330' },
      { token: 'comment', foreground: '9a917f', fontStyle: 'italic' },
      { token: 'keyword', foreground: '7b4fb0' },
      { token: 'string', foreground: '2e7d4f' },
      { token: 'number', foreground: 'b45309' },
      { token: 'regexp', foreground: 'b8326e' },
      { token: 'type', foreground: '2f7f90' },
      { token: 'identifier', foreground: '2b2330' },
      { token: 'delimiter', foreground: '6f6657' },
      { token: 'tag', foreground: '2f6f80' },
      { token: 'metatag', foreground: '7b4fb0' },
      { token: 'attribute.name', foreground: 'b8326e' },
      { token: 'attribute.value', foreground: '2e7d4f' },
      { token: 'attribute.value.number.css', foreground: 'b45309' },
      { token: 'attribute.value.unit.css', foreground: 'b45309' },
    ],
    colors: {
      'editor.background': '#fffdf7',
      'editor.foreground': '#2b2330',
      'editor.lineHighlightBackground': '#fbf2dc',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#ffca5470',
      'editor.inactiveSelectionBackground': '#ffca5440',
      'editorCursor.foreground': '#1a1320',
      'editorLineNumber.foreground': '#948770',
      'editorLineNumber.activeForeground': '#8a5a00',
      'editorIndentGuide.background1': '#efe3c6',
      'editorIndentGuide.activeBackground1': '#d6c59e',
      'editorBracketMatch.background': '#ffca5440',
      'editorBracketMatch.border': '#d6a01e',
      'editorWidget.background': '#fffdf7',
      'editorWidget.border': '#d6c59e',
      'editorSuggestWidget.background': '#fffdf7',
      'editorSuggestWidget.border': '#d6c59e',
      'editorSuggestWidget.selectedBackground': '#ffca5455',
      'editorHoverWidget.background': '#fffdf7',
      'editorHoverWidget.border': '#d6c59e',
      'editorGhostText.foreground': '#a59a84',
      'minimap.background': '#fffdf7',
      'scrollbarSlider.background': '#1a132018',
      'scrollbarSlider.hoverBackground': '#1a132028',
      'scrollbarSlider.activeBackground': '#d6a01e80',
      'editorGutter.background': '#fffdf7',
    },
  });
}

// ---------- Memuat Monaco ----------
// Monaco (±900 KB dari CDN) dimuat paralel dan tidak menahan bagian lain editor: daftar file, preview, dan
// percakapan AI langsung tampil. Yang butuh Monaco (openFile, showDiff) menunggu editorReady.
export let editorReady;

// loader.js (AMD) disisipkan dari sini, bukan lewat <script> di HTML, supaya editor.js tidak menunggunya.
// Filenya sudah mulai diunduh sejak awal lewat <link rel="preload"> di editor.html.
// Skrip Monaco dari CDN dimuat dengan crossorigin (CDN-nya mengizinkan CORS): tanpa itu Chrome menyembunyikan
// galatnya dari halaman (event unhandledrejection tidak terkirim), jadi pembatalan biasa Monaco tidak bisa
// disaring di setupEditor. Loader Monaco tidak punya opsinya, jadi atributnya dipasang saat skrip disisipkan.
export function loadMonaco() {
  const head = document.head;
  const append = head.appendChild;
  head.appendChild = function appendChild(node) {
    if (node.tagName === 'SCRIPT' && node.src?.startsWith(window.MONACO_BASE)) node.crossOrigin = 'anonymous';
    return append.call(this, node);
  };
  return new Promise((resolve, reject) => {
    const start = () => {
      window.require.config({ paths: { vs: `${window.MONACO_BASE}/vs` } });
      window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
    };
    if (window.require?.config) return start();
    const script = document.createElement('script');
    script.crossOrigin = 'anonymous';
    script.src = `${window.MONACO_BASE}/vs/loader.js`;
    script.onload = start;
    script.onerror = () => reject(new Error('Gagal memuat Monaco'));
    document.head.append(script);
  });
}

export async function setupEditor() {
  // Monaco membatalkan pekerjaan latarnya (sorotan kata, tautan, dsb.) saat model berganti; pembatalan itu
  // muncul sebagai "Uncaught (in promise) Canceled" di konsol padahal tidak ada yang salah.
  window.addEventListener('unhandledrejection', (e) => {
    if (e.reason?.name === 'Canceled' && e.reason?.message === 'Canceled') e.preventDefault();
  });
  monaco = await loadMonaco();
  defineTheme();
  editor = monaco.editor.create($('#editor'), {
    model: null,
    theme: monacoTheme(),
    automaticLayout: true,
    fontFamily: getComputedStyle(document.body).getPropertyValue('--mono'),
    fontSize: 14,
    lineHeight: 22,
    fontLigatures: true,
    renderLineHighlight: 'all',
    cursorBlinking: 'smooth',
    roundedSelection: true,
    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    tabSize: 2,
    insertSpaces: true,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorSmoothCaretAnimation: 'on',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true },
    renderWhitespace: 'selection',
    wordWrap: 'off',
    linkedEditing: true, // rename tag pembuka/penutup HTML bersamaan
    inlineSuggest: { enabled: settings.complete },
    padding: { top: 8 },
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => state.active && save(state.active));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyS, saveAll);
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => toggleAi());
  // Klik kanan di kode: kirim bagian yang dipilih (atau baris kursor) ke panel AI.
  const codeForAi = (ed) => {
    const model = ed.getModel();
    let sel = ed.getSelection();
    if (!model || !state.active || !sel) return null;
    if (sel.isEmpty()) sel = new monaco.Range(sel.startLineNumber, 1, sel.startLineNumber, model.getLineMaxColumn(sel.startLineNumber));
    const lines = sel.startLineNumber === sel.endLineNumber ? `baris ${sel.startLineNumber}` : `baris ${sel.startLineNumber}–${sel.endLineNumber}`;
    return `Di file ${state.active} ${lines}:\n\`\`\`\n${clipText(model.getValueInRange(sel), 4000)}\n\`\`\`\n\n`;
  };
  editor.addAction({
    id: 'rakit.aiChange', label: '✦ Minta AI mengubah kode ini', contextMenuGroupId: 'navigation', contextMenuOrder: 0,
    run: (ed) => { const code = codeForAi(ed); if (code) askAi(`${code}Ubah bagian ini supaya `, 'build'); },
  });
  editor.addAction({
    id: 'rakit.aiExplain', label: '✦ Tanya AI tentang kode ini', contextMenuGroupId: 'navigation', contextMenuOrder: 0.1,
    run: (ed) => { const code = codeForAi(ed); if (code) askAi(`${code}Jelaskan apa yang dilakukan kode ini dengan bahasa sederhana.`, 'plan'); },
  });
  // Di Mac, Monaco hanya memakai ⌘F (cari) & ⌥⌘F (ganti). Banyak pengguna terbiasa Ctrl+F / Ctrl+H dari
  // Windows, jadi tombol Ctrl yang asli (WinCtrl di Monaco) juga dipasang. Di Windows/Linux Ctrl+F sudah bawaan.
  if (/Mac|iPhone|iPad/.test(navigator.platform)) {
    editor.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyF, () => editor.getAction('actions.find')?.run());
    editor.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyH, () => editor.getAction('editor.action.startFindReplaceAction')?.run());
  }
  editor.onDidChangeCursorPosition(updateStatus);
  registerCompletion();
  applyResponsiveEditor();
  // Font editor (JetBrains Mono) dimuat tanpa menahan halaman, jadi bisa selesai SETELAH Monaco mengukur lebar
  // huruf dengan font cadangan (mis. Consolas di Windows, jauh lebih sempit). Tanpa ukur ulang, kursor, klik,
  // dan seleksi meleset dari teksnya.
  const remeasure = () => monaco.editor.remeasureFonts();
  document.fonts?.ready.then(remeasure);
  document.fonts?.addEventListener('loadingdone', remeasure);
}

// Mulai memuat Monaco (tanpa ditunggu); editorReady selesai saat editor kode siap dipakai.
export function startEditor() {
  editorReady = setupEditor();
  editorReady.catch((err) => {
    console.error(err);
    toast('Editor kode gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.', 'error');
  });
}
