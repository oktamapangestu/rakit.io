<!-- Dialog tambah/ubah provider AI untuk fungsi. Disimpan lalu langsung dites (onSaved). -->
<script>
  import { getContext, onMount } from 'svelte';
  import KeyDisclaimer from './KeyDisclaimer.svelte';

  // existing: provider yang diubah (null = baru). kinds: nama tampilan tiap jenis. first: belum ada provider lain.
  let { existing = null, kinds, first, onSaved, close } = $props();
  const { api, toast } = getContext('editor');

  // Contoh model hanya saran di kotak isian; nama model mana pun yang dikenal provider bisa diketik.
  const AI_KIND_INFO = {
    openai: { name: 'openai', keyUrl: 'https://platform.openai.com/api-keys', models: ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-4.1'], embed: 'text-embedding-3-small' },
    anthropic: { name: 'claude', keyUrl: 'https://console.anthropic.com/settings/keys', models: ['claude-sonnet-4-5', 'claude-haiku-4-5'], embed: '' },
    gemini: { name: 'gemini', keyUrl: 'https://aistudio.google.com/apikey', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'], embed: 'gemini-embedding-001' },
    compatible: { name: '', keyUrl: '', models: [], embed: '' },
  };
  // Endpoint kompatibel OpenAI yang populer: isi base URL & nama sekali klik.
  const AI_PRESETS = [
    { label: 'DeepSeek', name: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { label: 'Groq', name: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
    { label: 'OpenRouter', name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
    { label: 'Mistral', name: 'mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
    { label: 'Together', name: 'together', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  ];

  // Isian dialog berangkat dari nilai awal prop (dialog dibuat ulang setiap dibuka).
  // svelte-ignore state_referenced_locally
  let kind = $state(existing?.kind ?? 'openai');
  // svelte-ignore state_referenced_locally
  let name = $state(existing?.name ?? 'openai');
  // svelte-ignore state_referenced_locally
  let nameTouched = Boolean(existing);
  // svelte-ignore state_referenced_locally
  let baseUrl = $state(existing?.baseUrl ?? '');
  let apiKey = $state('');
  // svelte-ignore state_referenced_locally
  let model = $state(existing?.model ?? '');
  // svelte-ignore state_referenced_locally
  let embedModel = $state(existing?.embedModel ?? '');
  // svelte-ignore state_referenced_locally
  let isDefault = $state(existing ? existing.default : first);
  let saving = $state(false);
  let kindEl;
  let keyEl;

  const info = $derived(AI_KIND_INFO[kind]);
  const compatible = $derived(kind === 'compatible');

  onMount(() => (existing ? keyEl : kindEl).focus());

  function changeKind() {
    if (!nameTouched) name = info.name;
  }

  function preset(p) {
    baseUrl = p.baseUrl;
    if (!existing) name = p.name;
    if (!model) model = p.model;
  }

  async function submit(e) {
    e.preventDefault();
    saving = true;
    try {
      const data = await api('PUT', '/api/functions/ai-providers', {
        name, kind, baseUrl, apiKey, model, embedModel, default: isDefault,
      });
      close();
      toast(`Provider ${name} disimpan. Mengetes koneksi…`);
      onSaved(data, name);
    } catch (err) {
      toast(err.message, 'error');
      saving = false;
    }
  }
</script>

<div class="modal publish-modal ai-provider-modal" role="dialog" aria-label="Provider AI">
  <h3>{existing ? `Ubah provider ${existing.name}` : 'Tambah provider AI'}</h3>
  <p>Fungsi memakai AI lewat <code>ai.chat()</code>, <code>ai.json()</code>, dan <code>ai.embed()</code> dengan API key milikmu sendiri — biayanya ditagih provider langsung ke akunmu, bukan oleh rakit.io.</p>
  <KeyDisclaimer />
  <form class="ai-provider-form" onsubmit={submit}>
    <div class="ai-row">
      <label>Jenis
        <select bind:this={kindEl} bind:value={kind} onchange={changeKind} disabled={Boolean(existing)}>
          {#each Object.keys(AI_KIND_INFO) as k (k)}<option value={k}>{kinds[k] ?? k}</option>{/each}
        </select>
      </label>
      <label>Nama di kode
        <input value={name} disabled={Boolean(existing)} spellcheck="false" autocomplete="off"
          oninput={(e) => { e.target.value = name = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'); nameTouched = true; }}>
      </label>
    </div>
    <div class="ai-presets" hidden={!compatible}>
      {#each AI_PRESETS as p (p.name)}<button type="button" class="fn-chip" onclick={() => preset(p)}>{p.label}</button>{/each}
    </div>
    <label>{compatible ? 'Base URL' : 'Base URL (opsional, kosongkan untuk alamat resmi)'}
      <input bind:value={baseUrl} required={compatible} placeholder="https://api.deepseek.com/v1" spellcheck="false" autocomplete="off">
    </label>
    <label>
      <span class="ai-label-row">API key<a target="_blank" rel="noopener" href={info.keyUrl || '#'} hidden={!info.keyUrl}>Dapatkan API key ↗</a></span>
      <input bind:this={keyEl} bind:value={apiKey} type="password" autocomplete="new-password"
        placeholder={existing ? `kosongkan untuk tetap memakai key ${existing.keyHint}` : 'sk-…'}>
    </label>
    <label>Model chat
      <input bind:value={model} list="aiModelList" spellcheck="false" autocomplete="off" placeholder={info.models[0] ?? 'nama model, mis. deepseek-chat'}>
      <datalist id="aiModelList">{#each info.models as m (m)}<option value={m}></option>{/each}</datalist>
    </label>
    <label hidden={kind === 'anthropic'}>Model embedding <span class="ai-optional">(opsional, untuk ai.embed)</span>
      <input bind:value={embedModel} spellcheck="false" autocomplete="off" placeholder={info.embed || 'nama model embedding (bila didukung)'}>
    </label>
    <label class="ai-check"><input type="checkbox" bind:checked={isDefault}>Jadikan default (dipakai bila kode tidak menyebut provider)</label>
    <div class="modal-buttons">
      <button type="submit" class="primary" disabled={saving}>Simpan &amp; tes</button>
      <button type="button" onclick={close}>Batal</button>
    </div>
  </form>
</div>
