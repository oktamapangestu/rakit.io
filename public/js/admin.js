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
        detail: [h('strong', {}, `+${num(st.users.inPeriod)}`), ` dalam ${period} · ${num(st.users.today)} hari ini`],
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
        h('dt', {}, 'Kredit gratis terpakai bulan ini'), h('dd', {}, num(st.credits.usedThisMonth))));

    const topUsers = card('Pengguna paling aktif', `Berdasarkan request AI · ${period}`, table([
      { label: 'Pengguna', value: userLink },
      { label: 'Request', num: true, value: (u) => num(u.aiRequests) },
      { label: 'Token', num: true, value: (u) => compact(u.tokens) },
      { label: 'Belanja', num: true, value: (u) => (u.spent ? rupiah(u.spent) : h('span', { class: 'muted' }, '—')) },
    ], st.topUsers, 'Belum ada pemakaian AI.'));

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
      { label: 'Kredit', num: true, value: (p) => num(p.credits) },
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
      h('div', { class: 'grid two' }, payments, signups));
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
})();
