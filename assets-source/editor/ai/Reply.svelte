<!--
  Jawaban AI. Plan: rencana + tombol "Jalankan rencana ini". Builder dengan perubahan: kartu daftar perubahan; selama
  menunggu (applyState pending) perubahannya sudah tampil di preview dan bisa Disimpan atau Dibatalkan.
-->
<script>
  import { getContext, untrack } from 'svelte';
  import { ai, setMode, setInput, send, settle, startAutoFix, cancelAutoFix, scrollToEnd } from './state.svelte.js';
  import { con } from '../console/state.svelte.js';
  import { clipText } from '../handoff.js';
  import AiButton from '../AiButton.svelte';

  let { m } = $props();
  const { renderMarkdown, showDiff, openTable } = getContext('editor');

  // Elemennya sendiri menjadi div.md hasil renderMarkdown (tanpa pembungkus), sama seperti tampilan lama.
  function md(node, text) {
    const draw = (t) => {
      const out = renderMarkdown(t || 'Selesai.');
      node.className = out.className;
      node.replaceChildren(...out.childNodes);
    };
    draw(text);
    return { update: draw };
  }

  let ran = $state(false);
  function runPlan() {
    if (ai.busy) return;
    ran = true;
    setMode('build');
    setInput('Jalankan rencana di atas.');
    send();
  }

  const kind = (c) => (c.action === 'table' ? 'table' : c.action === 'delete' ? 'delete' : m.before[c.path] == null ? 'new' : 'edit');
  const label = { new: 'baru', edit: 'ubah', delete: 'hapus', table: 'tabel' };

  // Error di preview (console & request gagal, lihat tab Console) sejak perubahan jawaban ini diterapkan.
  const previewErrors = $derived(ai.watch?.id === m.id
    ? con.entries.filter((e) => e.time >= ai.watch.since && e.level === 'error' && (e.source === 'fe' || e.source === 'net'))
    : []);
  const errorCount = $derived(previewErrors.reduce((n, e) => n + e.count, 0));
  const errorLine = (e) => `[${e.page || '/'}] ${clipText(e.text, 600)}${e.count > 1 ? ` (${e.count}×)` : ''}`;
  function fixPrompt() {
    const lines = previewErrors.slice(-8).map((e) => `- ${errorLine(e)}`);
    return `Setelah perubahan terakhir, preview menampilkan error ini:\n${lines.join('\n')}\n\nCari penyebabnya (terutama di kode yang baru diubah) dan perbaiki.`;
  }

  // Error yang bisa diperbaiki AI tanpa bantuan pengguna: error JavaScript, file script/stylesheet yang gagal dimuat,
  // dan request yang gagal. Gambar yang belum diunggah dan request yang ditolak karena belum login tidak dihitung.
  const fixable = (e) => e.source === 'fe'
    || (e.source === 'net' && !/^Gagal memuat <(img|video|audio|source|iframe)\b/.test(e.text) && ![401, 403, 429].includes(e.status));
  const autoErrors = () => previewErrors.filter(fixable).slice(-8).map(errorLine);
  $effect(() => {
    if (previewErrors.some(fixable)) untrack(() => startAutoFix(m, autoErrors));
  });
  // Bar error muncul setelah kartu ini tampil: gulir supaya tidak tertutup kotak prompt (sekali saja).
  let shown = false;
  $effect(() => {
    if (errorCount > 0 && !shown) {
      shown = true;
      untrack(scrollToEnd);
    }
  });
  const counting = $derived(ai.autoFix?.id === m.id);

  let settling = $state(null); // 'keep' | 'revert' selama menunggu server
  async function act(action) {
    settling = action;
    await settle(m, action);
    settling = null;
  }
</script>

<!-- .msg memakai white-space: pre-wrap: isi ditulis rapat (spasi/baris baru di antara elemen akan ikut tampil). -->
<div class="msg assistant" class:plan={m.mode === 'plan'}>{#if m.mode === 'plan'}<div class="plan-label">Rencana</div>{/if}<div use:md={m.content}></div>{#if m.mode === 'plan'}<button
  type="button" class="plan-run" disabled={ran} onclick={runPlan}>{ran ? 'Dijalankan di mode Builder' : '▶ Jalankan rencana ini'}</button>{:else if m.changes?.length}<div
  class="changes"><div class="changes-head"><span>{`${m.changes.length} perubahan`}</span></div>{#each m.changes as c, i (i)}{#if c.action === 'table'}<button
    type="button" class="change-row" title="Buka di editor database" onclick={() => openTable(c.name)}><span class="badge table">{label.table}</span><span
    class="path">{`${c.name} (${c.columns.map((col) => col.name).join(', ')})`}</span><span class="view">buka</span></button>{:else}<button
    type="button" class="change-row" title={c.action === 'delete' ? c.path : 'Lihat perubahan'} onclick={() => (c.action === 'delete' ? null : showDiff(c, m.before[c.path] ?? ''))}><span
    class="badge {kind(c)}">{label[kind(c)]}</span><span class="path">{c.path}</span>{#if c.action !== 'delete'}<span class="view">lihat</span>{/if}</button>{/if}{/each}<div
    class="changes-actions">{#if m.applyState === 'pending'}<span class="changes-question">Perubahan sudah tampil di preview. Simpan perubahan ini?</span><button
      type="button" class="apply" disabled={Boolean(settling)} onclick={() => act('keep')}>✓ Simpan</button><button
      type="button" disabled={Boolean(settling)} onclick={() => act('revert')}>{settling === 'revert' ? 'Mengembalikan…' : 'Batalkan'}</button>{:else if m.applyState === 'kept'}<span
      class="changes-status">✓ Perubahan disimpan</span>{:else if m.applyState === 'reverted'}<span
      class="changes-status muted">↩ Dibatalkan — file dikembalikan ke versi sebelumnya</span>{:else if m.applyState === 'failed'}<span
      class="changes-status error">{m.error || 'Gagal menerapkan perubahan. File dikembalikan seperti semula.'}</span>{/if}</div>{#if errorCount}<div
    class="preview-errors" class:counting role="status"><span>{`⚠ Preview menampilkan ${errorCount} error setelah perubahan ini.`}</span>{#if counting}<span
      class="preview-autofix">{`AI memperbaikinya otomatis (gratis) dalam ${ai.autoFix.left} dtk…`}</span><button type="button" class="preview-fix"
      onclick={cancelAutoFix}>Jangan</button>{:else}<AiButton label="Perbaiki dengan AI" text={fixPrompt} cls="preview-fix" />{/if}</div>{/if}</div>{/if}</div>
