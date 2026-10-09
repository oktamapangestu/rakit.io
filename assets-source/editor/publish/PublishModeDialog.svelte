<!-- Pilih mode publikasi project: langsung tayang, atau manual (edit versi dev, lalu Publikasikan). -->
<script>
  import { getContext } from 'svelte';
  import { hostOf } from './hosts.js';

  // current: mode sekarang ('live' | 'manual'). onApplied(res): jawaban PUT /api/publish/mode.
  let { current, siteUrl, slug, onApplied, close } = $props();
  const { api, toast, saveAll } = getContext('editor');

  // svelte-ignore state_referenced_locally
  let chosen = $state(current);
  let agree = $state(false);
  let applying = $state(false);
  const devHost = $derived(hostOf(siteUrl).replace(`${slug}.`, `${slug}--dev.`));
  // Dari manual kembali ke langsung tayang: perubahan dev langsung tayang & data dev diganti data asli.
  const warn = $derived(current === 'manual' && chosen === 'live');

  async function apply() {
    applying = true;
    try {
      await saveAll();
      const res = await api('PUT', '/api/publish/mode', { mode: chosen, confirm: agree });
      close();
      onApplied(res);
      toast(chosen === 'manual' ? 'Publikasi manual aktif: edit di versi dev, lalu tekan Publikasikan' : 'Website kembali langsung tayang');
    } catch (err) {
      toast(err.message, 'error');
      applying = false;
    }
  }
</script>

<div class="modal publish-modal" role="dialog" aria-label="Mode publikasi">
  <h3>Mode publikasi</h3>
  <div class="mode-options" role="radiogroup">
    <button type="button" role="radio" class="mode-option" aria-checked={String(chosen === 'live')} onclick={() => (chosen = 'live')}>
      <strong>Langsung tayang</strong><span>{`Setiap perubahan langsung terlihat di ${hostOf(siteUrl)}. Cocok untuk belajar dan mencoba-coba.`}</span>
    </button>
    <button type="button" role="radio" class="mode-option" aria-checked={String(chosen === 'manual')} onclick={() => (chosen = 'manual')}>
      <strong>Publikasi manual (dev/prod)</strong><span>{`Kamu mengedit versi dev di ${devHost} (bisa dibagikan untuk minta pendapat). Website publik baru berubah saat kamu menekan Publikasikan. Database dev terpisah untuk uji coba.`}</span>
    </button>
  </div>
  <div class="pub-warn" hidden={!warn}>
    <p>Perubahan yang belum dipublikasikan akan langsung tayang, dan data uji coba di versi dev diganti data asli dari website publik.</p>
    <label class="pub-confirm"><input type="checkbox" bind:checked={agree}>Saya mengerti</label>
  </div>
  <div class="modal-buttons">
    <button type="button" class="primary" disabled={applying || chosen === current || (warn && !agree)} onclick={apply}>Terapkan</button>
    <button type="button" onclick={close}>Batal</button>
  </div>
</div>
