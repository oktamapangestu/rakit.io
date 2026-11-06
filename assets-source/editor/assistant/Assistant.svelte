<!--
  Asisten AI untuk website pengguna: aktif/mati, saldo, pilihan model, nama/sapaan/instruksi, batas harian,
  pemakaian 7 hari, dan cara memasang widget. Dibuka lewat openAssistant() di editor.js.
-->
<script>
  import { getContext } from 'svelte';
  import Icon from '../Icon.svelte';
  import { rupiah } from '../format.js';

  // onTopup: tutup dialog ini lalu buka isi saldo asisten (kembali ke sini setelah berhasil).
  let { onTopup, close } = $props();
  const { api, toast, copyText, saveAll, syncFromServer, schedulePreviewReload, icons } = getContext('editor');

  const WIDGET_TAG = '<script src="/api/ai/widget.js" defer><\/script>';
  const INSTRUCTION_EXAMPLE = [
    'Kamu adalah customer service Toko Kue Bu Sri.',
    '- Produk: bolu pandan Rp45.000, brownies Rp50.000, kue lapis Rp60.000.',
    '- Pesan lewat WhatsApp 0812-3456-7890, minimal H-1.',
    '- Buka Senin–Sabtu, 08.00–17.00. Kirim area Bandung saja.',
    'Jawab ramah dan singkat. Kalau ditanya hal di luar toko, arahkan kembali ke produk kami.',
  ].join('\n');

  let data = $state.raw(null);
  let error = $state('');
  let form = $state(null); // isian: { enabled, modelKey, name, greeting, instructions, dailyCap }
  let saving = $state(false);
  let status = $state('');
  let instrEl = $state();

  (async () => {
    try {
      data = await api('GET', '/api/assistant');
    } catch (err) {
      error = err.message;
      return;
    }
    if (!data.available || !data.models.length) {
      error = 'Asisten AI belum tersedia di server ini.';
      return;
    }
    const s = data.settings;
    form = { enabled: s.enabled, modelKey: s.modelKey, name: s.name, greeting: s.greeting, instructions: s.instructions, dailyCap: String(s.dailyCap) };
  })();

  const maxMsg = $derived(data ? Math.max(1, ...data.usage.map((u) => u.messages)) : 1);

  async function save(e) {
    e.preventDefault();
    saving = true;
    status = 'Menyimpan…';
    try {
      await api('PUT', '/api/assistant', { ...form, dailyCap: Number(form.dailyCap) });
      status = 'Tersimpan ✓';
      toast(form.enabled ? 'Asisten aktif di websitemu' : 'Pengaturan asisten disimpan');
      schedulePreviewReload();
    } catch (err) {
      status = '';
      toast(err.message, 'error');
    } finally {
      saving = false;
    }
  }

  // Sisipkan tag widget sebelum </body> di index.html (kalau belum ada).
  async function installWidget() {
    try {
      await saveAll();
      const { content } = await api('GET', '/api/files/content?path=index.html');
      if (content.includes('/api/ai/widget.js')) return toast('Asisten sudah terpasang di index.html');
      const next = /<\/body>/i.test(content) ? content.replace(/<\/body>/i, `  ${WIDGET_TAG}\n</body>`) : `${content}\n${WIDGET_TAG}\n`;
      await api('PUT', '/api/files/content', { path: 'index.html', content: next });
      await syncFromServer(['index.html']);
      toast(form.enabled ? 'Asisten dipasang di index.html' : 'Dipasang. Jangan lupa aktifkan & simpan.');
    } catch (err) {
      toast(err.message.includes('tidak ditemukan') ? 'index.html tidak ada. Tempel kodenya manual di halamanmu.' : err.message, 'error');
    }
  }
</script>

<div class="modal assistant-modal" role="dialog" aria-label="Asisten AI website">
  <div class="topup-head">
    <div>
      <h3>Asisten AI untuk websitemu</h3>
      <p>Pengunjung websitemu bisa bertanya kapan saja, dan dijawab AI sesuai instruksimu.</p>
    </div>
    <button class="icon-btn" type="button" title="Tutup" onclick={close}><Icon d={icons.close} /></button>
  </div>

  {#if error}
    <p class="topup-error">{error}</p>
  {:else if !form}
    <div class="topup-loading"><span class="dots"><i></i><i></i><i></i></span>Memuat…</div>
  {:else}
    {@const s = data.settings}
    {@const wallet = data.wallet}
    <form class="asst-form" onsubmit={save}>
      <div class="asst-status">
        <label class="switch asst-switch">
          <input type="checkbox" bind:checked={form.enabled}><span class="track"><span class="thumb"></span></span>
          <span><strong>Aktifkan asisten</strong><small>Kalau mati, gelembung chat tidak muncul di websitemu.</small></span>
        </label>
        {#if s.blocked}<span class="asst-pill bad">Diblokir admin</span>{/if}
      </div>
      <div class="asst-balance">
        <div>
          <span class="asst-label">Saldo asisten</span>
          <strong>{rupiah(Math.floor(wallet.available))}</strong>
          <small>Dipakai setiap kali asisten menjawab. Saldo tidak hangus.</small>
        </div>
        {#if data.packages.length}<button type="button" class="asst-topup" onclick={onTopup}>Isi saldo</button>{/if}
      </div>

      <h4>Pilih otak asistennya</h4>
      {#if s.modelFallback}
        <p class="asst-note">Model yang kamu pilih sebelumnya sedang tidak tersedia, jadi sementara asisten memakai model di bawah yang ditandai. Simpan untuk memakainya seterusnya.</p>
      {/if}
      <div class="asst-models">
        {#each data.models as m (m.key)}
          <button type="button" class="asst-model" class:selected={m.key === form.modelKey} onclick={() => (form.modelKey = m.key)}>
            <span class="asst-tier">{m.tier || m.name}</span>
            <strong>{m.name}</strong>
            <span class="asst-price">{`≈ ${rupiah(m.perMessage)} per jawaban`}</span>
            <small>{`≈ ${rupiah(m.per1k)} per 1.000 jawaban`}</small>
          </button>
        {/each}
      </div>

      <h4>Kenalkan asistenmu</h4>
      <div class="asst-grid">
        <label class="asst-field"><span>Nama asisten</span><input bind:value={form.name} maxlength="40" placeholder="mis. Sri, CS Toko Kue"></label>
        <label class="asst-field"><span>Sapaan pembuka</span><input bind:value={form.greeting} maxlength="200"></label>
      </div>
      <label class="asst-field">
        <span>Apa yang perlu diketahui asisten?<button type="button" class="link-btn" onclick={() => { form.instructions = INSTRUCTION_EXAMPLE; instrEl.focus(); }}>Pakai contoh</button></span>
        <textarea bind:this={instrEl} bind:value={form.instructions} rows="7" maxlength="4000" placeholder={INSTRUCTION_EXAMPLE}></textarea>
        <small>Tulis info usaha/websitemu: produk, harga, jam buka, cara pesan, dan gaya bicara. Asisten hanya menjawab berdasarkan ini.</small>
      </label>
      <!-- Tanpa bind:value: angka dikirim sebagai Number(isian), sama seperti sebelumnya. min/step = aturan server
           (bilangan bulat ≥ 100); dulu step 500 membuat nilai bawaan 5000 dianggap tidak sah oleh browser. -->
      <label class="asst-field">
        <span>Batas pemakaian per hari (Rp)</span>
        <input type="number" min="100" step="1" value={form.dailyCap} oninput={(e) => (form.dailyCap = e.target.value)}>
        <small>Supaya saldo aman walau websitemu tiba-tiba ramai. Asisten berhenti sampai besok kalau batas tercapai.</small>
      </label>

      <h4>Pemakaian</h4>
      <div class="asst-usage">
        <div class="asst-bars">
          {#each data.usage as u (u.day)}
            <span class="bar" title={`${new Date(`${u.day}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}: ${u.messages} jawaban · ${rupiah(u.spent)}`}>
              <i style="height:{Math.max(4, (u.messages / maxMsg) * 100)}%"></i>
            </span>
          {/each}
        </div>
        <small>{`7 hari terakhir: ${data.usage.reduce((n, u) => n + u.messages, 0)} jawaban · ${rupiah(Math.round(data.usage.reduce((n, u) => n + u.spent, 0)))}`}</small>
      </div>

      <h4>Pasang di websitemu</h4>
      <div class="asst-install">
        <p>Tempel baris ini sebelum <code>&lt;/body&gt;</code> di halaman yang ingin punya asisten, atau minta AI: “tambahkan asisten chat di websiteku”.</p>
        <div class="snippet">
          <code>{WIDGET_TAG}</code>
          <button type="button" onclick={() => copyText(WIDGET_TAG, 'Kode disalin')}>Salin</button>
        </div>
        <button type="button" class="link-btn" onclick={installWidget}>Pasang otomatis di index.html</button>
      </div>

      <div class="modal-buttons">
        <span class="asst-save-status">{status}</span>
        <button type="button" onclick={close}>Tutup</button>
        <button type="submit" class="primary" disabled={saving}>Simpan</button>
      </div>
    </form>
  {/if}
</div>
