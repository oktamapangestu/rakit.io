<!--
  Tab Riwayat: daftar versi project (dikelompokkan per hari) dan detail versi terpilih — beda dengan kondisi
  sekarang, kembalikan semua/satu file. Dipasang di #historyView oleh editor.js, yang memanggil showList() dan
  load() setiap tab dibuka.
-->
<script>
  import { getContext, tick } from 'svelte';
  import Icon from '../Icon.svelte';
  import FileIcon from '../FileIcon.svelte';
  import ImageCompareDialog from './ImageCompareDialog.svelte';
  import { HIST_ICON, versionText, timeOf, dayLabel, fullTime, STATUS_TEXT, restoreText } from './text.js';

  const { api, toast, confirm, saveAll, syncFromServer, showDiff, openDialog } = getContext('editor');

  let list = $state.raw([]);
  let history = $state.raw(null); // { days, max }: batas riwayat paket pemilik
  let listError = $state('');
  let selected = $state(null);
  // detail: { loading } | { error } | { version, files }
  let detail = $state.raw(null);
  let showingDetail = $state(false); // panel sempit (HP): daftar dan detail tampil bergantian
  let seq = 0;
  let layout;

  // Versi dikelompokkan per hari (judul hari muncul sebelum versi pertama hari itu).
  const items = $derived.by(() => {
    let lastDay = null;
    return list.map((v) => {
      const day = dayLabel(v.createdAt);
      const head = day !== lastDay ? day : null;
      lastDay = day;
      return { v, head, text: versionText(v) };
    });
  });

  // Di panel lebar daftar & detail selalu berdampingan, jadi ini hanya berpengaruh di HP.
  export async function showList() { await setDetail(false); }

  async function setDetail(show) {
    showingDetail = show;
    await tick();
    layout.scrollTop = 0;
    if (!show) layout.querySelector('.history-item.selected')?.scrollIntoView({ block: 'nearest' });
  }

  export async function load(selectId) {
    const mySeq = ++seq;
    let data;
    try {
      data = await api('GET', '/api/versions');
    } catch (err) {
      listError = err.message;
      return;
    }
    if (mySeq !== seq) return;
    listError = '';
    list = data.versions;
    history = data.history;
    const keep = selectId ?? selected;
    selected = list.some((v) => v.id === keep) ? keep : list[0]?.id ?? null;
    if (selected) showVersion(selected);
    else detail = null;
  }

  async function showVersion(id) {
    const mySeq = ++seq;
    detail = { loading: true };
    await saveAll(); // bandingkan dengan isi yang sudah tersimpan
    let data;
    try {
      data = await api('GET', `/api/versions/${id}`);
    } catch (err) {
      detail = { error: err.message };
      return;
    }
    if (mySeq !== seq) return;
    detail = data;
  }

  function pick(v) {
    selected = v.id;
    setDetail(true);
    showVersion(v.id);
  }

  async function saveVersion() {
    const label = await confirm({
      title: 'Simpan versi',
      message: 'Beri nama supaya mudah ditemukan nanti (boleh dikosongkan).',
      input: { placeholder: 'mis. Sebelum ganti warna', value: '' },
      buttons: [{ label: 'Simpan', primary: true }, { label: 'Batal', value: null }],
    });
    if (label === null) return;
    try {
      await saveAll();
      const { id } = await api('POST', '/api/versions', { label });
      toast('Versi disimpan');
      load(id);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Kembalikan seluruh project (atau satu file) ke versi.
  async function restore(version, path = null) {
    const files = detail?.files ?? [];
    const removed = path ? [] : files.filter((f) => f.status === 'new').map((f) => f.path);
    const text = restoreText(version, list[0]?.id === version.id);
    const ok = await confirm({
      title: path ? 'Kembalikan file ini?' : text.title,
      message: [
        path
          ? `"${path}" akan dibuat sama seperti pada ${fullTime(version.createdAt)}. Kondisi sekarang disimpan dulu sebagai versi baru, jadi kamu bisa kembali lagi kapan saja.`
          : text.confirm,
        removed.length ? ` File yang dibuat setelahnya akan dihapus: ${removed.join(', ')}.` : '',
      ].join(''),
      buttons: [{ label: path ? 'Ya, kembalikan' : `Ya, ${text.button[0].toLowerCase()}${text.button.slice(1)}`, value: true, primary: true }, { label: 'Batal', value: null }],
    });
    if (!ok) return;
    try {
      await saveAll();
      const { touched } = await api('POST', `/api/versions/${version.id}/restore`, path ? { path } : {});
      await syncFromServer(touched);
      toast(touched.length ? (path ? 'File dikembalikan' : text.done) : 'Tidak ada yang perlu dikembalikan');
      load(version.id);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Bandingkan isi file di versi (kiri) dengan sekarang (kanan).
  async function compare(version, f) {
    if (f.image) return openDialog(ImageCompareDialog, { version, file: f });
    try {
      const before = f.status === 'new' ? '' : (await api('GET', `/api/versions/${version.id}/file?path=${encodeURIComponent(f.path)}`)).content;
      const now = f.status === 'missing' ? '' : (await api('GET', `/api/files/content?path=${encodeURIComponent(f.path)}`)).content;
      showDiff({ path: f.path, content: now }, before, `Kiri: versi ${fullTime(version.createdAt)} · Kanan: sekarang`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }
</script>

{#snippet saveButton()}
  <button type="button" class="history-save" onclick={saveVersion}><Icon d={HIST_ICON.manual} />Simpan versi sekarang</button>
{/snippet}

{#snippet fileRow(version, f)}
  {@const st = STATUS_TEXT[f.status]}
  <div class="history-file {f.status}">
    <span class="history-file-name" title={f.path}><FileIcon path={f.path} /><span>{f.path}</span></span>
    <span class="history-badge {f.status}" title={st.hint}>{st.label}</span>
    <span class="history-file-actions">
      {#if f.status !== 'same'}<button type="button" onclick={() => compare(version, f)}>Lihat perbedaan</button>{/if}
      {#if f.status === 'changed' || f.status === 'missing'}<button type="button" onclick={() => restore(version, f.path)}>Kembalikan file ini</button>{/if}
    </span>
  </div>
{/snippet}

<div class="history-layout" class:has-versions={list.length > 0} class:showing-detail={showingDetail} bind:this={layout}>
  <aside class="history-list" aria-label="Daftar versi">
    {#if listError}
      <div class="history-empty error">{listError}</div>
    {:else if !history}
      <div class="history-empty">Memuat riwayat…</div>
    {:else}
      {@render saveButton()}
      {#if list.length}
        <!-- Penanda kondisi project saat ini: semua versi di bawahnya adalah foto dari waktu sebelumnya. -->
        <div class="history-now">
          <span class="history-now-dot"></span>
          <span class="history-text"><span class="history-title">Kondisi sekarang</span><span class="history-sub">Yang tampil di editor dan website</span></span>
        </div>
        {#each items as { v, head, text } (v.id)}
          {#if head}<div class="history-day">{head}</div>{/if}
          <button type="button" class="history-item {v.kind}" class:selected={v.id === selected} onclick={() => pick(v)}>
            <span class="history-icon"><Icon d={HIST_ICON[v.kind] ?? HIST_ICON.edit} /></span>
            <span class="history-text">
              <span class="history-title">{text.title}</span>
              {#if text.sub}<span class="history-sub">{text.sub}</span>{/if}
            </span>
            <span class="history-time">{timeOf(v.createdAt)}</span>
          </button>
        {/each}
      {/if}
      {@const { days, max } = history}
      <p class="history-note">
        {`Versi disimpan selama ${days} hari (maks. ${max.toLocaleString('id-ID')} versi).`}
      </p>
    {/if}
  </aside>
  <button type="button" class="history-back" onclick={() => setDetail(false)}>← Semua versi</button>
  <section class="history-detail" aria-live="polite">
    {#if detail?.loading}
      <div class="history-empty">Membandingkan dengan kondisi sekarang…</div>
    {:else if detail?.error}
      <div class="history-empty error">{detail.error}</div>
    {:else if detail}
      {@const { version, files } = detail}
      {@const text = versionText(version)}
      {@const differs = files.filter((f) => f.status !== 'same')}
      {@const same = files.filter((f) => f.status === 'same')}
      {@const count = (s) => files.filter((f) => f.status === s).length}
      {@const restoring = restoreText(version, list[0]?.id === version.id)}
      <div class="history-detail-head">
        <span class="history-icon big {version.kind}"><Icon d={HIST_ICON[version.kind] ?? HIST_ICON.edit} /></span>
        <div>
          <h2>{text.title}</h2>
          <p>{`Kondisi project pada ${fullTime(version.createdAt)}`}</p>
          {#if text.sub}<p class="history-detail-sub">{text.sub}</p>{/if}
        </div>
      </div>
      <div class="history-summary" class:same={!differs.length}>
        {differs.length
          ? [
            count('changed') && `${count('changed')} file berbeda`,
            count('missing') && `${count('missing')} file sudah dihapus`,
            count('new') && `${count('new')} file baru`,
          ].filter(Boolean).join(' · ')
          : 'Sama persis dengan kondisi sekarang'}
      </div>
      {#if differs.length}
        <div class="history-restore-box">
          <div><strong>{restoring.title}</strong><p>{restoring.text}</p></div>
          <button type="button" class="history-primary" onclick={() => restore(version)}>{restoring.button}</button>
        </div>
        <h4 class="history-files-title">Yang berbeda dari sekarang</h4>
        <div class="history-files">{#each differs as f (f.path)}{@render fileRow(version, f)}{/each}</div>
      {/if}
      {#if same.length}
        <details class="history-same">
          <summary>{`${same.length} file tidak berubah`}</summary>
          <div class="history-files">{#each same as f (f.path)}{@render fileRow(version, f)}{/each}</div>
        </details>
      {/if}
      <p class="history-db-note">Catatan: data di tab Data (database) tidak ikut dikembalikan, supaya data dari pengunjung tidak hilang.</p>
    {:else if history}
      <div class="history-welcome">
        <div class="history-welcome-icon"><Icon d={HIST_ICON.restore} /></div>
        <h3>Belum ada versi tersimpan</h3>
        <p>Versi adalah “foto” semua file project-mu pada satu waktu. Kalau nanti ada yang rusak atau kamu berubah pikiran, kamu bisa kembali ke versi sebelumnya.</p>
        <ul>
          <li>Tersimpan otomatis saat kamu mulai mengedit, dan sebelum AI mengubah file.</li>
          <li>Kamu juga bisa menyimpan versi sendiri kapan saja, misalnya sebelum mencoba desain baru.</li>
        </ul>
        <button type="button" class="history-primary" onclick={saveVersion}>Simpan versi sekarang</button>
      </div>
    {/if}
  </section>
</div>
