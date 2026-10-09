<!-- Ganti gambar di satu sel tabel (klik dua kali sel bertipe Gambar). -->
<script>
  import ImageField from './ImageField.svelte';
  import { saveCell } from './state.svelte.js';

  let { t, row, column, close } = $props();
  // svelte-ignore state_referenced_locally
  let value = $state(row[column.name] ?? '');

  async function submit(e) {
    e.preventDefault();
    try {
      await saveCell(t, row, column, value || null);
      close();
    } catch { /* pesan error sudah ditampilkan */ }
  }
</script>

<div class="modal db-modal">
  <form onsubmit={submit}>
    <h3>{`Gambar "${column.name}" · baris #${row.id}`}</h3>
    <ImageField {t} {column} bind:value />
    <div class="modal-buttons">
      <button type="button" onclick={close}>Batal</button>
      <button type="submit" class="primary">Simpan</button>
    </div>
  </form>
</div>
