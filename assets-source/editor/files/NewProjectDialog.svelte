<!-- Project baru: subdomain (alamat website) + nama. Berhasil = editor dibuka di project itu. -->
<script>
  import { getContext, onMount } from 'svelte';
  import { core } from './state.svelte.js';

  // onCreated(project): simpan file yang terbuka lalu pindah ke project baru.
  let { onCreated, close } = $props();
  const { api } = getContext('editor');

  // svelte-ignore state_referenced_locally
  const base = core.project.siteHost.slice(core.project.slug.length); // ".rakit.io"
  let slug = $state('');
  let name = $state('');
  let error = $state('');
  let busy = $state(false);
  let slugInput;
  onMount(() => slugInput.focus());

  async function submit(e) {
    e.preventDefault();
    busy = true;
    try {
      const { project } = await api('POST', '/api/projects', { slug, name });
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
    <label class="db-field"><span class="db-field-label">Alamat website</span>
      <input bind:this={slugInput} value={slug} placeholder="tokokue" spellcheck="false" autocomplete="off" maxlength="30"
        oninput={(e) => { e.target.value = slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); }}>
    </label>
    <p class="project-preview">Websitemu: <strong>{`${slug || 'namamu'}${base}`}</strong></p>
    <label class="db-field"><span class="db-field-label">Nama project<span class="col-type">opsional</span></span>
      <input bind:value={name} placeholder="Toko Kue Bu Sari" maxlength="60">
    </label>
    <p class="db-form-error">{error}</p>
    <div class="modal-buttons">
      <button type="button" onclick={close}>Batal</button>
      <button type="submit" class="primary" disabled={busy}>Buat project</button>
    </div>
  </form>
</div>
