<!--
  Panel Baca Alur Kode (#flowPanel): AI menjelaskan alur file yang sedang dibuka langkah demi langkah. Tampilan
  mengikuti state flow (state.svelte.js); aksi yang menyentuh Monaco/file ada di editor.js (prop actions).
-->
<script>
  import { getContext, tick } from 'svelte';
  import Icon from '../Icon.svelte';
  import FileIcon from '../FileIcon.svelte';
  import AiButton from '../AiButton.svelte';
  import FlowChart from './FlowChart.svelte';
  import { flow, flowSteps, flowStale } from './state.svelte.js';
  import { FLOW_KINDS, FLOW_NOTE, lineLabel } from './text.js';
  import { linkifyLines } from './linkify.js';

  // actions: explain(force), select(i), stopPlay(), togglePlay(), close(), goBack(), openRef(ref), flashLines(a, b),
  // ask(textarea), toggleWide(), saveShowChart(open).
  let { actions } = $props();
  const { renderMarkdown, icons } = getContext('editor');

  const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
  const ex = $derived(flow.saved?.explanation);
  const steps = $derived(flowSteps());
  const back = $derived(flow.back.at(-1));

  // Teks markdown dari AI; "baris 12" di dalamnya bisa diklik untuk menyorot baris itu. Elemennya sendiri menjadi
  // div.md hasil renderMarkdown (tanpa pembungkus tambahan, sama seperti tampilan lama).
  function md(node, text) {
    const draw = (t) => {
      const out = linkifyLines(renderMarkdown(t || ''), actions.flashLines);
      node.className = out.className;
      node.replaceChildren(...out.childNodes);
    };
    draw(text);
    return { update: draw };
  }

  // Langkah aktif tetap terlihat di daftar saat berpindah langkah.
  let list = $state();
  $effect(() => {
    const i = flow.step;
    tick().then(() => list?.querySelector(`.flow-step[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  });

  // Jawaban baru di obrolan tetap terlihat.
  let chatBox = $state();
  const chat = $derived(flow.chats[flow.path] ?? []);
  $effect(() => {
    void chat.length;
    void chat.at(-1)?.a;
    tick().then(() => chatBox?.lastElementChild?.scrollIntoView({ block: 'nearest' }));
  });

  const pick = (i) => { actions.stopPlay(); actions.select(i); };
</script>

{#snippet refChip(ref, compact = false)}
  <button type="button" class="flow-ref" title={ref.note ? `${ref.note} — buka ${ref.path}` : `Buka ${ref.path}`} onclick={() => actions.openRef(ref)}>
    <FileIcon path={ref.path} /><span class="flow-ref-path">{`${ref.path}${ref.line ? `:${ref.line}` : ''}`}</span>{#if !compact && ref.note}<span class="flow-ref-note">{ref.note}</span>{/if}
  </button>
{/snippet}

{#snippet quota(extra = '')}
  <span class="flow-quota {extra}">{flow.limit ? `Gratis · sisa ${flow.remaining} dari ${flow.limit} hari ini` : ''}</span>
{/snippet}

{#if flow.open}
  {@const path = flow.path}
  <div class="flow-head">
    <span class="flow-title"><Icon d={icons.flow} />Baca Alur Kode</span>
    <span class="flow-file">{path ? baseName(path) : ''}</span>
    {#if ex}<button type="button" class="icon-btn" title="Jelaskan ulang dengan AI" disabled={Boolean(flow.loading)} onclick={() => actions.explain(true)}><Icon d={icons.refresh} /></button>{/if}
    <button type="button" class="icon-btn" title="Perlebar panel" onclick={actions.toggleWide}>⤢</button>
    <button type="button" class="icon-btn" title="Tutup" onclick={actions.close}><Icon d={icons.close} /></button>
  </div>
  {#if back}
    <button type="button" class="flow-back" onclick={actions.goBack}>{`← Kembali ke ${baseName(back.path)} · langkah ${back.step + 1}`}</button>
  {/if}

  {#if !path}
    <div class="flow-empty"><p>Buka file .html, .css, atau .js untuk membaca alurnya.</p></div>
  {:else if flow.loading === path}
    {@const name = baseName(path)}
    <div class="flow-empty">
      <div class="flow-skeleton"><i></i><i></i><i></i><i></i></div>
      <p><span class="dots"><i></i><i></i><i></i></span>{` AI sedang membaca alur ${name}…`}</p>
      <p class="flow-muted">Biasanya 20–60 detik. Kamu boleh lanjut membaca kode sambil menunggu.</p>
    </div>
  {:else if !ex}
    <div class="flow-empty">
      <div class="flow-hero"><Icon d={icons.flow} /></div>
      <h3>{`Pahami alur ${baseName(path)}`}</h3>
      <p>AI membaca file ini dan menjelaskannya langkah demi langkah, berurutan seperti kode berjalan: baris mana yang terlibat, contoh nilainya, istilah penting, dan hubungannya dengan file lain di project.</p>
      <button type="button" class="flow-go" disabled={flow.remaining === 0} onclick={() => actions.explain()}><Icon d={icons.flow} />Baca alur file ini</button>
      <p class="flow-quota flow-muted">{flow.limit ? `Gratis · sisa ${flow.remaining} dari ${flow.limit} hari ini` : ''}</p>
    </div>
  {:else}
    {@const notes = ex.notes ?? []}
    {@const byId = new Map(steps.map((s) => [s.id, s]))}
    <div class="flow-scroll">
      {#if flowStale()}
        <div class="flow-stale">
          <span>File sudah berubah sejak penjelasan ini dibuat — baris yang disorot bisa bergeser.</span>
          <button type="button" onclick={() => actions.explain()}>Perbarui</button>
        </div>
      {/if}
      <section class="flow-summary"><div use:md={ex.summary}></div></section>
      {#if steps.length}
        {@const s = steps[flow.step]}
        <div class="flow-player">
          <button type="button" class="icon-btn" title="Langkah sebelumnya (←)" disabled={flow.step === 0} onclick={() => pick(flow.step - 1)}>‹</button>
          <div class="flow-player-label"><strong>{`Langkah ${flow.step + 1} dari ${steps.length}`}</strong><span>{s.title}</span></div>
          <button type="button" class="flow-play" class:on={flow.playTimer} title={flow.playTimer ? 'Berhenti' : 'Putar otomatis (pindah tiap 6 detik)'} onclick={actions.togglePlay}>{flow.playTimer ? '❚❚' : '▶'}</button>
          <button type="button" class="icon-btn" title="Langkah berikutnya (→)" disabled={flow.step === steps.length - 1} onclick={() => pick(flow.step + 1)}>›</button>
          <div class="flow-progress"><i style="width:{((flow.step + 1) / steps.length) * 100}%"></i></div>
        </div>
      {:else}
        <div class="flow-player"></div>
      {/if}
      <ol class="flow-steps" bind:this={list}>
        {#each steps as s, i (s.id)}
          {@const on = i === flow.step}
          {@const branches = s.next.filter((e) => e.label || e.to !== s.id + 1)}
          <li class="flow-step kind-{s.kind}" class:active={on} data-i={String(i)}>
            <button type="button" class="flow-step-head" aria-expanded={String(on)} onclick={() => pick(i)}>
              <span class="flow-num">{s.id}</span><span class="flow-step-title">{s.title}</span>{#if s.lines.length}<span class="flow-lines" title="Baris di file ini">{`baris ${lineLabel(s.lines)}`}</span>{/if}
            </button>
            {#if on}
              <div class="flow-step-body">
                <span class="flow-kind">{FLOW_KINDS[s.kind] ?? s.kind}</span>
                <div use:md={s.explain}></div>
                {#if s.example}<div class="flow-example"><b>Contoh</b><div use:md={s.example}></div></div>{/if}
                {#if s.terms.length}
                  <div class="flow-terms">
                    {#each s.terms as t (t.term)}<details class="flow-term"><summary>{t.term}</summary><p>{t.meaning}</p></details>{/each}
                  </div>
                {/if}
                {#if s.refs.length}
                  <div class="flow-refs"><span class="flow-sub">Terhubung ke</span>{#each s.refs as r, j (j)}{@render refChip(r)}{/each}</div>
                {/if}
                {#if branches.length}
                  <div class="flow-next">
                    <span class="flow-sub">Lalu</span>
                    {#each branches as e, j (j)}
                      {@const target = byId.get(e.to)}
                      {#if target}
                        <button type="button" class="flow-branch" onclick={() => pick(steps.indexOf(target))}>{#if e.label}<em>{e.label}</em>{/if}{`→ ${target.id}. ${target.title}`}</button>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ol>
      <details class="flow-section" open={flow.showChart} ontoggle={(e) => actions.saveShowChart(e.currentTarget.open)}>
        <summary>Diagram alur</summary>
        {#if flow.showChart && steps.length}<FlowChart {steps} step={flow.step} onSelect={pick} />{:else}<div class="flow-chart-box"></div>{/if}
        <p class="flow-muted">Klik kotak di diagram untuk membuka langkahnya.</p>
      </details>
      {#if ex.related?.length}
        <details class="flow-section" open>
          <summary>{`Terhubung dengan file lain (${ex.related.length})`}</summary>
          <div class="flow-related">{#each ex.related as r, j (j)}{@render refChip(r)}{/each}</div>
        </details>
      {/if}
      {#if ex.complexity}
        <details class="flow-section"><summary>Seberapa cepat kodenya?</summary><div use:md={ex.complexity}></div></details>
      {/if}
      {#if notes.length}
        <details class="flow-section" open={notes.some((n) => n.level === 'bug' || n.level === 'warn')}>
          <summary>{`Catatan (${notes.length})`}</summary>
          <ul class="flow-notes">
            {#each notes as n, j (j)}
              {@const [icon, label] = FLOW_NOTE[n.level] ?? FLOW_NOTE.info}
              {@const fix = `Di file ${path}${n.line ? ` baris ${n.line}` : ''}: ${n.text}\n\n${n.level === 'tip' ? 'Terapkan saran ini' : 'Perbaiki masalah ini'} tanpa mengubah perilaku lain.`}
              <li class="flow-note {n.level}">
                <span class="flow-note-icon" title={label}>{icon}</span>
                <!-- Isi dirapatkan: spasi di antara tombol akan ikut tampil. -->
                <div><div use:md={n.text}></div>{#if n.line}<button type="button" class="flow-line-link" onclick={() => actions.flashLines(n.line, n.line)}>{`baris ${n.line}`}</button>{/if}{#if n.level === 'bug' || n.level === 'warn' || n.level === 'tip'}<AiButton label={n.level === 'tip' ? 'Terapkan dengan AI' : 'Perbaiki dengan AI'} cls="flow-ai-fix" text={fix} />{/if}</div>
              </li>
            {/each}
          </ul>
        </details>
      {/if}
      <section class="flow-ask-wrap">
        <span class="flow-sub">Masih bingung? Tanya AI</span>
        <div class="flow-chat" bind:this={chatBox}>
          {#if steps.length}
            {#each chat as c, j (j)}
              <div class="flow-qa">
                <p class="flow-q">{c.q}</p>
                {#if c.a}<div use:md={c.a}></div>{:else}<div class="flow-muted"><span class="dots"><i></i><i></i><i></i></span> AI sedang menjawab…</div>{/if}
              </div>
            {/each}
          {/if}
        </div>
      </section>
      <p class="flow-meta flow-muted">{`Dibuat ${new Date(flow.saved.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })} · `}{#if steps.length}{@render quota()}{:else}<span class="flow-quota"></span>{/if}</p>
    </div>
    <form class="flow-ask" onsubmit={(e) => { e.preventDefault(); actions.ask(e.currentTarget.elements.q); }}>
      <textarea name="q" rows="1" maxlength="1000" placeholder={`Tanya tentang langkah ${flow.step + 1}… (Enter kirim)`}
        onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); actions.ask(e.currentTarget); } }}></textarea>
      <button type="submit" class="ai-send" title="Kirim"><Icon d="M1 1.5 15 8 1 14.5l2-6.5 6-.5v-1l-6-.5z" /></button>
    </form>
  {/if}
{/if}
