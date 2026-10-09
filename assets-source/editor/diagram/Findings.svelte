<!-- Temuan tentang diagram yang sedang dibuka (catatan dari AI), dengan tombol perbaikan untuk masalah. -->
<script>
  import AiButton from '../AiButton.svelte';
  import { DIAGRAM_NAMES } from './info.js';
  import { diagram, savedKind } from './state.svelte.js';

  const icon = { error: '✕', warn: '!', info: 'i', ok: '✓' };
  const findings = $derived(savedKind()?.notes ?? []);
</script>

<aside class="diagram-findings" id="diagramFindings" aria-label="Temuan" hidden={!diagram.findingsOpen}>
  {#if diagram.saved}
    <h4>Temuan</h4>
    {#if findings.length}
      <ul>
        {#each findings as f, i (i)}
          <li class={f.level}>
            <span class="f-icon">{icon[f.level]}</span>
            <div>
              <p>{f.text}</p>
              {#if f.level === 'error' || f.level === 'warn'}
                <AiButton label="Perbaiki" cls="finding-fix" text={`Diagram ${DIAGRAM_NAMES[diagram.kind] ?? ''} project ini menemukan masalah: "${f.text}". Periksa file dan database yang terkait, lalu perbaiki.`} />
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="f-empty">Tidak ada catatan.</p>
    {/if}
  {/if}
</aside>
