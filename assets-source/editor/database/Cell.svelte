<!--
  Satu sel tabel: kolom sistem (id, created_at) hanya dibaca, Ya/Tidak = kotak centang, gambar = dialog
  (klik dua kali), lainnya diubah langsung di sel (klik dua kali; Enter simpan, Esc batal, keluar = simpan).
-->
<script>
  import { getContext, tick } from 'svelte';
  import ImageDialog from './ImageDialog.svelte';
  import { imageSrc, saveCell } from './state.svelte.js';

  let { t, row, column } = $props();
  const { openDialog } = getContext('editor');

  let editing = $state(false);
  let draft = $state('');
  let input = $state();
  let finished = false;

  const value = $derived(row[column.name]);
  const empty = $derived(value === null || value === undefined || value === '');

  async function edit() {
    if (column.type === 'image') return openDialog(ImageDialog, { t, row, column });
    if (editing) return;
    draft = String(value ?? '');
    finished = false;
    editing = true;
    await tick();
    input.focus();
    input.select();
  }

  async function finish(commit) {
    if (finished) return;
    finished = true;
    if (commit && draft !== String(value ?? '')) {
      try {
        await saveCell(t, row, column, draft);
      } catch { /* pesan error sudah ditampilkan; isi kembali seperti semula */ }
    }
    editing = false;
  }

  function onkeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  }

  function toggle(e) {
    const box = e.currentTarget;
    saveCell(t, row, column, box.checked).catch(() => { box.checked = !box.checked; });
  }
</script>

{#snippet shown()}
  {#if empty}
    <span class="null">—</span>
  {:else if column.name === 'created_at'}
    {new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
  {:else if column.type === 'boolean'}
    {value ? 'Ya' : 'Tidak'}
  {:else if column.type === 'image'}
    <!-- decoding async: gambar asli (bisa beberapa MB) di-decode di luar thread utama, tidak menahan UI. -->
    <img class="db-thumb" src={imageSrc(value)} alt={column.name} loading="lazy" decoding="async" width="40" height="40">
  {:else}
    {String(value)}
  {/if}
{/snippet}

{#if column.system}
  <td class="sys {column.name}">{@render shown()}</td>
{:else if column.type === 'boolean'}
  <td class="bool"><input type="checkbox" aria-label={column.name} checked={Boolean(value)} onchange={toggle}></td>
{:else}
  <td title="Klik dua kali untuk mengubah" class={column.type === 'image' ? 'img' : null} class:editing ondblclick={edit}>
    {#if editing}
      {#if column.type === 'text'}
        <textarea rows="1" bind:this={input} value={draft} oninput={(e) => (draft = e.target.value)} {onkeydown} onblur={() => finish(true)}></textarea>
      {:else}
        <!-- Tanpa bind:value: untuk type=number Svelte mengubah isinya jadi angka, sedangkan server menerima teks. -->
        <input bind:this={input} value={draft} oninput={(e) => (draft = e.target.value)} {onkeydown} onblur={() => finish(true)}
          type={column.type === 'number' ? 'number' : 'text'} step={column.type === 'number' ? 'any' : null}
          placeholder={column.type === 'date' ? '2026-12-31' : null}>
      {/if}
    {:else}
      {@render shown()}
    {/if}
  </td>
{/if}
