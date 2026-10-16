<!-- Panel AI (#aiPanel): daftar pesan percakapan dan kotak prompt. Keadaan & aksi di state.svelte.js. -->
<script>
  import { getContext, tick } from 'svelte';
  import Icon from '../Icon.svelte';
  import Activity from './Activity.svelte';
  import Reply from './Reply.svelte';
  import Composer from './Composer.svelte';
  import { ai, AI_MODES, activeMode, engineName, setInput, send, stopJob } from './state.svelte.js';
  import { SPARK } from '../icons.js';

  const { openTopup, icons, pageName } = getContext('editor');

  let box;
  $effect(() => {
    void ai.scrollTick;
    tick().then(() => { box.scrollTop = box.scrollHeight; });
  });

  const copy = $derived(AI_MODES[activeMode()]);
</script>

<div class="ai-messages" id="aiMessages" bind:this={box}>
  {#if !ai.messages.length}
    {#if ai.credits && !ai.credits.enabled}
      <div class="ai-notice">Fitur AI belum diaktifkan di server ini.</div>
    {:else}
      <div class="ai-empty">
        <div class="spark"><Icon d={SPARK} /></div>
        <h3>{copy.title}</h3>
        <p>{copy.intro}</p>
        <div class="ai-suggestions">
          {#each copy.suggestions as text (text)}<button type="button" onclick={() => { setInput(text); send(); }}>{text}</button>{/each}
        </div>
      </div>
    {/if}
  {/if}
  <!-- .msg memakai white-space: pre-wrap: isi bubble ditulis rapat. -->
  {#each ai.messages as item (item.key)}
    {#if item.kind === 'user'}
      {@const many = new Set((item.blocks ?? []).map((x) => pageName(x.page))).size > 1}
      <div class="msg user">{#if item.mode === 'plan'}<span class="msg-mode">Plan</span>{/if}{#if item.mode === 'agent'}<span class="msg-mode agent">{`Agen · ${engineName(item.engine)}`}</span>{/if}{#if item.autoFix}<span class="msg-mode">Perbaikan otomatis · gratis</span>{/if}{#if item.images?.length}<div class="msg-images">{#each item.images as src, i (i)}<!-- svelte-ignore a11y_img_redundant_alt --><img {src} alt="Gambar terlampir">{/each}</div>{/if}{#if item.blocks?.length}<div class="msg-blocks">{#each item.blocks as b, i (i)}<span class="ai-block"><Icon d={icons.block} />{b.label}{#if many}<span class="ai-block-page">{pageName(b.page)}</span>{/if}</span>{/each}</div>{/if}{item.content}</div>
    {:else if item.kind === 'reply'}
      <Reply m={item.m} />
    {:else if item.kind === 'error'}
      <div class="msg error">{item.text}{#if item.code === 'no_credits' && ai.credits?.topupEnabled}<button type="button" class="ai-topup-btn inline" onclick={() => openTopup()}>Isi ulang kredit</button>{/if}</div>
    {:else if item.kind === 'job'}
      <Activity activity={item.activity} />
      <div class="msg loading"><span class="dots"><i></i><i></i><i></i></span><span>{item.status}</span><button class="stop" type="button" disabled={item.stopping} onclick={() => stopJob(item)}>{item.stopping ? 'Menghentikan…' : 'Stop'}</button></div>
    {:else if item.kind === 'activity'}
      <Activity activity={item.activity} />
    {:else if item.kind === 'notice'}
      <div class="ai-notice">{`AI sedang mengerjakan prompt di project ${item.slug}. `}<a href={item.url}>Buka project itu</a> — atau tunggu selesai untuk mengirim prompt di sini.</div>
    {/if}
  {/each}
</div>
<Composer />
