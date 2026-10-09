<!-- Proses AI (lihat activity.svelte.js). Isi baru diikuti ke bawah hanya bila sebelumnya sudah di dekat bawah. -->
<script>
  let { activity } = $props();
  const a = $derived(activity.state);
  // Event toggle <details> dikirim browser belakangan, bisa setelah bagian ini sudah dibuang; jadi nilainya ditulis
  // lewat prop (bukan derived a, yang sudah tidak berlaku lagi saat itu).
  const toggled = (key) => (e) => activity.setOpen(key, e.currentTarget.open);

  let el = $state();
  const near = (box) => box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  let sticky = [];
  $effect.pre(() => {
    void a.version;
    if (!el) return;
    const boxes = [activity.scroller?.(), ...el.querySelectorAll('.ai-thinking-text, .ai-draft')].filter(Boolean);
    sticky = boxes.filter(near);
  });
  $effect(() => {
    void a.version;
    for (const box of sticky) box.scrollTop = box.scrollHeight;
  });
</script>

{#if !a.removed}
  <details class="ai-activity" open={a.open} ontoggle={toggled('open')} bind:this={el}>
    <summary>{a.summary}</summary>
    {#each a.parts as p (p.key)}
      {#if p.kind === 'thinking'}
        <details class="ai-thinking" open={a.thinkingOpen} ontoggle={toggled('thinkingOpen')}><summary>Proses berpikir</summary><div class="ai-thinking-text">{a.thinking}</div></details>
      {:else if p.kind === 'say'}
        <div class="ai-say">{p.raw.replace(/<\/?message>/g, '').trim()}</div>
      {:else}
        <ol class="ai-steps">
          {#each a.items as item (item.key)}
            {#if item.kind === 'note'}
              <li class="ai-step note">{item.text}</li>
            {:else}
              <li class="ai-step {item.state}">
                {#if item.code}
                  <details bind:open={item.open}><summary><span class="ai-step-label">{`${item.label} `}<code>{item.target}</code></span></summary><pre class="ai-draft">{item.draft}</pre></details>
                {:else}
                  <span class="ai-step-label">{`${item.label} `}<code>{item.target}</code></span>
                {/if}{#each item.notes as note, i (i)}<small>{note}</small>{/each}
              </li>
            {/if}
          {/each}
        </ol>
      {/if}
    {/each}
  </details>
{/if}
