// Baca Alur Kode: panel di samping editor kode yang menjelaskan alur file langkah demi langkah, sorotan baris di
// Monaco, dan tanya jawab tentang file itu.
import { flushSync } from 'svelte';
import { core as state } from '../files/state.svelte.js';
import { toast, ui } from '../shell/state.svelte.js';
import { flow, flowSteps, flowStale } from '../flow/state.svelte.js';
import { extOf, isImage, storage } from './util.js';
import { api } from './api.js';
import { editor, editorReady, monaco } from './monaco.js';
import { openFile, openImage } from './files.js';

// ---------- Baca Alur Kode ----------
// Panel di samping editor kode: AI menjelaskan alur file yang sedang dibuka langkah demi langkah. Klik langkah →
// barisnya disorot di editor; klik baris di editor → langkahnya dibuka. Rujukan ke file lain membuka file itu
// (dengan tombol kembali). Gratis dengan batas harian; hasil disimpan server per file + hash isi.
// Keadaan panel ada di assets-source/editor/flow/state.svelte.js (dipakai juga FlowPanel.svelte). Id dekorasi
// Monaco per file disimpan di sini.
flow.showChart = storage.get('rakit.flowChart', true);
export const flowDeco = new Map(); // path -> id dekorasi Monaco di model file itu
export const FLOW_EXT = ['html', 'css', 'js'];
export const canFlow = (path) => Boolean(path) && FLOW_EXT.includes(extOf(path));

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function toggleFlow(force = !flow.open) {
  flow.open = force;
  storage.set('rakit.flowOpen', flow.open);
  stopFlowPlay();
  if (flow.open) {
    mountFlowPanel();
    flowFollow(true);
  } else {
    applyFlowHighlight();
  }
}

// Panel mengikuti file aktif: muat penjelasan tersimpan (tanpa AI) bila ganti file.
export async function flowFollow(force = false) {
  if (!flow.open) return;
  const path = state.active;
  if (!canFlow(path)) {
    flow.path = null;
    flow.saved = null;
    renderFlow();
    return;
  }
  if (path === flow.path && !force) {
    applyFlowHighlight();
    return;
  }
  const seq = ++flow.seq;
  let want = null;
  if (path !== flow.path) {
    flow.path = path;
    flow.saved = null;
    flow.step = 0;
    if (flow.pending?.path === path) want = flow.pending.step;
    flow.pending = null;
  }
  flow.hash = await sha256(state.models.get(path)?.getValue() ?? '');
  renderFlow();
  try {
    const out = await api('GET', `/api/ai/explain?path=${encodeURIComponent(path)}`);
    if (seq !== flow.seq) return;
    flow.saved = out.saved;
    flow.remaining = out.remaining;
    flow.limit = out.limit;
    if (want != null) flow.step = want;
    flow.step = Math.min(flow.step, Math.max(0, flowSteps().length - 1));
  } catch (err) {
    if (seq !== flow.seq) return;
    toast(err.message, 'error');
  }
  renderFlow();
}

export let flowStaleTimer;
export function flowContentChanged(path) {
  if (!flow.open || path !== flow.path) return;
  clearTimeout(flowStaleTimer);
  flowStaleTimer = setTimeout(async () => {
    const was = flowStale();
    flow.hash = await sha256(state.models.get(path)?.getValue() ?? '');
    if (was !== flowStale()) renderFlow();
  }, 400);
}

export async function explainFlow(force = false) {
  const path = flow.path;
  const model = state.models.get(path);
  if (!model || flow.loading) return;
  const content = model.getValue();
  flow.loading = path;
  stopFlowPlay();
  renderFlow();
  try {
    const out = await api('POST', '/api/ai/explain', { path, content, force });
    flow.remaining = out.remaining;
    flow.limit = out.limit;
    if (flow.path === path) {
      flow.saved = out.saved;
      flow.hash = out.saved.hash;
      flow.step = 0;
      delete flow.chats[path];
    }
    if (out.cached) toast('Penjelasan untuk isi file ini sudah ada — ditampilkan tanpa memakai jatah.');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    flow.loading = null;
    if (flow.path === path) renderFlow();
  }
}

// ---------- Sorotan di editor ----------
// Dekorasi dipasang langsung di model file (bukan di editor), supaya tidak tertinggal saat ganti tab.
export function setFlowDecorations(marks) {
  for (const [p, ids] of flowDeco) {
    const m = state.models.get(p);
    if (m && !m.isDisposed()) m.deltaDecorations(ids, []);
  }
  flowDeco.clear();
  const model = editor?.getModel();
  if (model && marks.length) flowDeco.set(state.active, model.deltaDecorations([], marks));
}

export function flashLines(a, b) {
  const model = editor.getModel();
  if (!model) return;
  const ids = model.deltaDecorations([], [{ range: new monaco.Range(a, 1, b, 1), options: { isWholeLine: true, className: 'flow-flash' } }]);
  editor.revealLinesInCenterIfOutsideViewport(a, b, monaco.editor.ScrollType.Smooth);
  setTimeout(() => { if (!model.isDisposed()) model.deltaDecorations(ids, []); }, 2400);
}

export function applyFlowHighlight({ reveal = false } = {}) {
  if (!editor || !monaco) return;
  const steps = flowSteps();
  if (!flow.open || !steps.length || state.active !== flow.path) return setFlowDecorations([]);
  const active = steps[flow.step];
  const marks = [];
  steps.forEach((s, i) => {
    for (const [a, b] of s.lines) {
      const on = i === flow.step;
      marks.push({
        range: new monaco.Range(a, 1, b, 1),
        options: {
          isWholeLine: true,
          className: on ? 'flow-line' : undefined,
          linesDecorationsClassName: on ? 'flow-gutter active' : 'flow-gutter',
          overviewRuler: on ? { color: '#d6a01e', position: monaco.editor.OverviewRulerLane.Center } : undefined,
        },
      });
    }
    const first = s.lines[0];
    if (first) {
      marks.push({
        range: new monaco.Range(first[0], 1, first[0], 1),
        options: { before: { content: ` ${s.id} `, inlineClassName: i === flow.step ? 'flow-badge active' : 'flow-badge' } },
      });
    }
  });
  setFlowDecorations(marks);
  if (reveal && active?.lines.length) {
    const [a] = active.lines[0];
    const b = active.lines.at(-1)[1];
    editor.revealLinesInCenterIfOutsideViewport(a, b, monaco.editor.ScrollType.Smooth);
  }
}

// Klik baris di editor → langkah yang mencakup baris itu (rentang terkecil) dibuka di panel.
export function flowSyncFromCursor(e) {
  if (!flow.open || e.source !== 'mouse' || state.active !== flow.path || flowStale()) return;
  const line = e.position.lineNumber;
  let best = -1;
  let size = Infinity;
  flowSteps().forEach((s, i) => {
    for (const [a, b] of s.lines) {
      if (line >= a && line <= b && b - a < size) {
        best = i;
        size = b - a;
      }
    }
  });
  if (best >= 0 && best !== flow.step) selectFlowStep(best, { reveal: false });
}

export function selectFlowStep(i, { reveal = true } = {}) {
  const steps = flowSteps();
  if (!steps.length) return;
  flow.step = Math.max(0, Math.min(steps.length - 1, i));
  if (state.active !== flow.path) {
    // Kembali ke file yang dijelaskan (activate → flowFollow memasang sorotan lagi).
    flow.back = flow.back.filter((b) => b.path !== flow.path);
    openFile(flow.path).then(() => applyFlowHighlight({ reveal }));
  } else {
    applyFlowHighlight({ reveal });
  }
}

export function stopFlowPlay() {
  clearInterval(flow.playTimer);
  flow.playTimer = null;
}

export function toggleFlowPlay() {
  if (flow.playTimer) return stopFlowPlay();
  if (flow.step >= flowSteps().length - 1) selectFlowStep(0);
  flow.playTimer = setInterval(() => {
    if (flow.step >= flowSteps().length - 1) return stopFlowPlay();
    selectFlowStep(flow.step + 1);
  }, 6000);
}

// Buka file rujukan; baris yang dirujuk disorot sebentar. Tombol "Kembali" mengembalikan ke langkah ini.
export async function openFlowRef(ref) {
  if (!state.entries.some((e) => e.path === ref.path)) return toast(`${ref.path} tidak ada lagi di project`, 'error');
  stopFlowPlay();
  if (isImage(ref.path)) return openImage(ref.path);
  if (ref.path !== flow.path && flow.path) flow.back = [...flow.back, { path: flow.path, step: flow.step }].slice(-20);
  await openFile(ref.path);
  if (ref.line && editor && state.active === ref.path) {
    const total = editor.getModel().getLineCount();
    const line = Math.min(ref.line, total);
    editor.setPosition({ lineNumber: line, column: 1 });
    flashLines(line, line);
  }
}

export async function flowGoBack() {
  const prev = flow.back.pop();
  if (!prev) return;
  if (!state.entries.some((e) => e.path === prev.path)) return renderFlow();
  if (flow.path === prev.path) return selectFlowStep(prev.step);
  flow.pending = prev; // flowFollow membuka langkah ini setelah penjelasannya dimuat
  await openFile(prev.path);
}

// ---------- Tampilan panel ----------
// Panel digambar FlowPanel.svelte dari state flow; aksi di bawah ini (dan di atas) yang menyentuh Monaco/file.
export function mountFlowPanel() {
  ui.loaded.flow = true;
  flushSync();
}

// Dulu menggambar ulang panel; kini tinggal efek sampingnya: putaran otomatis berhenti dan sorotan di editor
// diperbarui (digulir ke langkah aktif bila penjelasannya tampil).
export function renderFlow() {
  if (!flow.open) return;
  stopFlowPlay();
  applyFlowHighlight({ reveal: Boolean(flow.path && flow.loading !== flow.path && flowSteps().length) });
}

export async function flashFlowLines(a, b) {
  if (state.active !== flow.path) await openFile(flow.path);
  const total = editor.getModel()?.getLineCount() ?? 0;
  if (!total) return;
  a = Math.min(Math.max(1, a), total);
  b = Math.min(Math.max(a, b), total);
  flashLines(a, b);
}

export async function askFlow(input) {
  const question = input.value.trim();
  const path = flow.path;
  const model = state.models.get(path);
  if (!question || !model || flow.asking) return;
  flow.chats[path] ??= [];
  const chat = flow.chats[path];
  const history = chat.filter((c) => c.a).slice(-6);
  chat.push({ q: question, a: '' });
  const entry = chat.at(-1); // lewat state supaya jawabannya langsung tampil
  input.value = '';
  flow.asking = true;
  try {
    const out = await api('POST', '/api/ai/explain/ask', {
      path, content: model.getValue(), step: flowStale() ? 0 : flow.step + 1, question, history,
    });
    entry.a = out.answer;
    flow.remaining = out.remaining;
  } catch (err) {
    chat.splice(chat.indexOf(entry), 1);
    input.value = question;
    toast(err.message, 'error');
  } finally {
    flow.asking = false;
  }
}

export function bindFlowEvents() {
  editorReady.then(() => {
    editor.onDidChangeCursorPosition(flowSyncFromCursor);
    if (storage.get('rakit.flowOpen', false)) toggleFlow(true);
  }).catch(() => { /* pesan sudah ditampilkan */ });
}
