#!/usr/bin/env python3
"""UJI #2 (percobaan 3): aturan link dengan framing antislop-ui (positif + 5 opsi konkret).
Bandingkan lama vs baru. Ukur HANYA masalah link: href="#", anchor tanpa target, nav ke seksi tak ada."""
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

def chat(system, user, t=0.7, mt=2000):
    req = urllib.request.Request(BASE+'/chat/completions',
        data=json.dumps({'model':'deepseek-v4-pro','messages':[{'role':'system','content':system},{'role':'user','content':user}],
                         'temperature':t,'max_tokens':mt}).encode(),
        headers={'Content-Type':'application/json','Authorization':'Bearer '+KEY})
    with urllib.request.urlopen(req,timeout=200) as r: return json.loads(r.read())

def extract(t):
    m=re.search(r'```(?:html)?\s*\n?(.*?)```',t,re.S); return (m.group(1) if m else t).strip()

def scan(html):
    # id seksi yang benar-benar ada
    ids = set(re.findall(r'\bid\s*=\s*["\']([\w-]+)["\']', html))
    hrefs = re.findall(r'href\s*=\s*["\']([^"\']*)["\']', html)
    mati = sum(1 for h in hrefs if h.strip() in ('#',''))
    anchor = [h for h in hrefs if h.startswith('#') and len(h)>1]
    anchor_nyambung = sum(1 for h in anchor if h[1:] in ids)
    anchor_menggantung = sum(1 for h in anchor if h[1:] not in ids)
    return {'href_mati': mati, 'anchor_total': len(anchor),
            'anchor_nyambung': anchor_nyambung, 'anchor_menggantung': anchor_menggantung,
            'ada_coming_soon': 1 if re.search(r'coming soon', html, re.I) else 0}

TASKS = [
    ("landing","Buat index.html landing page kursus coding online: nav (Beranda, Kursus, Mentor, Harga, Kontak), hero, fitur, testimoni, CTA, footer."),
    ("toko","Buat index.html toko kue online: nav, hero, daftar 6 kue, tombol pesan, footer."),
    ("jasa","Buat index.html jasa desain logo: nav, hero, portofolio, layanan, kontak, footer."),
]
N = 4
rows = []
for task, desc in TASKS:
    for cond, sysmsg in [('A', OLD), ('B', NEW)]:
        for s in range(N):
            try:
                j = chat(sysmsg, f"{desc}\n\nBalas HANYA kode dalam satu blok ```html ... ```.")
                html = extract(j['choices'][0]['message']['content'])
                rows.append({'task':task,'cond':cond, **scan(html), 'tok':j.get('usage',{}).get('completion_tokens',0)})
            except Exception as e:
                rows.append({'task':task,'cond':cond,'error':str(e)[:100]})
    print(f"  {task} selesai ({N} sampel x 2 kondisi)")
json.dump(rows, open('/srv/rakit/tools/antislop/v3_rows.json','w'), indent=2, ensure_ascii=False)

def agg(cond):
    rs=[r for r in rows if r['cond']==cond and 'error' not in r]
    keys=['href_mati','anchor_total','anchor_nyambung','anchor_menggantung','ada_coming_soon','tok']
    return {k: round(statistics.mean([r[k] for r in rs]),2) for k in keys} | {'n':len(rs)}
print("\n===== UJI #2: framing antislop-ui =====")
a,b=agg('A'),agg('B')
for k in a:
    mark='' if k=='n' else ('↓' if b[k]<a[k] else ('↑' if b[k]>a[k] else '='))
    print(f"  {k:20s} lama={a[k]:>8}  baru={b[k]:>8}  {mark}")
json.dump({'lama':a,'baru':b}, open('/srv/rakit/tools/antislop/v3_stats.json','w'), indent=2, ensure_ascii=False)
