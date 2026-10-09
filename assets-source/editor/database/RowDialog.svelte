<!-- Tambah baris ke tabel. -->
<script>
  import { getContext, onMount } from 'svelte';
  import ImageField from './ImageField.svelte';
  import { DB_TYPES, tableUrl } from './types.js';
  import { load } from './state.svelte.js';

  let { t, close } = $props();
  const { api, toast } = getContext('editor');

  // Isian per kolom sebagai teks (seperti nilai <input>); Ya/Tidak sebagai true/false.
  // svelte-ignore state_referenced_locally
  let values = $state(Object.fromEntries(t.columns.map((c) => [c.name, c.type === 'boolean' ? false : ''])));
  let error = $state('');
  let form;

  onMount(() => form.querySelector('input, textarea')?.focus());

  async function submit(e) {
    e.preventDefault();
    const data = {};
    for (const c of t.columns) {
      const v = values[c.name];
      if (c.type === 'boolean') data[c.name] = v;
      else if (v !== '') data[c.name] = v;
    }
    try {
      await api('POST', `${tableUrl(t.name)}/rows`, data);
      close();
      toast('Baris ditambahkan');
      load();
    } catch (err) {
      error = err.message;
    }
  }
</script>

{#snippet label(c)}
  <span class="db-field-label">{c.name}{#if c.required}<span class="req">*</span>{/if}<span class="col-type">{c.type === 'reference' ? `→ ${c.refTable}` : DB_TYPES[c.type]}</span></span>
{/snippet}

<div class="modal db-modal">
  <form bind:this={form} onsubmit={submit}>
    <h3>{`Tambah baris ke ${t.name}`}</h3>
    {#each t.columns as c (c.name)}
      {#if c.type === 'image'}
        <div class="db-field image">
          {@render label(c)}
          <ImageField {t} column={c} bind:value={values[c.name]} />
        </div>
      {:else}
        <label class="db-field {c.type}">
          {@render label(c)}
          {#if c.type === 'boolean'}
            <input type="checkbox" bind:checked={values[c.name]}>
          {:else if c.type === 'text'}
            <textarea rows="2" bind:value={values[c.name]}></textarea>
          {:else}
            <!-- Tanpa bind:value: untuk type=number Svelte mengubah isinya jadi angka, sedangkan server menerima teks. -->
            <input value={values[c.name]} oninput={(e) => (values[c.name] = e.target.value)}
              type={c.type === 'number' || c.type === 'reference' ? 'number' : 'text'}
              step={c.type === 'number' ? 'any' : c.type === 'reference' ? '1' : null} min={c.type === 'reference' ? '1' : null}
              placeholder={c.type === 'reference' ? `id ${c.refTable}` : c.type === 'date' ? '2026-12-31 atau 2026-12-31T19:00' : null}>
          {/if}
        </label>
      {/if}
    {:else}
      <p class="db-note">Tabel ini belum punya kolom. Tambahkan kolom lewat ⚙ Atur.</p>
    {/each}
    <p class="db-form-error">{error}</p>
    <div class="modal-buttons">
      <button type="button" onclick={close}>Batal</button>
      <button type="submit" class="primary">Simpan</button>
    </div>
  </form>
</div>
