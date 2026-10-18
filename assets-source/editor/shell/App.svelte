<!--
  Kerangka editor (.app): header, panel file, area editor (tab mode & isinya), preview, navigasi HP, menu konteks,
  dan toast, beserta komponen isinya (pohon file, tab, panel AI, preview, tab Data/Diagram/Fungsi/…). Aksinya dari
  editor.js lewat prop actions; atribut yang berubah (mode aktif, panel tampil, kredit, paket, status simpan, …)
  mengikuti state. Dipasang dengan context 'editor', jadi semua komponen di dalamnya bisa memakai getContext('editor').
-->
<script>
  import { ui, toasts, views } from './state.svelte.js';
  import { splitter } from './resize.js';
  import ContextMenu from './ContextMenu.svelte';
  import FileTree from '../files/FileTree.svelte';
  import FileUsage from '../files/Usage.svelte';
  import Tabs from '../files/Tabs.svelte';
  import Breadcrumbs from '../files/Breadcrumbs.svelte';
  import PreviewPanel from '../preview/PreviewPanel.svelte';
  import AiPanel from '../ai/AiPanel.svelte';
  import TableList from '../database/TableList.svelte';
  import DbUsage from '../database/Usage.svelte';
  import DbMain from '../database/DbMain.svelte';
  import DiagramView from '../diagram/DiagramView.svelte';
  import Functions from '../functions/Functions.svelte';
  import History from '../history/History.svelte';
  import ConsoleTab from '../console/Console.svelte';
  import FlowPanel from '../flow/FlowPanel.svelte';
  import Docs from '../docs/Docs.svelte';
  import { core } from '../files/state.svelte.js';
  import { ai, canAfford, unlimitedLeft } from '../ai/state.svelte.js';
  import { con } from '../console/state.svelte.js';
  import { flow } from '../flow/state.svelte.js';
  import { FEATURE_INFO } from '../features.js';
  import { shortDate } from '../format.js';

  // actions (editor.js): toggleSidebar() · togglePreview() · setLayout(l) · setMode(m) · setMobileView(v) ·
  // projectMenu(anchor) · accountMenu() · copySite() · publish() · topup(tab?) · info(key) · createEntry(type, dir?) ·
  // upload() · refresh() · collapse() · openIndex() · tree (attachment #tree: klik, menu, keyboard, seret gambar) ·
  // selectTab(path) · closeTab(path) · toggleFlow() · flowKey(e) · flow (aksi FlowPanel) · setAutosave(on) ·
  // historyMenu(anchor) · clearHistory() · newConversation() · newTable() · preview (aksi PreviewPanel)
  let { actions } = $props();

  // Versi Inggris (halaman /en/editor) menautkan ke halaman berbahasa Inggris.
  const EN = document.documentElement.lang === 'en';
  const EDITOR_HREF = EN ? '/en/editor' : '/editor';
  const GUIDE_HREF = EN ? '/en/panduan' : '/panduan';

  const p = $derived(core.project);
  const manual = $derived(p?.mode === 'manual');
  const pubPending = $derived(manual && Boolean(ui.pubStatus?.pending));
  $effect(() => { if (p) document.body.dataset.publish = manual ? 'manual' : 'live'; });

  // Baca Alur Kode hanya untuk file .html, .css, .js.
  const canFlow = $derived(Boolean(core.active) && ['html', 'css', 'js'].includes(core.active.split('.').pop().toLowerCase()));

  // Kredit AI (lencana di atas panel AI).
  const c = $derived(ai.credits);
  const plan = $derived(c?.plan ?? null);
  const credit = $derived.by(() => {
    if (!c || !c.enabled) return { text: '', title: 'Kredit AI', empty: false, disabled: false };
    const unlimited = unlimitedLeft(c);
    return {
      text: unlimited ? 'Unlimited' : `${c.remaining} kredit`,
      empty: !canAfford(c, c.costPerPrompt),
      disabled: !c.topupEnabled,
      title: [
        plan && `${plan.name} aktif sampai ${shortDate(plan.expiresAt)}`,
        plan && (plan.id === 'unlimited'
          ? `Hari ini: ${plan.quotaUsed}/${plan.quota} prompt`
          : `Kredit ${plan.name}: ${plan.quotaRemaining}/${plan.quota} (terisi ulang ${shortDate(plan.quotaResetsAt)})`),
        c.bonusRemaining > 0 ? `Bonus awal: ${c.bonusRemaining}/${c.bonusLimit} (sekali, tidak berkurang tiap hari sampai habis)` : null,
        c.limit ? `Gratis hari ini: ${c.freeRemaining}/${c.limit} (terisi lagi besok 00.00 WIB, tidak menumpuk)` : null,
        c.purchased ? `Dibeli: ${c.purchased}` : null,
        c.topupEnabled ? 'Klik untuk langganan / isi ulang' : null,
      ].filter(Boolean).join(' · '),
    };
  });
  // Lencana langganan di header: peringatan saat masa aktif hampir habis.
  const planInfo = $derived.by(() => {
    if (!plan) return { expiring: false, days: '', title: null };
    const daysLeft = Math.max(0, Math.ceil((Date.parse(plan.expiresAt) - Date.now()) / 86_400_000));
    const expiring = daysLeft <= 3;
    return {
      expiring,
      days: expiring ? (daysLeft ? `${daysLeft} hari lagi` : 'berakhir hari ini') : '',
      title: `${plan.name} aktif sampai ${shortDate(plan.expiresAt)}${expiring ? ' · klik untuk perpanjang' : ''}`,
    };
  });
</script>

<header class="topbar">
  <div class="top-left">
    <a class="brand" href={EDITOR_HREF} title="rakit.io"><img class="logo" src="/logo.svg" alt=""><span class="brand-name">rakit<span class="dim">.io</span></span></a>
    <button class="chip-btn" id="toggleSidebar" class:active={ui.mode === 'code' && !ui.sidebarHidden} onclick={actions.toggleSidebar} title="Tampilkan/sembunyikan file (Ctrl+B)">
      <svg viewBox="0 0 16 16"><path d="M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5zM3.5 2a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5H6V2zM7 2v12h5.5a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5z"/></svg>
    </button>
    <div class="project-chip">
      <button type="button" class="project-switch" id="projectSwitch" onclick={(e) => { e.stopPropagation(); actions.projectMenu(e.currentTarget); }} title={p ? `Project: ${p.name} — ganti atau buat project` : 'Ganti atau buat project'}>
        <svg viewBox="0 0 16 16"><path d="M1.5 2h5l1 1.5h7l.5.5v9.5l-.5.5h-13l-.5-.5v-11zM2 3v9.5h12V4.5H7.2L6.2 3zm5.5 3.5v2h-2v1h2v2h1v-2h2v-1h-2v-2z"/></svg>
        <svg class="caret" viewBox="0 0 16 16"><path d="M4 6h8l-4 5z"/></svg>
      </button>
      <span class="live-dot" title="Online"></span>
      <a id="siteLink" target="_blank" rel="noopener" title="Buka website di tab baru" href={p?.siteUrl}>{p?.siteHost ?? ''}</a>
      <button class="mini-btn" id="copySite" title="Salin URL" onclick={actions.copySite}>
        <svg viewBox="0 0 16 16"><path d="M4 2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1z"/></svg>
      </button>
    </div>
  </div>

  <div class="top-center">
    <div class="layout-switch" class:attention={ui.layoutAttention} role="radiogroup" aria-label="Tampilan editor">
      <button type="button" role="radio" data-layout="simple" aria-checked={String(ui.layout === 'simple')} onclick={() => actions.setLayout('simple')} title="Simple: cukup ngobrol dengan AI dan lihat hasilnya">
        <svg viewBox="0 0 16 16"><path d="M8 0l1.6 4.4L14 6l-4.4 1.6L8 12 6.4 7.6 2 6l4.4-1.6zM13 10l.8 2.2L16 13l-2.2.8L13 16l-.8-2.2L10 13l2.2-.8z"/></svg>
        Simple
      </button>
      <button type="button" role="radio" data-layout="coding" aria-checked={String(ui.layout === 'coding')} onclick={() => actions.setLayout('coding')} title="Coding: file, editor kode, database, diagram, dan riwayat">
        <svg viewBox="0 0 16 16"><path d="M5.3 4.3 1.6 8l3.7 3.7-.7.7L.2 8l4.4-4.4zm5.4 0 .7-.7L15.8 8l-4.4 4.4-.7-.7L14.4 8z"/></svg>
        Coding
      </button>
    </div>
    <span class={["save-pill", ui.save.kind]} id="statusSave">{ui.save.text}</span>
  </div>

  <div class="top-right">
    <button class="chip-btn" id="togglePreview" class:active={!ui.previewHidden} onclick={actions.togglePreview} title="Tampilkan/sembunyikan preview (Ctrl+\)">
      <svg viewBox="0 0 16 16"><path d="M8 3C4.5 3 1.9 5.4 1 8c.9 2.6 3.5 5 7 5s6.1-2.4 7-5c-.9-2.6-3.5-5-7-5m0 8.5A3.5 3.5 0 1 1 8 4.5a3.5 3.5 0 0 1 0 7m0-5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4"/></svg>
      <span>Preview</span>
    </button>
    <a class="chip-btn" id="guideLink" href={GUIDE_HREF} target="_blank" rel="noopener" title="Panduan fitur &amp; cheat sheet prompt">
      <svg viewBox="0 0 16 16"><path d="M3 1.5A1.5 1.5 0 0 1 4.5 0h7A1.5 1.5 0 0 1 13 1.5v13a.5.5 0 0 1-.77.42L8 12.05 3.77 14.92A.5.5 0 0 1 3 14.5zm1.5-.5a.5.5 0 0 0-.5.5v11.53l3.73-2.53a.5.5 0 0 1 .54 0L12 13.53V1.5a.5.5 0 0 0-.5-.5zM5.5 3h5v1h-5zm0 2.5h5v1h-5zm0 2.5h3v1h-3z"/></svg>
      <span>Panduan</span>
    </a>
    <button type="button" class="release-btn" id="publishBtn" onclick={actions.publish} class:pending={pubPending} hidden={!manual}
      title={pubPending ? 'Ada perubahan yang belum dipublikasikan' : 'Website publik sudah sama dengan versi dev'}>
      <svg viewBox="0 0 16 16"><path d="M8 1 3.5 5.5l.7.7L7.5 2.9V11h1V2.9l3.3 3.3.7-.7zM2 10v4.5l.5.5h11l.5-.5V10h-1v4H3v-4z"/></svg>
      <span>Publikasikan</span>
      <i class="release-dot" aria-hidden="true"></i>
    </button>
    <a class="publish-btn" id="visitSite" target="_blank" rel="noopener" href={p?.siteUrl}>
      <svg viewBox="0 0 16 16"><path d="M9 2v1h3.3L6.6 8.6l.8.8L13 3.7V7h1V2zM12 13H3V4h4V3H2v11h11V9h-1z"/></svg>
      <span>Lihat situs</span>
    </a>
    <button type="button" class="plan-badge" id="planBadge" onclick={() => actions.topup('plans')} hidden={!plan} data-plan={plan?.id} class:expiring={planInfo.expiring} title={planInfo.title}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5.2l3.2 2.3L8 3l2.8 4.5L14 5.2 12.8 12H3.2zM3.3 13h9.4v1.2H3.3z"/></svg>
      <span class="plan-badge-name">{plan?.name ?? ''}</span>
      <span class="plan-badge-days">{planInfo.days}</span>
    </button>
    <button class="avatar" id="avatarBtn" title="Akun" onclick={(e) => { e.stopPropagation(); actions.accountMenu(); }} class:subscribed={Boolean(plan)} data-plan={plan?.id ?? ''}>{core.me?.username[0] ?? ''}</button>
  </div>
</header>

<div class="workbench">

  <main class="panel editor-area" id="editorArea" data-mode={ui.mode}>
    <div class="mode-switch" role="tablist" aria-label="Mode editor">
      <button role="tab" data-mode="ai" aria-selected={String(ui.mode === 'ai')} onclick={() => actions.setMode('ai')} title="Asisten AI (Ctrl+I)">
        <svg viewBox="0 0 16 16"><path d="M8 0l1.6 4.4L14 6l-4.4 1.6L8 12 6.4 7.6 2 6l4.4-1.6zM13 10l.8 2.2L16 13l-2.2.8L13 16l-.8-2.2L10 13l2.2-.8z"/></svg>
        AI
      </button>
      <button role="tab" data-mode="code" aria-selected={String(ui.mode === 'code')} onclick={() => actions.setMode('code')} title="Editor kode">
        <svg viewBox="0 0 16 16"><path d="M5.3 4.3 1.6 8l3.7 3.7-.7.7L.2 8l4.4-4.4zm5.4 0 .7-.7L15.8 8l-4.4 4.4-.7-.7L14.4 8z"/></svg>
        Code
      </button>
      <button role="tab" data-mode="data" aria-selected={String(ui.mode === 'data')} onclick={() => actions.setMode('data')} title="Database">
        <svg viewBox="0 0 16 16"><path d="M8 1C4.7 1 2 2.1 2 3.5v9C2 13.9 4.7 15 8 15s6-1.1 6-2.5v-9C14 2.1 11.3 1 8 1m0 1c2.9 0 5 .9 5 1.5S10.9 5 8 5 3 4.1 3 3.5 5.1 2 8 2M3 5c1.1.6 2.9 1 5 1s3.9-.4 5-1v3.5C13 9.1 10.9 10 8 10s-5-.9-5-1.5zm0 5c1.1.6 2.9 1 5 1s3.9-.4 5-1v2.5c0 .6-2.1 1.5-5 1.5s-5-.9-5-1.5z"/></svg>
        Data
      </button>
      <button role="tab" data-mode="diagram" aria-selected={String(ui.mode === 'diagram')} onclick={() => actions.setMode('diagram')} title="Diagram buatan AI (UML, ERD, peta halaman, alur data)">
        <svg viewBox="0 0 16 16"><path d="M1 1.5h5l.5.5v3l-.5.5H4v2h4V7l.5-.5h5l.5.5v3l-.5.5h-5L8 10V8.5H4v3h2l.5.5v3l-.5.5H1l-.5-.5v-3L1 11.5h2v-6H1L.5 5V2zm.5 1V4.5h4v-2zm8 5v2h4v-2zm-8 5v2h4v-2z"/></svg>
        Diagram
      </button>
      <button role="tab" data-mode="fn" aria-selected={String(ui.mode === 'fn')} onclick={() => actions.setMode('fn')} data-i18n="mode" title="Fungsi serverless: kode backend di /api/fn/…">
        <svg viewBox="0 0 16 16"><path d="M9.3 1 3 9.2h4.2L6.3 15l6.6-8.4H8.7z"/></svg>
        Fungsi
      </button>
      <button role="tab" data-mode="history" aria-selected={String(ui.mode === 'history')} onclick={() => actions.setMode('history')} title="Riwayat versi: lihat dan kembalikan versi sebelumnya">
        <svg viewBox="0 0 16 16"><path d="M8 1.5a6.5 6.5 0 1 1-6.14 4.35l.94.33A5.5 5.5 0 1 0 8 2.5c-1.77 0-3.35.84-4.35 2.15H5.5v1H2V2.15h1v1.72A6.48 6.48 0 0 1 8 1.5M7.5 4h1v3.8l2.6 1.5-.5.87-3.1-1.8z"/></svg>
        Riwayat
      </button>
      <button role="tab" data-mode="console" aria-selected={String(ui.mode === 'console')} onclick={() => actions.setMode('console')} title="Console: log dari halaman (FE), fungsi serverless (BE), dan request jaringan">
        <svg viewBox="0 0 16 16"><path d="M1.5 2h13l.5.5v11l-.5.5h-13l-.5-.5v-11zM2 3v10h12V3zm1.6 2.2.7-.7L7.1 8l-2.8 2.5-.7-.7L5.7 8zM8 10h4.5v1H8z"/></svg>
        Console
        <span class="console-badge" id="consoleBadge" hidden={!con.unread} title={`${con.unread} error baru`}>{con.unread > 99 ? '99+' : String(con.unread)}</span>
      </button>
      <button role="tab" data-mode="docs" aria-selected={String(ui.mode === 'docs')} onclick={() => actions.setMode('docs')} title="Dokumentasi project: API database & fungsi, struktur database, dan konfigurasi (otomatis)">
        <svg viewBox="0 0 16 16"><path d="M3.5 1h6.2L13 4.3v9.2a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 2 13.5v-11A1.5 1.5 0 0 1 3.5 1m0 1a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V5H9V2zM10 2.7V4h1.3zM4.5 7h7v1h-7zm0 2.5h7v1h-7zm0 2.5h4.5v1H4.5z"/></svg>
        Docs
      </button>
    </div>
    <div class="editor-main">
      <!-- Panel file: di desktop bagian dari mode Code (kiri editor kode); di HP tampil lewat tab File di navigasi bawah. -->
      <aside class="sidebar" id="sidebar" hidden={ui.sidebarHidden}>
        <div class="panel-head">
          <span class="panel-title">File</span>
          <div class="panel-actions">
            <button class="icon-btn" id="newFileBtn" title="File baru" onclick={() => actions.createEntry('file')}>
              <svg viewBox="0 0 16 16"><path d="M9.5 1H4a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 4 15h8a1.5 1.5 0 0 0 1.5-1.5V5zM12.5 13.5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5v-11A.5.5 0 0 1 4 2h5v3.5h3.5zM8.5 7v2h-2v1h2v2h1v-2h2V9h-2V7z"/></svg>
            </button>
            <button class="icon-btn" id="newFolderBtn" title="Folder baru" onclick={() => actions.createEntry('dir')}>
              <svg viewBox="0 0 16 16"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.3l1.5 1.5h6.2A1.5 1.5 0 0 1 15 5v7.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5zM2.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V5a.5.5 0 0 0-.5-.5H6.9L5.4 3zM7.5 6v2h-2v1h2v2h1V9h2V8h-2V6z"/></svg>
            </button>
            <button class="icon-btn" id="uploadBtn" title="Upload gambar" data-i18n="tombol" onclick={() => actions.upload()}>
              <svg viewBox="0 0 16 16"><path d="M2.5 2A1.5 1.5 0 0 0 1 3.5v9A1.5 1.5 0 0 0 2.5 14H9v-1H2.5a.5.5 0 0 1-.5-.5v-.8l3.2-3.3 2.1 2.1.7-.7-2.8-2.8L2 10.3V3.5a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 .5.5V8h1V3.5A1.5 1.5 0 0 0 13.5 2zM10.5 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M12.5 9.3 10 11.8l.7.7 1.3-1.3V15h1v-3.8l1.3 1.3.7-.7z"/></svg>
            </button>
            <button class="icon-btn" id="refreshBtn" title="Muat ulang" onclick={actions.refresh}>
              <svg viewBox="0 0 16 16"><path d="M13.45 5.17A6 6 0 1 0 14 8h-1a5 5 0 1 1-.8-2.73l-1.7.23.14 1 3.4-.5-.5-3.4-1 .14z"/></svg>
            </button>
            <button class="icon-btn feature-info-btn" id="filesInfo" title="Apa itu file &amp; folder?" aria-label="Penjelasan file &amp; folder" onclick={() => actions.info('files')}>
              <svg viewBox="0 0 16 16"><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1m0 1a6 6 0 1 0 0 12A6 6 0 0 0 8 2m.5 5v5h-1V7zM8 4.25a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5"/></svg>
            </button>
            <button class="icon-btn" id="collapseBtn" title="Tutup semua folder" onclick={actions.collapse}>
              <svg viewBox="0 0 16 16"><path d="M4 6h8v1H4zm0 3h8v1H4zM2.5 2h11A1.5 1.5 0 0 1 15 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9A1.5 1.5 0 0 1 2.5 2m0 1a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5z"/></svg>
            </button>
          </div>
        </div>
        <div class="project" id="projectName">{p?.siteHost ?? ''}</div>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="tree" id="tree" tabindex="0" {@attach actions.tree}>{#if ui.ready}<FileTree />{/if}</div>
        <div class="usage" id="usage">{#if ui.ready}<FileUsage />{/if}</div>
      </aside>
      <div class="splitter" data-target="sidebar" hidden={ui.sidebarHidden} {@attach splitter}><i></i></div>
      <div class="editor-top">
        <div class="tabs" id="tabs">{#if ui.ready}<Tabs onSelect={actions.selectTab} onClose={actions.closeTab} />{/if}</div>
        <div class="ai-head">
          <span class="ai-title">
            <svg viewBox="0 0 16 16"><path d="M8 0l1.6 4.4L14 6l-4.4 1.6L8 12 6.4 7.6 2 6l4.4-1.6zM13 10l.8 2.2L16 13l-2.2.8L13 16l-.8-2.2L10 13l2.2-.8z"/></svg>
            Asisten AI
          </span>
          <button type="button" class="credit-badge" id="aiCredits" class:empty={credit.empty} class:plan={Boolean(plan)} disabled={credit.disabled} title={credit.title} onclick={() => actions.topup()}>{credit.text}</button>
          <button class="icon-btn" id="aiHistory" title="Riwayat percakapan" onclick={(e) => actions.historyMenu(e.currentTarget)}>
            <svg viewBox="0 0 16 16"><path d="M8 1.5a6.5 6.5 0 1 1-6.14 4.35l.94.33A5.5 5.5 0 1 0 8 2.5c-1.77 0-3.35.84-4.35 2.15H5.5v1H2V2.15h1v1.72A6.48 6.48 0 0 1 8 1.5M7.5 4h1v3.8l2.6 1.5-.5.87-3.1-1.8z"/></svg>
          </button>
          <button class="icon-btn" id="aiClear" title="Hapus semua riwayat" onclick={actions.clearHistory}>
            <svg viewBox="0 0 16 16"><path d="M6 1h4l.5.5V3H14v1h-1v10.5l-.5.5h-9l-.5-.5V4H2V3h3.5V1.5zM6.5 3h3V2h-3zM4 4v10h8V4zm2 2h1v6H6zm3 0h1v6H9z"/></svg>
          </button>
          <button class="icon-btn" id="aiReset" title="Percakapan baru" onclick={actions.newConversation}>
            <svg viewBox="0 0 16 16"><path d="M8 1a7 7 0 1 0 7 7h-1a6 6 0 1 1-1.76-4.24L10.5 5.5H15V1l-1.76 1.76A6.98 6.98 0 0 0 8 1"/></svg>
          </button>
        </div>
        <div class="data-head">
          <span class="ai-title view-title">
            {#if ui.mode === 'data'}
              <svg viewBox="0 0 16 16"><path d="M8 1C4.7 1 2 2.1 2 3.5v9C2 13.9 4.7 15 8 15s6-1.1 6-2.5v-9C14 2.1 11.3 1 8 1m0 1c2.9 0 5 .9 5 1.5S10.9 5 8 5 3 4.1 3 3.5 5.1 2 8 2M3 5c1.1.6 2.9 1 5 1s3.9-.4 5-1v3.5C13 9.1 10.9 10 8 10s-5-.9-5-1.5zm0 5c1.1.6 2.9 1 5 1s3.9-.4 5-1v2.5c0 .6-2.1 1.5-5 1.5s-5-.9-5-1.5z"/></svg>
              Database
            {:else if ui.mode === 'diagram'}
              <svg viewBox="0 0 16 16"><path d="M1 1.5h5l.5.5v3l-.5.5H4v2h4V7l.5-.5h5l.5.5v3l-.5.5h-5L8 10V8.5H4v3h2l.5.5v3l-.5.5H1l-.5-.5v-3L1 11.5h2v-6H1L.5 5V2zm.5 1V4.5h4v-2zm8 5v2h4v-2zm-8 5v2h4v-2z"/></svg>
              Diagram
            {:else if ui.mode === 'fn'}
              <svg viewBox="0 0 16 16"><path d="M9.3 1 3 9.2h4.2L6.3 15l6.6-8.4H8.7z"/></svg>
              Fungsi serverless
            {:else if ui.mode === 'history'}
              <svg viewBox="0 0 16 16"><path d="M8 1.5a6.5 6.5 0 1 1-6.14 4.35l.94.33A5.5 5.5 0 1 0 8 2.5c-1.77 0-3.35.84-4.35 2.15H5.5v1H2V2.15h1v1.72A6.48 6.48 0 0 1 8 1.5M7.5 4h1v3.8l2.6 1.5-.5.87-3.1-1.8z"/></svg>
              Riwayat versi
            {:else if ui.mode === 'docs'}
              <svg viewBox="0 0 16 16"><path d="M3.5 1h6.2L13 4.3v9.2a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 2 13.5v-11A1.5 1.5 0 0 1 3.5 1m0 1a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V5H9V2zM10 2.7V4h1.3zM4.5 7h7v1h-7zm0 2.5h7v1h-7zm0 2.5h4.5v1H4.5z"/></svg>
              Dokumentasi
            {:else if ui.mode === 'console'}
              <svg viewBox="0 0 16 16"><path d="M1.5 2h13l.5.5v11l-.5.5h-13l-.5-.5v-11zM2 3v10h12V3zm1.6 2.2.7-.7L7.1 8l-2.8 2.5-.7-.7L5.7 8zM8 10h4.5v1H8z"/></svg>
              Console
            {/if}
          </span>
        </div>
        <button type="button" class="icon-btn feature-info-btn" id="modeInfo" title={`Apa itu ${FEATURE_INFO[ui.mode]?.title ?? 'fitur ini'}?`} aria-label="Penjelasan fitur ini" onclick={() => actions.info(ui.mode)}>
          <svg viewBox="0 0 16 16"><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1m0 1a6 6 0 1 0 0 12A6 6 0 0 0 8 2m.5 5v5h-1V7zM8 4.25a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5"/></svg>
        </button>
      </div>

      <div class="code-view" id="codeView" hidden={ui.mode !== 'code'} class:with-flow={flow.open}>
        <div class="code-bar">
          <div class="breadcrumbs" id="breadcrumbs">{#if ui.ready}<Breadcrumbs />{/if}</div>
          <button type="button" class="flow-btn" id="flowBtn" aria-pressed={String(flow.open)} class:active={flow.open} hidden={!canFlow} onclick={() => actions.toggleFlow()}
                  title="AI menjelaskan alur file ini langkah demi langkah (gratis)">
            <svg viewBox="0 0 16 16"><path d="M2 1.5h5l.5.5v3l-.5.5H5v2h3.5V7l.5-.5h5l.5.5v3l-.5.5H9l-.5-.5v-.5H5v2.5h2l.5.5v2l-.5.5H2l-.5-.5v-2l.5-.5h2v-6H2l-.5-.5V2zm.5 1v2h4v-2zm7 5v2h4v-2zm-7 5v1h4v-1z"/></svg>
            <span>Baca Alur Kode</span>
          </button>
        </div>
        <div class="code-body">
          <div class="editor-wrap">
            <div id="editor"></div>
            <div class="welcome" id="welcome" hidden={Boolean(core.active)}>
              <img class="welcome-logo" src="/logo.svg" alt="">
              <h2>Siap bikin sesuatu?</h2>
              <p>Pilih file di panel kiri, atau mulai dari sini.</p>
              <div class="welcome-actions">
                <button class="welcome-btn" data-action="new-file" onclick={() => actions.createEntry('file', '')}>
                  <svg viewBox="0 0 16 16"><path d="M9.5 1H4a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 4 15h8a1.5 1.5 0 0 0 1.5-1.5V5zM12.5 13.5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5v-11A.5.5 0 0 1 4 2h5v3.5h3.5zM8.5 7v2h-2v1h2v2h1v-2h2V9h-2V7z"/></svg>
                  File baru
                </button>
                <button class="welcome-btn" data-action="new-folder" onclick={() => actions.createEntry('dir', '')}>
                  <svg viewBox="0 0 16 16"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.3l1.5 1.5h6.2A1.5 1.5 0 0 1 15 5v7.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5zM2.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V5a.5.5 0 0 0-.5-.5H6.9L5.4 3z"/></svg>
                  Folder baru
                </button>
                <button class="welcome-btn" data-action="open-index" onclick={actions.openIndex}>
                  <svg viewBox="0 0 16 16"><path d="M8 1.3 1 6.5V15h5v-4.5h4V15h5V6.5zM14 14h-3V9.5H5V14H2V7l6-4.5L14 7z"/></svg>
                  Buka index.html
                </button>
              </div>
              <div class="shortcuts">
                <span><kbd>⌘/Ctrl</kbd><kbd>S</kbd> Simpan</span>
                <span><kbd>⌘/Ctrl</kbd><kbd>F</kbd> Cari</span>
                <span><kbd>⌘/Ctrl</kbd><kbd>B</kbd> Panel file</span>
                <span><kbd>⌘/Ctrl</kbd><kbd>\</kbd> Preview</span>
                <span><kbd>⌘/Ctrl</kbd><kbd>I</kbd> Asisten AI</span>
              </div>
            </div>
          </div>
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <aside class="flow-panel" id="flowPanel" tabindex="-1" aria-label="Baca Alur Kode" hidden={!flow.open} class:wide={flow.wide}
            onkeydown={actions.flowKey}>{#if ui.loaded.flow}<FlowPanel actions={actions.flow} />{/if}</aside>
        </div>
        <footer class="editor-foot">
          <span class="foot-item" id="statusUser">{core.me ? 'HTML · CSS · JS' : ''}</span>
          <span class="foot-spacer"></span>
          <span class="foot-item" id="statusCursor">{ui.cursor}</span>
          <span class="foot-item lang-badge" id="statusLang">{ui.lang}</span>
          <label class="switch" title="Simpan otomatis saat mengetik">
            <input type="checkbox" id="autosave" checked={core.autosave} onchange={(e) => actions.setAutosave(e.currentTarget.checked)}><span class="track"><span class="thumb"></span></span>
            Auto-save
          </label>
        </footer>
      </div>

      <div class="ai-view" id="aiPanel" hidden={ui.mode !== 'ai'}>{#if ui.ready}<AiPanel />{/if}</div>

      <div class="fn-view" id="fnView" hidden={ui.mode !== 'fn'}>{#if ui.loaded.fn}<Functions bind:this={views.fn} />{/if}</div>

      <div class="data-view" id="dataView" hidden={ui.mode !== 'data'}>
        <aside class="db-sidebar">
          <div class="db-sidebar-head">
            <span data-i18n="daftar">Tabel</span>
            <button class="icon-btn" id="dbNewTable" title="Tabel baru" onclick={actions.newTable}>
              <svg viewBox="0 0 16 16"><path d="M7.5 2h1v5.5H14v1H8.5V14h-1V8.5H2v-1h5.5z"/></svg>
            </button>
          </div>
          <div class="db-table-list" id="dbTableList">{#if ui.loaded.data}<TableList />{/if}</div>
          <div class="usage" id="dbUsage">{#if ui.loaded.data}<DbUsage />{/if}</div>
        </aside>
        <section class="db-main" id="dbMain">{#if ui.loaded.data}<DbMain />{/if}</section>
      </div>

      <div class="diagram-view" id="diagramView" hidden={ui.mode !== 'diagram'}>{#if ui.loaded.diagram}<DiagramView />{/if}</div>

      <div class="console-view" id="consoleView" hidden={ui.mode !== 'console'}>{#if ui.loaded.console}<ConsoleTab />{/if}</div>

      <div class="history-view" id="historyView" hidden={ui.mode !== 'history'}>{#if ui.loaded.history}<History bind:this={views.history} />{/if}</div>

      <div class="docs-view" id="docsView" hidden={ui.mode !== 'docs'}>{#if ui.loaded.docs}<Docs bind:this={views.docs} />{/if}</div>
    </div>
  </main>
  <div class="splitter" data-target="preview" hidden={ui.previewHidden} {@attach splitter}><i></i></div>

  <section class="panel preview" id="preview" hidden={ui.previewHidden}><PreviewPanel actions={actions.preview} /></section>

</div>

<nav class="mobile-nav" aria-label="Navigasi">
  <button type="button" data-view="files" aria-current={String(ui.mobileView === 'files')} onclick={() => actions.setMobileView('files')} class="coding-only">
    <svg viewBox="0 0 16 16"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.3l1.5 1.5h6.2A1.5 1.5 0 0 1 15 5v7.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5zM2.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V5a.5.5 0 0 0-.5-.5H6.9L5.4 3z"/></svg>
    File
  </button>
  <button type="button" data-view="editor" aria-current={String(ui.mobileView === 'editor')} onclick={() => actions.setMobileView('editor')}>
    <svg class="coding-only" viewBox="0 0 16 16"><path d="M5.3 4.3 1.6 8l3.7 3.7-.7.7L.2 8l4.4-4.4zm5.4 0 .7-.7L15.8 8l-4.4 4.4-.7-.7L14.4 8z"/></svg>
    <svg class="simple-only" viewBox="0 0 16 16"><path d="M8 0l1.6 4.4L14 6l-4.4 1.6L8 12 6.4 7.6 2 6l4.4-1.6zM13 10l.8 2.2L16 13l-2.2.8L13 16l-.8-2.2L10 13l2.2-.8z"/></svg>
    <span class="coding-only">Editor</span><span class="simple-only">Chat AI</span>
  </button>
  <button type="button" data-view="preview" aria-current={String(ui.mobileView === 'preview')} onclick={() => actions.setMobileView('preview')}>
    <svg viewBox="0 0 16 16"><path d="M8 3C4.5 3 1.9 5.4 1 8c.9 2.6 3.5 5 7 5s6.1-2.4 7-5c-.9-2.6-3.5-5-7-5m0 8.5A3.5 3.5 0 1 1 8 4.5a3.5 3.5 0 0 1 0 7m0-5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4"/></svg>
    Preview
  </button>
</nav>

<ContextMenu />
<div class="toasts" id="toasts">{#each toasts as t (t.id)}<div class="toast {t.type}" role="status">{t.message}</div>{/each}</div>
