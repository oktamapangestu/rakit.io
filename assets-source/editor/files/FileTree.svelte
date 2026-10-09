<!--
  Pohon file project (#tree). Klik, menu, keyboard, dan seret-lepas gambar ditangani editor.js lewat atribut
  data-path/data-type di tiap baris; komponen ini hanya menggambar dari core.
-->
<script>
  import FileIcon from '../FileIcon.svelte';
  import Icon from '../Icon.svelte';
  import { CHEVRON } from '../icons.js';
  import { core } from './state.svelte.js';

  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  // Folder dulu, lalu urut nama.
  const childrenOf = (dir) => core.entries
    .filter((e) => parentOf(e.path) === dir)
    .sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
  // Frontend/backend: folder functions/ dijalankan di server dan tidak pernah dikirim ke browser.
  const isBackend = (p) => /^functions(\/|$)/i.test(p);

  const rows = $derived.by(() => {
    const out = [];
    const walk = (dir, depth) => {
      for (const entry of childrenOf(dir)) {
        const open = core.expanded.has(entry.path);
        out.push({ entry, depth, open });
        if (entry.type === 'dir' && open) walk(entry.path, depth + 1);
      }
    };
    walk('', 0);
    return out;
  });
</script>

{#each rows as { entry, depth, open } (entry.path)}
  {@const isDir = entry.type === 'dir'}
  <div class="row" class:selected={core.selected === entry.path} class:dirty={core.dirty.has(entry.path)} class:drop-dir={core.dropDir === entry.path}
    style="padding-left:{8 + depth * 12}px" title={entry.path} data-path={entry.path} data-type={entry.type}>
    <span class="chev" class:open>{#if isDir}<Icon d={CHEVRON} />{/if}</span><FileIcon path={entry.path} dir={isDir} {open} /><span class="name">{entry.name}</span>{#if isBackend(entry.path)}<span
      class="side be" title="Backend: berjalan di server (fungsi /api/fn), kodenya tidak bisa dilihat pengunjung">BE</span>{:else if !isDir}<span
      class="side fe" title="Frontend: dikirim ke browser, kodenya bisa dilihat pengunjung">FE</span>{/if}<button type="button" class="row-more" title="Menu" aria-label={`Menu ${entry.name}`}>⋯</button>
  </div>
{:else}
  <div class="empty">Belum ada file. Klik kanan di sini, pakai tombol di atas, atau seret gambar ke sini.</div>
{/each}
