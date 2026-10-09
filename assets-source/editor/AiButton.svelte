<!--
  Tombol yang mengisi kotak AI dengan permintaan (bisa diubah dulu sebelum dikirim). Sama dengan aiButton() di
  editor.js. text: string, atau fungsi yang dipanggil saat diklik.
-->
<script>
  import { getContext } from 'svelte';

  let { label, text, cls = 'fn-btn', mode = 'build' } = $props();
  const { askAi } = getContext('editor');
</script>

<button
  type="button"
  class="{cls} ai-handoff"
  title={`Isi kotak AI (${mode === 'plan' ? 'Plan' : 'Builder'}) dengan permintaan ini — bisa diubah dulu sebelum dikirim`}
  onclick={(e) => { e.stopPropagation(); askAi(typeof text === 'function' ? text() : text, mode); }}
><span class="ai-spark" aria-hidden="true">✦</span>{label}</button>
