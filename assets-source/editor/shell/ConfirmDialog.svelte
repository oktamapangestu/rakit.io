<!--
  Dialog tanya/konfirmasi umum (modal() & ask() di editor.js, confirm di context editor). answer(nilai) menutup
  dialog dengan jawaban itu; Esc atau klik di luar dialog = null. Isi input dibaca dari elemennya saat dikirim (juga
  bila diisi tanpa event input, mis. oleh pengisi otomatis).
  buttons: [{ label, value, primary?, danger? }] — tombol utama (primary, atau yang pertama) = Enter. Bila ada input,
  jawaban tombol utama adalah isi input (tanpa spasi tepi).
-->
<script>
  import { onMount } from 'svelte';

  let { title, message = null, input = null, buttons, answer } = $props();

  // svelte-ignore state_referenced_locally
  const primary = buttons.find((b) => b.primary) ?? buttons[0];
  let inputEl = $state();
  let form;

  onMount(() => {
    if (inputEl) {
      inputEl.focus();
      // Pilih nama tanpa ekstensi, seperti VS Code.
      const dot = inputEl.value.lastIndexOf('.');
      inputEl.setSelectionRange(0, dot > 0 ? dot : inputEl.value.length);
    } else {
      form.querySelector('button[type=submit]').focus();
    }
  });
</script>

<!-- Tanpa spasi di antara elemen (sama dengan markup lama). -->
<form class="modal" bind:this={form} onsubmit={(e) => { e.preventDefault(); answer(input ? inputEl.value.trim() : primary.value); }}><h3>{title}</h3>{#if message}<p>{message}</p>{/if}{#if input}<input
  bind:this={inputEl} value={input.value ?? ''} placeholder={input.placeholder} spellcheck="false" autocomplete="off">{/if}<div class="modal-buttons">{#each buttons as b, i (i)}<button
  type={b === primary ? 'submit' : 'button'} class={b.danger ? 'danger' : b.primary ? 'primary' : ''}
  onclick={b === primary ? null : () => answer(b.value)}>{b.label}</button>{/each}</div></form>
