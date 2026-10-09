<!--
  Publikasikan versi dev ke website publik (mode publikasi manual). status: hasil GET /api/publish — file &
  struktur database yang berubah, dan apakah ada yang menghapus data (destructive, perlu dicentang dulu).
-->
<script>
  import { getContext } from 'svelte';
  import { hostOf } from './hosts.js';

  let { status: st, onPublished, onModeDialog, close } = $props();
  const { api, toast } = getContext('editor');

  const MARK = { added: ['+', 'baru'], changed: ['~', 'diubah'], removed: ['−', 'dihapus'] };
  let agree = $state(false);
  let publishing = $state(false);

  async function publish() {
    publishing = true;
    try {
      const status = (await api('POST', '/api/publish', { confirm: agree })).publish;
      onPublished(status);
      close();
      toast(`Dipublikasikan ke ${hostOf(st.siteUrl)}`);
    } catch (err) {
      toast(err.message, 'error');
      publishing = false;
    }
  }
</script>

<div class="modal publish-modal" role="dialog" aria-label="Publikasikan website">
  <h3>Publikasikan ke website publik</h3>
  <p class="pub-lead">
    {#if st.pending}Perubahan di versi dev akan tayang di <strong>{hostOf(st.siteUrl)}</strong>.{:else}Website publik <strong>{hostOf(st.siteUrl)}</strong> sudah sama dengan versi dev.{/if}
  </p>
  {#if st.files.length}
    <h4>{`File (${st.files.length})`}</h4>
    <ul class="pub-list">
      {#each st.files as f (f.path)}
        <li class="pub-file {f.change}"><span class="pub-mark">{MARK[f.change][0]}</span><code>{f.path}</code><span class="pub-what">{MARK[f.change][1]}</span></li>
      {/each}
    </ul>
  {/if}
  {#if st.schema.length}
    <h4>Struktur database</h4>
    <ul class="pub-list">
      {#each st.schema as c, i (i)}<li class="pub-schema" class:destructive={c.destructive}>{c.destructive ? '⚠️ ' : ''}{c.text}</li>{/each}
    </ul>
  {/if}
  {#if st.pending}<p class="pub-note">Data hasil uji coba di versi dev tidak ikut; data dan gambar kiriman pengunjung di website publik tetap aman.</p>{/if}
  {#if st.destructive}
    <label class="pub-confirm"><input type="checkbox" bind:checked={agree}>Saya mengerti: data di tabel/kolom yang dihapus akan hilang dari website publik.</label>
  {/if}
  <div class="modal-buttons">
    <button type="button" class="link-btn pub-mode" onclick={() => { close(); onModeDialog(); }}>Ubah mode publikasi</button>
    <!-- Perlu centang "Saya mengerti" bila ada data yang terhapus. -->
    <button type="button" class="primary" disabled={publishing || !st.pending || (st.destructive && !agree)} onclick={publish}>{publishing ? 'Mempublikasikan…' : 'Publikasikan'}</button>
    <button type="button" onclick={close}>Tutup</button>
  </div>
</div>
