<!-- Panel kode Mermaid di mode Edit: pratinjau langsung saat mengetik, Simpan (Ctrl/⌘+S), dan "Ubah dengan AI". -->
<script>
  import { getContext, onMount } from 'svelte';
  import { diagram, costPerPrompt, setEditCode, setEditInput, saveEdit, leaveEdit, askChange } from './state.svelte.js';

  const { autoFocus } = getContext('editor');
  let input;
  onMount(() => {
    setEditInput(input);
    autoFocus(input);
    return () => setEditInput(null);
  });

  const edit = $derived(diagram.edit);
  const busy = $derived(Boolean(diagram.busy));

  function onkeydown(e) {
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); document.execCommand('insertText', false, '  '); }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveEdit(); }
  }
</script>

<aside class="diagram-editor" aria-label="Edit diagram">
  <div class="diagram-editor-head">
    <strong>Kode Mermaid</strong>
    <div>
      <button type="button" class="fn-btn" onclick={() => leaveEdit()}>Batal</button>
      <button type="button" class="fn-btn primary" disabled={busy || Boolean(edit?.error) || edit?.code === edit?.base || edit?.saving} onclick={saveEdit}>Simpan</button>
    </div>
  </div>
  <textarea class="diagram-code" spellcheck="false" autocomplete="off" aria-label="Kode Mermaid" bind:this={input} readonly={busy}
    value={edit?.code ?? ''} oninput={(e) => setEditCode(e.target.value)} {onkeydown}></textarea>
  {#if edit?.error}
    {@const message = edit.error}
    <p class="diagram-code-error">{`Belum bisa digambar: ${message.slice(0, 300)}`}</p>
  {:else}
    <p class="diagram-code-error" hidden></p>
  {/if}
  <p class="diagram-editor-hint">Pratinjau berubah saat kamu mengetik. Klik teks di diagram untuk menggantinya.</p>
  <div class="diagram-editor-ai">
    <textarea rows="2" maxlength="2000" placeholder="mis. tambahkan tabel pembayaran yang terhubung ke pesanan" aria-label="Perubahan yang diminta ke AI"
      bind:value={edit.ask} disabled={busy} onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askChange(); } }}></textarea>
    <button type="button" class="fn-btn" disabled={busy} title={`AI mengubah diagram sesuai permintaanmu (${costPerPrompt()} kredit)`} onclick={askChange}>✦ Ubah dengan AI</button>
  </div>
</aside>
