<!-- Keluaran console fungsi, diwarnai per level (lihat console.js). -->
<script>
  import { consoleLines } from './console.js';

  let { text } = $props();
  const lines = $derived(consoleLines(text));
</script>

<pre class="fn-pre logs">{#each lines as line, i (i)}<span class="log-line {line.level}">{#if line.tag}<b class="log-level">{line.tag}</b>{/if}{line.text}</span>{/each}</pre>
