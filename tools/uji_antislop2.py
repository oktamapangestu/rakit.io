#!/usr/bin/env python3
"""Uji A/B multi-sampel & multi-model: apakah antislop-code mengurangi komentar slop?
Menjalankan beberapa tugas x beberapa sampel x 2 kondisi, lalu bikin statistik ringkas."""
import json, os, re, urllib.request, time, statistics

env = {}
for line in open('/srv/rakit/.env'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1); env[k.strip()] = v.strip()
BASE = env['AI_BASE_URL'].rstrip('/'); KEY = env['AI_API_KEY']
ANTISLOP = open('/srv/rakit/tools/antislop/antislop-code.md').read()

def chat(model, messages, temperature=0.7, max_tokens=1600):
    body = {'model': model, 'messages': messages, 'temperature': temperature, 'max_tokens': max_tokens}
    req = urllib.request.Request(BASE + '/chat/completions', data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())

TASKS = [
    ("keranjang.js", "Keranjang belanja: tambah(item), hapus(id), total() dengan diskon 10% bila >500000, simpan/muat localStorage."),
    ("auth.js", "Modul login: hashPassword(), verifyPassword(), buatToken(), cekSesi(). Pakai crypto sederhana."),
    ("format.js", "Utilitas format: rupiah(n), tanggal(d), slug(s), singkat(teks, n)."),
]

SYS = "Kamu programmer JavaScript yang menulis kode bersih dan berfungsi."
def system(cond):
    return SYS if cond == 'A' else SYS + "\n\nPatuhi aturan komentar berikut:\n\n" + ANTISLOP

def extract(text):
    m = re.search(r'```(?:javascript|js)?\s*\n?(.*?)```', text, re.S)
    return (m.group(1) if m else text).strip()

PATTERNS = [
    ("banner", r'//\s*[=\-*_]{4,}'),
    ("narasi_langkah", r'//\s*(Step\s*\d|Langkah\s*\d|Pertama,|Kedua,|Ketiga,)'),
    ("label_kosong", r'//\s*(Main logic|Core logic|Business logic|Helper|Entry point|Error handling|Initialize|Class\b|Constructor|Konstruktor)'),
    ("restate", r'//\s*(Inisialisasi|Initialize|Membuat|Create|Define|Mendefinisikan|Simpan|Menyimpan|Memuat|Menghapus|Menambah|Menghitung|Mengembalikan|Mengubah|Mengecek|Memeriksa)'),
    ("emoji", "//[^\\n]*[\\u2705\\U0001F680\\U0001F512\\U0001F4E6\\u2728]"),
    ("end_marker", r'//\s*(end if|end function|End of|akhir)\b'),
    ("todo_kabur", r'//\s*(TODO:|Future improvements|Add more)'),
]
def slop_jenis(code):
    return [n for n, p in PATTERNS if re.search(p, code, re.I | re.M)]
def n_comments(code):
    return len(re.findall(r'//[^\n]*|/\*.*?\*/', code, re.S))
def n_biz(code):  # komentar yang menyebut aturan bisnis/angka
    return len(re.findall(r'//[^\n]*(diskon|10%|500000|aturan|edge|asumsi|karena|harus|jika tidak|fallback|token|kedaluwarsa)', code, re.I))

MODELS = ['deepseek-v4-pro', 'deepseek-v4.1-flash']
SAMPLES = 3
rows = []
for model in MODELS:
    for tname, tdesc in TASKS:
        for cond in ['A', 'B']:
            for s in range(SAMPLES):
                try:
                    j = chat(model, [{'role':'system','content':system(cond)},
                                     {'role':'user','content':f"Tulis file {tname}. {tdesc}\nBalas HANYA kode dalam satu blok ```javascript ... ```."}])
                    code = extract(j['choices'][0]['message']['content'])
                    rows.append({'model': model, 'task': tname, 'cond': cond,
                                 'slop_jenis': slop_jenis(code), 'n_slop': len(slop_jenis(code)),
                                 'n_comments': n_comments(code), 'n_biz': n_biz(code),
                                 'tok_out': j.get('usage',{}).get('completion_tokens',0)})
                except Exception as e:
                    rows.append({'model': model, 'task': tname, 'cond': cond, 'error': str(e)[:120]})
            print(f"  {model} {tname} {cond} selesai")
json.dump(rows, open('/srv/rakit/tools/antislop/ab_rows.json','w'), indent=2, ensure_ascii=False)

# Statistik
def agg(cond):
    rs = [r for r in rows if r.get('cond')==cond and 'error' not in r]
    return {
        'n': len(rs),
        'avg_slop_jenis': round(statistics.mean([r['n_slop'] for r in rs]), 2),
        'avg_komentar': round(statistics.mean([r['n_comments'] for r in rs]), 1),
        'avg_biz': round(statistics.mean([r['n_biz'] for r in rs]), 2),
        'avg_tok_out': round(statistics.mean([r['tok_out'] for r in rs])),
        'pct_sampel_ada_slop': round(100*sum(1 for r in rs if r['n_slop']>0)/len(rs)),
    }
print("\n===== STATISTIK =====")
a, b = agg('A'), agg('B')
for k in a:
    print(f"  {k:22s} A(tanpa)={a[k]:>7}   B(dengan)={b[k]:>7}")
json.dump({'A': a, 'B': b}, open('/srv/rakit/tools/antislop/ab_stats.json','w'), indent=2)
