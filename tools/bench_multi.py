#!/usr/bin/env python3
"""Benchmark lanjutan: banyak model pada 6 soal koding sulit (versi paralel, incremental).

- Kualitas: jalankan kode keluaran model terhadap tes otomatis (subprocess).
- Vision: kirim gambar editor nyata, minta baca exception+baris.
- Format: kirim instruksi JSON ketat, cek kepatuhan.
- Menulis hasil incremental ke bench_all.json (tiap model selesai) + JSONL.
"""
import argparse, json, os, re, subprocess, sys, time, urllib.request, importlib.util
from concurrent.futures import ThreadPoolExecutor, as_completed

# muat helper dari harness utama
spec = importlib.util.spec_from_file_location("b", "/srv/rakit/tools/bench_model.py")
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)

# --- 6 soal sulit (subset lebih ketat dari bench_model) ---
HARD_IDS = ["median", "expr", "wordbreak", "tokenbucket", "regex_lite", "calc_prec"]
HARD = [c for c in b.CASES if c["id"] in HARD_IDS]
# tambah 2 soal sulit yang hanya ada di run eval sebelumnya
HARD += [
 {"id":"regex_lite","title":"Mesin regex mini","prompt":"Tulis fungsi Python `is_match(s: str, p: str) -> bool` untuk regex sederhana: '.' = satu karakter apa pun, '*' = nol atau lebih dari karakter SEBELUMNYA. Cocokkan SELURUH string. Contoh: is_match('aa','a*')=True, is_match('aab','c*a*b')=True, is_match('mississippi','mis*is*p*.')=False.",
  "tests":'''def T(name, cond):
    print('TEST PASS' if cond else 'TEST FAIL', name)
T('aa_a', is_match('aa','a') is False)
T('aa_star', is_match('aa','a*') is True)
T('ab', is_match('ab','.*') is True)
T('aab', is_match('aab','c*a*b') is True)
T('miss', is_match('mississippi','mis*is*p*.') is False)
T('empty', is_match('','.*') is True)
T('dot', is_match('a','.') is True)
T('dotstar', is_match('abcd','ab.*') is True)
T('pb', is_match('pb','p*') is False)
'''},
 {"id":"calc_prec","title":"Evaluator unary minus berantai","prompt":"Tulis fungsi Python `calc(expr: str) -> int` untuk ekspresi BILANGAN BULAT dengan + - * dan tanda kurung. Dukung minus uner berantai: '--5'=5, '-(-5)'=5, '3--2'=5, '-(3)'=-3. Tanpa pembagian. Ekspresi selalu valid.",
  "tests":'''def T(name, cond):
    print('TEST PASS' if cond else 'TEST FAIL', name)
T('a', calc('1+1')==2)
T('b', calc('3--2')==5)
T('c', calc('--5')==5)
T('d', calc('-(-5)')==5)
T('e', calc('-(3)')==-3)
T('f', calc('2*(3+4)')==14)
T('g', calc('-2*-3')==6)
T('h', calc('10-2-3')==5)
T('i', calc('-(2+3)*2')==-10)
'''},
]
# de-dup by id
seen=set(); CASES=[]
for c in HARD:
    if c["id"] not in seen: seen.add(c["id"]); CASES.append(c)

# --- tugas vision ---
VISION_PROMPT = ("Perhatikan gambar kode Python ini. (1) Sebutkan error persis (nama exception). "
    "(2) Pada baris berapa. (3) Tulis perbaikan minimalnya. Format: EXCEPTION=<nama>; BARIS=<nomor>; lalu blok kode.")
# --- tugas format ---
FMT_PROMPT = ('Balas HANYA satu objek JSON valid, tanpa teks lain, tanpa markdown fence.\n'
    'Skema: {"file": <string>, "action": "create"|"update"|"delete", "content": <string>}\n'
    'Permintaan: buat file app.py berisi fungsi hello() yang mencetak "hai".\nBalas JSON saja.')


def call_vision(base, key, model, img_b64, timeout=120):
    body = json.dumps({"model": model, "messages":[{"role":"user","content":[
        {"type":"text","text":VISION_PROMPT},
        {"type":"image_url","image_url":{"url":f"data:image/png;base64,{img_b64}"}}]}],
        "temperature":0.0,"max_tokens":500}).encode()
    req = urllib.request.Request(f"{base}/chat/completions", data=body,
        headers={"Authorization":f"Bearer {key}","Content-Type":"application/json"})
    t0=time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: d=json.loads(r.read())
        return {"ok":True,"text":d["choices"][0]["message"]["content"],"latency":round(time.time()-t0,2),
                "out":(d.get("usage") or {}).get("completion_tokens")}
    except Exception as e:
        return {"ok":False,"error":f"{type(e).__name__}: {e}"[:120],"latency":round(time.time()-t0,2)}


def check_json(text):
    t=(text or "").strip()
    m=re.search(r"\{.*\}", t, re.S)
    if not m: return False
    try:
        o=json.loads(m.group(0))
        return {"file","action","content"} <= set(o.keys()) and o.get("action") in ("create","update","delete")
    except Exception:
        return False


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--models", default="")
    ap.add_argument("--out", default="/srv/rakit/tools/bench_all.json")
    ap.add_argument("--workers", type=int, default=4)
    args=ap.parse_args()

    env=b.load_env(); base,key=env["AI_BASE_URL"].rstrip("/"),env["AI_API_KEY"]
    models=[m.strip() for m in (args.models or open("/srv/rakit/tools/models.txt").read()).split(",") if m.strip()]
    img_b64 = __import__("base64").b64encode(open("/tmp/vision_test.png","rb").read()).decode()

    out={}  # model -> stats
    jsonl=open(args.out+".jsonl","w")

    def bench_quality(m):
        res={"ok":0,"fail":0,"err":0,"pass":0,"total":0,"lat":[],"out_tokens":[]}
        for c in CASES:
            r=b.call_model(base,key,m,c["prompt"],temperature=0.0,max_tokens=6000,timeout=120)
            if not r["ok"]: res["err"]+=1; continue
            code=b.extract_code(r["text"])
            h=b.run_harness(code,c["tests"]) if code else {"passed":0,"total":0,"all_pass":False}
            res["pass"]+=h["passed"]; res["total"]+=h["total"]
            res["ok"]+=1 if h["all_pass"] else 0
            res["fail"]+=0 if h["all_pass"] else 1
            res["lat"].append(r["latency_s"]); res["out_tokens"].append(r["out_tokens"] or 0)
        return res

    def bench_model(m):
        q=bench_quality(m)
        v=call_vision(base,key,m,img_b64)
        vok = v.get("ok") and "ZeroDivisionError" in v.get("text","").lower()
        f=b.call_model(base,key,m,FMT_PROMPT,temperature=0.0,max_tokens=600,timeout=90)
        jok = f.get("ok") and check_json(f["text"])
        stats={"score":round(100*q["pass"]/q["total"],1) if q["total"] else 0,
            "ok":q["ok"],"fail":q["fail"],"err":q["err"],
            "avg_latency":round(sum(q["lat"])/len(q["lat"]),2) if q["lat"] else 0,
            "avg_out_tokens":round(sum(q["out_tokens"])/len(q["out_tokens"]),0) if q["out_tokens"] else 0,
            "vision":{"ok":1 if vok else 0,"fail":0 if vok else 1,
                      "out":v.get("out"),"err":v.get("error")},
            "format_json":"lulus" if jok else "gagal"}
        out[m]=stats
        json.dump(out, open(args.out,"w"), indent=2)
        jsonl.write(json.dumps({"model":m,**stats})+"\n"); jsonl.flush()
        tag = f"score={stats['score']:>5.1f} ok={q['ok']}/{q['ok']+q['fail']} err={q['err']} " \
              f"vis={'Y' if vok else 'N'} fmt={stats['format_json']} lat={stats['avg_latency']}s out={stats['avg_out_tokens']:.0f}"
        print(f"[{time.strftime('%H:%M:%S')}] {m:22s} {tag}", flush=True)
        return m,stats

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs=[ex.submit(bench_model,m) for m in models]
        for f in as_completed(futs):
            try: f.result()
            except Exception as e: print("ERR worker:", e, flush=True)
    jsonl.close()
    print(f"\nSelesai. Hasil: {args.out}", flush=True)


if __name__ == "__main__":
    main()
