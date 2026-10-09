<!--
  Kanvas diagram (#diagramCanvas): memuat, proses AI, belum dibuat, gagal digambar, atau gambar Mermaid yang bisa
  di-zoom & digeser (panzoom.js). Di mode Edit, pratinjau digambar ulang tiap kode berubah dengan posisi & zoom
  dipertahankan, dan klik teks di diagram menggantinya di kode.
-->
<script>
  import { getContext, tick, untrack } from 'svelte';
  import Icon from '../Icon.svelte';
  import { DIAGRAM_NAMES } from './info.js';
  import { diagram, savedKind, setCanvas, setEditError, fitDiagram, load, generate, renameLabel, costPerPrompt } from './state.svelte.js';
  import { panZoom } from './panzoom.js';

  const { loadMermaid, icons } = getContext('editor');

  // shown: drawing | ready | failed | editFailed — keadaan gambar untuk diagram tersimpan yang sedang dibuka.
  let shown = $state('drawing');
  let failure = $state(null); // { message, canFix }
  let svgNode = $state.raw(null);
  let canvas = $state();
  let seq = 0; // hanya render terakhir yang boleh tampil (tab bisa diganti cepat)

  $effect(() => { setCanvas(canvas); });

  const code = $derived(diagram.edit ? diagram.edit.preview : savedKind()?.code ?? '');

  // Gambar ulang saat jenis, kode, atau status berubah. draw() sendiri membaca & menulis keadaan kanvas, jadi tidak
  // dilacak (untrack) supaya tidak memicu dirinya sendiri.
  $effect(() => {
    void diagram.tick;
    const saved = savedKind();
    const source = code;
    const editing = Boolean(diagram.edit);
    if (!diagram.saved || diagram.busy === diagram.kind || !saved) return;
    untrack(() => draw(source, editing, saved));
  });

  // Mermaid kadang meninggalkan elemen sementara di <body> (terutama saat gagal): bersihkan. SVG yang sedang tampil
  // memakai id yang sama (gayanya bergantung pada id itu), jadi isi kanvas tidak boleh ikut terhapus.
  const cleanupMermaid = (id) => ['', 'd', 'i'].forEach((p) => {
    const el = document.getElementById(`${p}${id}`);
    if (el && !canvas?.contains(el)) el.remove();
  });

  async function draw(source, editing, saved) {
    const mySeq = ++seq;
    // Saat mengedit, pratinjau digambar ulang tiap kode berubah: posisi & zoom dipertahankan.
    const keepView = editing && shown === 'ready';
    if (!keepView) {
      diagram.view.w = 0;
      shown = 'drawing';
    }
    const id = `diagram-${mySeq}`;
    try {
      const mermaid = await loadMermaid();
      const { svg: markup } = await mermaid.render(id, source);
      if (mySeq !== seq) return;
      if (editing) setEditError(null);
      // Parse di dokumen terpisah lalu pindahkan elemen SVG-nya (tanpa innerHTML). Parser HTML dipakai karena label
      // Mermaid berisi HTML (mis. <br>) yang tidak valid sebagai XML murni.
      const svgEl = new DOMParser().parseFromString(markup, 'text/html').querySelector('svg');
      if (!svgEl) throw new Error('Mermaid tidak menghasilkan SVG');
      const imported = document.importNode(svgEl, true);
      const vb = imported.viewBox?.baseVal;
      const width = vb?.width || 800;
      const height = vb?.height || 600;
      // Mermaid memberi width="100%": ganti dengan ukuran aslinya. Inline style, karena aturan global
      // `svg { width: 16px }` (untuk ikon) mengalahkan atribut width/height.
      Object.assign(imported.style, { width: `${width}px`, height: `${height}px`, maxWidth: 'none' });
      Object.assign(diagram.view, { w: width, h: height });
      svgNode = imported;
      shown = 'ready';
      if (!keepView) {
        await tick();
        fitDiagram();
      }
    } catch (err) {
      if (mySeq !== seq) return;
      const message = String(err.message || err).slice(0, 1000);
      // Sedang mengedit: kesalahan ditampilkan di panel kode; gambar terakhir yang berhasil tetap terlihat.
      if (editing) {
        setEditError(message);
        if (!keepView) shown = 'editFailed';
        return;
      }
      console.error(err);
      // Kode buatan AI kadang salah tulis: minta AI memperbaikinya (gratis, beberapa kali per diagram).
      failure = { message, canFix: saved.canFix };
      shown = 'failed';
    } finally {
      cleanupMermaid(id);
    }
  }

  // Elemen yang dibuat di luar Svelte (SVG Mermaid, panel proses AI) dipasang apa adanya.
  function place(node, el) {
    const put = (x) => node.replaceChildren(...(x ? [x] : []));
    put(el);
    return { update: put };
  }
  function append(node, el) {
    let current = el;
    if (el) node.append(el);
    return {
      update(next) {
        if (next === current) return;
        current?.remove();
        current = next;
        if (next) node.append(next);
      },
      destroy() { current?.remove(); },
    };
  }

  // Klik (bukan seret) teks di diagram saat mode Edit.
  const LABEL_TAGS = new Set(['text', 'tspan', 'span', 'p', 'div', 'b', 'strong', 'i', 'em']);
  function labelAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (!el.closest('#diagramCanvas .diagram-stage')) continue;
      const box = LABEL_TAGS.has(el.localName) ? el : el.closest('g.node, g.cluster')?.querySelector('.nodeLabel, text');
      const text = box?.textContent.replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    return '';
  }
  let down = null;
  function onclick(e) {
    if (!diagram.edit || diagram.busy || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const label = labelAt(e.clientX, e.clientY);
    if (label) renameLabel(label);
  }

  const v = $derived(diagram.view);
</script>

{#snippet message(title, text)}
  <div class="db-empty-icon diagram-empty-icon"><Icon d={icons.table} /></div>
  <h3>{title}</h3>
  <p>{text}</p>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="diagram-canvas" id="diagramCanvas" tabindex="0" aria-label="Kanvas diagram. Scroll atau cubit untuk zoom, seret untuk geser."
  bind:this={canvas} use:panZoom onpointerdowncapture={(e) => { down = [e.clientX, e.clientY]; }} {onclick}>
  {#if diagram.loadError}
    <div class="db-empty">
      <h3>Gagal memuat diagram</h3>
      <p>{diagram.loadError}</p>
      <div class="diagram-actions"><button type="button" class="fn-btn primary" onclick={load}>Coba lagi</button></div>
    </div>
  {:else if !diagram.saved}
    <div class="diagram-loading"><span class="dots"><i></i><i></i><i></i></span>Memuat diagram…</div>
  {:else if diagram.busy === diagram.kind}
    <!-- Proses AI (berpikir & kode Mermaid yang sedang ditulis) tampil di bawah status selama diagram dibuat. -->
    <div class="diagram-progress" use:append={diagram.activity?.el}>
      <div class="diagram-loading"><span class="dots"><i></i><i></i><i></i></span><span>{diagram.status}</span></div>
    </div>
  {:else if !savedKind()}
    <div class="db-empty">
      {@render message(`Belum ada diagram ${DIAGRAM_NAMES[diagram.kind]}`, `AI akan membaca file & database project lalu menggambarnya. Memakai ${costPerPrompt()} kredit AI.`)}
      <div class="diagram-actions"><button type="button" class="fn-btn primary" onclick={() => generate()}>Buat diagram dengan AI</button></div>
    </div>
  {:else if shown === 'drawing'}
    <div class="diagram-loading"><span class="dots"><i></i><i></i><i></i></span>Menggambar diagram…</div>
  {:else if shown === 'editFailed'}
    <div class="db-empty">{@render message('Kode diagram belum benar', 'Perbaiki kodenya di panel kiri, atau minta AI mengubahnya.')}</div>
  {:else if shown === 'failed'}
    <div class="db-empty">
      {@render message('Diagram gagal digambar', failure.canFix ? 'Kode diagram dari AI ada yang salah. Minta AI memperbaikinya (gratis), atau buat ulang.' : 'Kode diagram dari AI ada yang salah. Coba buat ulang dengan Update diagram.')}
      <div class="diagram-actions">
        {#if failure.canFix}<button type="button" class="fn-btn primary" onclick={() => generate(failure.message)}>Perbaiki dengan AI</button>{/if}
        <button type="button" class="fn-btn" class:primary={!failure.canFix} onclick={() => generate()}>Update diagram</button>
      </div>
      <p class="diagram-error">{failure.message.slice(0, 300)}</p>
    </div>
  {:else}
    <div class="diagram-stage" style:transform="translate({v.x}px, {v.y}px) scale({v.z})" use:place={svgNode}></div>
    <!-- Petunjuk hilang setelah dipakai. -->
    <div class="diagram-hint" class:gone={v.touched}>{diagram.edit
      ? 'Klik teks di diagram untuk menggantinya · scroll atau cubit untuk zoom · seret untuk geser'
      : 'Scroll atau cubit untuk zoom · seret untuk geser · klik dua kali untuk memperbesar'}</div>
  {/if}
</div>
