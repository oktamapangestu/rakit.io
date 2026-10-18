<!--
  Catatan Project di tab Dokumentasi: aturan & selera pemilik untuk website ini, ikut dikirim ke AI di setiap prompt
  (lihat go/internal/ai/notes.go). Tampil sebagai markdown; Ubah membuka kotak teks. "Draf dengan AI" (1 kredit)
  mengisi kotak teks dengan draf dari isi project — baru tersimpan setelah Simpan.
-->
<script>
  import { getContext } from 'svelte';

  // notes: catatan tersimpan; max: panjang maksimal; onSaved(notes): dipanggil setelah tersimpan.
  let { notes, max, onSaved } = $props();
  const { api, toast, confirm, setCredits, renderMarkdown, costPerPrompt, autoFocus } = getContext('editor');

  const EXAMPLE = [
    '## Tentang website',
    '- Toko kue rumahan, pengunjungnya ibu-ibu di sekitar Bandung',
    '',
    '## Gaya & tampilan',
    '- Warna utama cokelat #7c4a2d, latar krem; font bulat dan ramah',
    '- Bahasa santai, sapa pengunjung dengan "kamu"',
    '',
    '## Aturan untuk AI',
    '- Jangan ubah footer dan nomor WhatsApp',
    '- Setiap halaman baru wajib punya navigasi yang sama',
  ].join('\n');

  let editing = $state(false);
  let text = $state('');
  let saving = $state(false);
  let drafting = $state(false);
  let box = $state();

  const dirty = $derived(editing && text.trim() !== notes);
  const length = $derived([...text].length);

  function edit(initial = notes) {
    text = initial;
    editing = true;
    queueMicrotask(() => autoFocus(box));
  }

  async function cancel() {
    if (dirty) {
      const ok = await confirm({ title: 'Buang perubahan?', message: 'Catatan yang belum disimpan akan hilang.',
        buttons: [{ label: 'Buang', value: true, primary: true, danger: true }, { label: 'Lanjut mengedit', value: null }] });
      if (!ok) return;
    }
    editing = false;
  }

  async function save() {
    if (length > max) return toast(`Catatan maksimal ${max} karakter`, 'error');
    saving = true;
    try {
      const out = await api('PUT', '/api/docs/notes', { notes: text });
      onSaved(out.notes);
      editing = false;
      toast('Catatan disimpan. AI akan membacanya di setiap prompt.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      saving = false;
    }
  }

  async function draft() {
    const current = editing ? text.trim() : notes;
    const basis = current ? 'Catatan yang sudah ada dipakai sebagai dasar; aturan yang kamu tulis dipertahankan.' : '';
    const ok = await confirm({
      title: 'Buat draf dengan AI?',
      message: `AI membaca file, database, dan fungsi project-mu lalu menyusun draf catatan. ${basis} Kamu bisa memeriksa dan mengubahnya sebelum menyimpan. Memakai ${costPerPrompt()} kredit.`,
      buttons: [{ label: 'Buat draf', value: true, primary: true }, { label: 'Batal', value: null }],
    });
    if (!ok) return;
    drafting = true;
    try {
      // Isi kotak teks (boleh belum disimpan) jadi dasar draf.
      const out = await api('POST', '/api/docs/notes/draft', editing ? { notes: text } : undefined);
      if (out.credits) setCredits(out.credits);
      edit(out.draft);
      toast('Draf siap. Periksa dan ubah bila perlu, lalu tekan Simpan.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      drafting = false;
    }
  }
</script>

<section class="docs-section" id="docs-catatan">
  <h4>Catatan Project <span class="fn-chip cron">Dibaca AI di setiap prompt</span></h4>
  <p class="fn-note">Tulis hal yang harus selalu diingat AI tentang website ini: tujuan, pengunjung, gaya tampilan, dan bagian yang tidak boleh diubah. Kamu tidak perlu mengulanginya di setiap prompt.</p>

  {#if editing}
    <div class="docs-notes-edit">
      <textarea bind:this={box} bind:value={text} rows="16" spellcheck="false" placeholder={EXAMPLE} disabled={drafting}
        onkeydown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } }}></textarea>
      <div class="docs-notes-bar">
        <span class="docs-notes-count" class:over={length > max}>{`${length.toLocaleString('id-ID')} / ${max.toLocaleString('id-ID')}`}</span>
        <span class="docs-spacer"></span>
        <button type="button" class="fn-btn ai-handoff" disabled={drafting || saving} onclick={draft}><span class="ai-spark" aria-hidden="true">✦</span>{drafting ? 'AI menyusun draf…' : 'Draf dengan AI'}</button>
        <button type="button" class="fn-btn" disabled={saving} onclick={cancel}>Batal</button>
        <button type="button" class="fn-btn primary" disabled={saving || drafting || length > max} onclick={save}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
      </div>
    </div>
  {:else if notes}
    <div class="docs-card docs-notes">
      <div class="docs-notes-view" {@attach (el) => { el.replaceChildren(renderMarkdown(notes)); }}></div>
      <div class="docs-notes-bar">
        <span class="docs-spacer"></span>
        <button type="button" class="fn-btn ai-handoff" disabled={drafting} onclick={draft}><span class="ai-spark" aria-hidden="true">✦</span>{drafting ? 'AI menyusun draf…' : 'Perbarui dengan AI'}</button>
        <button type="button" class="fn-btn primary" onclick={() => edit()}>Ubah</button>
      </div>
    </div>
  {:else}
    <div class="fn-empty">
      <p>Belum ada catatan. Mulai dari draf buatan AI berdasarkan isi project-mu, atau tulis sendiri.</p>
      <div class="docs-notes-bar">
        <button type="button" class="fn-btn primary ai-handoff" disabled={drafting} onclick={draft}><span class="ai-spark" aria-hidden="true">✦</span>{drafting ? 'AI menyusun draf…' : 'Buat draf dengan AI'}</button>
        <button type="button" class="fn-btn" onclick={() => edit('')}>Tulis sendiri</button>
      </div>
    </div>
  {/if}
</section>
