#!/usr/bin/env python3
"""Uji ulang: apakah aturan link yang DIPERKUAT mengurangi href="#" mati?
A = prompt builder lama, B = prompt baru (aturan link diperkuat). Fokus: hitung href="#".
Lebih banyak sampel (tugas landing/toko x 4 sampel) agar varians turun."""
import json, re, statistics, urllib.request, subprocess

env = {}
for line in open('/srv/rakit/.env'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1); env[k.strip()] = v.strip()
BASE = env['AI_BASE_URL'].rstrip('/'); KEY = env['AI_API_KEY']

def build(rev):
    src = subprocess.run(['git','show',f'{rev}:src/ai.js'] if rev!='WORK' else ['cat','src/ai.js'],
                         cwd='/srv/rakit', capture_output=True, text=True).stdout
    out = subprocess.run(['node','-e',f'''
      const src={json.dumps(src)};
      const BASE_PROMPT=src.slice(src.indexOf("const BASE_PROMPT")).split(";")[0].replace(/^const BASE_PROMPT = `/,"").replace(/`$/,"");
      const seg=src.slice(src.indexOf("const BUILD_PROMPT"),src.indexOf("const TOOLS"));
      process.stdout.write(seg.split("`")[1].replace("${{BASE_PROMPT}}",BASE_PROMPT));
    '''], capture_output=True, text=True)
    return out.stdout

OLD, NEW = build('HEAD'), build('WORK')
print(f"prompt: lama={len(OLD)} baru={len(NEW)}\n")

def chat(system, user, t=0.7, mt=1800):
    req = urllib.request.Request(BASE+'/chat/completions',
        data=json.dumps({'model':'deepseek-v4-pro','messages':[{'role':'system','content':system},{'role':'user','content':user}],
                         'temperature':t,'max_tokens':mt}).encode(),
        headers={'Content-Type':'application/json','Authorization':'Bearer '+KEY})
    with urllib.request.urlopen(req,timeout=180) as r: return json.loads(r.read())

def extract(t):
    m=re.search(r'```(?:html)?\s*\n?(.*?)```',t,re.S); return (m.group(1) if m else t).strip()

TASKS = [
    ("landing","Buat index.html landing page kursus coding online: nav, hero, fitur, testimoni, CTA, footer."),
    ("toko","Buat index.html toko kue online: nav, hero, daftar 6 kue, tombol pesan, footer."),
]
def scan(html):
    return {
      'href_mati': len(re.findall(r'href\s*=\s*["\']#["\']', html, re.I)),
      'anchor_valid': len(re.findall(r'href\s*=\s*["\']#[\w-]+["\']', html, re.I)),
      'tautan_nyata': len(re.findall(r'href\s*=\s*["\'](?!\s*#)[^"\']+\.(html|css|js|png|jpg)["\']', html, re.I)),
      'angka_palsu': len(re.findall(r'\b\d{2,3}%|\b\d{3,}\+', html)),
      'bintang': len(re.findall(r'[★⭐🌟]', html)),
    }

rows=[]
for task, desc in TASKS:
    for cond, sysmsg in [('A', OLD), ('B', NEW)]:
        for s in range(4):
            try:
                j=chat(sysmsg, f"{desc}\n\nBalas HANYA kode dalam satu blok ```html ... ```.")
                html=extract(j['choices'][0]['message']['content'])
                rows.append({'task':task,'cond':cond, **scan(html), 'tok':j.get('usage',{}).get('completion_tokens',0)})
            except Exception as e:
                rows.append({'task':task,'cond':cond,'error':str(e)[:100]})
    print(f"  {task} selesai")
json.dump(rows, open('/srv/rakit/tools/antislop/link_rows.json','w'), indent=2, ensure_ascii=False)

def agg(cond):
    rs=[r for r in rows if r['cond']==cond and 'error' not in r]
    keys=['href_mati','anchor_valid','tautan_nyata','angka_palsu','bintang','tok']
    return {k: round(statistics.mean([r[k] for r in rs]),2) for k in keys} | {'n':len(rs)}
print("\n===== EFEK ATURAN LINK DIPERKUAT =====")
a,b=agg('A'),agg('B')
for k in a:
    mark='' if k=='n' else ('↓' if b[k]<a[k] else ('↑' if b[k]>a[k] else '='))
    print(f"  {k:14s} lama={a[k]:>8}  baru={b[k]:>8}  {mark}")
json.dump({'lama':a,'baru':b}, open('/srv/rakit/tools/antislop/link_stats.json','w'), indent=2, ensure_ascii=False)
