<!-- Contoh kode di tab Dokumentasi: judul kecil, tombol salin, dan kodenya. -->
<script>
  import { getContext } from 'svelte';

  let { code, label } = $props();
  const { copyText } = getContext('editor');
</script>

<div class="docs-code">
  <div class="docs-code-head">
    <span class="fn-label">{label}</span>
    <button type="button" class="fn-btn" onclick={() => copyText(code, 'Kode disalin')}>Salin</button>
  </div>
  <pre class="fn-pre">{code}</pre>
</div>
