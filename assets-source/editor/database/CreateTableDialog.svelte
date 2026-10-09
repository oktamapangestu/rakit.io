<!-- Tabel baru: nama + daftar kolom (id dan created_at dibuat otomatis). -->
<script>
  import { getContext, onMount, tick } from 'svelte';
  import Icon from '../Icon.svelte';
  import TypeSelect from './TypeSelect.svelte';
  import { db, load } from './state.svelte.js';

  let { presetName = '', close } = $props();
  const { api, toast, icons } = getContext('editor');

  let seq = 0;
  const column = (preset = {}) => ({ key: ++seq, name: preset.name ?? '', type: preset.type ?? 'text', refTable: '', required: false, private: false });
  // svelte-ignore state_referenced_locally
  let name = $state(typeof presetName === 'string' ? presetName : '');
  let columns = $state([column({ name: 'nama', type: 'text' })]);
  let error = $state('');
  let nameInput;
  let list;

  onMount(() => nameInput.focus());

  async function addColumn() {
    columns.push(column());
    await tick();
    list.lastElementChild.querySelector('input').focus();
  }

  async function submit(e) {
    e.preventDefault();
    const payload = columns.filter((c) => c.name.trim()).map((c) => ({
      name: c.name.trim(), type: c.type, required: c.required, private: c.private,
      ...(c.type === 'reference' ? { refTable: c.refTable } : {}),
    }));
    try {
      const { table } = await api('POST', '/api/database/tables', { name, columns: payload });
      close();
      toast(`Tabel ${table.name} dibuat`);
      db.active = table.name;
      db.offset = 0;
      load();
    } catch (err) {
      error = err.message;
    }
  }
</script>

<div class="modal db-modal wide">
  <form onsubmit={submit}>
    <h3>Tabel baru</h3>
    <label class="db-field"><span class="db-field-label">Nama tabel</span>
      <input bind:this={nameInput} bind:value={name} placeholder="contoh: ucapan" spellcheck="false" autocomplete="off">
    </label>
    <div class="db-field-label">Kolom<span class="col-type">id dan created_at dibuat otomatis</span></div>
    <div class="db-col-list" bind:this={list}>
      {#each columns as c, i (c.key)}
        <div class="db-col-row">
          <input bind:value={c.name} placeholder="nama_kolom" spellcheck="false" autocomplete="off">
          <TypeSelect bind:value={c.type} />
          <!-- Kolom bertipe Relasi: tabel yang ditunjuk. -->
          <select class="ref-select" title="Tabel yang ditunjuk" bind:value={c.refTable} hidden={c.type !== 'reference'}>
            <option value="">— pilih tabel —</option>
            {#each db.tables as t (t.name)}<option value={t.name}>{t.name}</option>{/each}
          </select>
          <label class="mini-check" title="Wajib diisi"><input type="checkbox" bind:checked={c.required}>Wajib</label>
          <label class="mini-check" title="Tidak tampil di API publik"><input type="checkbox" bind:checked={c.private}>Privat</label>
          <button type="button" class="icon-btn" title="Hapus kolom" onclick={() => columns.splice(i, 1)}><Icon d={icons.close} /></button>
        </div>
      {/each}
    </div>
    <button type="button" class="db-add-col" onclick={addColumn}>+ Tambah kolom</button>
    <p class="db-note">Tabel baru bersifat privat. Buka akses di ⚙ Atur supaya websitemu bisa membaca atau mengirim data.</p>
    <p class="db-form-error">{error}</p>
    <div class="modal-buttons">
      <button type="button" onclick={close}>Batal</button>
      <button type="submit" class="primary">Buat tabel</button>
    </div>
  </form>
</div>
