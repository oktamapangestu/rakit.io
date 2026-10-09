<!-- Penjelasan jenis diagram untuk pemula (tombol ⓘ). -->
<script>
  import { onMount } from 'svelte';
  import { DIAGRAM_NAMES, DIAGRAM_INFO } from './info.js';

  let { kind, close } = $props();
  // svelte-ignore state_referenced_locally
  const info = DIAGRAM_INFO[kind];
  let body;
  let ok;
  onMount(() => {
    ok.focus({ preventScroll: true });
    body.scrollTop = 0;
  });
</script>

<div class="modal db-modal diagram-info" bind:this={body}>
  <h3>{`Diagram ${DIAGRAM_NAMES[kind]}`}</h3>
  <h4>Apa itu?</h4><p>{info.what}</p>
  <h4>Gunanya</h4><p>{info.use}</p>
  <h4>Cara membaca</h4>
  <dl>{#each info.read as [term, desc] (term)}<dt>{term}</dt><dd>{desc}</dd>{/each}</dl>
  <p class="diagram-info-note">Diagram ini digambar AI dari file & database project. Tekan Update diagram setelah project berubah.</p>
  <div class="modal-buttons"><button type="button" class="primary" bind:this={ok} onclick={close}>Mengerti</button></div>
</div>
