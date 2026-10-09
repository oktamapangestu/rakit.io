<!-- Contoh kode memakai tabel dari website (API /api/db/<tabel>). -->
<script>
  import { getContext } from 'svelte';

  let { t } = $props();
  const { copyText } = getContext('editor');

  // [{ title, code, ops }] — ops: akses yang dibutuhkan kode; peringatan muncul bila tidak ada satu pun yang publik.
  const blocks = $derived.by(() => {
    const url = `/api/db/${t.name}`;
    const columns = t.columns.filter((c) => !c.system);
    const example = { text: 'teks', number: 1, boolean: true, date: '2026-12-31', reference: 1, image: '/uploads/contoh.jpg' };
    const sample = Object.fromEntries(columns.map((c) => [c.name, example[c.type]]));
    // body: objek data, atau teks kode JS untuk isi JSON.stringify(...)
    const send = (method, path, body) => `fetch('${path}', {\n  method: '${method}',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify(${typeof body === 'string' ? body : JSON.stringify(body)}),\n});`;
    const first = columns[0];
    const textCol = columns.find((c) => c.type === 'text');
    const imageCol = columns.find((c) => c.type === 'image');
    const refCol = columns.find((c) => c.type === 'reference');
    const block = (title, code, ops = []) => ({ title, code, ops });
    return {
      list: [
        block('Membaca data', `// Ambil data, terbaru dulu (20 per halaman)\nconst res = await fetch('${url}?sort=-created_at&limit=20');\nconst { rows, total } = await res.json();`, ['list']),
        block('Membaca satu data', `// Ambil satu data berdasarkan id\nconst res = await fetch('${url}/1');\nconst row = await res.json();`, ['view']),
        block('Menambah data', `// Tambah data; balasannya data baru lengkap dengan id\nconst res = await ${send('POST', url, sample)}\nconst row = await res.json();`, ['create']),
        block('Mengubah data', `// Ubah data dengan id 1 (cukup kirim kolom yang diubah)\nawait ${send('PATCH', `${url}/1`, first ? { [first.name]: example[first.type] } : {})}`, ['update']),
        block('Menghapus data', `// Hapus data dengan id 1\nawait fetch('${url}/1', { method: 'DELETE' });`, ['delete']),
        imageCol ? block('Upload gambar', `// 1. Upload file dari <input type="file" id="file-${imageCol.name}">\nconst file = document.querySelector('#file-${imageCol.name}').files[0];\nconst up = await fetch('${url}/upload?column=${imageCol.name}', { method: 'POST', body: file });\nconst { url } = await up.json(); // mis. "/uploads/${t.name}/xxxx.jpg"\n// 2. Simpan alamatnya di kolom ${imageCol.name} (bersama kolom lain)\nawait ${send('POST', url, `{ ...data, ${imageCol.name}: url }`)}`, ['create', 'update']) : null,
        refCol ? block('Data relasi', `// Sertakan data dari tabel ${refCol.refTable} (kolom ${refCol.name})\nconst res = await fetch('${url}?expand=${refCol.name}');\nconst { rows } = await res.json();\n// rows[0].${refCol.name}__ref berisi data ${refCol.refTable} yang ditunjuk`, ['list', 'view']) : null,
        block('Menangani error', `const res = await fetch('${url}');\nif (!res.ok) {\n  // Pesan dari server, mis. akses ditolak atau kolom wajib belum diisi\n  const { error } = await res.json();\n  alert(error);\n}`),
      ].filter(Boolean),
      footer: `Filter: ${url}?${textCol ? `${textCol.name}=Budi` : 'kolom=nilai'} · Urutkan: ?sort=-created_at (tanda - = menurun) · Halaman: ?limit=20&offset=20 · Ganti 1 dengan id datanya.`,
    };
  });
</script>

{#each blocks.list as b (b.title)}
  <div class="db-snippet">
    <div class="db-snippet-head">
      <span>{b.title}</span>
      {#if b.ops.length && !b.ops.some((op) => t.rules[op] === 'public')}
        <span class="db-warn" title="Buka akses di atas supaya kode ini berfungsi">Akses belum publik</span>
      {/if}
      <button type="button" class="db-copy" onclick={() => copyText(b.code, 'Kode disalin')}>Salin</button>
    </div>
    <pre><code>{b.code}</code></pre>
  </div>
{/each}
<p class="db-section-desc">{blocks.footer}</p>
