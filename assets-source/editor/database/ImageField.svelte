<!-- Isian gambar: pratinjau + upload file + (opsional) alamat URL. value = alamat gambar atau ''. -->
<script>
  import { getContext } from 'svelte';
  import { imageSrc, uploadImage } from './state.svelte.js';

  let { t, column, value = $bindable('') } = $props();
  const { toast } = getContext('editor');

  // svelte-ignore state_referenced_locally
  let url = $state(value.startsWith('/') ? '' : value); // isian alamat (kosong bila gambarnya hasil upload)
  let status = $state('');

  function pick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif,image/svg+xml';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      status = 'Mengupload…';
      try {
        value = await uploadImage(t, column, file);
        url = '';
        status = 'Terupload ✓';
      } catch (err) {
        status = '';
        toast(err.message, 'error');
      }
    };
    input.click();
  }
</script>

<div class="db-img-field">
  <div class="db-img-preview">
    {#if value}<img src={imageSrc(value)} alt={column.name}>{:else}<span class="null">Belum ada gambar</span>{/if}
  </div>
  <div class="db-img-actions">
    <button type="button" class="db-btn" onclick={pick}>{value ? 'Ganti gambar…' : 'Upload gambar…'}</button>
    <button type="button" class="db-btn" onclick={() => { value = ''; url = ''; status = ''; }}>Kosongkan</button>
    <span class="db-img-status">{status}</span>
  </div>
  <input type="text" placeholder="atau tempel alamat https://…" bind:value={url} oninput={(e) => (value = e.target.value.trim())}>
</div>
