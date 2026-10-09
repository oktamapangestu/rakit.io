<!-- Provider AI untuk library ai.* di fungsi (API key milik pemilik project, tidak pernah dikirim balik). -->
<script>
  import { getContext } from 'svelte';
  import Icon from '../Icon.svelte';
  import AiButton from '../AiButton.svelte';
  import SectionHead from './SectionHead.svelte';
  import KeyDisclaimer from './KeyDisclaimer.svelte';
  import AiProviderDialog from './AiProviderDialog.svelte';

  let { data: d, onData } = $props();
  const { api, toast, confirm, copyText, openDialog, icons } = getContext('editor');

  let tests = $state({}); // nama provider -> hasil tes terakhir

  const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}rb` : String(n));

  async function test(name) {
    tests[name] = { running: true };
    try {
      tests[name] = await api('POST', `/api/functions/ai-providers/${encodeURIComponent(name)}/test`);
    } catch (err) {
      tests[name] = { ok: false, error: err.message };
    }
    onData(await api('GET', '/api/functions').catch(() => d)); // pemakaian hari ini
  }

  const edit = (existing = null) => openDialog(AiProviderDialog, {
    existing, kinds: d.aiKinds, first: !d.aiProviders.length,
    onSaved: (data, name) => { onData(data); test(name); },
  });

  async function remove(p) {
    const ok = await confirm({ title: `Hapus provider ${p.name}?`, message: `Fungsi yang memakai provider '${p.name}' akan gagal sampai provider ditambahkan lagi. API key-nya ikut dihapus dari server.`, buttons: [{ label: 'Hapus', value: true, danger: true }, { label: 'Batal', value: null }] });
    if (!ok) return;
    try {
      onData(await api('DELETE', `/api/functions/ai-providers/${encodeURIComponent(p.name)}`));
      delete tests[p.name];
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function makeDefault(p) {
    try {
      onData(await api('PUT', '/api/functions/ai-providers', { ...p, apiKey: '', default: true }));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const AI_EXAMPLE = [
    "export default async function (req, { db, ai }) {",
    "  // Teks: provider default, atau pilih { provider: 'gemini', model: '…' }",
    "  const { text } = await ai.chat(`Buat deskripsi singkat untuk produk: ${req.body.nama}`, {",
    "    system: 'Kamu penulis toko online yang ramah. Jawab dalam bahasa Indonesia.',",
    "  });",
    "",
    "  // JSON terstruktur: hasilnya langsung objek",
    "  const data = await ai.json(`Ambil nama & nomor HP dari: ${req.body.pesan}`, { nama: 'string', hp: 'string' });",
    "",
    "  // Gambar (vision): URL https, path gambar di project, atau data URL",
    "  const cek = await ai.chat('Apakah ini bukti transfer? Sebutkan nominalnya.', { images: [req.body.bukti] });",
    "",
    "  // Embedding: cari data yang maknanya mirip",
    "  const [a, b] = await ai.embed(['kue coklat', 'brownies']);",
    "  return { text, data, cek: cek.text, mirip: ai.similarity(a, b) };",
    "}",
  ].join('\n');
</script>

<section class="fn-section">
  <SectionHead title="Provider AI" count={d.aiProviders.length || null}>
    {#if d.aiProviders.length}<AiButton label="Buat fitur AI" text="Buatkan fungsi serverless yang memakai ai.chat dari provider AI-ku untuk " />{/if}
    <button type="button" class="fn-btn primary" onclick={() => edit()}>+ Tambah provider</button>
  </SectionHead>
  <p class="fn-note">Pakai AI di fungsi lewat <code>ai.chat()</code>, <code>ai.json()</code>, dan <code>ai.embed()</code> — satu cara untuk OpenAI, Claude, Gemini, dan endpoint kompatibel OpenAI (DeepSeek, Groq, OpenRouter, …). Memakai API key milikmu; waktu menunggu AI tidak dihitung ke batas waktu fungsi.</p>
  <KeyDisclaimer />
  {#if d.aiProviders.length}
    <ul class="fn-secrets ai-providers">
      {#each d.aiProviders as p (p.name)}
        {@const t = tests[p.name]}
        <li>
          <div class="ai-prov-main">
            <div class="ai-prov-title">
              <code>{p.name}</code><span class="fn-chip">{d.aiKinds[p.kind] ?? p.kind}</span>{#if p.default}<span class="fn-chip ai-default">default</span>{/if}
            </div>
            <div class="ai-prov-meta">
              <span title="Model chat">{p.model}</span>
              {#if p.embedModel}<span title="Model embedding">{`embed: ${p.embedModel}`}</span>{/if}
              <span title="API key">{`key ${p.keyHint}`}</span>
              <span title="Pemakaian hari ini (WIB)">{p.today.calls
                ? `${p.today.calls} panggilan · ${fmt(p.today.inputTokens + p.today.outputTokens)} token${p.today.errors ? ` · ${p.today.errors} gagal` : ''} hari ini`
                : 'belum dipakai hari ini'}</span>
            </div>
            {#if t}
              <div class="ai-test {t.running ? '' : t.ok ? 'ok' : 'fail'}">
                {t.running ? 'Mengetes koneksi…' : t.ok ? `✓ Tersambung (${t.ms} ms) — jawaban: "${String(t.text).trim().slice(0, 60)}"` : `✕ ${t.error}`}
              </div>
            {/if}
          </div>
          <div class="ai-prov-actions">
            <button type="button" class="fn-btn" disabled={t?.running} onclick={() => test(p.name)}>Tes</button>
            {#if !p.default}<button type="button" class="fn-btn" onclick={() => makeDefault(p)}>Jadikan default</button>{/if}
            <button type="button" class="fn-btn" onclick={() => edit(p)}>Ubah</button>
            <button type="button" class="icon-btn" title={`Hapus ${p.name}`} onclick={() => remove(p)}><Icon d={icons.trash} /></button>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="fn-placeholder">Belum ada provider. Tambahkan API key OpenAI, Claude, Gemini, atau provider lain, lalu panggil ai.chat(…) dari fungsi.</p>
  {/if}
  <details class="fn-help ai-example">
    <summary>Contoh kode</summary>
    <div class="ai-example-tools"><button type="button" class="fn-btn" onclick={() => copyText(AI_EXAMPLE, 'Contoh kode disalin')}>Salin</button></div>
    <pre class="fn-pre">{AI_EXAMPLE}</pre>
  </details>
</section>
