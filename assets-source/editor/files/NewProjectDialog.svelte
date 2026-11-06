<!-- Project baru: nama + alamat website (acak, atau alamat sendiri bila kuota alamat custom masih ada).
     Berhasil = editor dibuka di project itu. -->
<script>
  import { getContext, onMount } from 'svelte';
  import { core } from './state.svelte.js';
  import AddressField from './AddressField.svelte';

  // onCreated(project): simpan file yang terbuka lalu pindah ke project baru.
  let { onCreated, close } = $props();
  const { api } = getContext('editor');

  let name = $state('');
  let custom = $state(false);
  let slug = $state('');
  let error = $state('');
  let busy = $state(false);
  let nameInput;
  onMount(() => nameInput.focus());

  async function submit(e) {
    e.preventDefault();
    busy = true;
    try {
      const { project } = await api('POST', '/api/projects', { slug: custom ? slug : '', name });
      close();
      await onCreated(project);
    } catch (err) {
      error = err.message;
      busy = false;
    }
  }
</script>

<div class="modal db-modal">
  <form onsubmit={submit}>
    <h3>Project baru</h3>
    <p class="db-note">Setiap project adalah website terpisah dengan alamat, file, database, dan riwayat AI sendiri. Kredit AI dipakai bersama untuk semua project.</p>
    <label class="db-field"><span class="db-field-label">Nama project<span class="col-type">opsional</span></span>
      <input bind:this={nameInput} bind:value={name} placeholder="Toko Kue Bu Sari" maxlength="60">
    </label>
    <AddressField bind:custom bind:slug used={core.projects.filter((p) => p.custom).length} />
    <p class="db-form-error">{error}</p>
    <div class="modal-buttons">
      <button type="button" onclick={close}>Batal</button>
      <button type="submit" class="primary" disabled={busy || (custom && !slug)}>Buat project</button>
    </div>
  </form>
</div>
