#!/usr/bin/env python3
"""
Pembanding kualitas 2 model AI untuk kebutuhan rakit.io.

Menjalankan satu set prompt uji (khas rakit: Plan, Builder, Vision) ke dua model,
lalu menilai kualitas jawaban secara otomatis + menyiapkan berkas untuk penilaian manual.

Pemakaian:
    python3 compare.py --model-a deepseek-v4-pro --model-b gpt-6-sol
    python3 compare.py --model-a deepseek-v4-pro --model-b claude-sonnet-5.5 --runs 3
    python3 compare.py --list                # lihat model yang tersedia
    python3 compare.py ... --only plan       # hanya uji Plan

Hasil disimpan di ./hasil/<timestamp>/ :
    - jawaban.md      : semua jawaban, siap dibaca/dinilai
    - skor.csv        : skor otomatis per prompt per model
    - ringkasan.md    : tabel ringkas + rekomendasi
    - raw/*.json      : respons mentah tiap panggilan (untuk audit)

Konfigurasi diambil dari /srv/rakit/.env (AI_BASE_URL, AI_API_KEY).
"""
import argparse
import csv
import json
import os
import re
import statistics
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV_FILE = Path("/srv/rakit/.env")


# ---------------- konfigurasi ----------------

def load_env(path: Path) -> dict:
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip().strip('"').strip("'")
        env[k.strip()] = v
    return env


ENV = load_env(ENV_FILE)
BASE_URL = ENV.get("AI_BASE_URL", "https://api.kelontongai.id/v1").rstrip("/")
API_KEY = ENV.get("AI_API_KEY", "")


def api(path: str, method: str = "GET", body: dict | None = None, timeout: int = 180):
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {API_KEY}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


# ---------------- prompt uji (khas rakit) ----------------

# Tiap kasus: nama, kategori, prompt, dan penilai otomatis (heuristic).
# Penilaian otomatis sengaja sederhana & transparan; keputusan akhir tetap manual.
KASUS = [
    {
        "id": "plan_landing",
        "kategori": "Plan",
        "prompt": (
            "Saya mau bikin website untuk warung kopi kecil di Pekanbaru. "
            "Isinya: halaman depan dengan menu, foto-foto, alamat, dan formulir pesan. "
            "Bisa terima pesanan online juga. Tolong rencanakan dulu."
        ),
        "wajib": ["index", "menu", "formulir", "warna", "tabel", "alamat"],
        "larangan": ["<html>", "```html"],
        "catatan": "Plan harus konkret: file, tabel DB, tampilan. Tanpa kode penuh.",
    },
    {
        "id": "plan_vague",
        "kategori": "Plan",
        "prompt": "buat website dong",
        "wajib": ["?"],
        "larangan": ["<html>"],
        "catatan": "Harus bertanya balik (maks 3 pertanyaan), bukan menebak.",
    },
    {
        "id": "build_counter",
        "kategori": "Builder",
        "prompt": (
            "Buat halaman hitung pengunjung: ada angka besar di tengah dan tombol "
            "'Tambah'. Setiap klik nambah 1. Simpan juga ke database supaya "
            "totalnya sama untuk semua pengunjung. File index.html saja."
        ),
        "wajib": ["index.html", "/api/db/", "fetch", "create_table"],
        "larangan": ["localStorage"],
        "catatan": "Builder harus pakai tool + database, BUKAN localStorage.",
    },
    {
        "id": "build_bugfix",
        "kategori": "Builder",
        "prompt": (
            "Di file js/app.js ada error: 'Uncaught TypeError: Cannot read properties "
            "of null (reading addEventListener)'. Tombol dengan id simpan tidak berfungsi. "
            "Perbaiki dan jelaskan singkat."
        ),
        "wajib": ["simpan", "addEventListener"],
        "larangan": [],
        "catatan": "Harus paham penyebab (elemen null) & solusi (null check / urutan script).",
    },
    {
        "id": "vision_mockup",
        "kategori": "Vision",
        "prompt": (
            "Ini screenshot website saya. Kenapa tampilannya berantakan di HP? "
            "Apa yang harus diperbaiki?"
        ),
        "wajib": ["viewport", "media", "responsive", "lebar", "font"],
        "larangan": [],
        "catatan": "Vision harus sebut elemen visual konkret + saran responsif.",
    },
]


# ---------------- penilaian otomatis ----------------

def nilai(jawaban: str, kasus: dict) -> dict:
    """Penilaian heuristic yang transparan. Rentang 0-100."""
    t = (jawaban or "").lower()
    n_char = len(jawaban or "")

    # kelengkapan: kata kunci wajib
    wajib = kasus.get("wajib", [])
    ketemu = sum(1 for w in wajib if w.lower() in t)
    skor_wajib = (ketemu / len(wajib) * 100) if wajib else 100

    # kebersihan: kata terlarang
    larangan = kasus.get("larangan", [])
    pelanggaran = sum(1 for w in larangan if w.lower() in t)
    skor_larangan = 100 if not larangan else max(0, 100 - pelanggaran * 50)

    # panjang wajar (tidak kosong, tidak bertele-tele). Ideal 200-4000 char.
    if n_char < 50:
        skor_panjang = 20
    elif n_char < 200:
        skor_panjang = 60
    elif n_char <= 4000:
        skor_panjang = 100
    elif n_char <= 8000:
        skor_panjang = 70
    else:
        skor_panjang = 40

    # struktur: ada heading/bullet/penomoran (menandakan rapi)
    struktur = 0
    if re.search(r"^\s*[-*•]", jawaban or "", re.M):
        struktur += 50
    if re.search(r"^\s*\d+[.)]", jawaban or "", re.M):
        struktur += 30
    if re.search(r"^#{1,4}\s", jawaban or "", re.M) or "<h" in t:
        struktur += 20
    skor_struktur = min(100, struktur)

    total = (skor_wajib * 0.40) + (skor_larangan * 0.25) + (skor_panjang * 0.15) + (skor_struktur * 0.20)
    return {
        "skor_total": round(total, 1),
        "skor_kelengkapan": round(skor_wajib, 1),
        "skor_kebersihan": round(skor_larangan, 1),
        "skor_panjang": round(skor_panjang, 1),
        "skor_struktur": round(skor_struktur, 1),
        "panjang_char": n_char,
        "kata_wajib_ketemu": f"{ketemu}/{len(wajib)}",
    }


# ---------------- pemanggilan model ----------------

def panggil(model: str, prompt: str, timeout: int = 180) -> dict:
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 8000,
        "temperature": 0.3,
        "stream": False,
    }
    mulai = time.time()
    try:
        resp = api("/chat/completions", "POST", body, timeout=timeout)
        durasi = time.time() - mulai
        pilihan = resp.get("choices", [])
        teks = pilihan[0]["message"]["content"] if pilihan else ""
        usage = resp.get("usage", {})
        return {
            "ok": True,
            "teks": teks or "",
            "durasi_s": round(durasi, 1),
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
            "error": None,
        }
    except urllib.error.HTTPError as e:
        pesan = e.read().decode(errors="replace")[:400]
        return {"ok": False, "teks": "", "durasi_s": round(time.time() - mulai, 1),
                "error": f"HTTP {e.code}: {pesan}"}
    except Exception as e:
        return {"ok": False, "teks": "", "durasi_s": round(time.time() - mulai, 1),
                "error": f"{type(e).__name__}: {e}"}


# ---------------- alur utama ----------------

def jalankan(args):
    if not API_KEY:
        print("ERROR: AI_API_KEY tidak ditemukan di /srv/rakit/.env", file=sys.stderr)
        sys.exit(1)

    if args.list:
        data = api("/models")
        print(f"{'ID Model':<32} {'ctx':>9} {'vision':>7}")
        print("-" * 52)
        for m in data.get("data", []):
            c = m.get("capabilities", {})
            print(f"{m['id']:<32} {c.get('contextWindow', 0):>9} {str(c.get('vision', False)):>7}")
        return

    model_a, model_b = args.model_a, args.model_b
    kasus = [k for k in KASUS if not args.only or k["kategori"].lower() == args.only.lower()]
    if not kasus:
        print(f"Tidak ada kasus untuk filter '{args.only}'", file=sys.stderr)
        sys.exit(1)

    stempel = datetime.now().strftime("%Y%m%d_%H%M%S")
    outdir = HERE / "hasil" / stempel
    (outdir / "raw").mkdir(parents=True, exist_ok=True)

    print(f"{'='*66}")
    print(f"  Bandingkan : {model_a}  vs  {model_b}")
    print(f"  Kasus      : {len(kasus)} prompt × {args.runs} kali")
    print(f"  Hasil      : {outdir}")
    print(f"{'='*66}\n")

    baris = []
    for run_i in range(1, args.runs + 1):
        for k in kasus:
            print(f"[run {run_i}/{args.runs}] {k['id']} ({k['kategori']})")
            tugas = [(model_a, "A"), (model_b, "B")]
            hasil = {}
            with ThreadPoolExecutor(max_workers=2) as ex:
                fut = {ex.submit(panggil, m, k["prompt"]): (m, tag) for m, tag in tugas}
                for f in fut:
                    m, tag = fut[f]
                    hasil[tag] = f.result()

            for tag in ("A", "B"):
                m = model_a if tag == "A" else model_b
                r = hasil[tag]
                skor = nilai(r["teks"], k)
                status = "OK" if r["ok"] else f"GAGAL ({r['error']})"
                print(f"    {tag} {m:<28} {status:<10} skor={skor['skor_total']:>5} "
                      f"{r['durasi_s']:>5.1f}s")
                baris.append({
                    "run": run_i, "kasus": k["id"], "kategori": k["kategori"],
                    "model": m, "tag": tag, **skor,
                    "durasi_s": r["durasi_s"],
                    "prompt_tokens": r.get("prompt_tokens"),
                    "completion_tokens": r.get("completion_tokens"),
                    "ok": r["ok"], "error": r["error"] or "",
                })
                (outdir / "raw" / f"{run_i}_{k['id']}_{tag}.json").write_text(
                    json.dumps({"model": m, "kasus": k, "respons": r}, ensure_ascii=False, indent=2))
            print()

    # ---- skor.csv ----
    kolom = ["run", "kasus", "kategori", "model", "tag", "skor_total", "skor_kelengkapan",
             "skor_kebersihan", "skor_panjang", "skor_struktur", "panjang_char",
             "kata_wajib_ketemu", "durasi_s", "prompt_tokens", "completion_tokens", "ok", "error"]
    with (outdir / "skor.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=kolom)
        w.writeheader()
        w.writerows(baris)

    # ---- jawaban.md ----
    md = [f"# Perbandingan Model AI rakit.io\n",
          f"- Model A: **{model_a}**", f"- Model B: **{model_b}**",
          f"- Waktu: {datetime.now():%Y-%m-%d %H:%M}", f"- Kasus: {len(kasus)} prompt × {args.runs} run\n"]
    for k in kasus:
        md.append(f"\n---\n\n## {k['id']} — {k['kategori']}\n")
        md.append(f"**Prompt:** {k['prompt']}\n")
        md.append(f"*Catatan:* {k['catatan']}\n")
        for tag in ("A", "B"):
            m = model_a if tag == "A" else model_b
            fn = outdir / "raw" / f"1_{k['id']}_{tag}.json"
            if fn.exists():
                r = json.loads(fn.read_text())["respons"]
                md.append(f"\n### {tag} · {m}  (skor {nilai(r['teks'], k)['skor_total']})\n")
                md.append("```\n" + (r["teks"] or f"(GAGAL: {r['error']})") + "\n```\n")
    (outdir / "jawaban.md").write_text("\n".join(md))

    # ---- ringkasan.md ----
    ringkas(outdir, model_a, model_b, baris, kasus)


def ringkas(outdir: Path, ma: str, mb: str, baris: list, kasus: list):
    lines = [f"# Ringkasan: {ma} vs {mb}\n",
             f"_{datetime.now():%Y-%m-%d %H:%M}_\n"]

    def agg(model):
        s = [b["skor_total"] for b in baris if b["model"] == model and b["ok"]]
        d = [b["durasi_s"] for b in baris if b["model"] == model and b["ok"]]
        gagal = sum(1 for b in baris if b["model"] == model and not b["ok"])
        return {
            "n": len(s),
            "rata": round(statistics.mean(s), 1) if s else 0,
            "min": min(s) if s else 0,
            "max": max(s) if s else 0,
            "durasi": round(statistics.mean(d), 1) if d else 0,
            "gagal": gagal,
        }

    a, b = agg(ma), agg(mb)
    lines.append("## Skor keseluruhan\n")
    lines.append(f"| Metrik | {ma} | {mb} |")
    lines.append("|---|---|---|")
    lines.append(f"| Skor rata-rata | **{a['rata']}** | **{b['rata']}** |")
    lines.append(f"| Skor terendah | {a['min']} | {b['min']} |")
    lines.append(f"| Skor tertinggi | {a['max']} | {b['max']} |")
    lines.append(f"| Rata-rata durasi | {a['durasi']}s | {b['durasi']}s |")
    lines.append(f"| Panggilan gagal | {a['gagal']} | {b['gagal']} |")

    # per kategori
    lines.append("\n## Skor per kategori\n")
    kat = sorted({k["kategori"] for k in kasus})
    lines.append(f"| Kategori | {ma} | {mb} | Selisih |")
    lines.append("|---|---|---|---|")
    for c in kat:
        sa = [x["skor_total"] for x in baris if x["model"] == ma and x["kategori"] == c and x["ok"]]
        sb = [x["skor_total"] for x in baris if x["model"] == mb and x["kategori"] == c and x["ok"]]
        ra = round(statistics.mean(sa), 1) if sa else 0
        rb = round(statistics.mean(sb), 1) if sb else 0
        d = round(rb - ra, 1)
        tanda = "→" if abs(d) < 2 else ("B unggul" if d > 0 else "A unggul")
        lines.append(f"| {c} | {ra} | {rb} | {d:+} {tanda} |")

    # rekomendasi
    lines.append("\n## Rekomendasi\n")
    if a["rata"] == b["rata"]:
        lines.append("- Skor imbang. Pilih yang lebih cepat/murah, atau uji manual lebih banyak.")
    else:
        pemenang = mb if b["rata"] > a["rata"] else ma
        selisih = abs(b["rata"] - a["rata"])
        lines.append(f"- **{pemenang}** unggul {selisih:.1f} poin pada skor otomatis.")
    lines.append(f"- Skor otomatis hanya indikator awal. Buka `jawaban.md` untuk penilaian manual "
                 f"(kebenaran, relevansi, kelengkapan) — itu yang menentukan.\n")
    lines.append("## Berkas\n")
    lines.append("- `jawaban.md` — semua jawaban berdampingan")
    lines.append("- `skor.csv` — data mentah tiap penilaian")
    lines.append("- `raw/` — respons JSON asli\n")

    (outdir / "ringkasan.md").write_text("\n".join(lines))
    print("="*66)
    print("SELESAI")
    print(f"  Ringkasan : {outdir}/ringkasan.md")
    print(f"  Jawaban   : {outdir}/jawaban.md")
    print(f"  Skor      : {outdir}/skor.csv")
    print("="*66)
    print("\n" + "\n".join(lines[lines.index('## Skor keseluruhan\n'):lines.index('## Berkas\n')]))


def main():
    p = argparse.ArgumentParser(description="Bandingkan kualitas 2 model AI untuk rakit.io")
    p.add_argument("--model-a", help="ID model A")
    p.add_argument("--model-b", help="ID model B")
    p.add_argument("--runs", type=int, default=1, help="ulangi tiap prompt N kali (default 1)")
    p.add_argument("--only", help="hanya uji kategori ini (plan/builder/vision)")
    p.add_argument("--list", action="store_true", help="tampilkan model yang tersedia")
    args = p.parse_args()

    if not args.list and (not args.model_a or not args.model_b):
        p.error("--model-a dan --model-b wajib (atau pakai --list)")

    jalankan(args)


if __name__ == "__main__":
    main()
