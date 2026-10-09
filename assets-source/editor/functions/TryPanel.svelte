<!-- Uji coba fungsi dari editor: method, query, body JSON, lalu hasil & keluaran console. -->
<script>
  import AiButton from '../AiButton.svelte';
  import ConsoleView from './ConsoleView.svelte';
  import { clipText, fnFixPrompt } from '../handoff.js';

  // form: { method, query, body } milik tab Fungsi (tetap ada saat pindah fungsi). result: jawaban /run.
  let { f, form = $bindable(), result: r, running, onRun } = $props();

  const shown = $derived.by(() => {
    const body = r?.body ?? '';
    try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
  });
</script>

<div class="fn-try">
  <div class="fn-try-row">
    <select bind:value={form.method}>
      {#each ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as m (m)}<option value={m}>{m}</option>{/each}
    </select>
    <input bind:value={form.query} placeholder="query, mis. nama=Ani&halaman=2" spellcheck="false">
    <button type="button" class="fn-run" disabled={running} onclick={() => onRun(f.name)}>{running ? 'Menjalankan…' : '▶ Jalankan'}</button>
  </div>
  <textarea rows="5" spellcheck="false" placeholder="body JSON (opsional)" bind:value={form.body}></textarea>
  {#if r}
    <div class="fn-result">
      {#if r.status}
        <div class="fn-result-head">
          <span class="fn-status s{String(r.status)[0]}">{r.status}</span><span>{`${r.ms} ms`}</span>{#if r.headers?.['content-type']}<code>{r.headers['content-type']}</code>{/if}
        </div>
      {/if}
      {#if r.error}<p class="fn-error">{r.error}</p>{/if}
      {#if shown}<pre class="fn-pre">{shown}</pre>{/if}
      {#if r.logs}
        <div class="fn-label">console</div>
        <ConsoleView text={r.logs} />
      {/if}
      <!-- Hanya bila fungsinya benar-benar berjalan (ada status) — bukan kuota habis/gagal menyimpan. -->
      {#if r.status && (r.error || r.status >= 500)}
        <div class="fn-ai-fix">
          <AiButton label="Perbaiki dengan AI" text={() => fnFixPrompt(f.name, {
            status: r.status, error: r.error || (r.status >= 500 ? shown : ''), logs: r.logs, trigger: 'uji coba',
            request: [`${form.method} /api/fn/${f.name}${form.query ? `?${form.query}` : ''}`, clipText(form.body, 1000)].filter(Boolean).join('\n'),
          })} />
        </div>
      {/if}
    </div>
  {/if}
</div>
