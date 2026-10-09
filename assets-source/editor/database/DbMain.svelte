<!-- Isi tab Data (#dbMain): tabel aktif (kepala, baris, halaman), atau ajakan membuat tabel pertama. -->
<script>
  import { getContext } from 'svelte';
  import Icon from '../Icon.svelte';
  import AiButton from '../AiButton.svelte';
  import Cell from './Cell.svelte';
  import RowDialog from './RowDialog.svelte';
  import CreateTableDialog from './CreateTableDialog.svelte';
  import TableSettings from './TableSettings.svelte';
  import { DB_OPS, DB_TYPES } from './types.js';
  import { db, shownTable, load, page, deleteRow } from './state.svelte.js';

  const { openDialog, icons } = getContext('editor');

  const t = $derived(shownTable());
  const publicOps = $derived(t ? DB_OPS.filter(([op]) => t.rules[op] === 'public').map(([, label]) => label.toLowerCase()) : []);
  const columns = $derived(t ? [{ name: 'id', type: 'number', system: true }, ...t.columns, { name: 'created_at', type: 'date', system: true }] : []);
  const from = $derived(db.total ? db.offset + 1 : 0);
  const to = $derived(db.offset + db.rows.length);
</script>

{#if !t}
  <div class="db-empty">
    <div class="db-empty-icon"><Icon d={icons.table} /></div>
    <h3>Belum ada tabel</h3>
    <p>Tabel menyimpan data dari websitemu — misalnya ucapan tamu, RSVP, atau pesan dari form kontak.</p>
    <button type="button" class="db-btn primary" onclick={() => openDialog(CreateTableDialog)}>+ Buat tabel</button>
    <p class="db-hint">Atau minta AI membuatkan tabel sekaligus halamannya:</p>
    <AiButton label="Buat form RSVP dengan AI" text="Buatkan form RSVP (nama, jumlah tamu, pesan) yang datanya tersimpan di database, beserta daftar tamu yang sudah konfirmasi." cls="db-btn" />
  </div>
{:else}
  <div class="db-main-head">
    <div class="db-title">
      <h3>{t.name}</h3>
      <span class="db-access" class:open={publicOps.length}>{publicOps.length ? `Publik: ${publicOps.join(', ')}` : 'Privat — hanya kamu'}</span>
    </div>
    <div class="db-actions">
      <button type="button" class="icon-btn" title="Muat ulang" onclick={load}><Icon d={icons.refresh} /></button>
      <AiButton label="Pakai di website" cls="db-btn" text={() => `Tampilkan data dari tabel "${t.name}" di website dengan tampilan yang rapi dan responsif${t.rules.create === 'public' ? ', beserta form untuk menambah data' : ''}. Pakai tabel yang sudah ada; tambah kolom atau akses publik hanya bila perlu.`} />
      <button type="button" class="db-btn" onclick={() => openDialog(TableSettings, { name: t.name })}><Icon d={icons.gear} />Atur</button>
      <button type="button" class="db-btn primary" onclick={() => openDialog(RowDialog, { t })}>+ Baris</button>
    </div>
  </div>

  <div class="db-grid-wrap">
    <table class="db-grid">
      <thead>
        <tr>
          {#each columns as c (c.name)}
            <th>
              <span class="col-name">{c.name}</span>{#if c.required}<span class="col-flag" title="Wajib diisi">*</span>{/if}{#if c.private}<span class="col-flag private" title="Privat — tidak tampil di API publik"><Icon d={icons.lock} /></span>{/if}<span class="col-type">{c.system ? 'otomatis' : (c.type === 'reference' ? `→ ${c.refTable}` : DB_TYPES[c.type])}</span>
            </th>
          {/each}
          <th class="row-actions"></th>
        </tr>
      </thead>
      <tbody>
        {#each db.rows as row (row.id)}
          <tr>
            {#each columns as c (c.name)}<Cell {t} {row} column={c} />{/each}
            <td class="row-actions">
              <button type="button" class="icon-btn" title="Hapus baris" onclick={() => deleteRow(t, row)}><Icon d={icons.trash} /></button>
            </td>
          </tr>
        {:else}
          <tr><td colspan={String(columns.length + 1)} class="db-no-rows">Belum ada data. Klik "+ Baris", atau kirim data dari websitemu.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="db-pager">
    <span>{`${from}–${to} dari ${db.total} baris`}</span>
    <button type="button" class="icon-btn" title="Sebelumnya" disabled={db.offset === 0} onclick={() => page(-1)}>‹</button>
    <button type="button" class="icon-btn" title="Berikutnya" disabled={to >= db.total} onclick={() => page(1)}>›</button>
  </div>
{/if}
