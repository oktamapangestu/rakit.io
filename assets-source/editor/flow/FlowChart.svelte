<!-- Diagram alur langkah-langkah (Mermaid). Klik kotak -> buka langkahnya; langkah aktif ditandai. -->
<script>
  import { getContext } from 'svelte';
  import { flowChartCode } from './text.js';

  let { steps, step, onSelect } = $props();
  const { loadMermaid } = getContext('editor');

  let box = $state();
  let status = $state('loading'); // loading | ready | error
  let seq = 0;

  $effect(() => {
    const code = flowChartCode(steps);
    const mySeq = ++seq;
    const id = `flowchart-render-${Date.now()}`;
    status = 'loading';
    (async () => {
      try {
        const mermaid = await loadMermaid();
        const { svg: markup } = await mermaid.render(id, code);
        if (mySeq !== seq || !box?.isConnected) return;
        const svgEl = new DOMParser().parseFromString(markup, 'text/html').querySelector('svg');
        if (!svgEl) throw new Error('Mermaid tidak menghasilkan SVG');
        const imported = document.importNode(svgEl, true);
        const vb = imported.viewBox?.baseVal;
        Object.assign(imported.style, { width: `${vb?.width || 300}px`, maxWidth: '100%', height: 'auto' });
        imported.querySelectorAll('g.node').forEach((node) => {
          const m = node.id.match(/flowchart-S(\d+)-/);
          if (!m) return;
          node.dataset.step = m[1];
          node.style.cursor = 'pointer';
          node.addEventListener('click', () => onSelect(Number(m[1]) - 1));
        });
        box.replaceChildren(imported);
        status = 'ready';
      } catch (err) {
        console.error(err);
        if (mySeq === seq) status = 'error';
      } finally {
        // Mermaid meninggalkan elemen sementara di <body>.
        ['', 'd', 'i'].forEach((p) => {
          const el = document.getElementById(`${p}${id}`);
          if (el && !box?.contains(el)) el.remove();
        });
      }
    })();
  });

  // Tandai kotak langkah aktif.
  $effect(() => {
    if (status !== 'ready') return;
    box.querySelectorAll('g.node').forEach((node) => {
      node.classList.toggle('flow-node-active', Number(node.dataset.step) === step + 1);
    });
  });
</script>

<div class="flow-chart-box">
  {#if status === 'loading'}
    <div class="flow-muted"><span class="dots"><i></i><i></i><i></i></span> Menggambar diagram…</div>
  {:else if status === 'error'}
    <div class="flow-muted">Diagram alur tidak bisa digambar untuk file ini.</div>
  {/if}
  <div class="flow-chart-svg" bind:this={box} style:display={status === 'ready' ? 'contents' : 'none'}></div>
</div>
