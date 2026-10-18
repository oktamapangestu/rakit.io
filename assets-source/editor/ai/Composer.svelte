<!--
  Kotak prompt: blok pilihan dari preview (#aiBlocks, diisi renderBlocks di editor.js), lampiran gambar (pilih, tempel,
  atau seret), mode Builder/Agen/Plan (Agen: pilihan mesin, bila server punya), dan kirim. Banner muncul saat kredit habis.
-->
<script>
  import { getContext } from 'svelte';
  import Icon from '../Icon.svelte';
  import { ai, AI_MODES, AGENT_ENGINES, SHOW_AGENT_MODE, activeMode, currentEngine, setEngine, canAfford, promptCost, contextUsage, setMode, send, addImages, removeImage } from './state.svelte.js';
  import { preview, pageName } from '../preview/state.svelte.js';

  const { openTopup, autoFocus, icons, pickParent, pickRemove } = getContext('editor');
  const blocks = $derived(preview.pick.blocks);
  const manyPages = $derived(new Set(blocks.map((b) => b.page)).size > 1);

  const c = $derived(ai.credits);
  const empty = $derived(Boolean(c?.enabled) && !canAfford(c, c.costPerPrompt));
  const canSend = $derived(Boolean(c?.enabled) && canAfford(c, promptCost()) && !ai.busy && !ai.applying);
  const placeholder = $derived(blocks.length
    ? 'Mau blok ini diubah jadi seperti apa? Mis. buat lebih modern dengan warna gelap'
    : AI_MODES[activeMode()].placeholder);
  const agents = $derived(c?.agents ?? []);

  // Isi jendela konteks AI pada jawaban terakhir: cincin kecil + persen di samping tombol kirim.
  const usage = $derived(contextUsage());
  const kTok = (n) => `${Math.round(n / 100) / 10}k`;
  const RING = 2 * Math.PI * 6; // keliling lingkaran r=6

  // Kotak prompt membesar mengikuti isinya (maks. 200 px), juga saat diisi dari luar (mis. tombol "Tanya AI").
  let input;
  $effect(() => {
    void ai.input;
    if (!input.offsetParent) return; // panel tersembunyi: ukurannya belum bisa diukur
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  });

  let drop = $state(false);
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');

  function pick() {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = 'image/png,image/jpeg,image/webp';
    el.multiple = true;
    el.onchange = () => addImages(el.files);
    el.click();
  }
</script>

<div class="ai-topup" id="aiTopupBanner" hidden={!empty}>
  <span id="aiTopupText">{!c ? 'Kredit AI kamu habis.' : c.topupEnabled
    ? 'Kredit AI kamu habis.'
    : c.bonusRemaining > 0
      ? `Masih ada bonus awal ${c.bonusRemaining} kredit.`
      : `Kredit AI hari ini habis (gratis ${c.limit}/hari). Terisi lagi besok 00.00 WIB.`}</span>
  <button type="button" class="ai-topup-btn" id="aiTopupBtn" hidden={!c?.topupEnabled} onclick={() => openTopup()}>Isi ulang kredit</button>
</div>
<form class="ai-composer" id="aiForm" class:drop
  onsubmit={(e) => { e.preventDefault(); send(); }}
  ondragover={(e) => { if (!hasFiles(e) || !c?.images) return; e.preventDefault(); drop = true; }}
  ondragleave={() => { drop = false; }}
  ondrop={(e) => { if (!e.dataTransfer?.files?.length || !c?.images) return; e.preventDefault(); drop = false; addImages(e.dataTransfer.files); }}>
  <!-- Blok yang dipilih di preview: ⬆ = perbesar ke bagian induknya (hanya di halaman yang sedang tampil). -->
  <div class="ai-blocks" id="aiBlocks" hidden={!blocks.length}>
    {#each blocks as b (`${b.page} ${b.selector}`)}
      {@const here = b.page === preview.pick.page}
      <span class="ai-block" class:other-page={!here} title={`${b.page} · ${b.selector}`}><Icon d={icons.block} /><span class="ai-block-label">{b.label}</span>{#if manyPages}<span
        class="ai-block-page">{pageName(b.page)}</span>{/if}{#if here}<button type="button" title="Perbesar ke bagian induknya" aria-label={`Perbesar ${b.label}`} onclick={() => pickParent(b)}>⬆</button>{/if}<button
        type="button" title="Lepas blok ini" aria-label={`Lepas ${b.label}`} onclick={() => pickRemove(b)}>×</button></span>
    {/each}
  </div>
  <div class="ai-attachments" id="aiAttachments" hidden={!ai.images.length}>
    {#each ai.images as img, i (img.thumb)}
      <span class="ai-thumb"><img src={img.thumb} alt={`Gambar ${i + 1}`}><button type="button" title="Hapus gambar" aria-label="Hapus gambar" onclick={() => removeImage(i)}>×</button></span>
    {/each}
    {#if ai.images.length}<span class="ai-attach-note">{`Prompt dengan gambar memakai ${c?.images?.cost} kredit`}</span>{/if}
  </div>
  <textarea id="aiInput" rows="3" maxlength="20000" {placeholder} bind:this={input} bind:value={ai.input} disabled={!c?.enabled}
    onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } }}
    onpaste={(e) => {
      // Tempel screenshot langsung ke kotak prompt.
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length && c?.images) { e.preventDefault(); addImages(files); }
    }}></textarea>
  <div class="ai-composer-foot">
    <div class="ai-mode" role="radiogroup" aria-label="Mode AI">
      <button type="button" role="radio" data-ai-mode="build" aria-checked={String(ai.mode === 'build')} title="AI langsung menulis dan mengubah file"
        onclick={() => { setMode('build'); autoFocus(input); }}><svg viewBox="0 0 16 16"><path d="M9.8 1.2a3.8 3.8 0 0 0-4.6 4.9L1 10.3a1.7 1.7 0 0 0 2.4 2.4l4.2-4.2a3.8 3.8 0 0 0 4.9-4.6l-2 2-1.8-.3-.3-1.8zM2.3 11.6l4.5-4.5.1.1.4.4-4.5 4.5a.4.4 0 0 1-.5-.5"/></svg>Builder</button>
      {#if SHOW_AGENT_MODE && agents.length}<button type="button" role="radio" data-ai-mode="agent" aria-checked={String(activeMode() === 'agent')} title="Agen AI mengerjakan di sandbox lalu menguji hasilnya sendiri (lebih lama, lebih teliti)"
        onclick={() => { setMode('agent'); autoFocus(input); }}><svg viewBox="0 0 16 16"><path d="M8 1a1 1 0 0 1 1 1v1h2.5A2.5 2.5 0 0 1 14 5.5v5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 10.5v-5A2.5 2.5 0 0 1 4.5 3H7V2a1 1 0 0 1 1-1M4.5 4.5a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1zM6 7a1 1 0 1 1 0 2 1 1 0 0 1 0-2m4 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2M0 7h1v3H0zm15 0h1v3h-1z"/></svg>Agen</button>{/if}
      <button type="button" role="radio" data-ai-mode="plan" aria-checked={String(ai.mode === 'plan')} title="Diskusi & susun rencana, tanpa mengubah file"
        onclick={() => { setMode('plan'); autoFocus(input); }}><svg viewBox="0 0 16 16"><path d="M2 3h1.5v1.5H2zm3 .25h9v1H5zM2 7.25h1.5v1.5H2zm3 .25h9v1H5zM2 11.5h1.5V13H2zm3 .25h9v1H5z"/></svg>Plan</button>
    </div>
    {#if activeMode() === 'agent'}
      <select class="ai-engine" aria-label="Mesin agen" title={AGENT_ENGINES[currentEngine()]?.hint ?? ''} value={currentEngine()} onchange={(e) => setEngine(e.currentTarget.value)}>
        {#each agents as a (a.id)}<option value={a.id} title={AGENT_ENGINES[a.id]?.hint ?? ''}>{AGENT_ENGINES[a.id]?.name ?? a.name}</option>{/each}
      </select>
    {/if}
    <button type="button" class="ai-attach" id="aiAttach" title="Lampirkan gambar: desain, sketsa, atau screenshot error (bisa juga tempel/seret)" hidden={!c?.enabled || !c.images} onclick={pick}>
      <svg viewBox="0 0 16 16"><path d="M2.5 2A1.5 1.5 0 0 0 1 3.5v9A1.5 1.5 0 0 0 2.5 14h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 13.5 2zM2 3.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5v7.3l-3-3-2.5 2.5-3-3L2 11.8zM10.5 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"/></svg>
      <span>Gambar</span>
    </button>
    {#if usage}
      <span class="ai-context" class:warn={usage.pct >= 70} class:full={usage.pct >= 90} role="img"
        aria-label={`Konteks AI terpakai ${usage.pct}%`}
        title={usage.pct >= 70
          ? `Konteks AI: ${kTok(usage.tokens)} dari ${kTok(usage.size)} token. Percakapan sudah panjang; mulai percakapan baru agar AI lebih fokus.`
          : `Konteks AI: ${kTok(usage.tokens)} dari ${kTok(usage.size)} token`}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" class="track" /><circle cx="8" cy="8" r="6" class="fill"
          stroke-dasharray={RING} stroke-dashoffset={RING * (1 - usage.pct / 100)} /></svg>
        <span>{`${usage.pct}%`}</span>
      </span>
    {/if}
    <button class="ai-send" id="aiSend" type="submit" title="Kirim" disabled={!canSend || !ai.input.trim()}>
      <svg viewBox="0 0 16 16"><path d="M1 1.5 15 8 1 14.5l2-6.5 6-.5v-1l-6-.5z"/></svg>
    </button>
  </div>
</form>
