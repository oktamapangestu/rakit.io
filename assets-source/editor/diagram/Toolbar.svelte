<!-- Toolbar tab Diagram: jenis diagram, info, waktu, Edit, Update, zoom, salin, unduh, Temuan. -->
<script>
  import { getContext } from 'svelte';
  import Icon from '../Icon.svelte';
  import InfoDialog from './InfoDialog.svelte';
  import { DIAGRAM_NAMES } from './info.js';
  import {
    diagram, savedKind, costPerPrompt, selectKind, generate, startEdit, leaveEdit, zoomAtCenter, fitDiagram,
    copyCode, download, setFindingsOpen,
  } from './state.svelte.js';

  const { openDialog } = getContext('editor');

  const TABS = [
    ['usecase', 'Use Case', 'Aktor dan fitur yang dapat dipakai'],
    ['activity', 'Activity', 'Alur proses/aktivitas sistem'],
    ['sequence', 'Sequence', 'Urutan interaksi antaraktor/objek'],
    ['class', 'Class', 'Class, atribut, method, dan relasinya'],
    ['state', 'State', 'Perubahan kondisi/status objek'],
    ['erd', 'ERD', 'Struktur tabel database'],
    ['site', 'Peta halaman', 'Halaman, link, dan file CSS/JS'],
    ['flow', 'Alur data', 'Halaman/script mana yang memakai tabel apa'],
  ];
  const ICONS = {
    info: 'M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1m0 1a6 6 0 1 0 0 12A6 6 0 0 0 8 2m.5 5v5h-1V7zM8 4.25a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5',
    edit: 'M11.1 1.6a1.6 1.6 0 0 1 2.3 0l1 1a1.6 1.6 0 0 1 0 2.3L5.3 14H2v-3.3zm1.6.7a.6.6 0 0 0-.9 0l-1 1 1.9 1.9 1-1a.6.6 0 0 0 0-.9zM11.9 5.9 10 4 3 11v2h2z',
    update: 'M13.45 5.17A6 6 0 1 0 14 8h-1a5 5 0 1 1-.8-2.73l-1.7.23.14 1 3.4-.5-.5-3.4-1 .14z',
    copy: 'M4 2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1z',
    download: 'M7.5 1h1v8.3l2.6-2.6.7.7L8 11.2 4.2 7.4l.7-.7 2.6 2.6zM2 13h12v1H2z',
  };

  const diagramTime = (ms) => new Date(ms).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const saved = $derived(savedKind());
  const name = $derived(DIAGRAM_NAMES[diagram.kind]);
  const findings = $derived(saved?.notes ?? []);
  const problems = $derived(findings.filter((f) => f.level === 'error' || f.level === 'warn').length);
</script>

<div class="diagram-bar">
  <div class="seg diagram-tabs" role="tablist" aria-label="Jenis diagram">
    {#each TABS as [kind, label, title] (kind)}
      <button type="button" role="tab" data-diagram={kind} {title} aria-selected={String(kind === diagram.kind)} onclick={() => selectKind(kind)}>{label}</button>
    {/each}
  </div>
  <div class="diagram-tools">
    <button type="button" class="icon-btn" id="diagramInfo" title={diagram.saved ? `Tentang diagram ${name}` : 'Tentang diagram ini'} aria-label="Tentang diagram ini"
      onclick={() => openDialog(InfoDialog, { kind: diagram.kind })}><Icon d={ICONS.info} /></button>
    <span class="tool-sep"></span>
    <span class="diagram-updated" id="diagramUpdated" title={saved ? new Date(saved.updatedAt).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'medium' }) : ''}>{!diagram.saved
      ? ''
      : diagram.busy === diagram.kind ? 'AI sedang membuat…' : saved ? `Diperbarui ${diagramTime(saved.updatedAt)}` : 'Belum dibuat'}</span>
    <button type="button" class="diagram-edit" id="diagramEdit" class:active={diagram.edit} aria-pressed={String(Boolean(diagram.edit))} disabled={Boolean(diagram.busy) || !saved}
      title="Edit diagram: ubah kode, klik teks di diagram, atau minta AI" onclick={() => (diagram.edit ? leaveEdit() : startEdit())}><Icon d={ICONS.edit} />Edit</button>
    <button type="button" class="diagram-update" id="diagramUpdate" disabled={Boolean(diagram.busy) || !diagram.saved || Boolean(diagram.edit)}
      title={diagram.saved ? `Buat ulang diagram ${name} dengan AI dari file & database terbaru (${costPerPrompt()} kredit)` : null} onclick={() => generate()}><Icon d={ICONS.update} />Update diagram</button>
    <span class="tool-sep"></span>
    <button type="button" class="icon-btn" id="diagramZoomOut" title="Perkecil (−)" onclick={() => zoomAtCenter(1 / 1.25)}>−</button>
    <button type="button" class="zoom-label" id="diagramZoomFit" title="Pas di layar (tombol 0) · ukuran asli: tombol 1" onclick={fitDiagram}>{`${Math.round(diagram.view.z * 100)}%`}</button>
    <button type="button" class="icon-btn" id="diagramZoomIn" title="Perbesar (+)" onclick={() => zoomAtCenter(1.25)}>+</button>
    <span class="tool-sep"></span>
    <button type="button" class="icon-btn" id="diagramCopy" title="Salin kode Mermaid" onclick={copyCode}><Icon d={ICONS.copy} /></button>
    <button type="button" class="icon-btn" id="diagramDownload" title="Unduh SVG" onclick={download}><Icon d={ICONS.download} /></button>
    <span class="tool-sep"></span>
    <button type="button" class="findings-toggle" id="diagramFindingsToggle" class:alert={problems > 0} aria-pressed={String(diagram.findingsOpen)}
      title={!diagram.saved ? 'Temuan' : problems ? `${problems} hal perlu diperhatikan` : 'Catatan tentang diagram ini'}
      onclick={() => setFindingsOpen(!diagram.findingsOpen)}>Temuan <span class="count">{findings.length}</span></button>
  </div>
</div>
