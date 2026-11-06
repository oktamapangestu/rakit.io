<!-- Ganti alamat website project aktif: ke alamat acak baru atau alamat sendiri. File, database, dan riwayat ikut
     pindah; alamat lama berhenti bekerja. Berhasil = editor dimuat ulang di alamat baru. -->
<script>
  import { getContext } from 'svelte';
  import { core } from './state.svelte.js';
  import AddressField from './AddressField.svelte';

  // onChanged(project): pindah ke alamat baru.
  let { onChanged, close } = $props();
  const { api, saveAll } = getContext('editor');

  let custom = $state(false);
  let slug = $state('');
  let error = $state('');
  let busy = $state(false);
  const used = core.projects.filter((p) => p.custom && p.slug !== core.project.slug).length;

  async function submit(e) {
    e.preventDefault();
    busy = true;
    try {
      await saveAll();
      const { project } = await api('POST', `/api/projects/${core.project.slug}/address`, { slug: custom ? slug : '' });
      close();
      await onChanged(project);
    } catch (err) {
      error = err.message;
      busy = false;
    }
  }
</script>

<div class="modal db-modal">
  <form onsubmit={submit}>
    <h3>Ganti alamat website</h3>
    <p class="db-note">{`Alamat sekarang: ${core.project.siteHost}. Setelah diganti, alamat lama berhenti bekerja dan bisa dipakai orang lain. File, database, dan riwayat project ikut pindah.`}</p>
    <AddressField bind:custom bind:slug {used} />
    <p class="db-form-error">{error}</p>
    <div class="modal-buttons">
      <button type="button" onclick={close}>Batal</button>
      <button type="submit" class="primary" disabled={busy || (custom && !slug)}>Ganti alamat</button>
    </div>
  </form>
</div>
