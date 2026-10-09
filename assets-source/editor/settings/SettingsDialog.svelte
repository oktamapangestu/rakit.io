<!-- Pengaturan editor (disimpan di browser ini): tema, bahasa, prediksi kode. -->
<script>
  // lang: bahasa aktif ('id' | 'en'). dark: tema gelap aktif. complete: prediksi kode aktif.
  let { lang, dark, complete, onTheme, onLanguage, onComplete, close } = $props();

  // svelte-ignore state_referenced_locally
  let theme = $state(dark ? 'dark' : 'light');
  // svelte-ignore state_referenced_locally
  let completeOn = $state(complete);
</script>

<div class="modal db-modal settings-modal">
  <h3>Pengaturan</h3>
  <div class="settings-group">
    <h4>Tampilan</h4>
    <div class="theme-choice" role="radiogroup" aria-label="Tema">
      {#each [['light', 'Terang'], ['dark', 'Gelap']] as [value, label] (value)}
        <button type="button" role="radio" aria-checked={String(theme === value)} onclick={() => { theme = value; onTheme(value); }}><span class="theme-swatch {value}"></span>{label}</button>
      {/each}
    </div>
  </div>
  <div class="settings-group">
    <h4>Bahasa · Language</h4>
    <div class="theme-choice" role="radiogroup" aria-label="Bahasa · Language">
      {#each [['id', 'Bahasa Indonesia'], ['en', 'English']] as [value, label] (value)}
        <button type="button" role="radio" aria-checked={String(value === lang)} onclick={() => onLanguage(value)}>{label}</button>
      {/each}
    </div>
  </div>
  <div class="settings-group">
    <h4>Editor kode</h4>
    <label class="switch asst-switch settings-row">
      <input type="checkbox" bind:checked={completeOn} onchange={() => onComplete(completeOn)}><span class="track"><span class="thumb"></span></span>
      <span>
        <strong>Prediksi kode otomatis (AI)</strong>
        <small>Saat berhenti mengetik, AI menebak lanjutan kode dalam teks abu-abu. Tekan Tab untuk menerima, Esc atau lanjut mengetik untuk mengabaikan. Gratis, tidak memakai kredit.</small>
      </span>
    </label>
  </div>
  <p class="settings-note">Pengaturan disimpan di browser ini.</p>
  <div class="modal-buttons"><button type="button" class="primary" onclick={close}>Selesai</button></div>
</div>
