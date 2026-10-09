<!--
  Perbandingan isi file (Monaco diff editor): kiri = before, kanan = after. Dipakai kartu perubahan AI dan Riwayat
  versi lewat showDiff() di editor.js. caption: keterangan opsional di bawah judul.
-->
<script>
  import { onMount } from 'svelte';
  import Icon from '../Icon.svelte';
  import { CLOSE } from '../icons.js';

  let { path, caption = null, before, after, monaco, theme, close } = $props();
  let body;

  onMount(() => {
    const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : '';
    const language = { html: 'html', css: 'css', js: 'javascript' }[ext];
    const diffEditor = monaco.editor.createDiffEditor(body, {
      theme,
      readOnly: true,
      automaticLayout: true,
      renderSideBySide: body.clientWidth > 700,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
    });
    const original = monaco.editor.createModel(before, language);
    const modified = monaco.editor.createModel(after, language);
    diffEditor.setModel({ original, modified });
    // Editor dilepas dulu, baru modelnya (model yang masih terpasang tidak boleh dibuang).
    return () => {
      diffEditor.dispose();
      original.dispose();
      modified.dispose();
    };
  });
</script>

<div class="modal diff-modal">
  <div class="diff-head"><div><h3>{path}</h3>{#if caption}<p class="diff-caption">{caption}</p>{/if}</div><button
    class="icon-btn" title="Tutup" onclick={close}><Icon d={CLOSE} /></button></div>
  <div class="diff-body" bind:this={body}></div>
</div>
