(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);

  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat(Infinity)) if (child != null && child !== false) el.append(child);
    return el;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs = {}, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
    for (const child of children) el.append(child);
    return el;
  }

  // ---------- Format angka ----------
  const num = (n) => Number(n || 0).toLocaleString('id-ID');
  function compact(n) {
    const v = Number(n || 0);
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
    if (Math.abs(v) >= 1e4) return `${(v / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 1 })} rb`;
    return num(v);
  }
  const rupiah = (n) => `Rp${num(n)}`;
  const rupiahCompact = (n) => `Rp${compact(n)}`;
  const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
  const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');
  const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  const dateTime = (value) => new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  const shortTime = (value) => new Date(value).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // ---------- Data ----------
  let days = 30;
  try { days = Number(localStorage.getItem('rakit.adminDays')) || 30; } catch { /* abaikan */ }
  let stats = null;

  async function load() {
    $('#refresh').classList.add('spin');
    try {
      const res = await fetch(`/api/admin/stats?days=${days}`, { credentials: 'same-origin' });
      if (res.status === 401) return void (location.href = '/');
      if (res.status === 403) return void (location.href = '/editor');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
      stats = data;
      render();
    } catch (err) {
      $('#page').replaceChildren(h('p', { class: 'error' }, `Gagal memuat statistik: ${err.message}`));
    } finally {
      $('#refresh').classList.remove('spin');
    }
  }

  // ---------- Grafik batang (satu seri) ----------
  // Tanpa legenda: satu seri, judul kartu sudah menyebut isinya.

  function niceMax(max) {
    if (max <= 0) return 1;
    const pow = 10 ** Math.floor(Math.log10(max));
    for (const step of [1, 2, 2.5, 5, 10]) if (step * pow >= max) return step * pow;
    return 10 * pow;
  }

  function barChart({ data, value, color, format, tickFormat = compact }) {
    const wrap = h('div', { class: 'chart' });
    const tooltip = $('#tooltip');

    const draw = () => {
      const W = Math.max(wrap.clientWidth, 280);
      const H = 200;
      const pad = { l: 44, r: 6, t: 10, b: 26 };
      const innerW = W - pad.l - pad.r;
      const innerH = H - pad.t - pad.b;
      const values = data.map(value);
      const max = niceMax(Math.max(...values));
      const y = (v) => pad.t + innerH - (v / max) * innerH;
      const band = innerW / data.length;
      const barW = Math.max(2, Math.min(24, band - 2)); // maks 24px, sisakan celah ≥ 2px
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });

      for (const t of [0, max / 2, max]) {
        svg.append(s('line', { class: t === 0 ? 'baseline' : 'grid-line', x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t) }));
        svg.append(s('text', { class: 'tick', x: pad.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, tickFormat(t)));
      }

      // Label tanggal: awal, tengah, akhir.
      const labelIdx = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];
      for (const i of labelIdx) {
        const anchor = i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle';
        const x = i === 0 ? pad.l : i === data.length - 1 ? W - pad.r : pad.l + band * (i + 0.5);
        svg.append(s('text', { class: 'tick', x, y: H - 6, 'text-anchor': anchor }, dayLabel(data[i].date)));
      }

      const bars = data.map((d, i) => {
        const v = value(d);
        const x = pad.l + band * i + (band - barW) / 2;
        const top = y(v);
        const height = pad.t + innerH - top;
        if (v <= 0 || height < 0.5) return null;
        // Ujung data membulat 4px, dasar tetap siku.
        const r = Math.min(4, barW / 2, height);
        const base = pad.t + innerH;
        const d0 = `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z`;
        const bar = s('path', { class: 'bar', d: d0, style: `fill:${color}` });
        svg.append(bar);
        return bar;
      });

      // Area hover selebar satu kolom penuh, lebih besar dari batangnya.
      data.forEach((d, i) => {
        const hit = s('rect', { class: 'hit', x: pad.l + band * i, y: pad.t, width: band, height: innerH });
        hit.addEventListener('pointerenter', () => {
          wrap.classList.add('hovering');
          bars.forEach((b, j) => b?.classList.toggle('active', j === i));
          tooltip.replaceChildren(
            h('div', { class: 't-date' }, new Date(`${d.date}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })),
            h('div', { class: 't-value' }, h('span', { class: 'swatch', style: `background:${color}` }), format(d)),
          );
          tooltip.hidden = false;
        });
        hit.addEventListener('pointermove', (e) => {
          const rect = tooltip.getBoundingClientRect();
          const left = Math.min(e.clientX + 14, innerWidth - rect.width - 8);
          tooltip.style.left = `${Math.max(8, left)}px`;
          tooltip.style.top = `${e.clientY - rect.height - 12}px`;
        });
        hit.addEventListener('pointerleave', () => {
          wrap.classList.remove('hovering');
          tooltip.hidden = true;
        });
        svg.append(hit);
      });

      if (values.every((v) => v === 0)) {
        svg.append(s('text', { class: 'empty', x: pad.l + innerW / 2, y: pad.t + innerH / 2, 'text-anchor': 'middle' }, 'Belum ada data di periode ini'));
      }
      wrap.replaceChildren(svg);
    };

    requestAnimationFrame(draw);
    new ResizeObserver(() => draw()).observe(wrap);
    return wrap;
  }

  // Tabel data di bawah grafik (alternatif yang bisa dibaca tanpa melihat warna/grafik).
  function dataTable(rows, columns) {
    return h('details', { class: 'data-table' },
      h('summary', {}, 'Lihat data'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'num' : null }, c.label)))),
        h('tbody', {}, [...rows].reverse().map((r) => h('tr', {}, columns.map((c) => h('td', { class: c.num ? 'num' : null }, c.value(r)))))))));
  }

  // ---------- Komponen ----------
  const tile = ({ label, value, detail, hero }) => h('div', { class: `card tile${hero ? ' hero' : ''}` },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, value),
    detail ? h('div', { class: 'detail' }, detail) : null);

  const card = (title, sub, ...children) => h('section', { class: 'card' },
    h('h2', {}, title), sub ? h('p', { class: 'sub' }, sub) : h('div', { style: 'height:12px' }), children);

  const STATUS = {
    ok: { label: 'Berhasil', color: 'var(--good)' },
    error: { label: 'Error provider/server', color: 'var(--critical)' },
    max_tokens: { label: 'Terpotong (batas token)', color: 'var(--serious)' },
    bad_output: { label: 'Jawaban tidak terbaca', color: 'var(--serious)' },
    refusal: { label: 'Ditolak AI', color: 'var(--warning)' },
    aborted: { label: 'Dihentikan user', color: 'var(--faint)' },
    queue_full: { label: 'Ditolak: antrean penuh', color: 'var(--serious)' },
    queue_timeout: { label: 'Kelamaan di antrean', color: 'var(--serious)' },
  };

  function table(columns, rows, empty) {
    return h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'num' : null }, c.label)))),
      h('tbody', {}, rows.length
        ? rows.map((r) => h('tr', {}, columns.map((c) => h('td', { class: c.num ? 'num' : null }, c.value(r)))))
        : h('tr', {}, h('td', { class: 'empty-row', colspan: String(columns.length) }, empty)))));
  }

  const userLink = (u) => h('a', { href: u.siteUrl, target: '_blank', rel: 'noopener' }, u.username);

  // ---------- Render ----------
  function render() {
    const st = stats;
    const period = `${st.days} hari terakhir`;
    const failed = st.ai.requests - (st.ai.byStatus.ok ?? 0);

    const tiles = h('div', { class: 'grid tiles' },
      tile({
        hero: true,
        label: 'Pengguna',
        value: num(st.users.total),
        detail: [h('strong', {}, `+${num(st.users.inPeriod)}`), ` dalam ${period} · ${num(st.users.today)} hari ini · ${num(st.users.projects ?? 0)} project`],
      }),
      tile({
        label: 'Pendapatan',
        value: rupiahCompact(st.revenue.inPeriod),
        detail: [`${num(st.revenue.paidCount)} transaksi · total `, h('strong', {}, rupiahCompact(st.revenue.allTime))],
      }),
      tile({
        label: 'Request AI',
        value: num(st.ai.requests),
        detail: [`${num(st.ai.users)} pengguna · `, h('strong', {}, pct(failed, st.ai.requests)), ' gagal'],
      }),
      tile({
        label: 'Kredit terjual',
        value: num(st.revenue.creditsSold),
        detail: [`${num(st.revenue.payingUsers)} pembeli · saldo belum terpakai `, h('strong', {}, num(st.credits.purchasedOutstanding))],
      }),
      tile({
        label: 'Pelanggan aktif',
        value: num((st.subscribers?.pro ?? 0) + (st.subscribers?.unlimited ?? 0)),
        detail: [`Pro ${num(st.subscribers?.pro ?? 0)} · Unlimited `, h('strong', {}, num(st.subscribers?.unlimited ?? 0))],
      }));

    const charts = h('div', { class: 'grid three' },
      card('Pendaftar baru per hari', period,
        barChart({ data: st.signupsByDay, value: (d) => d.count, color: 'var(--series-users)', format: (d) => `${num(d.count)} pendaftar` }),
        dataTable(st.signupsByDay, [{ label: 'Tanggal', value: (d) => dayLabel(d.date) }, { label: 'Pendaftar', num: true, value: (d) => num(d.count) }])),
      card('Pendapatan per hari', `${period} · pembayaran berhasil${st.revenue.livemode ? '' : ' (mode uji coba)'}`,
        barChart({ data: st.revenueByDay, value: (d) => d.amount, color: 'var(--series-revenue)', format: (d) => `${rupiah(d.amount)} · ${num(d.count)} transaksi`, tickFormat: rupiahCompact }),
        dataTable(st.revenueByDay, [{ label: 'Tanggal', value: (d) => dayLabel(d.date) }, { label: 'Transaksi', num: true, value: (d) => num(d.count) }, { label: 'Pendapatan', num: true, value: (d) => rupiah(d.amount) }])),
      card('Request AI per hari', period,
        barChart({ data: st.ai.byDay, value: (d) => d.requests, color: 'var(--series-ai)', format: (d) => `${num(d.requests)} request · ${num(d.failed)} gagal` }),
        dataTable(st.ai.byDay, [{ label: 'Tanggal', value: (d) => dayLabel(d.date) }, { label: 'Request', num: true, value: (d) => num(d.requests) }, { label: 'Gagal', num: true, value: (d) => num(d.failed) }, { label: 'Token', num: true, value: (d) => num(d.tokens) }])));

    const health = card('Kesehatan AI', period,
      st.ai.requests
        ? h('ul', { class: 'status-list' }, Object.entries(st.ai.byStatus).map(([status, count]) => h('li', {},
          h('span', { class: 'dot', style: `background:${STATUS[status]?.color ?? 'var(--faint)'}` }),
          h('span', { class: 'name' }, STATUS[status]?.label ?? status),
          h('span', { class: 'count' }, num(count)),
          h('span', { class: 'pct' }, pct(count, st.ai.requests)))))
        : h('p', { class: 'sub' }, 'Belum ada request AI di periode ini.'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Token input'), h('dd', {}, num(st.ai.tokensIn)),
        h('dt', {}, 'Token output'), h('dd', {}, num(st.ai.tokensOut)),
        h('dt', {}, 'Model aktif'), h('dd', {}, st.ai.currentModel),
        h('dt', {}, 'Kredit gratis terpakai hari ini'), h('dd', {}, num(st.credits.usedToday))));

    const topUsers = card('Pengguna paling aktif', `Berdasarkan request AI · ${period}`, table([
      { label: 'Pengguna', value: userLink },
      { label: 'Request', num: true, value: (u) => num(u.aiRequests) },
      { label: 'Token', num: true, value: (u) => compact(u.tokens) },
      { label: 'Belanja', num: true, value: (u) => (u.spent ? rupiah(u.spent) : h('span', { class: 'muted' }, '—')) },
    ], st.topUsers, 'Belum ada pemakaian AI.'));

    // Bar kecil untuk menunjukkan sisa kredit relatif terhadap bonus + jatah + saldo.
    const creditBar = (u) => {
      const total = u.bonusRemaining + u.freeRemaining + u.purchased;
      const cap = u.used + u.bonusUsed + total || 1;
      const seg = (n, cls) => (n > 0 ? h('span', { class: `seg ${cls}`, style: `width:${(n / cap) * 100}%` }) : null);
      return h('span', { class: 'creditbar', title: `Bonus terpakai ${num(u.bonusUsed)} (sisa ${num(u.bonusRemaining)}) · gratis terpakai ${num(u.used)} (sisa ${num(u.freeRemaining)}) · saldo ${num(u.purchased)}` },
        seg(u.used, 'used'), seg(u.bonusUsed, 'bonus'), seg(u.bonusRemaining, 'bonus-left'), seg(u.freeRemaining, 'free'), seg(u.purchased, 'paid'));
    };

    const creditUsers = card('Kredit & token per pengguna',
      `Bonus awal ${num(st.credits.freeBonus)} (sekali) · jatah gratis ${num(st.credits.freePerUser)}/hari (reset 00.00 WIB) · total ${num(st.creditUsers.length)} pengguna`,
      table([
        { label: 'Pengguna', value: userLink },
        { label: 'Bonus sisa', num: true, value: (u) => (u.bonusLimit ? `${num(u.bonusRemaining)} / ${num(u.bonusLimit)}` : h('span', { class: 'muted' }, '—')) },
        { label: 'Gratis terpakai', num: true, value: (u) => `${num(u.used)} / ${num(u.freeLimit)}` },
        { label: 'Gratis sisa', num: true, value: (u) => num(u.freeRemaining) },
        { label: 'Saldo beli', num: true, value: (u) => (u.purchased ? num(u.purchased) : h('span', { class: 'muted' }, '—')) },
        { label: 'Total tersedia', num: true, value: (u) => h('strong', {}, num(u.remaining)) },
        { label: 'Bar', value: creditBar },
        { label: 'Token (in/out)', num: true, value: (u) => `${compact(u.inTokens)} / ${compact(u.outTokens)}` },
        { label: 'AI terakhir', value: (u) => (u.lastAt ? shortTime(u.lastAt) : h('span', { class: 'muted' }, '—')) },
      ], st.creditUsers, 'Belum ada pengguna.'));

    const storage = card('Penyimpanan', `Dihitung ${dateTime(st.storage.computedAt)}`, h('dl', { class: 'kv flush' },
      h('dt', {}, 'File website'), h('dd', {}, `${bytes(st.storage.siteBytes)} · ${num(st.storage.siteFiles)} file`),
      h('dt', {}, 'Database proyek'), h('dd', {}, `${bytes(st.storage.dbBytes)} · ${num(st.storage.projectsWithDatabase)} proyek`),
      h('dt', {}, 'Sesi login aktif'), h('dd', {}, `${num(st.users.activeSessions)} pengguna`)));

    const q = st.queue;
    const secs = (ms) => `${(ms / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} dtk`;
    const queueCard = card('Antrean AI', `Sejak server terakhir dinyalakan · maks ${num(q.maxConcurrent)} request bersamaan`, h('dl', { class: 'kv flush' },
      h('dt', {}, 'Sedang berjalan / batas saat ini'), h('dd', {}, `${num(q.active)} / ${num(q.currentLimit)}${q.currentLimit < q.maxConcurrent ? ` (diturunkan dari ${num(q.maxConcurrent)})` : ''}`),
      h('dt', {}, 'Menunggu di antrean'), h('dd', {}, `${num(q.queued)} / ${num(q.queueMax)}`),
      h('dt', {}, 'Request yang sempat mengantre'), h('dd', {}, `${num(q.queuedTotal)} dari ${num(q.served)}`),
      h('dt', {}, 'Waktu tunggu (median / maks)'), h('dd', {}, `${secs(q.medianWaitMs)} / ${secs(q.maxWaitMs)}`),
      h('dt', {}, 'Coba ulang karena provider sibuk'), h('dd', {}, num(q.retries)),
      h('dt', {}, 'Ditolak: antrean penuh / kelamaan'), h('dd', {}, `${num(q.rejectedFull)} / ${num(q.timedOut)}`)));

    const payments = card('Transaksi terbaru', `${num(st.revenue.pending)} QRIS masih menunggu pembayaran`, table([
      { label: 'Waktu', value: (p) => shortTime(p.createdAt) },
      { label: 'Pengguna', value: (p) => p.username },
      { label: 'Item', num: true, value: (p) => (p.packageId?.startsWith('plan:') ? `Langganan ${p.packageId.slice(5)}` : p.packageId?.startsWith('asst:') ? 'Saldo asisten' : `${num(p.credits)} kredit`) },
      { label: 'Nominal', num: true, value: (p) => rupiah(p.amount) },
      { label: 'Status', value: (p) => h('span', { class: `pill ${p.status}` }, { succeeded: 'Lunas', pending: 'Menunggu', failed: 'Gagal', expired: 'Kedaluwarsa', canceled: 'Batal' }[p.status] ?? p.status, p.livemode ? null : h('span', { class: 'muted' }, ' · uji')) },
    ], st.recentPayments, 'Belum ada transaksi.'));

    const signups = card('Pendaftar terbaru', null, table([
      { label: 'Pengguna', value: userLink },
      { label: 'Email', value: (u) => u.email },
      { label: 'Daftar', value: (u) => shortTime(u.createdAt) },
    ], st.recentUsers, 'Belum ada pengguna.'));

    $('#page').replaceChildren(
      h('p', { class: 'meta' }, `Diperbarui ${dateTime(st.generatedAt)} · waktu WIB`),
      tiles,
      charts,
      h('div', { class: 'grid three' }, health, topUsers, h('div', { class: 'stack' }, queueCard, storage)),
      creditUsers,
      h('div', { class: 'grid two' }, payments, signups));
  }

  // ---------- Harga langganan ----------
  // Dimuat & dirender terpisah dari statistik, supaya isian yang belum disimpan tidak hilang saat statistik dimuat ulang.
  const mbLabel = (n) => `${Math.round(n / 1048576)} MB`;

  async function plansApi(method, body) {
    const res = await fetch('/api/admin/plans', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
    return data;
  }

  async function loadPlans() {
    try {
      renderPlans(await plansApi('GET'));
    } catch (err) {
      $('#plans').replaceChildren(h('p', { class: 'error' }, `Gagal memuat harga langganan: ${err.message}`));
    }
  }

  function renderPlans(data) {
    const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
    const numberInput = (value, attrs = {}) => h('input', { type: 'number', inputmode: 'numeric', value: String(value), ...attrs });
    const costInput = numberInput(data.modelCost || '', { min: '0', step: '0.01', placeholder: 'mis. 431' });
    const freeInput = numberInput(data.freeDaily, { min: '0', max: String(data.limits.freeDailyMax), step: '1', required: true });
    const bonusInput = numberInput(data.freeBonus, { min: '0', max: String(data.limits.freeBonusMax), step: '1', required: true });
    const freeEstimate = h('small', {});
    const bonusEstimate = h('small', {});
    const updateBonuses = () => {
      const n = Number(freeInput.value) || 0;
      const b = Number(bonusInput.value) || 0;
      const cost = Number(costInput.value) || 0;
      const totalFirstMonth = b + n * 30;
      freeEstimate.textContent = n
        ? `Maks. ${num(n * 30)} kredit/bulan per pengguna${cost && data.usage.avgTokens ? ` · biaya AI terburuk ≈ ${rupiah(Math.round((n * 30 / data.creditsPerPrompt) * data.usage.avgTokens * cost / 1e6))}/pengguna/bulan` : ''}.`
        : 'Pengguna gratis tidak mendapat kredit AI.';
      bonusEstimate.textContent = b
        ? `Sekali per akun, tidak menumpuk. Bulan pertama maks. ≈ ${num(totalFirstMonth)} kredit${cost && data.usage.avgTokens ? ` · biaya terburuk ≈ ${rupiah(Math.round((totalFirstMonth / data.creditsPerPrompt) * data.usage.avgTokens * cost / 1e6))}` : ''}.`
        : 'Tanpa bonus kredit awal.';
    };
    freeInput.addEventListener('input', updateBonuses);
    bonusInput.addEventListener('input', updateBonuses);
    costInput.addEventListener('input', updateBonuses);
    updateBonuses();
    const status = h('span', { class: 'save-status', role: 'status' });
    const saveBtn = h('button', { type: 'submit', class: 'save-btn', disabled: true }, 'Simpan harga');

    const rows = data.plans.map((plan) => {
      const price = numberInput(plan.price, { min: String(data.limits.minPrice), max: String(data.limits.maxPrice), step: '1000', required: true });
      const quota = numberInput(plan.quota, { min: '1', max: String(data.limits.maxQuota), step: '1', required: true });
      const enabled = h('input', { type: 'checkbox', checked: plan.enabled });
      const estimate = h('div', { class: 'estimate' });
      const daily = plan.quotaUnit === 'daily';

      // Perkiraan biaya AI terburuk (semua kuota terpakai) dari rata-rata token per prompt 30 hari terakhir.
      const update = () => {
        const p = Number(price.value) || 0;
        const qv = Number(quota.value) || 0;
        const prompts = daily ? qv * 30 : qv / data.creditsPerPrompt;
        const perUnit = qv ? p / (daily ? qv * 30 : qv) : 0;
        const cost = Number(costInput.value) || 0;
        const lines = [h('div', {}, daily ? 'Harga per prompt (maks. terpakai)' : 'Harga per kredit', h('strong', {}, rupiah(Math.round(perUnit))))];
        if (cost && data.usage.avgTokens) {
          const maxCost = Math.round((prompts * data.usage.avgTokens * cost) / 1e6);
          const margin = p ? Math.round(((p - maxCost) / p) * 100) : 0;
          lines.push(h('div', {}, 'Biaya AI jika kuota habis', h('strong', {}, `≈ ${rupiah(maxCost)}`)));
          lines.push(h('div', { class: margin < 30 ? 'warn' : 'good' }, 'Margin terburuk', h('strong', {}, `${margin}%`)));
        }
        estimate.replaceChildren(...lines);
      };
      for (const el of [price, quota]) el.addEventListener('input', update);
      costInput.addEventListener('input', update);
      update();

      return {
        read: () => ({ id: plan.id, price: Number(price.value), quota: Number(quota.value), enabled: enabled.checked }),
        el: h('div', { class: `plan-row${plan.enabled ? '' : ' off'}` },
          h('div', { class: 'plan-head' },
            h('h3', {}, plan.name),
            h('label', { class: 'switch' }, enabled, h('span', {}, 'Dijual'))),
          h('div', { class: 'plan-fields' },
            field('Harga / 30 hari (Rp)', price),
            field(daily ? 'Batas prompt per hari' : 'Kredit AI per 30 hari', quota, daily ? 'Fair use; hari dihitung WIB' : null)),
          h('p', { class: 'plan-storage' }, `Storage ${mbLabel(plan.storage.totalSize)} · database ${mbLabel(plan.storage.dbBytes)} · gambar ${mbLabel(plan.storage.imageSize)}/file`),
          estimate),
        enabled,
      };
    });
    rows.forEach((r) => r.enabled.addEventListener('change', () => r.el.classList.toggle('off', !r.enabled.checked)));

    const form = h('form', { class: 'card plans-card', novalidate: true },
      h('div', { class: 'plans-title' },
        h('div', {},
          h('h2', {}, 'Harga langganan & kredit gratis'),
          h('p', { class: 'sub' }, 'Berlaku untuk pembelian baru. Pelanggan aktif tetap memakai masa aktifnya; paket yang tidak dijual tetap berlaku bagi yang sudah membayar.')),
        h('div', { class: 'plans-actions' }, status, saveBtn)),
      h('div', { class: 'plan-grid' }, rows.map((r) => r.el)),
      h('div', { class: 'plan-free' },
        h('div', { class: 'plan-head' }, h('h3', {}, 'Gratis')),
        field('Kredit AI gratis per hari', freeInput, 'Reset 00.00 WIB, tidak menumpuk.'),
        freeEstimate,
        field('Bonus kredit awal (sekali per akun)', bonusInput, 'Berlaku untuk semua akun yang belum menghabiskannya, termasuk pengguna lama. Habis pakai, tidak kembali.'),
        bonusEstimate),
      h('div', { class: 'plan-cost' },
        field('Biaya model AI per 1 juta token (Rp)', costInput, 'Opsional, untuk menghitung margin.'),
        h('p', { class: 'usage-note' }, data.usage.prompts
          ? `30 hari terakhir: ${num(data.usage.prompts)} prompt, rata-rata ${num(data.usage.avgTokens)} token/prompt (maks. ${num(data.usage.maxTokens)}).`
          : 'Belum ada data pemakaian AI 30 hari terakhir, jadi biaya belum bisa diperkirakan.')));

    const markDirty = () => { saveBtn.disabled = false; status.textContent = 'Belum disimpan'; status.className = 'save-status dirty'; };
    form.addEventListener('input', markDirty);
    form.addEventListener('change', markDirty);
    form.onsubmit = async (e) => {
      e.preventDefault();
      saveBtn.disabled = true;
      status.textContent = 'Menyimpan…';
      status.className = 'save-status';
      try {
        const saved = await plansApi('PUT', { plans: rows.map((r) => r.read()), modelCost: Number(costInput.value) || 0, freeDaily: Number(freeInput.value), freeBonus: Number(bonusInput.value) });
        renderPlans(saved);
        const done = $('#plans .save-status');
        done.textContent = 'Tersimpan ✓';
        done.className = 'save-status ok';
      } catch (err) {
        saveBtn.disabled = false;
        status.textContent = err.message;
        status.className = 'save-status error-text';
      }
    };
    $('#plans').replaceChildren(form);
  }

  // ---------- Asisten AI website: model & pemakaian ----------
  async function assistantApi(method, path = '', body) {
    const res = await fetch(`/api/admin/assistant${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
    return data;
  }

  async function loadAssistantAdmin() {
    try {
      renderAssistantAdmin(await assistantApi('GET'));
    } catch (err) {
      $('#assistantAdmin').replaceChildren(h('p', { class: 'error' }, `Gagal memuat pengaturan asisten: ${err.message}`));
    }
  }

  function renderAssistantAdmin(data) {
    const status = h('span', { class: 'save-status', role: 'status' });
    const saveBtn = h('button', { type: 'submit', class: 'save-btn', disabled: true }, 'Simpan model');
    const trialInput = h('input', { type: 'number', min: '0', step: '100', value: String(data.trial) });
    const rowsEl = h('tbody', {});
    const rows = [];

    const perAnswer = (cost, markup) => ((data.typicalTokens * cost * markup) / 1e6);
    function addRow(m) {
      const input = (value, attrs = {}) => h('input', { value: String(value ?? ''), ...attrs });
      const r = {
        enabled: h('input', { type: 'checkbox', checked: m.enabled, title: 'Aktif' }),
        key: input(m.key, { placeholder: 'kode', maxlength: '30', class: 'mono' }),
        name: input(m.name, { placeholder: 'Nama tampil' }),
        tier: input(m.tier, { placeholder: 'Hemat / Pintar', maxlength: '20' }),
        model: input(m.model, { placeholder: 'id model di gateway', class: 'mono' }),
        cost: input(m.cost, { type: 'number', min: '0', step: '1' }),
        markup: input(m.markup, { type: 'number', min: '1', max: '20', step: '0.1' }),
        price: h('span', { class: 'num-cell' }),
      };
      const update = () => {
        const c = Number(r.cost.value) || 0;
        const k = Number(r.markup.value) || 0;
        const sell = perAnswer(c, k);
        const base = perAnswer(c, 1);
        r.price.textContent = `≈ Rp${sell.toLocaleString('id-ID', { maximumFractionDigits: 2 })} (modal Rp${base.toLocaleString('id-ID', { maximumFractionDigits: 2 })})`;
      };
      r.cost.addEventListener('input', update);
      r.markup.addEventListener('input', update);
      update();
      r.tr = h('tr', { class: m.enabled ? '' : 'off' },
        h('td', {}, r.enabled), h('td', {}, r.key), h('td', {}, r.name), h('td', {}, r.tier), h('td', {}, r.model),
        h('td', {}, r.cost), h('td', {}, r.markup), h('td', {}, r.price),
        h('td', {}, h('button', { type: 'button', class: 'row-del', title: 'Hapus model', onclick: () => {
          rows.splice(rows.indexOf(r), 1);
          r.tr.remove();
          markDirty();
        } }, '×')));
      r.enabled.addEventListener('change', () => r.tr.classList.toggle('off', !r.enabled.checked));
      rows.push(r);
      rowsEl.append(r.tr);
    }
    data.models.forEach(addRow);

    const markDirty = () => { saveBtn.disabled = false; status.textContent = 'Belum disimpan'; status.className = 'save-status dirty'; };
    const form = h('form', { class: 'card plans-card', novalidate: true },
      h('div', { class: 'plans-title' },
        h('div', {},
          h('h2', {}, 'Asisten AI website'),
          h('p', { class: 'sub' }, `Model yang bisa dipilih pengguna untuk chatbot websitenya. Biaya = Rp per 1 juta token dari gateway; harga jual = biaya × margin. Perkiraan per jawaban memakai ±${num(data.typicalTokens)} token.`)),
        h('div', { class: 'plans-actions' }, status, saveBtn)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'model-table' },
        h('thead', {}, h('tr', {}, ['Aktif', 'Kode', 'Nama', 'Label', 'ID model', 'Biaya/1jt token', 'Margin ×', 'Harga jual/jawaban', ''].map((t) => h('th', {}, t)))),
        rowsEl)),
      h('div', { class: 'model-actions' },
        h('button', { type: 'button', class: 'ghost-btn', onclick: () => { addRow({ key: '', name: '', tier: '', model: '', cost: '', markup: 3, enabled: false }); markDirty(); } }, '+ Tambah model'),
        h('label', { class: 'field inline' }, h('span', {}, 'Saldo percobaan per akun (Rp)'), trialInput)),
      h('h3', { class: 'sub-title' }, 'Website yang memakai asisten'),
      data.sites.length
        ? h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['Website', 'Pemilik', 'Status', 'Model', 'Hari ini', '30 hari', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, data.sites.map((site) => h('tr', {},
            h('td', {}, h('a', { href: site.siteUrl, target: '_blank', rel: 'noopener' }, site.slug)),
            h('td', {}, site.username),
            h('td', {}, h('span', { class: `pill ${site.blocked ? 'failed' : site.enabled ? 'succeeded' : 'pending'}` }, site.blocked ? 'Diblokir' : site.enabled ? 'Aktif' : 'Mati')),
            h('td', {}, site.modelKey || '—'),
            h('td', { class: 'num' }, `${num(site.messagesToday)} · ${rupiah(Math.round(site.spentToday))}`),
            h('td', { class: 'num' }, `${num(site.messages30)} · ${rupiah(Math.round(site.spent30))}`),
            h('td', {}, h('button', { type: 'button', class: 'ghost-btn small', onclick: async () => {
              try {
                renderAssistantAdmin(await assistantApi('POST', '/block', { slug: site.slug, blocked: !site.blocked }));
              } catch (err) {
                alertStatus(err.message);
              }
            } }, site.blocked ? 'Buka blokir' : 'Blokir')))))))
        : h('p', { class: 'sub' }, 'Belum ada website yang mengatur asisten.'));

    function alertStatus(message) {
      status.textContent = message;
      status.className = 'save-status error-text';
    }
    form.addEventListener('input', markDirty);
    form.addEventListener('change', markDirty);
    form.onsubmit = async (e) => {
      e.preventDefault();
      saveBtn.disabled = true;
      status.textContent = 'Menyimpan…';
      status.className = 'save-status';
      try {
        const saved = await assistantApi('PUT', '', {
          models: rows.map((r) => ({
            key: r.key.value, name: r.name.value, tier: r.tier.value, model: r.model.value,
            cost: Number(r.cost.value), markup: Number(r.markup.value), enabled: r.enabled.checked,
          })),
          trial: Number(trialInput.value),
        });
        renderAssistantAdmin(saved);
        const done = $('#assistantAdmin .save-status');
        done.textContent = 'Tersimpan ✓';
        done.className = 'save-status ok';
      } catch (err) {
        saveBtn.disabled = false;
        alertStatus(err.message);
      }
    };
    $('#assistantAdmin').replaceChildren(form);
  }

  // ---------- Event ----------
  function setDays(value) {
    days = value;
    try { localStorage.setItem('rakit.adminDays', String(value)); } catch { /* abaikan */ }
    document.querySelectorAll('.range [data-days]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.days) === days)));
  }
  document.querySelectorAll('.range [data-days]').forEach((btn) => {
    btn.onclick = () => { setDays(Number(btn.dataset.days)); load(); };
  });
  $('#refresh').onclick = load;
  setDays([7, 30, 90].includes(days) ? days : 30);
  load();
  loadPlans();
  loadAssistantAdmin();
})();
