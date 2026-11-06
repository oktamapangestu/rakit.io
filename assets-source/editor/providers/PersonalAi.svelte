<!-- AI pribadi akun: endpoint kompatibel OpenAI dengan API key milik pengguna. Selama aktif, AI editor (Builder/Plan,
     diagram, draf catatan) memakainya tanpa memotong jatah prompt/kredit. Opsional: base URL format Anthropic untuk
     mode Agen (Claude Agent SDK) dengan key & model yang sama. Key tidak pernah dikirim balik ke browser. -->
<script>
  import { getContext, onMount } from 'svelte';
  import SectionHead from '../functions/SectionHead.svelte';
  import KeyDisclaimer from '../functions/KeyDisclaimer.svelte';

  // onChanged(): pengaturan berubah (muat ulang info kredit di editor).
  let { onChanged } = $props();
  const { api, toast, confirm } = getContext('editor');

  // agentBaseUrl: endpoint format Anthropic untuk mode Agen ('' = provider tidak mendukung).
  const PRESETS = [
    { id: 'anthropic', label: 'Claude (Anthropic)', baseUrl: 'https://api.anthropic.com/v1', agentBaseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' },
    { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
    { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', agentBaseUrl: 'https://api.deepseek.com/anthropic/v1', model: 'deepseek-chat' },
    { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
    { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini' },
    { id: 'ollama', label: 'Ollama (lokal)', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder' },
  ];

  let view = $state(null); // { configured, active, baseUrl, model, keyHint }
  let form = $state({ baseUrl: '', agentBaseUrl: '', apiKey: '', model: '' });
  let editing = $state(false);
  let saving = $state(false);
  let test = $state(null); // { running } | { ok, models } | { ok: false, error }
  let error = $state('');

  async function load() {
    try {
      view = await api('GET', '/api/ai/provider');
    } catch (err) {
      error = err.message;
    }
  }
  onMount(load);

  function startEdit(preset = null) {
    form = preset
      ? { baseUrl: preset.baseUrl, agentBaseUrl: preset.agentBaseUrl ?? '', apiKey: '', model: preset.model }
      : { baseUrl: view?.baseUrl ?? '', agentBaseUrl: view?.agentBaseUrl ?? '', apiKey: '', model: view?.model ?? '' };
    test = null;
    editing = true;
  }

  async function runTest() {
    test = { running: true };
    try {
      test = await api('POST', '/api/ai/provider/test', editing ? { baseUrl: form.baseUrl, apiKey: form.apiKey } : {});
    } catch (err) {
      test = { ok: false, error: err.message };
    }
  }

  async function save(e) {
    e.preventDefault();
    saving = true;
    try {
      view = await api('PUT', '/api/ai/provider', { baseUrl: form.baseUrl, agentBaseUrl: form.agentBaseUrl, apiKey: form.apiKey, model: form.model, active: true });
      editing = false;
      toast(`AI pribadi aktif: ${view.model}`);
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    }
    saving = false;
  }

  async function setActive(active) {
    try {
      view = await api('PUT', '/api/ai/provider', { active });
      toast(active ? `AI pribadi aktif: ${view.model}` : 'AI editor kembali memakai jatah rakit.io');
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function remove() {
    const ok = await confirm({ title: 'Hapus AI pribadi?', message: 'API key-mu dihapus dari server, dan AI editor kembali memakai jatah prompt harian rakit.io.', buttons: [{ label: 'Hapus', value: true, danger: true }, { label: 'Batal', value: null }] });
    if (!ok) return;
    try {
      await api('DELETE', '/api/ai/provider');
      view = { configured: false };
      test = null;
      onChanged?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
</script>

<section class="fn-section">
  <SectionHead title="AI pribadi untuk editor">
    {#if view?.configured && !editing}
      <label class="switch-inline"><input type="checkbox" checked={view.active} onchange={(e) => setActive(e.currentTarget.checked)}>Aktif</label>
    {/if}
  </SectionHead>
  <p class="fn-note">Pakai API key milikmu untuk Builder, Plan, diagram, dan draf catatan. Selama aktif, prompt <b>tidak memakai jatah harian maupun kredit</b> — biayanya ditagih provider langsung ke akunmu. Berlaku di semua project. Endpoint harus kompatibel OpenAI (chat completions + tool calling). Untuk <b>mode Agen</b> (Claude Agent SDK), isi juga base URL format Anthropic — mis. Claude atau DeepSeek.</p>
  <KeyDisclaimer editor />

  {#if error}
    <p class="history-empty error">{error}</p>
  {:else if !view}
    <p class="fn-placeholder">Memuat…</p>
  {:else if editing}
    <form class="personal-form" onsubmit={save}>
      <div class="personal-presets" role="group" aria-label="Isi cepat">
        {#each PRESETS as p (p.id)}
          <button type="button" class="fn-btn" onclick={() => { form.baseUrl = p.baseUrl; form.agentBaseUrl = p.agentBaseUrl ?? ''; form.model = p.model; test = null; }}>{p.label}</button>
        {/each}
      </div>
      <label class="db-field"><span class="db-field-label">Base URL</span>
        <input bind:value={form.baseUrl} placeholder="https://api.openai.com/v1" spellcheck="false" autocomplete="off" required>
      </label>
      <label class="db-field"><span class="db-field-label">Base URL mode Agen<span class="col-type">opsional · format Anthropic</span></span>
        <input bind:value={form.agentBaseUrl} placeholder="https://api.anthropic.com/v1" spellcheck="false" autocomplete="off">
      </label>
      <label class="db-field"><span class="db-field-label">API key{#if view.configured}<span class="col-type">{view.keyHint ? `kosongkan = tetap ${view.keyHint}` : 'opsional'}</span>{/if}</span>
        <input type="password" bind:value={form.apiKey} placeholder={view.configured ? '••••••' : 'sk-…'} autocomplete="off" spellcheck="false">
      </label>
      <label class="db-field"><span class="db-field-label">Model</span>
        <input bind:value={form.model} placeholder="gpt-4.1-mini" spellcheck="false" autocomplete="off" required list="personalModels">
        {#if test?.ok && test.models?.length}
          <datalist id="personalModels">{#each test.models as m (m)}<option value={m}></option>{/each}</datalist>
        {/if}
      </label>
      {#if test}
        <div class="ai-test {test.running ? '' : test.ok ? 'ok' : 'fail'}">
          {test.running ? 'Mengetes koneksi…' : test.ok ? `✓ Tersambung — ${test.models.length} model tersedia` : `✕ ${test.error}`}
        </div>
      {/if}
      <div class="modal-buttons">
        <button type="button" onclick={() => { editing = false; test = null; }}>Batal</button>
        <button type="button" disabled={test?.running || !form.baseUrl} onclick={runTest}>Tes koneksi</button>
        <button type="submit" class="primary" disabled={saving}>Simpan & aktifkan</button>
      </div>
    </form>
  {:else if view.configured}
    <ul class="fn-secrets ai-providers">
      <li>
        <div class="ai-prov-main">
          <div class="ai-prov-title"><code>{view.model}</code>{#if view.active}<span class="fn-chip ai-default">aktif</span>{:else}<span class="fn-chip">nonaktif</span>{/if}</div>
          <div class="ai-prov-meta">
            <span title="Base URL">{view.baseUrl}</span>
            <span title="API key">{view.keyHint ? `key ${view.keyHint}` : 'tanpa key'}</span>
            <span title="Mode Agen (Claude Agent SDK)">{view.agentBaseUrl ? 'mode Agen: aktif' : 'mode Agen: dikerjakan Builder'}</span>
          </div>
          {#if test}
            <div class="ai-test {test.running ? '' : test.ok ? 'ok' : 'fail'}">
              {test.running ? 'Mengetes koneksi…' : test.ok ? `✓ Tersambung — ${test.models.length} model tersedia` : `✕ ${test.error}`}
            </div>
          {/if}
        </div>
        <div class="ai-prov-actions">
          <button type="button" class="fn-btn" disabled={test?.running} onclick={runTest}>Tes</button>
          <button type="button" class="fn-btn" onclick={() => startEdit()}>Ubah</button>
          <button type="button" class="fn-btn" onclick={remove}>Hapus</button>
        </div>
      </li>
    </ul>
  {:else}
    <div class="personal-presets">
      {#each PRESETS as p (p.id)}
        <button type="button" class="fn-btn" onclick={() => startEdit(p)}>{p.label}</button>
      {/each}
      <button type="button" class="fn-btn primary" onclick={() => startEdit()}>+ Endpoint lain</button>
    </div>
  {/if}
</section>
