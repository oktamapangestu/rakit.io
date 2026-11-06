<!-- Tab Provider AI: AI pribadi untuk editor (per akun) dan provider untuk ai.* di fungsi (per project). -->
<script>
  import { getContext } from 'svelte';
  import PersonalAi from './PersonalAi.svelte';
  import AiProviders from '../functions/AiProviders.svelte';

  const { api, loadCredits } = getContext('editor');
  let data = $state(null); // GET /api/functions (daftar provider fungsi ada di sini)
  let error = $state('');

  // Dipanggil setiap tab dibuka (project bisa berganti isi).
  export async function load() {
    try {
      data = await api('GET', '/api/functions');
      error = '';
    } catch (err) {
      error = err.message;
    }
  }
</script>

<div class="fn-wrap">
  <div class="fn-head">
    <div>
      <h3>Provider AI</h3>
      <p>Hubungkan API key AI milikmu: untuk AI editor tanpa memakai jatah/kredit, dan untuk fitur AI di fungsi serverless website-mu.</p>
    </div>
  </div>
  <PersonalAi onChanged={loadCredits} />
  {#if error}
    <p class="history-empty error">{error}</p>
  {:else if data}
    <AiProviders {data} onData={(d) => { data = d; }} />
  {/if}
</div>
