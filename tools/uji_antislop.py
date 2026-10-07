#!/usr/bin/env python3
"""Uji A/B: apakah aturan antislop-code benar-benar mengurangi komentar 'slop'?

Kirim tugas kode IDENTIK ke model yang sama, dua kondisi:
  A = tanpa aturan (baseline)
  B = dengan aturan antislop-code
Lalu nilai otomatis: pola komentar-slop (regex) + nilai juri LLM.
"""
import json, os, re, sys, urllib.request, time

env = {}
for line in open('/srv/rakit/.env'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip()
BASE = env['AI_BASE_URL'].rstrip('/')
KEY = env['AI_API_KEY']
MODEL = env.get('AI_MODEL', 'deepseek-v4-pro')

ANTISLOP = open('/srv/rakit/tools/antislop/antislop-code.md').read()

def chat(messages, temperature=0.3, max_tokens=2000):
    body = {'model': MODEL, 'messages': messages, 'temperature': temperature, 'max_tokens': max_tokens}
    req = urllib.request.Request(BASE + '/chat/completions',
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())

# --- Tugas kode: sengaja mengundang komentar gaya-AI default ---
TASK = """Tulis file JavaScript bernama `keranjang.js` untuk aplikasi toko online.

Fitur:
- class Keranjang dengan method: tambah(item), hapus(id), total(), daftar()
- item = { id, nama, harga, jumlah }
- total() menghitung harga*jumlah, dengan diskon 10% bila subtotal > 500000
- simpan & muat dari localStorage

Tulis kode lengkap yang berfungsi. Sertakan komentar seperlunya.

Balas HANYA kode JS-nya di dalam satu blok ```javascript ... ```, tanpa penjelasan lain."""

SYSTEM_BASE = "Kamu programmer JavaScript yang menulis kode bersih dan berfungsi."

def run(condition):
    if condition == 'A':
        sysmsg = SYSTEM_BASE
    else:
        sysmsg = SYSTEM_BASE + "\n\nPatuhi aturan komentar berikut:\n\n" + ANTISLOP
    t0 = time.time()
    j = chat([{'role': 'system', 'content': sysmsg}, {'role': 'user', 'content': TASK}])
    dt = time.time() - t0
    text = j['choices'][0]['message']['content']
    u = j.get('usage', {})
    return text, {'in': u.get('prompt_tokens', 0), 'out': u.get('completion_tokens', 0), 'sec': round(dt, 1)}

def extract_code(text):
    m = re.search(r'```(?:javascript|js)?\s*\n?(.*?)```', text, re.S)
    return m.group(1).strip() if m else text.strip()

# --- Pemeriksa pola komentar slop (dari definisi antislop-code) ---
PATTERNS = [
    ("banner pemisah", r'//\s*[=\-*_]{4,}'),
    ("narasi langkah", r'//\s*(Step\s*\d|Langkah\s*\d|First,|Then,|Finally,|Pertama,|Kedua,)'),
    ("label kosong", r'//\s*(Main logic|Core logic|Business logic|Helper function|Entry point|Error handling|Initialize|Class|Constructor)\b'),
    ("restating obvious", r'//\s*(Inisialisasi|Initialize|Membuat|Create|Define|Mendefinisikan)\b[^\n]{0,30}$'),
    ("emoji dekoratif", "//[^\\n]*[\\u2705\\U0001F680\\U0001F512\\U0001F4E6\\u2728]"),
    ("end marker", r'//\s*(end if|end function|End of|akhir)\b'),
    ("TODO kabur", r'//\s*(TODO:|Future improvements|Add more)'),
]
def scan_slop(code):
    found = []
    for name, pat in PATTERNS:
        hits = re.findall(pat, code, re.I | re.M)
        if hits:
            found.append((name, len(hits)))
    return found

def count_comments(code):
    return len(re.findall(r'//[^\n]*|/\*.*?\*/', code, re.S))

# --- Juri LLM: nilai apakah komentar berguna / slop ---
JUDGE = """Kamu penilai kode yang ketat. Diberikan kode JavaScript. Nilai KOMENTAR-nya saja (bukan kodenya).

Balas JSON persis:
{"slop_score": <0-10, 0=komentar semua berguna/bersih, 10=sangat banyak komentar slop>,
 "useful_score": <0-10, seberapa berguna komentarnya>,
 "jumlah_komentar": <int>,
 "contoh_slop": ["..."]}

Kriteria komentar SLP: mengulang kode, narasi langkah, label kosong, banner dekoratif, emoji dekoratif, TODO kabur.
Komentar BERGUN: menjelaskan aturan bisnis, edge case, asumsi, algoritma, efek samping."""

def judge(code):
    j = chat([{'role': 'system', 'content': JUDGE},
              {'role': 'user', 'content': f'```javascript\n{code}\n```'}], temperature=0, max_tokens=600)
    txt = j['choices'][0]['message']['content']
    m = re.search(r'\{.*\}', txt, re.S)
    try:
        return json.loads(m.group(0))
    except Exception:
        return {'raw': txt[:300]}

print(f"Model: {MODEL}\nTask: keranjang.js\n")
results = {}
for cond in ['A', 'B']:
    print(f"----- Kondisi {cond} ({'tanpa' if cond=='A' else 'DENGAN'} antislop-code) -----")
    text, usage = run(cond)
    code = extract_code(text)
    slop = scan_slop(code)
    nc = count_comments(code)
    print(f"  token: in={usage['in']} out={usage['out']} | {usage['sec']}s | baris={len(code.splitlines())} | komentar≈{nc}")
    print(f"  pola slop terdeteksi: {slop if slop else 'TIDAK ADA'}")
    jv = judge(code)
    print(f"  juri: {jv}")
    results[cond] = {'code': code, 'usage': usage, 'slop_patterns': slop, 'comments': nc, 'judge': jv, 'raw': text}
    open(f'/srv/rakit/tools/antislop/hasil_{cond}.js', 'w').write(code)
    open(f'/srv/rakit/tools/antislop/hasil_{cond}.json', 'w').write(json.dumps(results[cond], indent=2, ensure_ascii=False))
    print()

# Ringkasan
print("===== RINGKASAN =====")
for cond in ['A', 'B']:
    r = results[cond]
    jv = r['judge']
    print(f"  {cond}: slop_jenis={len(r['slop_patterns'])} slop_score={jv.get('slop_score','?')} useful={jv.get('useful_score','?')} komentar={r['comments']} tok_out={r['usage']['out']}")
json.dump(results, open('/srv/rakit/tools/antislop/ringkasan.json', 'w'), indent=2, ensure_ascii=False)
