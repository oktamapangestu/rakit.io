<!-- Dialog jadwal (cron, WIB) satu fungsi. minMinutes = jadwal tersering paket pemilik (0 = paket tanpa jadwal). -->
<script>
  import { getContext } from 'svelte';
  import { FN_DAYS, pad2, describeCron } from './cron.js';

  let { f, minMinutes: min, onSaved, close } = $props();
  const { api, toast, topupEnabled, openTopup } = getContext('editor');

  // svelte-ignore state_referenced_locally
  const current = f.schedule?.cron ?? ''; // jadwal saat dialog dibuka
  let dayTime = $state('07:00');
  let weekTime = $state('07:00');
  let day = $state('1');
  let custom = $state(current);
  let m;
  if ((m = /^(\d+) (\d+) \* \* (?:[0-7]|\*)$/.exec(current))) dayTime = weekTime = `${pad2(m[2])}:${pad2(m[1])}`;
  if ((m = /^\d+ \d+ \* \* ([0-7])$/.exec(current))) day = m[1] === '7' ? '0' : m[1];

  const timeCron = (value, dow) => { const [hh, mm] = (value || '07:00').split(':'); return `${Number(mm)} ${Number(hh)} * * ${dow}`; };
  const options = [
    { id: 'off', label: 'Tanpa jadwal', cron: () => '' },
    { id: '5', label: 'Setiap 5 menit', cron: () => '*/5 * * * *', every: 5 },
    { id: '15', label: 'Setiap 15 menit', cron: () => '*/15 * * * *', every: 15 },
    { id: '30', label: 'Setiap 30 menit', cron: () => '*/30 * * * *', every: 30 },
    { id: 'hour', label: 'Setiap jam', cron: () => '0 * * * *', every: 60 },
    { id: 'day', label: 'Setiap hari jam', cron: () => timeCron(dayTime, '*'), every: 1440 },
    { id: 'week', label: 'Setiap minggu', cron: () => timeCron(weekTime, day), every: 10080 },
    { id: 'custom', label: 'Kustom (cron, WIB)', cron: () => custom },
  ];
  const guess = () => {
    if (!current) return 'off';
    const known = { '*/5 * * * *': '5', '*/15 * * * *': '15', '*/30 * * * *': '30', '0 * * * *': 'hour' }[current];
    if (known) return known;
    if (/^\d+ \d+ \* \* \*$/.test(current)) return 'day';
    if (/^\d+ \d+ \* \* [0-7]$/.test(current)) return 'week';
    return 'custom';
  };
  let chosen = $state(guess());
  let saving = $state(false);
  const blocked = (o) => o.id !== 'off' && (min === 0 || (o.every && o.every < min));

  async function save() {
    saving = true;
    try {
      const cron = options.find((o) => o.id === chosen).cron();
      const data = await api('PUT', `/api/functions/${encodeURIComponent(f.name)}/schedule`, { cron });
      close();
      onSaved(data);
      toast(cron ? `Jadwal ${f.name}: ${describeCron(cron)}` : `Jadwal ${f.name} dimatikan`);
    } catch (err) {
      toast(err.message, 'error');
      saving = false;
    }
  }
</script>

<div class="modal publish-modal" role="dialog" aria-label="Jadwal fungsi">
  <h3>{`Jadwal ${f.name}`}</h3>
  {#if min === 0}
    <div class="cron-locked">
      <p>Jadwal (cron) tersedia untuk paket Pro dan Unlimited: fungsi berjalan otomatis, mis. kirim rekap harian atau bersihkan data lama.</p>
      {#if topupEnabled()}<button type="button" class="fn-btn primary" onclick={() => { close(); openTopup('plans'); }}>Lihat paket</button>{/if}
    </div>
  {:else}
    <p class="fn-note">{`Berjalan otomatis (WIB) memakai versi publik fungsi; req.method = "CRON". Paketmu: paling sering tiap ${min} menit.`}</p>
  {/if}
  <div class="cron-options" role="radiogroup">
    {#each options as o (o.id)}
      {@const off = blocked(o)}
      <!-- Klik di mana pun dalam pilihan (termasuk kolom jamnya) memilihnya. -->
      <div class="cron-option" class:blocked={off} role="radio" aria-checked={String(chosen === o.id)} tabindex="0"
        onclick={() => { if (!off) chosen = o.id; }}
        onkeydown={(e) => { if (!off && e.target === e.currentTarget && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); chosen = o.id; } }}>
        <span class="cron-dot"></span><span class="cron-label">{o.label}</span>
        {#if o.id === 'day'}
          <span class="cron-extra"><input type="time" bind:value={dayTime} aria-label="Jam (harian)"></span>
        {:else if o.id === 'week'}
          <span class="cron-extra">
            <select bind:value={day}>{#each [1, 2, 3, 4, 5, 6, 0] as d (d)}<option value={String(d)}>{FN_DAYS[d]}</option>{/each}</select><input type="time" bind:value={weekTime} aria-label="Jam (mingguan)">
          </span>
        {:else if o.id === 'custom'}
          <span class="cron-extra"><input bind:value={custom} placeholder="menit jam tanggal bulan hari, mis. 0 7 * * 1-5" spellcheck="false"></span>
        {/if}
        {#if off && o.every}<span class="cron-plan">{min ? `min. ${min} mnt` : 'Pro'}</span>{/if}
      </div>
    {/each}
  </div>
  {#if f.schedule?.lastRunAt}
    <p class="fn-note">{`Terakhir berjalan ${new Date(f.schedule.lastRunAt).toLocaleString('id-ID')} — status ${f.schedule.lastStatus ?? '-'}`}</p>
  {/if}
  <div class="modal-buttons">
    <button type="button" class="primary" disabled={saving} onclick={save}>Simpan</button>
    <button type="button" onclick={close}>Batal</button>
  </div>
</div>
