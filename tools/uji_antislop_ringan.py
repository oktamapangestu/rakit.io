#!/usr/bin/env python3
"""Uji efek aturan anti-slop RINGAN yang disisipkan ke BUILD_PROMPT rakit.
A = prompt builder LAMA, B = prompt builder BARU (tanpa/dengan 6 aturan ringan).
Tugas: bikin halaman/label -> memancing angka palsu, testimoni karangan, filler, tombol mati."""
import json, os, re, statistics, urllib.request, subprocess

env = {}
for line in open('/srv/rakit/.env'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1); env[k.strip()] = v.strip()
BASE = env['AI_BASE_URL'].rstrip('/'); KEY = env['AI_API_KEY']

# Ambil prompt builder lama dari git, baru dari working tree — lewat generator utk kebenaran.
def build_prompt(rev):
    """rev: 'HEAD' = lama, 'WORK' = baru. Kembalikan BUILD_PROMPT."""
    src = subprocess.run(['git', 'show', f'{rev}:src/ai.js'] if rev != 'WORK' else ['cat', 'src/ai.js'],
                         cwd='/srv/rakit', capture_output=True, text=True).stdout
    # jalankan generator kecil: potong BASE_PROMPT + blok BUILD
    js = src
    out = subprocess.run(['node', '-e', f'''
      const src = {json.dumps(js)};
      const BASE_PROMPT = src.slice(src.indexOf("const BASE_PROMPT")).split(";")[0].replace(/^const BASE_PROMPT = `/,"").replace(/`$/,"");
      const start = src.indexOf("const BUILD_PROMPT");
      const seg = src.slice(start, src.indexOf("const TOOLS"));
      const body = seg.split("`")[1];
      const text = body.replace("${{BASE_PROMPT}}", BASE_PROMPT);
      process.stdout.write(text);
    '''], capture_output=True, text=True)
    return out.stdout

OLD = build_prompt('HEAD')
NEW = build_prompt('WORK')
print(f"panjang prompt: lama={len(OLD)} baru={len(NEW)} (+{len(NEW)-len(OLD)} char)\n")

def chat(system, user, model='deepseek-v4-pro', t=0.7, mt=1600):
    req = urllib.request.Request(BASE + '/chat/completions',
        data=json.dumps({'model': model, 'messages': [{'role':'system','content':system},{'role':'user','content':user}],
                         'temperature': t, 'max_tokens': mt}).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())

def extract(t):
    m = re.search(r'```(?:html|javascript|js|css)?\s*\n?(.*?)```', t, re.S)
    return (m.group(1) if m else t).strip()

TASKS = [
    ("landing", "Buat halaman index.html landing page untuk kursus coding online. Sertakan bagian keunggulan, testimoni, dan statistik."),
    ("toko", "Buat index.html toko kue: hero, daftar 6 kue dengan harga, dan tombol pesan."),
    ("filler", "Buat index.html sederhana untuk jasa desain logo. Jangan berlebihan."),
]

# Pemeriksa: angka/statistik tanpa sumber, testimoni karangan, filler, tombol mati.
def scan(html):
    f = {}
    f['angka_palsu'] = len(re.findall(r'\b(\d{2,3}%|\d{3,}\+|\d+\.\d+k|\d{2,}\.\d{3} (siswa|pelanggan|klien|user))', html, re.I))
    f['testimoni'] = len(re.findall(r'(testimoni|kata mereka|apa kata|ulasan pelanggan|—\s*[A-Z][a-z]+,)', html, re.I))
    f['bintang'] = len(re.findall(r'[★★★★★]|[⭐🌟]', html))
    f['emoji_dekor'] = len(re.findall(r'[\U0001F300-\U0001FAFF\u2728\u2705]', html))
    f['tombol_mati'] = len(re.findall(r'<a[^>]*href=["\']#["\'][^>]*>(?![^<]*(masuk|login|daftar|hubungi))[^<]{0,40}</a>', html, re.I))
    return f

rows = []
SY_NO = "You are the AI assistant built into rakit.io."
for task, desc in TASKS:
    for cond, sysmsg in [('A', OLD), ('B', NEW)]:
        for s in range(2):
            try:
                j = chat(sysmsg, f"{desc}\n\nBalas HANYA kode dalam satu blok ```html ... ```.")
                html = extract(j['choices'][0]['message']['content'])
                rows.append({'task': task, 'cond': cond, **scan(html),
                             'tok_out': j.get('usage',{}).get('completion_tokens',0), 'len': len(html)})
            except Exception as e:
                rows.append({'task': task, 'cond': cond, 'error': str(e)[:100]})
    print(f"  {task} selesai")

json.dump(rows, open('/srv/rakit/tools/antislop/ringan_rows.json','w'), indent=2, ensure_ascii=False)
def agg(cond):
    rs = [r for r in rows if r['cond']==cond and 'error' not in r]
    keys = ['angka_palsu','testimoni','bintang','emoji_dekor','tombol_mati','tok_out']
    return {k: round(statistics.mean([r[k] for r in rs]), 2) for k in keys} | {'n': len(rs)}
print("\n===== EFEK ATURAN RINGAN =====")
a, b = agg('A'), agg('B')
for k in a:
    arah = '' if k=='n' else ('↓ lebih baik' if b[k] < a[k] else ('↑ ' if b[k] > a[k] else '='))
    print(f"  {k:14s} lama={a[k]:>8}  baru={b[k]:>8}   {arah}")
json.dump({'lama': a, 'baru': b}, open('/srv/rakit/tools/antislop/ringan_stats.json','w'), indent=2)
