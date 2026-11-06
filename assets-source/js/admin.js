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
  // Waktu relatif: "baru saja", "12 menit lalu", "3 jam lalu", lalu tanggal untuk yang lebih lama.
  function ago(value) {
    const mins = Math.floor((Date.now() - new Date(value)) / 60000);
    if (mins < 2) return 'baru saja';
    if (mins < 60) return `${mins} menit lalu`;
    if (mins < 24 * 60) return `${Math.floor(mins / 60)} jam lalu`;
    if (mins < 7 * 24 * 60) return `${Math.floor(mins / 1440)} hari lalu`;
    return shortTime(value);
  }
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
      for (const id of ['#tab-ringkasan', '#tab-pengguna']) $(id).replaceChildren(h('p', { class: 'error' }, `Gagal memuat statistik: ${err.message}`));
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

  // Di layar sempit tabel ditampilkan sebagai kartu per baris (CSS `table.cards`): tiap sel diberi label dari
  // judul kolomnya. lead = indeks sel judul kartu (lebar penuh, tanpa label); wide = sel lain yang lebar penuh.
  function stack(tableEl, { lead = 0, wide = [] } = {}) {
    const labels = [...tableEl.querySelectorAll('thead th')].map((th) => th.textContent);
    tableEl.classList.add('cards');
    for (const tr of tableEl.querySelectorAll('tbody tr')) {
      [...tr.children].forEach((td, i) => {
        if (td.hasAttribute('colspan')) return;
        if (labels[i]) td.dataset.label = labels[i];
        if (i === lead) td.classList.add('lead');
        if (wide.includes(i)) td.classList.add('wide');
      });
    }
    return tableEl;
  }

  function table(columns, rows, empty) {
    return h('div', { class: 'table-wrap' }, stack(h('table', {},
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'num' : null }, c.label)))),
      h('tbody', {}, rows.length
        ? rows.map((r) => h('tr', {}, columns.map((c) => h('td', { class: c.num ? 'num' : null }, c.value(r)))))
        : h('tr', {}, h('td', { class: 'empty-row', colspan: String(columns.length) }, empty)))),
    { wide: columns.flatMap((c, i) => (c.wide ? [i] : [])) }));
  }

  const userLink = (u) => h('a', { href: u.siteUrl, target: '_blank', rel: 'noopener' }, u.username);

  // ---------- Render ----------
  const muted = (text = '—') => h('span', { class: 'muted' }, text);
  const sectionTitle = (text) => h('h2', { class: 'section-title' }, text);

  // Bar kecil: prompt gratis hari ini (terpakai / sisa).
  const creditBar = (u) => {
    const cap = u.freeLimit || 1;
    const seg = (n, cls) => (n > 0 ? h('span', { class: `seg ${cls}`, style: `width:${(n / cap) * 100}%` }) : null);
    return h('span', { class: 'creditbar', title: `Prompt gratis hari ini: terpakai ${num(u.used)}, sisa ${num(u.freeRemaining)} · kredit dibeli ${num(u.purchased)}` },
      seg(u.used, 'used'), seg(u.freeRemaining, 'free'));
  };

  function render() {
    renderOverview();
    renderPeople();
  }

  function renderOverview() {
    const st = stats;
    const period = `${st.days} hari terakhir`;
    const failed = st.ai.requests - (st.ai.byStatus.ok ?? 0);
    const totalTokens = st.tokenRanking.editorTokens + st.tokenRanking.assistantTokens;

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
        label: 'Token terpakai',
        value: compact(totalTokens),
        detail: [`Editor ${compact(st.tokenRanking.editorTokens)} · asisten `, h('strong', {}, compact(st.tokenRanking.assistantTokens))],
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
      card('Request AI per hari', `${period} · AI editor`,
        barChart({ data: st.ai.byDay, value: (d) => d.requests, color: 'var(--series-ai)', format: (d) => `${num(d.requests)} request · ${num(d.failed)} gagal · ${compact(d.tokens)} token` }),
        dataTable(st.ai.byDay, [{ label: 'Tanggal', value: (d) => dayLabel(d.date) }, { label: 'Request', num: true, value: (d) => num(d.requests) }, { label: 'Gagal', num: true, value: (d) => num(d.failed) }, { label: 'Token', num: true, value: (d) => num(d.tokens) }])));

    const health = card('Kesehatan AI editor', period,
      st.ai.requests
        ? h('ul', { class: 'status-list' }, Object.entries(st.ai.byStatus).map(([status, count]) => h('li', {},
          h('span', { class: 'dot', style: `background:${STATUS[status]?.color ?? 'var(--faint)'}` }),
          h('span', { class: 'name' }, STATUS[status]?.label ?? status),
          h('span', { class: 'count' }, num(count)),
          h('span', { class: 'pct' }, pct(count, st.ai.requests)))))
        : h('p', { class: 'sub' }, 'Belum ada request AI di periode ini.'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Model aktif'), h('dd', { class: 'mono' }, st.ai.currentModel),
        st.ai.models.flatMap((m) => [h('dt', { class: 'mono' }, m.model), h('dd', {}, `${num(m.requests)} request`)]),
        h('dt', {}, 'Token input / output'), h('dd', {}, `${num(st.ai.tokensIn)} / ${num(st.ai.tokensOut)}`),
        h('dt', {}, 'Kredit gratis terpakai hari ini'), h('dd', {}, num(st.credits.usedToday))));

    // Pemeriksaan kode otomatis job Builder (go/internal/ai/codecheck.go), per model.
    const CHECK_LABEL = { js: 'sintaks JS', css: 'struktur CSS', ref: 'file/tautan hilang', alpine: 'Alpine', column: 'kolom database', fn: 'fungsi hilang', api: 'API database', link: 'tautan mati', contrast: 'kontras', edit: 'edit_file meleset', tool: 'tool gagal', claim: 'klaim tanpa tool', loss: 'kode hilang', shrink: 'file menyusut', form: 'form tak tersimpan', chatbot: 'chatbot tanpa widget', page: 'error di halaman (check_page)', scratch: 'fungsi percobaan tertinggal' };
    const quality = card('Kualitas kode AI per model', `${period} · job Builder yang selesai`, table([
      { label: 'Model', value: (m) => h('span', { class: 'mono' }, m.model), wide: true },
      { label: 'Job', num: true, value: (m) => num(m.builds) },
      { label: 'Sempat bermasalah', num: true, value: (m) => `${num(m.problems)} (${pct(m.problems, m.builds)})` },
      { label: 'Selesai masih bermasalah', num: true, value: (m) => `${num(m.left)} (${pct(m.left, m.builds)})` },
      { label: 'Putaran rata-rata', num: true, value: (m) => (m.rounds / m.builds).toLocaleString('id-ID', { maximumFractionDigits: 1 }) },
      { label: 'Masalah terbanyak', value: (m) => Object.entries(m.found).sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([k, n]) => `${CHECK_LABEL[k] ?? k} ${num(n)}`).join(' · ') || muted() },
    ], st.ai.codeQuality ?? [], 'Belum ada job Builder di periode ini.'));

    const q = st.queue;
    const secs = (ms) => `${(ms / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} dtk`;
    const queueCard = card('Antrean AI', `Sejak server terakhir dinyalakan · maks ${num(q.maxConcurrent)} request bersamaan`, h('dl', { class: 'kv flush' },
      h('dt', {}, 'Sedang berjalan / batas saat ini'), h('dd', {}, `${num(q.active)} / ${num(q.currentLimit)}${q.currentLimit < q.maxConcurrent ? ` (diturunkan dari ${num(q.maxConcurrent)})` : ''}`),
      h('dt', {}, 'Menunggu di antrean'), h('dd', {}, `${num(q.queued)} / ${num(q.queueMax)}`),
      h('dt', {}, 'Request yang sempat mengantre'), h('dd', {}, `${num(q.queuedTotal)} dari ${num(q.served)}`),
      h('dt', {}, 'Waktu tunggu (median / maks)'), h('dd', {}, `${secs(q.medianWaitMs)} / ${secs(q.maxWaitMs)}`),
      h('dt', {}, 'Coba ulang karena provider sibuk'), h('dd', {}, num(q.retries)),
      h('dt', {}, 'Ditolak: antrean penuh / kelamaan'), h('dd', {}, `${num(q.rejectedFull)} / ${num(q.timedOut)}`)));

    const storage = card('Penyimpanan', `Dihitung ${dateTime(st.storage.computedAt)}`, h('dl', { class: 'kv flush' },
      h('dt', {}, 'File website'), h('dd', {}, `${bytes(st.storage.siteBytes)} · ${num(st.storage.siteFiles)} file`),
      h('dt', {}, 'Database proyek'), h('dd', {}, `${bytes(st.storage.dbBytes)} · ${num(st.storage.projectsWithDatabase)} proyek`),
      h('dt', {}, 'Sesi login aktif'), h('dd', {}, `${num(st.users.activeSessions)} pengguna`)));

    const payments = card('Transaksi terbaru', `${num(st.revenue.pending)} QRIS masih menunggu pembayaran`, table([
      { label: 'Waktu', value: (p) => shortTime(p.createdAt) },
      { label: 'Pengguna', value: (p) => p.username },
      { label: 'Item', value: (p) => (p.packageId?.startsWith('plan:') ? `Langganan ${p.packageId.slice(5)} (lama)` : p.packageId?.startsWith('asst:') ? 'Saldo asisten' : `${num(p.credits)} kredit`) },
      { label: 'Nominal', num: true, value: (p) => rupiah(p.amount) },
      { label: 'Status', value: (p) => h('span', { class: `pill ${p.status}` }, { succeeded: 'Lunas', pending: 'Menunggu', failed: 'Gagal', expired: 'Kedaluwarsa', canceled: 'Batal' }[p.status] ?? p.status, p.livemode ? null : muted(' · uji')) },
    ], st.recentPayments, 'Belum ada transaksi.'));

    $('#tab-ringkasan').replaceChildren(
      h('p', { class: 'meta' }, `Diperbarui ${dateTime(st.generatedAt)} · waktu WIB`),
      tiles,
      sectionTitle('Tren harian'),
      charts,
      sectionTitle('Sistem & transaksi'),
      h('div', { class: 'grid three' }, health, h('div', { class: 'stack' }, queueCard, storage), payments),
      quality);
  }

  // Ranking pemakaian token: bar tersusun (input / output editor / asisten) relatif terhadap peringkat 1.
  function tokenRankingCard(st) {
    const tr = st.tokenRanking;
    const total = tr.editorTokens + tr.assistantTokens;
    const top = tr.users[0]?.tokens || 1;
    const seg = (n, cls) => (n > 0 ? h('span', { class: `seg ${cls}`, style: `width:${(n / top) * 100}%` }) : null);
    const legend = h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'in' }), 'Input editor'),
      h('span', {}, h('i', { class: 'out' }), 'Output editor'),
      h('span', {}, h('i', { class: 'asst' }), 'Asisten website'));

    const rows = tr.users.map((u, i) => h('tr', { class: i < 3 ? `rank-top rank-${i + 1}` : null },
      h('td', { class: 'rank' }, h('span', { class: 'rank-no' }, String(i + 1))),
      h('td', {}, h('div', { class: 'who' }, userLink(u), h('span', { class: 'muted' }, u.email))),
      h('td', { class: 'share-cell' },
        h('span', { class: 'tokenbar', title: `Input ${num(u.inTokens)} · output ${num(u.outTokens)} · asisten ${num(u.assistantTokens)}` },
          seg(u.inTokens, 'in'), seg(u.outTokens, 'out'), seg(u.assistantTokens, 'asst'))),
      h('td', { class: 'num' }, h('strong', {}, compact(u.tokens)), h('div', { class: 'muted small' }, pct(u.tokens, total))),
      h('td', { class: 'num' }, u.aiRequests ? `${compact(u.inTokens)} / ${compact(u.outTokens)}` : muted()),
      h('td', { class: 'num' }, u.aiRequests ? [num(u.aiRequests), h('div', { class: 'muted small' }, `≈ ${compact(Math.round((u.inTokens + u.outTokens) / u.aiRequests))}/request`)] : muted()),
      h('td', { class: 'num' }, u.assistantTokens ? [compact(u.assistantTokens), h('div', { class: 'muted small' }, `${num(u.assistantMessages)} jawaban`)] : muted()),
      h('td', { class: 'num' }, u.spent ? rupiah(u.spent) : muted())));

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', {}, 'Ranking pemakaian token'),
          h('p', { class: 'sub' }, `20 pengguna teratas · ${st.days} hari terakhir · total ${num(total)} token (editor ${compact(tr.editorTokens)}, asisten ${compact(tr.assistantTokens)})`)),
        legend),
      h('div', { class: 'table-wrap' }, stack(h('table', { class: 'ranking' },
        h('thead', {}, h('tr', {},
          h('th', { class: 'rank' }, '#'), h('th', {}, 'Pengguna'), h('th', {}, 'Komposisi'), h('th', { class: 'num' }, 'Total token'),
          h('th', { class: 'num' }, 'Editor in / out'), h('th', { class: 'num' }, 'Request editor'), h('th', { class: 'num' }, 'Asisten'), h('th', { class: 'num' }, 'Belanja'))),
        h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { class: 'empty-row', colspan: '8' }, 'Belum ada pemakaian token di periode ini.')))), { lead: 1, wide: [2] })));
  }

  // Ranking per aksi: request AI editor dengan token terbanyak, siapa yang menjalankan, dan apa yang diminta.
  // Server mengirim gabungan 20 teratas menurut total, input, dan output, jadi urutan bisa diganti di sini.
  const ACTIONS = { build: 'Builder', plan: 'Plan', diagram: 'Diagram' };
  const SORTS = { total: ['Total', (a) => a.inTokens + a.outTokens], in: ['Input', (a) => a.inTokens], out: ['Output', (a) => a.outTokens] };
  let actionSort = 'total';
  function tokenActionsCard(st) {
    const body = h('div', {});
    const switcher = h('div', { class: 'range', role: 'radiogroup', 'aria-label': 'Urutkan menurut' });
    const draw = () => {
      const by = SORTS[actionSort][1];
      const list = [...(st.tokenRanking.actions ?? [])].sort((a, b) => by(b) - by(a)).slice(0, 20);
      const numCell = (key, content) => h('td', { class: key === actionSort ? 'num sorted' : 'num' }, content);
      switcher.replaceChildren(...Object.entries(SORTS).map(([key, [label]]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(key === actionSort), onclick: () => { actionSort = key; draw(); },
      }, label)));
      body.replaceChildren(h('div', { class: 'table-wrap' }, stack(h('table', { class: 'action-ranking' },
        h('thead', {}, h('tr', {},
          h('th', { class: 'rank' }, '#'), h('th', {}, 'Aksi'), h('th', {}, 'Pengguna'),
          h('th', { class: 'num' }, 'Input'), h('th', { class: 'num' }, 'Output'), h('th', { class: 'num' }, 'Total'), h('th', {}, 'Model'))),
        h('tbody', {}, list.length
          ? list.map((a, i) => h('tr', { class: i < 3 ? `rank-top rank-${i + 1}` : null },
            h('td', { class: 'rank' }, h('span', { class: 'rank-no' }, String(i + 1))),
            h('td', {}, h('div', { class: 'action-cell' },
              h('span', {}, h('span', { class: `act act-${a.action || 'none'}` }, ACTIONS[a.action] ?? 'AI'),
                a.detail ? h('span', { class: 'act-detail', title: a.detail }, a.detail) : muted(a.action ? '—' : 'aksi belum tercatat')),
              h('span', { class: 'muted' },
                a.project ? h('a', { href: a.projectUrl, target: '_blank', rel: 'noopener' }, a.project) : 'project tidak diketahui',
                ' · ', h('span', { title: dateTime(a.at) }, shortTime(a.at))))),
            h('td', {}, h('div', { class: 'who' }, userLink(a), h('span', { class: 'muted' }, a.email))),
            numCell('in', num(a.inTokens)),
            numCell('out', num(a.outTokens)),
            numCell('total', h('strong', {}, compact(a.inTokens + a.outTokens))),
            h('td', {}, h('span', { class: 'mono small' }, a.model),
              a.status !== 'ok' ? h('div', {}, h('span', { class: 'pill failed' }, STATUS[a.status]?.label ?? a.status)) : null)))
          : h('tr', {}, h('td', { class: 'empty-row', colspan: '7' }, 'Belum ada request AI editor di periode ini.')))), { lead: 1 })));
    };
    draw();
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', {}, 'Aksi AI dengan token terbanyak'),
          h('p', { class: 'sub' }, `20 request AI editor teratas (Builder, Plan, diagram) · ${st.days} hari terakhir`)),
        switcher),
      body);
  }

  // Kredit per pengguna: semua akun, bisa dicari; ditampilkan bertahap supaya tabel tidak terlalu panjang.
  let creditQuery = '';
  let creditLimit = 25;
  function creditUsersCard(st) {
    const body = h('div', {});
    const draw = () => {
      const q = creditQuery.trim().toLowerCase();
      const list = q ? st.creditUsers.filter((u) => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) : st.creditUsers;
      const shown = list.slice(0, creditLimit);
      body.replaceChildren(
        table([
          { label: 'Pengguna', value: (u) => h('div', { class: 'who' }, userLink(u), h('span', { class: 'muted' }, u.email)) },
          { label: 'Gratis hari ini', num: true, value: (u) => `${num(u.used)} / ${num(u.freeLimit)}` },
          { label: 'Saldo beli', num: true, value: (u) => (u.purchased ? num(u.purchased) : muted()) },
          { label: 'Prompt hari ini', value: creditBar, wide: true },
          { label: 'Token seumur akun', num: true, value: (u) => (u.tokens ? compact(u.tokens) : muted()) },
          { label: 'AI terakhir', value: (u) => (u.lastAt ? shortTime(u.lastAt) : muted()) },
        ], shown, q ? 'Tidak ada pengguna yang cocok.' : 'Belum ada pengguna.'),
        list.length > shown.length
          ? h('div', { class: 'more' }, h('button', { type: 'button', class: 'ghost-btn small', onclick: () => { creditLimit += 50; draw(); } }, `Tampilkan lagi (${num(list.length - shown.length)} tersisa)`))
          : null);
    };
    const search = h('input', { type: 'search', class: 'search', placeholder: 'Cari username / email', value: creditQuery, 'aria-label': 'Cari pengguna' });
    search.addEventListener('input', () => { creditQuery = search.value; creditLimit = 25; draw(); });
    draw();
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', {},
          h('h2', {}, 'Kredit per pengguna'),
          h('p', { class: 'sub' }, `Jatah ${num(st.credits.freePerUser)} prompt/hari (reset 00.00 WIB), lalu kredit yang dibeli · ${num(st.creditUsers.length)} pengguna`)),
        search),
      body);
  }

  function renderPeople() {
    const st = stats;
    const signups = card('Pendaftar terbaru', '10 akun terakhir', table([
      { label: 'Pengguna', value: (u) => h('div', { class: 'who' }, userLink(u), h('span', { class: 'muted' }, u.email)) },
      { label: 'Daftar', value: (u) => h('span', { title: dateTime(u.createdAt) }, ago(u.createdAt)) },
      { label: 'Project', num: true, value: (u) => num(u.projects) },
    ], st.recentUsers, 'Belum ada pengguna.'));

    // "Online" = aktif dalam 10 menit terakhir (waktu aktif dicatat paling sering 5 menit sekali).
    const au = st.activeUsers;
    const active = card('Aktif terakhir', `${num(au.day)} pengguna aktif 24 jam terakhir · ${num(au.week)} dalam 7 hari`, table([
      { label: 'Pengguna', value: (u) => h('div', { class: 'who' }, h('span', {}, userLink(u)), h('span', { class: 'muted' }, u.email)) },
      { label: 'Terakhir aktif', value: (u) => h('span', { class: `seen${Date.now() - new Date(u.lastSeenAt) < 10 * 60000 ? ' online' : ''}`, title: dateTime(u.lastSeenAt) }, ago(u.lastSeenAt)) },
      { label: 'AI terakhir', value: (u) => (u.lastAiAt ? h('span', { title: dateTime(u.lastAiAt) }, ago(u.lastAiAt)) : muted()) },
      { label: 'Project', num: true, value: (u) => num(u.projects) },
    ], au.users, 'Belum ada aktivitas tercatat.'));

    $('#tab-pengguna').replaceChildren(
      h('p', { class: 'meta' }, `Diperbarui ${dateTime(st.generatedAt)} · waktu WIB`),
      tokenRankingCard(st),
      tokenActionsCard(st),
      h('div', { class: 'grid two' }, active, signups),
      creditUsersCard(st));
  }

  // ---------- Jatah AI gratis ----------
  // Dimuat & dirender terpisah dari statistik, supaya isian yang belum disimpan tidak hilang saat statistik dimuat ulang.
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
      $('#plans').replaceChildren(h('p', { class: 'error' }, `Gagal memuat pengaturan AI gratis: ${err.message}`));
    }
  }

  function renderPlans(data) {
    const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
    const numberInput = (value, attrs = {}) => h('input', { type: 'number', inputmode: 'numeric', value: String(value), ...attrs });
    const costInput = numberInput(data.modelCost || '', { min: '0', step: '0.01', placeholder: 'mis. 431' });
    const freeInput = numberInput(data.freeDaily, { min: '0', max: String(data.limits.freeDailyMax), step: '1', required: true });
    const freeEstimate = h('small', {});
    const updateEstimate = () => {
      const n = Number(freeInput.value) || 0;
      const cost = Number(costInput.value) || 0;
      freeEstimate.textContent = n
        ? `Maks. ${num(n * 30)} prompt/bulan per pengguna${cost && data.usage.avgTokens ? ` · biaya AI terburuk ≈ ${rupiah(Math.round(n * 30 * data.usage.avgTokens * cost / 1e6))}/pengguna/bulan` : ''}.`
        : 'Pengguna tidak mendapat prompt gratis (hanya kredit yang dibeli).';
    };
    freeInput.addEventListener('input', updateEstimate);
    costInput.addEventListener('input', updateEstimate);
    updateEstimate();
    const status = h('span', { class: 'save-status', role: 'status' });
    const saveBtn = h('button', { type: 'submit', class: 'save-btn', disabled: true }, 'Simpan');

    const form = h('form', { class: 'card plans-card', novalidate: true },
      h('div', { class: 'plans-title' },
        h('div', {},
          h('h2', {}, 'Jatah AI gratis'),
          h('p', { class: 'sub' }, 'Semua akun mendapat jatah yang sama. Setelah habis, AI memakai kredit yang dibeli.')),
        h('div', { class: 'plans-actions' }, status, saveBtn)),
      h('div', { class: 'plan-free' },
        field('Prompt gratis per hari', freeInput, 'Per akun, reset 00.00 WIB, tidak menumpuk. Prompt bergambar juga dihitung 1.'),
        freeEstimate),
      h('div', { class: 'plan-cost' },
        field('Biaya model AI per 1 juta token (Rp)', costInput, 'Opsional, untuk memperkirakan biaya.'),
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
        const saved = await plansApi('PUT', { modelCost: Number(costInput.value) || 0, freeDaily: Number(freeInput.value) });
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

  // ---------- Provider AI: endpoint kompatibel OpenAI ----------
  // Model merujuk provider dengan "model@id" (tanpa @ = provider bawaan dari .env). Di form model, provider
  // dipilih lewat dropdown di samping ID model (modelRef).
  let providers = [{ id: '', name: 'Bawaan (.env)', builtin: true }];
  const knownModels = new Map(); // id provider → ID model dari tes koneksi (saran isian model)

  const PRESETS = [
    { label: 'OpenAI', id: 'openai', baseUrl: 'https://api.openai.com/v1' },
    { label: 'Anthropic Claude', id: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
    { label: 'Google Gemini', id: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
    { label: 'OpenRouter', id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
    { label: 'DeepSeek', id: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' },
    { label: 'Groq', id: 'groq', baseUrl: 'https://api.groq.com/openai/v1' },
    { label: 'Ollama (lokal)', id: 'ollama', baseUrl: 'http://localhost:11434/v1' },
  ];

  async function providersApi(method, path = '', body) {
    const res = await fetch(`/api/admin/ai-providers${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
    return data;
  }

  async function loadProviders() {
    try {
      const data = await providersApi('GET');
      providers = data.providers;
      renderProviders(data);
    } catch (err) {
      $('#aiProviders').replaceChildren(h('p', { class: 'error' }, `Gagal memuat provider AI: ${err.message}`));
    }
  }

  // Saran ID model per provider (dari tes koneksi), lewat <datalist>.
  const listId = (id) => `models-${id || 'bawaan'}`;
  function fillDatalist(id, models) {
    knownModels.set(id, models);
    let list = document.getElementById(listId(id));
    if (!list) document.body.append(list = h('datalist', { id: listId(id) }));
    list.replaceChildren(...models.map((m) => h('option', { value: m })));
  }

  const splitRef = (ref) => {
    const at = String(ref ?? '').lastIndexOf('@');
    return at < 0 ? [String(ref ?? ''), ''] : [ref.slice(0, at), ref.slice(at + 1)];
  };

  // Isian model: dropdown provider + ID model. read() → "model" atau "model@provider".
  function modelRef(value, { placeholder = 'id model', required = false, label = 'Model' } = {}) {
    const [model, pid] = splitRef(value);
    const select = h('select', { class: 'provider-select', 'aria-label': `Provider ${label}`, title: 'Provider' },
      providers.map((p) => h('option', { value: p.id, selected: p.id === pid }, p.builtin ? 'Bawaan' : p.name)));
    if (pid && !providers.some((p) => p.id === pid)) select.append(h('option', { value: pid, selected: true }, `${pid} (tidak ada)`));
    select.hidden = providers.length < 2 && !pid; // hanya provider bawaan: tidak perlu memilih
    const input = h('input', { value: model, placeholder, required, class: 'mono', maxlength: '100', spellcheck: 'false', autocomplete: 'off', list: listId(pid), 'aria-label': label });
    select.addEventListener('change', () => input.setAttribute('list', listId(select.value)));
    return {
      el: h('span', { class: 'model-ref' }, select, input),
      input,
      read: () => {
        const m = input.value.trim();
        return m && select.value ? `${m}@${select.value}` : m;
      },
    };
  }

  function renderProviders(data) {
    const status = h('span', { class: 'save-status', role: 'status' });
    const formSlot = h('div', {});
    const custom = () => data.providers.filter((p) => !p.builtin);
    const showError = (message) => { status.textContent = message; status.className = 'save-status error-text'; };

    // Simpan seluruh daftar; apiKey kosong = key lama tetap dipakai.
    async function saveList(list, done) {
      status.textContent = 'Menyimpan…';
      status.className = 'save-status';
      try {
        const saved = await providersApi('PUT', '', { providers: list });
        providers = saved.providers;
        renderProviders(saved);
        const ok = $('#aiProviders .save-status');
        ok.textContent = done;
        ok.className = 'save-status ok';
        loadAiModels(); // dropdown provider di form model ikut diperbarui
        loadAssistantAdmin();
        return true;
      } catch (err) {
        showError(err.message);
        return false;
      }
    }

    async function test(body, out) {
      out.className = 'provider-test';
      out.textContent = 'Menguji koneksi…';
      try {
        const res = await providersApi('POST', '/test', body);
        if (!res.ok) {
          out.className = 'provider-test error-text';
          out.textContent = res.error;
          return;
        }
        if (body.id !== undefined) fillDatalist(body.id, res.models);
        out.className = 'provider-test ok';
        out.replaceChildren(`✓ Terhubung · ${num(res.models.length)} model`,
          res.models.length ? h('span', { class: 'muted' }, ` — mis. ${res.models.slice(0, 6).join(', ')}${res.models.length > 6 ? ', …' : ''}`) : '');
      } catch (err) {
        out.className = 'provider-test error-text';
        out.textContent = err.message;
      }
    }

    // Form tambah/ubah. p = provider yang diubah (null = baru).
    function openForm(p) {
      const fields = {
        name: h('input', { value: p?.name ?? '', placeholder: 'mis. OpenAI', maxlength: '60', required: true }),
        id: h('input', { value: p?.id ?? '', placeholder: 'mis. openai', maxlength: '30', class: 'mono', spellcheck: 'false', readonly: Boolean(p), required: true }),
        baseUrl: h('input', { value: p?.baseUrl ?? '', placeholder: 'https://api.openai.com/v1', class: 'mono', spellcheck: 'false', required: true }),
        apiKey: h('input', { type: 'password', placeholder: p?.hasKey ? `kosong = tetap ${p.keyHint}` : 'sk-…', class: 'mono', autocomplete: 'new-password', spellcheck: 'false' }),
      };
      let idTouched = Boolean(p);
      fields.id.addEventListener('input', () => { idTouched = true; });
      fields.name.addEventListener('input', () => {
        if (!idTouched) fields.id.value = fields.name.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
      });
      const preset = p ? null : h('select', { onchange: () => {
        const pr = PRESETS.find((x) => x.id === preset.value);
        if (!pr) return;
        fields.name.value = pr.label;
        if (!idTouched || !fields.id.value) fields.id.value = pr.id;
        fields.baseUrl.value = pr.baseUrl;
        fields.apiKey.focus();
      } }, h('option', { value: '' }, 'Isi sendiri (kompatibel OpenAI)'), PRESETS.map((pr) => h('option', { value: pr.id }, pr.label)));
      const result = h('div', { class: 'provider-test' });
      const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
      const values = () => ({ id: fields.id.value.trim().toLowerCase(), name: fields.name.value.trim(), baseUrl: fields.baseUrl.value.trim(), apiKey: fields.apiKey.value.trim() });
      const form = h('form', { class: 'provider-form', novalidate: true },
        h('h3', { class: 'sub-title' }, p ? `Ubah ${p.name}` : 'Provider baru'),
        h('div', { class: 'provider-fields' },
          preset ? field('Pilih cepat', preset) : null,
          field('Nama', fields.name),
          field('ID', fields.id, p ? 'ID tidak bisa diubah (dipakai di model: id-model@id).' : 'Dipakai di model: id-model@id.'),
          field('Base URL', fields.baseUrl, 'Alamat API kompatibel OpenAI, biasanya diakhiri /v1.'),
          field('API key', fields.apiKey, p?.hasKey ? 'Biarkan kosong untuk tetap memakai key lama.' : 'Disimpan di server; tidak pernah ditampilkan lagi.')),
        result,
        h('div', { class: 'model-actions' },
          h('button', { type: 'button', class: 'ghost-btn', onclick: () => test({ ...values(), id: p?.id ?? values().id }, result) }, 'Tes koneksi'),
          h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'ghost-btn', onclick: () => formSlot.replaceChildren() }, 'Batal'),
          h('button', { type: 'submit', class: 'save-btn' }, p ? 'Simpan perubahan' : 'Tambah provider')));
      form.onsubmit = async (e) => {
        e.preventDefault();
        const v = values();
        const list = custom().map((x) => ({ id: x.id, name: x.name, baseUrl: x.baseUrl, apiKey: '' }));
        if (p) list[list.findIndex((x) => x.id === p.id)] = { ...v, id: p.id };
        else list.push(v);
        await saveList(list, p ? 'Provider disimpan ✓' : 'Provider ditambahkan ✓');
      };
      formSlot.replaceChildren(form);
      (p ? fields.name : preset).focus();
    }

    const rows = data.providers.map((p) => {
      const result = h('div', { class: 'provider-test' });
      return h('div', { class: 'provider-row' },
        h('div', { class: 'provider-main' },
          h('div', { class: 'provider-name' },
            h('strong', {}, p.name),
            p.builtin ? h('span', { class: 'pill pending' }, 'atur di .env') : h('code', {}, `@${p.id}`)),
          h('div', { class: 'mono small muted' }, p.baseUrl || 'Belum diatur (AI_BASE_URL)'),
          h('div', { class: 'small muted' }, p.hasKey ? `API key ${p.keyHint}` : 'Tanpa API key'),
          h('div', { class: 'small' }, p.usedBy.length ? `Dipakai: ${p.usedBy.join(' · ')}` : h('span', { class: 'muted' }, 'Belum dipakai model mana pun')),
          result),
        h('div', { class: 'provider-actions' },
          h('button', { type: 'button', class: 'ghost-btn small', disabled: !p.baseUrl, onclick: () => test(p.builtin ? { builtin: true, id: '' } : { id: p.id, baseUrl: p.baseUrl }, result) }, 'Tes'),
          p.builtin ? null : h('button', { type: 'button', class: 'ghost-btn small', onclick: () => openForm(p) }, 'Ubah'),
          p.builtin ? null : h('button', { type: 'button', class: 'ghost-btn small danger', title: p.usedBy.length ? 'Masih dipakai model' : 'Hapus provider', onclick: async () => {
            if (p.usedBy.length) return showError(`"${p.name}" masih dipakai (${p.usedBy.join(', ')}). Ganti model itu dulu.`);
            if (!confirm(`Hapus provider "${p.name}"? API key-nya ikut terhapus.`)) return;
            await saveList(custom().filter((x) => x.id !== p.id).map((x) => ({ id: x.id, name: x.name, baseUrl: x.baseUrl, apiKey: '' })), 'Provider dihapus ✓');
          } }, 'Hapus')));
    });

    const addBtn = h('button', { type: 'button', class: 'save-btn', disabled: custom().length >= data.maxProviders, onclick: () => openForm(null) }, '+ Tambah provider');
    $('#aiProviders').replaceChildren(h('div', { class: 'card plans-card' },
      h('div', { class: 'plans-title' },
        h('div', {},
          h('h2', {}, 'Provider AI'),
          h('p', { class: 'sub' }, 'Layanan AI yang dipakai editor & asisten website: semua yang kompatibel OpenAI (OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek, Groq, Ollama, …). Pilih provider di samping tiap model di bawah. Taruh model cadangan di provider lain supaya permintaan tetap jalan saat satu provider gangguan.')),
        h('div', { class: 'plans-actions' }, status, addBtn)),
      h('div', { class: 'provider-list' }, rows),
      formSlot));
  }

  // ---------- Model AI editor: utama & daftar cadangan ----------
  async function aiModelsApi(method, body) {
    const res = await fetch('/api/admin/ai-models', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
    return data;
  }

  async function loadAiModels() {
    try {
      renderAiModels(await aiModelsApi('GET'));
    } catch (err) {
      $('#aiModels').replaceChildren(h('p', { class: 'error' }, `Gagal memuat pengaturan model AI: ${err.message}`));
    }
  }

  function renderAiModels(data) {
    const status = h('span', { class: 'save-status', role: 'status' });
    const saveBtn = h('button', { type: 'submit', class: 'save-btn', disabled: true }, 'Simpan model');
    const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, h('small', {}, hint));
    const inputs = {
      model: modelRef(data.models.model, { placeholder: 'id model', required: true, label: 'Model utama' }),
      vision: modelRef(data.models.vision, { placeholder: 'kosong = lampiran gambar dimatikan', label: 'Model gambar' }),
    };

    // Daftar cadangan: dicoba berurutan dari atas saat model sebelumnya gangguan.
    const fallbackList = (models, label) => {
      const list = h('ol', { class: 'fallback-list' });
      const addBtn = h('button', { type: 'button', class: 'ghost-btn small', onclick: () => { add('').focus(); changed(); } }, '+ Tambah model cadangan');
      const changed = () => {
        addBtn.hidden = list.children.length >= data.maxFallbacks;
        list.hidden = !list.children.length;
        form.dispatchEvent(new Event('input'));
      };
      const refs = new Map(); // <li> → isian model
      const add = (value) => {
        const ref = modelRef(value, { label });
        const row = h('li', {}, ref.el,
          h('button', { type: 'button', class: 'icon-btn', title: 'Hapus', 'aria-label': `Hapus ${label}`, onclick: () => { row.remove(); refs.delete(row); changed(); } }, '✕'));
        refs.set(row, ref);
        list.append(row);
        return ref.input;
      };
      models.forEach(add);
      addBtn.hidden = models.length >= data.maxFallbacks;
      list.hidden = !models.length;
      return {
        el: h('div', { class: 'fallbacks' }, h('span', { class: 'fallbacks-label' }, label), list, addBtn),
        read: () => [...list.children].map((row) => refs.get(row).read()).filter(Boolean),
      };
    };
    const fallbacks = fallbackList(data.models.fallbacks, 'Model cadangan');
    const visionFallbacks = fallbackList(data.models.visionFallbacks, 'Model gambar cadangan');

    // Model per tugas: ikuti default (model utama), atau model khusus + cadangannya sendiri.
    const tasks = data.taskList.map((t) => {
      const own = data.tasks[t.key];
      const ref = modelRef(own?.model ?? '', { placeholder: 'id model', label: `Model ${t.label}` });
      const extra = fallbackList(own?.fallbacks ?? [], `Cadangan ${t.label}`);
      const custom = h('div', { class: 'task-custom' }, ref.el, extra.el);
      const mode = h('select', { class: 'task-mode', 'aria-label': `Model untuk ${t.label}` },
        h('option', { value: '' }, `Ikuti ${t.default.toLowerCase()}`),
        h('option', { value: 'own', selected: Boolean(own) }, 'Model khusus'));
      const sync = () => { custom.hidden = !mode.value; };
      mode.addEventListener('change', () => { sync(); if (mode.value) ref.input.focus(); });
      sync();
      return {
        key: t.key,
        el: h('div', { class: 'task-row' },
          h('div', { class: 'task-head' }, h('strong', {}, t.label), h('small', {}, t.description)),
          mode, custom),
        read: () => (mode.value ? { model: ref.read(), fallbacks: extra.read() } : { model: '', fallbacks: [] }),
      };
    });

    const form = h('form', { class: 'card plans-card', novalidate: true },
      h('div', { class: 'plans-title' },
        h('div', {},
          h('h2', {}, 'Model AI editor'),
          h('p', { class: 'sub' }, `Bila model utama gangguan (error, sibuk terus, atau tidak merespons), permintaan otomatis diulang dengan model cadangan — berurutan dari atas sampai ada yang berhasil (maks. ${num(data.maxFallbacks)}). Model yang gangguan dilewati ${num(data.cooldownMinutes)} menit, lalu dicoba lagi.`)),
        h('div', { class: 'plans-actions' }, status, saveBtn)),
      h('div', { class: 'ai-model-grid' },
        h('div', { class: 'ai-model-group' },
          field('Model utama', inputs.model.el, 'Dipakai semua tugas yang tidak diberi model khusus (lihat Model per tugas).'),
          fallbacks.el),
        h('div', { class: 'ai-model-group' },
          field('Model gambar (vision)', inputs.vision.el, 'Membaca gambar yang dilampirkan di prompt.'),
          visionFallbacks.el)),
      h('h3', { class: 'sub-title' }, 'Model per tugas'),
      h('p', { class: 'sub' }, 'Beri tugas tertentu model sendiri — mis. model kecil & cepat untuk prediksi kode, model terkuat untuk Builder. Cadangannya terpisah dari cadangan model utama.'),
      h('div', { class: 'task-list' }, tasks.map((t) => t.el)),
      h('h3', { class: 'sub-title' }, 'Keadaan model'),
      h('div', { class: 'table-wrap' }, stack(h('table', {},
        h('thead', {}, h('tr', {}, ['Model', 'Status', 'Gangguan', 'Error terakhir'].map((t) => h('th', {}, t)))),
        h('tbody', {}, data.health.map((m) => h('tr', {},
          h('td', { class: 'mono' }, m.model),
          h('td', {}, h('span', { class: `pill ${m.down ? 'failed' : 'succeeded'}` }, m.down ? `Gangguan · dicoba lagi ${Math.ceil(m.retryInSeconds / 60)} mnt` : 'Normal')),
          h('td', { class: 'num' }, num(m.failures)),
          h('td', {}, m.lastError
            ? h('span', { class: 'muted', title: m.lastError }, `${new Date(m.lastFailureAt).toLocaleString('id-ID')} · ${m.lastError.slice(0, 80)}`)
            : h('span', { class: 'muted' }, '—')))))), { wide: [1, 3] })),
      h('p', { class: 'usage-note' }, `Dialihkan ke model cadangan ${num(data.fallbackUsed)} kali sejak server dinyalakan.`));

    const markDirty = () => { saveBtn.disabled = false; status.textContent = 'Belum disimpan'; status.className = 'save-status dirty'; };
    form.addEventListener('input', markDirty);
    form.addEventListener('change', markDirty);
    form.onsubmit = async (e) => {
      e.preventDefault();
      saveBtn.disabled = true;
      status.textContent = 'Menyimpan…';
      status.className = 'save-status';
      try {
        const saved = await aiModelsApi('PUT', {
          model: inputs.model.read(), fallbacks: fallbacks.read(), vision: inputs.vision.read(), visionFallbacks: visionFallbacks.read(),
          tasks: Object.fromEntries(tasks.map((t) => [t.key, t.read()])),
        });
        renderAiModels(saved);
        const done = $('#aiModels .save-status');
        done.textContent = 'Tersimpan ✓';
        done.className = 'save-status ok';
      } catch (err) {
        saveBtn.disabled = false;
        status.textContent = err.message;
        status.className = 'save-status error-text';
      }
    };
    $('#aiModels').replaceChildren(form);
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

    const MODEL_COLS = ['Aktif', 'Kode', 'Nama', 'Label', 'Provider · ID model', 'Biaya/1jt token', 'Margin ×', 'Harga jual/jawaban', ''];
    const perAnswer = (cost, markup) => ((data.typicalTokens * cost * markup) / 1e6);
    function addRow(m) {
      const input = (value, attrs = {}) => h('input', { value: String(value ?? ''), ...attrs });
      const r = {
        enabled: h('input', { type: 'checkbox', checked: m.enabled, title: 'Aktif' }),
        key: input(m.key, { placeholder: 'kode', maxlength: '30', class: 'mono' }),
        name: input(m.name, { placeholder: 'Nama tampil' }),
        tier: input(m.tier, { placeholder: 'Hemat / Pintar', maxlength: '20' }),
        model: modelRef(m.model, { label: `Model ${m.name || 'asisten'}` }),
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
        h('td', {}, r.enabled), h('td', {}, r.key), h('td', {}, r.name), h('td', {}, r.tier), h('td', {}, r.model.el),
        h('td', {}, r.cost), h('td', {}, r.markup), h('td', {}, r.price),
        h('td', {}, h('button', { type: 'button', class: 'row-del', title: 'Hapus model', onclick: () => {
          rows.splice(rows.indexOf(r), 1);
          r.tr.remove();
          markDirty();
        } }, '×')));
      // Label kolom untuk tampilan kartu di layar sempit (baris bisa ditambah setelah tabel dibuat).
      [...r.tr.children].forEach((td, i) => {
        if (MODEL_COLS[i]) td.dataset.label = MODEL_COLS[i];
        if (i === 4 || i === 7) td.classList.add('wide');
      });
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
          h('p', { class: 'sub' }, `Model yang bisa dipilih pengguna untuk chatbot websitenya. Biaya = Rp per 1 juta token dari provider; harga jual = biaya × margin. Perkiraan per jawaban memakai ±${num(data.typicalTokens)} token.`)),
        h('div', { class: 'plans-actions' }, status, saveBtn)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'model-table cards' },
        h('thead', {}, h('tr', {}, MODEL_COLS.map((t) => h('th', {}, t)))),
        rowsEl)),
      h('div', { class: 'model-actions' },
        h('button', { type: 'button', class: 'ghost-btn', onclick: () => { addRow({ key: '', name: '', tier: '', model: '', cost: '', markup: 3, enabled: false }); markDirty(); } }, '+ Tambah model'),
        h('label', { class: 'field inline' }, h('span', {}, 'Saldo percobaan per akun (Rp)'), trialInput)),
      h('h3', { class: 'sub-title' }, 'Website yang memakai asisten'),
      data.sites.length
        ? h('div', { class: 'table-wrap' }, stack(h('table', {},
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
            } }, site.blocked ? 'Buka blokir' : 'Blokir'))))))))
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
            key: r.key.value, name: r.name.value, tier: r.tier.value, model: r.model.read(),
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

  // ---------- Email platform (lupa password) ----------
  async function mailApi(method, path = '', body) {
    const res = await fetch(`/api/admin/mail${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Gagal (${res.status})`);
    return data;
  }

  async function loadMail() {
    try {
      renderMail(await mailApi('GET'));
    } catch (err) {
      $('#mailSettings').replaceChildren(h('p', { class: 'error' }, `Gagal memuat pengaturan email: ${err.message}`));
    }
  }

  function renderMail(data) {
    const status = h('span', { class: 'save-status', role: 'status' });
    const setStatus = (text, kind = '') => { status.textContent = text; status.className = `save-status ${kind}`; };
    const fields = {
      sender: h('input', { type: 'email', value: data.sender, placeholder: 'hello@domain-terverifikasi.com', class: 'mono', spellcheck: 'false', autocomplete: 'off' }),
      senderName: h('input', { value: data.senderName, placeholder: 'mis. rakit.io', maxlength: '60' }),
      apiKey: h('input', { type: 'password', placeholder: data.hasKey ? `kosong = tetap ${data.keyHint}` : 'API key', class: 'mono', autocomplete: 'new-password', spellcheck: 'false' }),
    };
    const testTo = h('input', { type: 'email', placeholder: 'kosong = email akunmu', class: 'mono', spellcheck: 'false', autocomplete: 'off' });
    const testResult = h('div', { class: 'provider-test' });
    const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);

    async function save(body, done) {
      setStatus('Menyimpan…');
      try {
        renderMail(await mailApi('PUT', '', body));
        const ok = $('#mailSettings .save-status');
        ok.textContent = done;
        ok.className = 'save-status ok';
      } catch (err) {
        setStatus(err.message, 'error-text');
      }
    }

    async function sendTest() {
      testResult.className = 'provider-test';
      testResult.textContent = 'Mengirim email tes…';
      try {
        const res = await mailApi('POST', '/test', { to: testTo.value.trim() });
        testResult.className = `provider-test ${res.ok ? 'ok' : 'error-text'}`;
        testResult.textContent = res.ok ? `✓ Terkirim ke ${res.to}` : res.error;
      } catch (err) {
        testResult.className = 'provider-test error-text';
        testResult.textContent = err.message;
      }
    }

    const form = h('form', { novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      save({ sender: fields.sender.value, senderName: fields.senderName.value, apiKey: fields.apiKey.value }, 'Pengaturan email disimpan ✓');
    } },
      h('div', { class: 'provider-fields' },
        field('Email pengirim', fields.sender, 'Harus memakai domain yang sudah diverifikasi di layanan email.'),
        field('Nama pengirim', fields.senderName, 'Tampil sebagai nama pengirim. Boleh kosong.'),
        field('API key', fields.apiKey, data.hasKey ? 'Biarkan kosong untuk tetap memakai key lama.' : 'Disimpan di server; tidak pernah ditampilkan lagi.')),
      h('div', { class: 'model-actions' },
        data.hasKey ? h('button', { type: 'button', class: 'ghost-btn small danger', onclick: () => {
          if (confirm('Hapus API key email? Fitur lupa password akan mati.')) save({ sender: data.sender, senderName: data.senderName, clearKey: true }, 'API key dihapus ✓');
        } }, 'Hapus API key') : null,
        h('span', { class: 'spacer' }),
        h('button', { type: 'submit', class: 'save-btn' }, 'Simpan')));

    $('#mailSettings').replaceChildren(h('div', { class: 'card plans-card' },
      h('div', { class: 'plans-title' },
        h('div', {},
          h('h2', {}, 'Email'),
          h('p', { class: 'sub' }, 'Pengirim email platform, dipakai untuk link lupa password. Fitur lupa password muncul di halaman masuk setelah email pengirim dan API key diisi.',
            h('br'), h('span', { class: 'mono small muted' }, data.apiUrl))),
        h('div', { class: 'plans-actions' }, status,
          h('span', { class: `pill ${data.enabled ? 'succeeded' : 'pending'}` }, data.enabled ? 'Aktif' : 'Belum aktif'))),
      h('div', { class: 'provider-form' }, form),
      h('h3', { class: 'sub-title' }, 'Kirim email tes'),
      h('div', { class: 'model-actions mail-test' },
        h('label', { class: 'field' }, h('span', {}, 'Kirim ke'), testTo),
        h('button', { type: 'button', class: 'ghost-btn', disabled: !data.enabled, title: data.enabled ? null : 'Simpan email pengirim & API key dulu', onclick: sendTest }, 'Kirim tes')),
      testResult));
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
  // Tab disimpan di hash URL (#ringkasan, #pengguna, #pengaturan) supaya bisa ditautkan & bertahan saat reload.
  const TABS = ['ringkasan', 'pengguna', 'pengaturan'];
  function showTab(name) {
    const tab = TABS.includes(name) ? name : 'ringkasan';
    for (const t of TABS) $(`#tab-${t}`).hidden = t !== tab;
    document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $('.range').hidden = tab === 'pengaturan'; // periode tidak berlaku untuk pengaturan
    $('#tooltip').hidden = true;
  }
  document.querySelectorAll('.tabs [data-tab]').forEach((btn) => {
    btn.onclick = () => { history.replaceState(null, '', `#${btn.dataset.tab}`); showTab(btn.dataset.tab); };
  });
  addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  showTab(location.hash.slice(1));

  $('#refresh').onclick = load;
  setDays([7, 30, 90].includes(days) ? days : 30);
  load();
  loadPlans();
  loadMail();
  // Model memakai daftar provider (dropdown), jadi provider dimuat dulu.
  loadProviders().finally(() => {
    loadAiModels();
    loadAssistantAdmin();
  });
})();
