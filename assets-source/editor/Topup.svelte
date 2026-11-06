<!--
  Isi ulang kredit AI / Saldo Asisten, dibayar dengan QRIS. Dipasang di #modal oleh openTopup()
  di editor.js, yang juga menutupnya (onClose) dan menangani Escape & klik di luar dialog.
-->
<script>
  import { onDestroy } from 'svelte';
  import { rupiah } from './format.js';

  let {
    tab = 'credits', // 'credits' | 'assistant'
    api,
    showAssistant = false,
    icons, // { close, spark }: path SVG
    onCredits, // kredit terbaru dari server
    onUseAI, // "Lanjut pakai AI"
    onAfter, // "Kembali ke pengaturan asisten"
    onClose,
  } = $props();

  // view.name: loading | error | unavailable | credits | assistant | payment | success | ended
  let view = $state({ name: 'loading', title: 'Isi ulang kredit AI', text: 'Memuat paket…' });
  let data = $state.raw(null);
  let selected = $state.raw(null); // paket kredit / saldo asisten yang dipilih
  let countdown = $state('');
  let closed = false;
  let pollTimer;
  let countdownTimer;

  const stopTimers = () => {
    clearTimeout(pollTimer);
    clearInterval(countdownTimer);
  };
  function close() {
    closed = true;
    stopTimers();
    onClose();
  }
  onDestroy(() => {
    closed = true;
    stopTimers();
  });

  async function showPackages() {
    stopTimers();
    view = { name: 'loading', title: 'Isi ulang kredit AI', text: 'Memuat paket…' };
    try {
      data = await api('GET', '/api/billing/packages');
    } catch (err) {
      view = { name: 'error', title: 'Isi ulang kredit AI', message: err.message };
      return;
    }
    if (closed) return;
    onCredits(data.credits);
    if (tab === 'assistant') {
      if (!data.enabled || !data.assistantPackages?.length) {
        view = { name: 'unavailable', title: 'Isi saldo asisten' };
        return;
      }
      selected = data.assistantPackages[Math.min(1, data.assistantPackages.length - 1)];
      view = { name: 'assistant' };
      return;
    }
    if (!data.enabled || !data.packages.length) {
      view = { name: 'unavailable', title: 'Isi ulang kredit AI' };
      return;
    }
    selected = data.packages[Math.min(1, data.packages.length - 1)];
    view = { name: 'credits' };
  }

  const ENDED = {
    expired: 'Waktu pembayaran habis. Buat kode QRIS baru untuk mencoba lagi.',
    failed: 'Pembayaran gagal. Silakan coba lagi.',
    canceled: 'Pembayaran dibatalkan.',
  };
  const DEFAULT_STEPS = ['Buka aplikasi e-wallet atau mobile banking yang mendukung QRIS.', 'Scan kode QR di samping.', 'Periksa nominal, lalu konfirmasi pembayaran.'];

  // ---------- Pembayaran ----------

  async function startPayment(item) {
    view = { name: 'loading', title: 'Pembayaran', text: 'Membuat kode QRIS…' };
    try {
      const { payment } = item.assistantPackageId
          ? await api('POST', '/api/billing/assistant-topup', { packageId: item.assistantPackageId })
          : await api('POST', '/api/billing/topup', { packageId: item.packageId });
      if (!closed) showPayment(payment);
    } catch (err) {
      if (!closed) view = { name: 'error', title: 'Pembayaran', message: err.message };
    }
  }

  function showPayment(payment) {
    view = { name: 'payment', payment };
    const tick = () => {
      const ms = Date.parse(payment.expiresAt) - Date.now();
      if (Number.isNaN(ms)) return (countdown = '—');
      if (ms <= 0) return showEnded('expired');
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      countdown = `${m}:${String(s).padStart(2, '0')}`;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);

    const poll = async () => {
      if (closed) return;
      try {
        const res = await api('GET', `/api/billing/payments/${encodeURIComponent(payment.id)}`);
        if (closed) return;
        if (res.credits) onCredits(res.credits);
        if (res.payment.status === 'succeeded') return showSuccess(res.payment, res.credits);
        if (res.payment.status !== 'pending') return showEnded(res.payment.status);
      } catch { /* coba lagi di putaran berikutnya */ }
      pollTimer = setTimeout(poll, 3000);
    };
    pollTimer = setTimeout(poll, 3000);
  }

  function showSuccess(payment, credits) {
    stopTimers();
    view = { name: 'success', payment, credits };
  }

  function showEnded(status) {
    stopTimers();
    view = { name: 'ended', status };
  }

  function changePackage(payment) {
    tab = payment.assistant ? 'assistant' : 'credits';
    showPackages();
  }

  showPackages();
</script>

{#snippet icon(d)}<svg viewBox="0 0 16 16"><path {d} /></svg>{/snippet}

{#snippet head(title, subtitle)}
  <div class="topup-head">
    <div>
      <h3>{title}</h3>
      {#if subtitle}<p>{subtitle}</p>{/if}
    </div>
    <button class="icon-btn" type="button" title="Tutup" onclick={close}>{@render icon(icons.close)}</button>
  </div>
{/snippet}

{#snippet testMode(extra = '')}
  {#if !data?.livemode}<p class="topup-test {extra}">Mode uji coba — tidak ada uang sungguhan yang ditarik.</p>{/if}
{/snippet}

{#snippet packageGrid(packages)}
  <div class="pkg-grid">
    {#each packages as pkg (pkg.id)}
      <button type="button" class="pkg" class:selected={pkg === selected} onclick={() => (selected = pkg)}>
        {#if pkg.amount !== undefined}
          <span class="pkg-credits">{rupiah(pkg.amount)}</span>
          <span class="pkg-label">saldo asisten</span>
        {:else}
          <span class="pkg-credits">{pkg.credits}</span>
          <span class="pkg-label">kredit</span>
          <span class="pkg-price">{rupiah(pkg.price)}</span>
        {/if}
      </button>
    {/each}
  </div>
{/snippet}

<div class="modal topup-modal" role="dialog" aria-label="Isi ulang kredit AI">
  {#if view.name === 'loading'}
    {@render head(view.title)}
    <div class="topup-loading"><span class="dots"><i></i><i></i><i></i></span>{view.text}</div>

  {:else if view.name === 'error'}
    {@render head(view.title)}
    <p class="topup-error">{view.message}</p>
    <div class="modal-buttons"><button type="button" class="primary" onclick={showPackages}>Coba lagi</button></div>

  {:else if view.name === 'unavailable'}
    {@render head(view.title)}
    <p class="topup-error">Pembayaran belum tersedia saat ini.</p>

  {:else if view.name === 'credits'}
    {@const c = data.credits}
    {@render head('Isi ulang kredit AI', `Kredit yang dibeli tidak hangus, dan dipakai setelah jatah ${c.limit} prompt gratis harianmu habis.`)}
    <div class="topup-balance">
      <span>{`Prompt gratis hari ini: ${c.freeRemaining}/${c.limit}`}</span>
      <strong>{`${c.purchased} kredit`}</strong>
    </div>
    {@render packageGrid(data.packages)}
    {@render testMode()}
    <div class="modal-buttons">
      <button type="button" onclick={close}>Batal</button>
      <button type="button" class="primary" onclick={() => startPayment({ packageId: selected.id })}>Bayar dengan QRIS</button>
    </div>

  {:else if view.name === 'assistant'}
    <!-- Paket isi ulang Saldo Asisten AI (Rupiah dibayar = saldo yang didapat). -->
    {@render head('Isi saldo asisten AI', 'Saldo dipakai setiap kali asisten menjawab pengunjung websitemu. Saldo tidak hangus.')}
    {@render packageGrid(data.assistantPackages)}
    {@render testMode()}
    <div class="modal-buttons">
      <button type="button" onclick={close}>Batal</button>
      <button type="button" class="primary" onclick={() => startPayment({ assistantPackageId: selected.id })}>Bayar dengan QRIS</button>
    </div>

  {:else if view.name === 'payment'}
    {@const payment = view.payment}
    {@render head('Scan untuk membayar', payment.assistant ? `Saldo Asisten AI ${rupiah(payment.amount)}` : `${payment.credits} kredit AI`)}
    <div class="pay-body">
      <div class="qr-card">
        <div class="qris-label">QRIS</div>
        {#if payment.qr}
          <img class="qr" src={payment.qr} alt="Kode QRIS">
        {:else}
          <div class="qr qr-missing">Kode QR tidak tersedia. Gunakan halaman pembayaran.</div>
        {/if}
        <div class="pay-amount">{rupiah(payment.amount)}</div>
        <div class="pay-timer">Bayar dalam <strong>{countdown}</strong></div>
      </div>
      <div class="pay-side">
        <p class="pay-title">{payment.instructions?.title || 'Cara membayar'}</p>
        <ol class="pay-steps">
          {#each payment.instructions?.steps?.length ? payment.instructions.steps : DEFAULT_STEPS as step, j (j)}<li>{step}</li>{/each}
        </ol>
        <div class="pay-status"><span class="dots"><i></i><i></i><i></i></span>Menunggu pembayaran…</div>
        {#if payment.checkoutUrl}
          <a class="pay-link" href={payment.checkoutUrl} target="_blank" rel="noopener">Buka halaman pembayaran ↗</a>
        {/if}
      </div>
    </div>
    <div class="modal-buttons">
      <button type="button" onclick={() => changePackage(payment)}>Ganti paket</button>
      <button type="button" onclick={close}>Tutup</button>
    </div>

  {:else if view.name === 'success'}
    {@const { payment, credits } = view}
    {@render head('Pembayaran berhasil')}
    <div class="topup-result ok">
      <div class="result-icon">✓</div>
      {#if payment.assistant}
        <h4>{`+${rupiah(payment.amount)} saldo asisten`}</h4>
        <p>Asisten di websitemu siap menjawab pengunjung. Terima kasih!</p>
      {:else}
        <h4>{`+${payment.credits} kredit ditambahkan`}</h4>
        <p>{`Saldo kreditmu sekarang ${credits?.purchased ?? ''} kredit. Terima kasih!`}</p>
      {/if}
    </div>
    <div class="modal-buttons">
      {#if payment.assistant}
        <button type="button" class="primary" onclick={onAfter}>Kembali ke pengaturan asisten</button>
      {:else}
        <button type="button" class="primary" onclick={onUseAI}>Lanjut pakai AI</button>
      {/if}
    </div>

  {:else if view.name === 'ended'}
    {@render head('Pembayaran tidak selesai')}
    <div class="topup-result"><div class="result-icon">!</div><p>{ENDED[view.status] ?? 'Pembayaran tidak dapat diproses.'}</p></div>
    <div class="modal-buttons">
      <button type="button" onclick={close}>Tutup</button>
      <button type="button" class="primary" onclick={showPackages}>Coba lagi</button>
    </div>
  {/if}
</div>
