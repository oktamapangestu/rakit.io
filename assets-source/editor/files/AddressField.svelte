<!-- Pilihan alamat website project: acak (bawaan, tanpa batas) atau alamat sendiri (dibatasi core.maxCustom per
     akun). used = jumlah alamat custom yang sudah terpakai, tidak termasuk project yang sedang diganti alamatnya. -->
<script>
  import { core } from './state.svelte.js';

  let { custom = $bindable(false), slug = $bindable(''), used } = $props();

  // svelte-ignore state_referenced_locally
  const base = core.project.siteHost.slice(core.project.slug.length); // ".rakit.io"
  const left = $derived(Math.max(0, core.maxCustom - used));
  let slugInput = $state();

  function pickCustom() {
    if (!left) return;
    custom = true;
    queueMicrotask(() => slugInput?.focus());
  }
</script>

<div class="db-field"><span class="db-field-label">Alamat website</span>
  <div class="mode-options" role="radiogroup" aria-label="Alamat website">
    <button type="button" role="radio" class="mode-option" aria-checked={String(!custom)} onclick={() => (custom = false)}>
      <strong>Alamat acak</strong><span>{`Dibuat otomatis, mis. web-k7m2qx${base}. Bisa diganti ke alamat sendiri kapan saja.`}</span>
    </button>
    <button type="button" role="radio" class="mode-option" aria-checked={String(custom)} disabled={!left} onclick={pickCustom}>
      <strong>Alamat sendiri</strong>
      <span>{left ? `Sisa ${left} dari ${core.maxCustom} alamat custom untuk akunmu.` : `Kuota ${core.maxCustom} alamat custom sudah habis. Ganti project lain ke alamat acak untuk membebaskannya.`}</span>
    </button>
  </div>
</div>
{#if custom}
  <label class="db-field"><span class="db-field-label">Alamat sendiri</span>
    <input bind:this={slugInput} value={slug} placeholder="tokokue" spellcheck="false" autocomplete="off" maxlength="30"
      oninput={(e) => { e.target.value = slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); }}>
  </label>
  <p class="project-preview">Websitemu: <strong>{`${slug || 'namamu'}${base}`}</strong></p>
{/if}
