<!-- Penjelasan satu fitur editor untuk pemula (tombol ⓘ): apa itu, analogi, cara pakai, istilah, dan coba ke AI. -->
<script>
  import { getContext, onMount } from 'svelte';
  import { FEATURE_INFO } from './features.js';

  let { key, close } = $props();
  const { askAi } = getContext('editor');
  // svelte-ignore state_referenced_locally
  const info = FEATURE_INFO[key];
  let body;
  let ok;
  onMount(() => {
    ok.focus({ preventScroll: true });
    body.scrollTop = 0;
  });
</script>

<div class="modal db-modal wide feature-info" bind:this={body}>
  <div class="fi-head">
    <span class="fi-icon" aria-hidden="true">{info.icon}</span>
    <div><span class="fi-kicker">Kenali fitur</span><h3>{info.title}</h3></div>
  </div>
  <p class="fi-what">{info.what}</p>
  <div class="fi-analogy"><strong>{'Analogi '}</strong>{info.analogy}</div>
  <h4>Kenapa penting?</h4><p>{info.why}</p>
  <h4>Cara pakai di rakit.io</h4>
  <ol class="fi-steps">{#each info.how as step, i (i)}<li>{step}</li>{/each}</ol>
  <h4>Istilah yang perlu kamu tahu</h4>
  <dl class="fi-terms">{#each info.terms as [term, desc] (term)}<dt>{term}</dt><dd>{desc}</dd>{/each}</dl>
  <div class="fi-tip"><strong>{'Tips belajar: '}</strong>{info.tip}</div>
  {#if info.tryText}<div class="fi-try"><span>Coba minta ke AI:</span><code>{info.tryText}</code></div>{/if}
  <div class="modal-buttons">
    {#if info.tryText}<button type="button" onclick={() => { close(); askAi(info.tryText, info.tryMode); }}>Coba sekarang</button>{/if}
    <button type="button" class="primary" bind:this={ok} onclick={close}>Mengerti</button>
  </div>
</div>
