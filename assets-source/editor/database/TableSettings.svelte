<!-- Dialog Atur tabel: akses dari website, kolom, contoh kode, ganti nama & hapus tabel. -->
<script>
  import { getContext } from 'svelte';
  import Icon from '../Icon.svelte';
  import ConfirmButton from './ConfirmButton.svelte';
  import Snippets from './Snippets.svelte';
  import TypeSelect from './TypeSelect.svelte';
  import { DB_OPS, DB_TYPES, tableUrl } from './types.js';
  import { db, load, patchTable } from './state.svelte.js';

  let { name, close } = $props();
  const { api, toast, icons } = getContext('editor');

  // svelte-ignore state_referenced_locally
  let tableName = $state(name); // berganti bila tabelnya diganti nama
  const t = $derived(db.tables.find((x) => x.name === tableName));
  let newName = $state('');
  let newType = $state('text');
  let renameInput = $state();

  $effect(() => { if (!t) close(); });

  const patch = async (payload, message) => { tableName = await patchTable(tableName, payload, message); };

  // Isian yang gagal disimpan dikembalikan ke nilai tersimpan.
  async function renameColumn(e, c) {
    const to = e.currentTarget.value.trim();
    const input = e.currentTarget;
    if (to && to !== c.name) await patch({ renameColumns: [{ from: c.name, to }] }, 'Nama kolom diganti');
    input.value = c.name;
  }

  async function setFlag(e, c, key) {
    const box = e.currentTarget;
    await patch({ columnFlags: { [c.name]: { [key]: box.checked } } });
    box.checked = Boolean(t?.columns.find((x) => x.name === c.name)?.[key]);
  }

  async function addColumn() {
    const n = newName.trim();
    if (!n) return;
    const before = t.columns.length;
    await patch({ addColumns: [{ name: n, type: newType }] }, 'Kolom ditambahkan');
    if (t && t.columns.length > before) newName = '';
  }

  async function renameTable() {
    const to = renameInput.value.trim();
    if (to !== t.name) await patch({ rename: to }, 'Nama tabel diganti');
    if (t) renameInput.value = t.name;
  }

  async function dropTable() {
    try {
      await api('DELETE', tableUrl(t.name));
      close();
      toast(`Tabel ${t.name} dihapus`);
      db.active = null;
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
</script>

{#if t}
  <div class="modal db-modal wide">
    <div class="topup-head">
      <div><h3>{`Atur tabel ${t.name}`}</h3><p>{`${t.rowCount} baris`}</p></div>
      <button type="button" class="icon-btn" title="Tutup" onclick={close}><Icon d={icons.close} /></button>
    </div>

    <section class="db-section">
      <h4>Akses dari website</h4>
      <p class="db-section-desc">Siapa yang boleh memakai tabel ini lewat API websitemu. Kamu sendiri selalu bisa mengelola datanya di editor ini.</p>
      <div class="db-access-list">
        {#each DB_OPS as [op, label] (op)}
          <div class="db-access-row">
            <span>{label}</span>
            <div class="seg">
              {#each [['public', 'Publik'], ['owner', 'Hanya kamu']] as [value, text] (value)}
                <button type="button" class={t.rules[op] === value ? `on ${value}` : ''} onclick={() => t.rules[op] !== value && patch({ rules: { [op]: value } })}>{text}</button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </section>

    <section class="db-section">
      <h4>Kolom</h4>
      <p class="db-section-desc">Kolom privat tidak ditampilkan ke pengunjung. Tipe kolom tidak bisa diubah setelah dibuat.</p>
      {#each t.columns as c (c.name)}
        <div class="db-col-row">
          <input value={c.name} spellcheck="false" title="Ganti nama kolom lalu tekan Enter" onchange={(e) => renameColumn(e, c)}>
          <span class="db-type-fixed">{DB_TYPES[c.type]}</span>
          <label class="mini-check" title="Wajib diisi"><input type="checkbox" checked={Boolean(c.required)} onchange={(e) => setFlag(e, c, 'required')}>Wajib</label>
          <label class="mini-check" title="Tidak tampil di API publik"><input type="checkbox" checked={Boolean(c.private)} onchange={(e) => setFlag(e, c, 'private')}>Privat</label>
          <ConfirmButton label="Hapus" onConfirm={() => patch({ dropColumns: [c.name] }, `Kolom ${c.name} dihapus`)} />
        </div>
      {/each}
      <div class="db-col-row add">
        <input bind:value={newName} placeholder="kolom_baru" spellcheck="false" autocomplete="off"
          onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addColumn(); } }}>
        <TypeSelect bind:value={newType} />
        <button type="button" class="db-btn" onclick={addColumn}>+ Tambah</button>
      </div>
    </section>

    <section class="db-section">
      <h4>Pakai di websitemu</h4>
      <Snippets {t} />
    </section>

    <section class="db-section">
      <h4>Tabel</h4>
      <div class="db-col-row">
        <input bind:this={renameInput} value={t.name} spellcheck="false">
        <button type="button" class="db-btn" onclick={renameTable}>Ganti nama</button>
        <ConfirmButton label="Hapus tabel" onConfirm={dropTable} />
      </div>
    </section>
  </div>
{/if}
