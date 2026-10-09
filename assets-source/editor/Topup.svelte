<!--
  Langganan & isi ulang kredit AI / Saldo Asisten, dibayar dengan QRIS. Dipasang di #modal oleh openTopup()
  di editor.js, yang juga menutupnya (onClose) dan menangani Escape & klik di luar dialog.
-->
<script>
  import { onDestroy } from 'svelte';
  import { rupiah, shortDate } from './format.js';

  let {
    tab = undefined, // 'plans' | 'credits' | 'assistant'; kosong = langganan bila belum berlangganan
    intro = false, // sambutan saat editor pertama kali dibuka (promosi, ada tombol "Nanti saja")
    api,
    showAssistant = false,
    icons, // { close, spark }: path SVG
    onCredits, // kredit terbaru dari server
    onPlanPaid, // langganan berhasil dibayar
    onUseAI, // "Lanjut pakai AI"
    onAfter, // "Kembali ke pengaturan asisten"
    onPromo, // tampilan promosi aktif/tidak (modal lebar)
    onClose,
  } = $props();

  const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;
  const PLAN_RANK = { pro: 1, unlimited: 2 };
  const CHECK = 'M6.2 11.6 2.9 8.3l-.9.9 4.2 4.2 8-8-.9-.9z';
  const RIBBON = { pro: 'Paling populer', unlimited: 'Paling lega' };

  // view.name: loading | error | unavailable | promo | plans | credits | assistant | payment | success | ended
  let view = $state({ name: 'loading', title: 'Langganan & kredit AI', text: 'Memuat paket…' });
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

  $effect(() => onPromo(view.name === 'promo'));

  async function showPackages() {
    stopTimers();
    view = { name: 'loading', title: 'Langganan & kredit AI', text: 'Memuat paket…' };
    try {
      data = await api('GET', '/api/billing/packages');
    } catch (err) {
      view = { name: 'error', title: 'Langganan & kredit AI', message: err.message };
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
    if (!data.enabled || (!data.packages.length && !data.plans.length)) {
      view = { name: 'unavailable', title: 'Langganan & kredit AI' };
      return;
    }
    if (intro) {
      if (!data.plans.length || data.credits.plan) return close(); // tidak ada yang bisa ditawarkan
      view = { name: 'promo' };
      return;
    }
    if (!data.plans.length) tab = 'credits';
    if (!data.packages.length) tab = 'plans';
    tab ??= data.credits.plan ? 'credits' : 'plans';
    showTab(tab);
  }

  function showTab(id) {
    tab = id;
    if (id === 'credits') selected = data.packages[Math.min(1, data.packages.length - 1)];
    view = { name: id };
  }

  // ---------- Isi tampilan ----------

  // Promosi untuk pengguna gratis: kelipatan dibanding paket Gratis.
  const times = (a, b) => (a && b && a / b >= 1.5 ? `${Math.round(a / b)}×` : null);
  function promoFeatures(plan) {
    const free = data.credits;
    const freeStore = data.free?.storage;
    return [
      plan.credits
        ? [`${plan.credits.toLocaleString('id-ID')} kredit AI / 30 hari`, times(plan.credits, free.limit * 30)]
        : [`AI hingga ${plan.dailyLimit} prompt / hari`, times(plan.dailyLimit, free.limit)],
      [`Storage ${mb(plan.storage.totalSize)} per project`, times(plan.storage.totalSize, freeStore?.totalSize)],
      [`Database ${mb(plan.storage.dbBytes)} per project`, times(plan.storage.dbBytes, freeStore?.dbBytes)],
      [`Gambar hingga ${mb(plan.storage.imageSize)} per file`, times(plan.storage.imageSize, freeStore?.imageSize)],
      [`${plan.storage.entries.toLocaleString('id-ID')} file & folder`, times(plan.storage.entries, freeStore?.entries)],
      [`Riwayat versi ${plan.history.days} hari`, times(plan.history.days, data.free?.history?.days)],
      ...(showAssistant && plan.assistant ? [[`Saldo asisten AI website ${rupiah(plan.assistant)}/30 hari`, null]] : []),
    ];
  }

  function planFeatures(plan) {
    return [
      plan.credits ? `${plan.credits.toLocaleString('id-ID')} kredit AI tiap 30 hari` : `AI tanpa kuota bulanan (maks. ${plan.dailyLimit} prompt/hari)`,
      `Storage ${mb(plan.storage.totalSize)} per project`,
      `Database ${mb(plan.storage.dbBytes)} per project`,
      `Upload gambar hingga ${mb(plan.storage.imageSize)} per file`,
      `Riwayat versi ${plan.history.days} hari`,
      showAssistant && plan.assistant ? `Saldo asisten AI website ${rupiah(plan.assistant)} / 30 hari` : null,
      `Maks. ${plan.storage.entries.toLocaleString('id-ID')} file & folder`,
    ].filter(Boolean);
  }

  function planButton(plan) {
    const current = data.credits.plan;
    const isCurrent = current?.id === plan.id;
    const lower = Boolean(current) && PLAN_RANK[plan.id] < PLAN_RANK[current.id];
    const label = isCurrent ? 'Perpanjang 30 hari' : lower ? `Kamu sudah ${current.name}` : current ? `Upgrade ke ${plan.name}` : `Pilih ${plan.name}`;
    return { isCurrent, lower, label };
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
      const { payment } = item.planId
        ? await api('POST', '/api/billing/subscribe', { planId: item.planId })
        : item.assistantPackageId
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
    if (payment.plan) onPlanPaid();
    view = { name: 'success', payment, credits };
  }

  function showEnded(status) {
    stopTimers();
    view = { name: 'ended', status };
  }

  function changePackage(payment) {
    tab = payment.plan ? 'plans' : payment.assistant ? 'assistant' : 'credits';
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

{#snippet tabs()}
  {#if data.plans.length && data.packages.length}
    <div class="topup-tabs" role="tablist">
      {#each [['plans', 'Langganan'], ['credits', 'Isi kredit']] as [id, label] (id)}
        <button type="button" role="tab" aria-selected={String(tab === id)} onclick={() => showTab(id)}>{label}</button>
      {/each}
    </div>
  {/if}
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

<div class="modal topup-modal" class:promo-modal={view.name === 'promo'} role="dialog" aria-label="Langganan & kredit AI">
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

  {:else if view.name === 'promo'}
    {@const free = data.credits}
    {@const left = free.freeRemaining}
    {@const bonus = free.bonusRemaining ?? 0}
    <button class="icon-btn promo-close" type="button" title="Tutup" onclick={close}>{@render icon(icons.close)}</button>
    <div class="promo-hero">
      <span class="promo-orb a"></span><span class="promo-orb b"></span>
      <span class="promo-kicker">{@render icon(icons.spark)}Upgrade rakit.io</span>
      <h2>Bangun lebih banyak, lebih cepat.</h2>
      <p>Kredit AI berlimpah, storage lega, dan upload gambar lebih besar.</p>
      {#if bonus}
        <div class="promo-today"><span>{`Bonus awal ${bonus} kredit masih tersedia (sekali, tidak berkurang tiap hari)`}</span></div>
      {/if}
      {#if free.limit}
        <div class="promo-today" class:empty={!left}>
          <span>{left ? `Kredit gratis hari ini tinggal ${left} dari ${free.limit}` : `Kredit gratis hari ini (${free.limit}) sudah habis`}</span>
          <span class="promo-meter"><i style="width:{(left / free.limit) * 100}%"></i></span>
        </div>
      {/if}
    </div>
    <div class="promo-grid">
      {#each data.plans as plan, i (plan.id)}
        <div class="promo-card {plan.id}" style="--delay:{120 + i * 90}ms">
          {#if RIBBON[plan.id]}<span class="promo-ribbon">{RIBBON[plan.id]}</span>{/if}
          <div class="promo-name">{plan.name}</div>
          <div class="promo-price">{rupiah(plan.price)}<span>/30 hari</span></div>
          <ul class="promo-features">
            {#each promoFeatures(plan) as [text, mult], j (j)}
              <li>{@render icon(CHECK)}<span>{text}</span>{#if mult}<b class="promo-mult" title="dibanding paket Gratis">{mult}</b>{/if}</li>
            {/each}
          </ul>
          <button type="button" class="promo-cta" onclick={() => startPayment({ planId: plan.id })}>{`Mulai ${plan.name}`}</button>
        </div>
      {/each}
    </div>
    <ul class="promo-trust">
      <li>{@render icon(CHECK)}Bayar QRIS — semua e-wallet &amp; m-banking</li>
      <li>{@render icon(CHECK)}Aktif instan setelah bayar</li>
      <li>{@render icon(CHECK)}Tanpa tagihan otomatis</li>
    </ul>
    {@render testMode('promo-test')}
    <button type="button" class="promo-later" onclick={close}>Nanti saja, lanjut dengan paket Gratis</button>

  {:else if view.name === 'plans'}
    {@const current = data.credits.plan}
    {@const free = data.credits}
    {#if intro}
      {@render head('Bangun lebih banyak dengan rakit.io', 'Kamu sedang memakai paket Gratis. Berlangganan untuk kredit AI lebih banyak dan storage lebih besar. Bayar sekali dengan QRIS untuk 30 hari, tanpa tagihan otomatis.')}
    {:else}
      {@render head('Langganan rakit.io', 'Bayar sekali dengan QRIS untuk 30 hari, tanpa tagihan otomatis. Bonus storage langsung aktif setelah pembayaran.')}
      {@render tabs()}
    {/if}
    <div class="topup-balance">
      {#if current}
        <span>{`Paket ${current.name} aktif sampai `}<strong>{shortDate(current.expiresAt)}</strong></span>
        <strong>{current.id === 'unlimited' ? `${current.quotaRemaining}/${current.quota} prompt hari ini` : `${current.quotaRemaining} kredit`}</strong>
      {:else}
        <span>Paket sekarang: <strong>Gratis</strong></span>
        <span>{`Bonus awal ${free.bonusLimit} kredit + ${free.limit} kredit/hari · storage 20 MB`}</span>
      {/if}
    </div>
    <div class="plan-grid">
      {#each data.plans as plan (plan.id)}
        {@const button = planButton(plan)}
        <div class="plan-card" class:current={button.isCurrent} class:featured={plan.id === 'unlimited'}>
          <div class="plan-name">{plan.name}{#if button.isCurrent}<span class="plan-tag">Aktif</span>{/if}</div>
          <div class="plan-price">{rupiah(plan.price)}<span>{' / 30 hari'}</span></div>
          <ul class="plan-features">
            {#each planFeatures(plan) as text, j (j)}<li>{text}</li>{/each}
          </ul>
          <button type="button" class={button.lower ? '' : 'primary'} disabled={button.lower} onclick={() => startPayment({ planId: plan.id })}>{button.label}</button>
        </div>
      {/each}
    </div>
    {#if current && current.id !== 'unlimited' && data.plans.some((p) => p.id === 'unlimited')}
      <p class="topup-note">{`Upgrade ke Unlimited: sisa masa aktif ${current.name} dikonversi jadi hari Unlimited sesuai harga.`}</p>
    {/if}
    {@render testMode()}
    {#if intro}
      <div class="modal-buttons"><button type="button" onclick={close}>Nanti saja, pakai paket Gratis</button></div>
    {/if}

  {:else if view.name === 'credits'}
    {@const c = data.credits}
    {@render head('Isi ulang kredit AI', 'Kredit yang dibeli tidak hangus, dan dipakai setelah kuota langganan & kredit gratis harianmu habis.')}
    {@render tabs()}
    <div class="topup-balance">
      <span>Sisa kredit sekarang</span>
      <strong>{`${c.remaining} kredit`}</strong>
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
    {@render head('Scan untuk membayar', payment.plan ? `Langganan ${payment.plan} 30 hari` : payment.assistant ? `Saldo Asisten AI ${rupiah(payment.amount)}` : `${payment.credits} kredit AI`)}
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
    {@const plan = credits?.plan}
    {@render head('Pembayaran berhasil')}
    <div class="topup-result ok">
      <div class="result-icon">✓</div>
      {#if payment.assistant}
        <h4>{`+${rupiah(payment.amount)} saldo asisten`}</h4>
        <p>Asisten di websitemu siap menjawab pengunjung. Terima kasih!</p>
      {:else if payment.plan}
        <h4>{`${plan?.name ?? payment.plan} aktif`}</h4>
        <p>{plan ? `Berlaku sampai ${shortDate(plan.expiresAt)}. Bonus storage sudah aktif di semua project-mu. Terima kasih!` : 'Terima kasih!'}</p>
      {:else}
        <h4>{`+${payment.credits} kredit ditambahkan`}</h4>
        <p>{`Sisa kreditmu sekarang ${credits?.remaining ?? ''} kredit. Terima kasih!`}</p>
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
