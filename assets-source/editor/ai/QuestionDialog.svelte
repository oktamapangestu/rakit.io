<!--
  Dialog pertanyaan agen (tool ask_user, lihat go/internal/ai/askuser.go): AI berhenti sejenak dan menunggu keputusan
  pemilik website. Pilih salah satu pilihan atau tulis jawaban sendiri, lalu Jawab. "Nanti" menutup dialog saja —
  AI tetap menunggu dan dialognya bisa dibuka lagi dari tombol Jawab di panel AI.
  question: { id, question, options: [{ label, description? }] } · onAnswer(teks) → Promise<boolean> (true = terkirim)
-->
<script>
  import { onMount } from 'svelte';
  import Icon from '../Icon.svelte';
  import { SPARK } from '../icons.js';

  let { question, onAnswer, close } = $props();

  // svelte-ignore state_referenced_locally
  let choice = $state(question.options[0]?.label ?? null);
  let own = $state('');
  let sending = $state(false);
  let form;

  const answer = $derived(own.trim() || choice);

  onMount(() => form.querySelector('.ask-option[aria-checked="true"]')?.focus());

  async function submit(e) {
    e.preventDefault();
    if (!answer || sending) return;
    sending = true;
    if (await onAnswer(answer)) close();
    else sending = false;
  }

  // Panah atas/bawah memindah pilihan, seperti radio biasa.
  function onKey(e, i) {
    const n = question.options.length;
    const next = e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowUp' ? (i + n - 1) % n : -1;
    if (next < 0) return;
    e.preventDefault();
    choice = question.options[next].label;
    own = '';
    form.querySelectorAll('.ask-option')[next].focus();
  }
</script>

<form class="modal ask-modal" bind:this={form} onsubmit={submit}>
  <span class="ask-kicker"><Icon d={SPARK} />AI bertanya</span>
  <h3>{question.question}</h3>
  <div class="ask-options" role="radiogroup" aria-label="Pilihan jawaban">
    {#each question.options as o, i (o.label)}
      <button type="button" class="ask-option" role="radio" aria-checked={String(!own.trim() && choice === o.label)}
        tabindex={choice === o.label ? 0 : -1} onclick={() => { choice = o.label; own = ''; }} onkeydown={(e) => onKey(e, i)}>
        <span class="ask-radio" aria-hidden="true"></span>
        <span class="ask-text"><strong>{o.label}</strong>{#if o.description}<span>{o.description}</span>{/if}</span>
      </button>
    {/each}
  </div>
  <input class="ask-own" bind:value={own} placeholder="Atau tulis jawabanmu sendiri…" maxlength="1000" spellcheck="false" autocomplete="off">
  <p class="ask-note">AI menunggu jawabanmu. Tanpa jawaban dalam 10 menit, AI memilih yang paling aman sendiri.</p>
  <div class="modal-buttons">
    <button type="button" onclick={close}>Nanti</button>
    <button type="submit" class="primary" disabled={!answer || sending}>{sending ? 'Mengirim…' : 'Jawab'}</button>
  </div>
</form>
