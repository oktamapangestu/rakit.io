#!/usr/bin/env python3
"""Benchmark koding: DeepSeek V4 Pro vs DeepSeek V4.1 Flash.

Mengirim soal koding yang SAMA ke kedua model, lalu menilai jawabannya dengan
tes otomatis (objektif). Fokus: kemampuan menulis kode yang benar dari deskripsi.

Pakai kredensial dari /srv/rakit/.env (AI_BASE_URL, AI_API_KEY).
Jalankan:  python3 /srv/rakit/tools/bench_model.py
Opsi:      --models a,b   --only <soal-id>   --out <file.json>
"""
import argparse, json, os, re, subprocess, sys, time, urllib.request

ENV_PATH = "/srv/rakit/.env"


def load_env(path=ENV_PATH):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def call_model(base, key, model, prompt, temperature=0.0, max_tokens=4096, timeout=180):
    """Panggil endpoint chat completions (OpenAI-compatible)."""
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": "Kamu asisten koding. Jawab HANYA dengan satu blok kode ```python ... ``` berisi solusi lengkap, tanpa penjelasan."},
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }).encode()
    req = urllib.request.Request(
        f"{base}/chat/completions", data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read())
        msg = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {}) or {}
        return {"ok": True, "text": msg, "latency_s": round(time.time() - t0, 2),
                "in_tokens": usage.get("prompt_tokens"), "out_tokens": usage.get("completion_tokens")}
    except Exception as e:
        detail = ""
        if hasattr(e, "read"):
            try:
                detail = e.read().decode()[:500]
            except Exception:
                pass
        return {"ok": False, "error": f"{type(e).__name__}: {e} {detail}",
                "latency_s": round(time.time() - t0, 2)}


def extract_code(text):
    """Ambil blok kode python dari jawaban model."""
    if not text:
        return ""
    m = re.search(r"```(?:python|py)?\s*\n(.*?)```", text, re.S)
    if m:
        return m.group(1).strip()
    # tidak ada fence: buang baris penjelasan awal yang jelas bukan kode
    return text.strip()


def run_harness(candidate_code, tests_code):
    """Jalankan kode kandidat + tes di subprocess terpisah. Kembalikan (lulus, total, detail)."""
    script = candidate_code + "\n\n" + tests_code
    p = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=30)
    out = (p.stdout or "") + (p.stderr or "")
    lines = [l for l in out.splitlines() if l.startswith("TEST ")]
    passed = sum(1 for l in lines if l.startswith("TEST PASS"))
    failed = sum(1 for l in lines if l.startswith("TEST FAIL"))
    total = passed + failed
    return {"passed": passed, "failed": failed, "total": total,
            "all_pass": total > 0 and failed == 0, "exit": p.returncode,
            "raw": out[-1500:]}


# ---------------- SOAL (deskripsi + tes otomatis) ----------------
CASES = [
    {
        "id": "lru",
        "title": "LRU Cache dengan kapasitas",
        "prompt": (
            "Tulis kelas Python `LRUCache` dengan `__init__(self, capacity: int)`, "
            "`get(self, key: int) -> int` (kembalikan -1 bila tidak ada), dan "
            "`put(self, key: int, value: int) -> None`. Saat kapasitas terlampaui, "
            "buang item yang paling lama tidak dipakai. `get` dan `put` harus O(1). "
            "Kelas harus bernama persis LRUCache."
        ),
        "tests": '''
def T(name, cond):
    print("TEST PASS" if cond else "TEST FAIL", name)
c = LRUCache(2)
c.put(1,1); c.put(2,2)
T("get1", c.get(1)==1)
c.put(3,3)
T("evict2", c.get(2)==-1)
T("has3", c.get(3)==3)
c.put(4,4)
T("evict1", c.get(1)==-1)
T("has4", c.get(4)==4)
T("has3b", c.get(3)==3)
c2 = LRUCache(1)
c2.put(1,1); c2.put(1,2)
T("overwrite", c2.get(1)==2)
''',
    },
    {
        "id": "roman",
        "title": "Angka Romawi (dua arah)",
        "prompt": (
            "Tulis dua fungsi Python: `to_roman(n: int) -> str` (1 <= n <= 3999) yang mengubah "
            "bilangan bulat menjadi angka Romawi standar, dan `from_roman(s: str) -> int` yang "
            "mengubah angka Romawi valid menjadi bilangan bulat. Tangani aturan subtractive "
            "(IV, IX, XL, XC, CD, CM)."
        ),
        "tests": '''
def T(name, cond):
    print("TEST PASS" if cond else "TEST FAIL", name)
T("r1", to_roman(1)=="I")
T("r4", to_roman(4)=="IV")
T("r9", to_roman(9)=="IX")
T("r58", to_roman(58)=="LVIII")
T("r1994", to_roman(1994)=="MCMXCIV")
T("r3999", to_roman(3999)=="MMMCMXCIX")
T("f1", from_roman("I")==1)
T("f4", from_roman("IV")==4)
T("f1994", from_roman("MCMXCIV")==1994)
T("roundtrip", all(from_roman(to_roman(i))==i for i in range(1,4000)))
''',
    },
    {
        "id": "bugfix",
        "title": "Perbaiki bug: cari dua angka berjumlah target",
        "prompt": (
            "Fungsi berikut SALAH. Tulis ulang versi yang BENAR dengan mengganti seluruh isi "
            "fungsi (nama dan tanda tangan tetap sama). Kembalikan daftar dua INDEKS berbeda "
            "(i != j) sehingga nums[i] + nums[j] == target; bila tidak ada, kembalikan []. "
            "Tidak boleh memakai indeks yang sama dua kali. Perbaiki juga kasus ada angka sama.\n\n"
            "```python\n"
            "def two_sum(nums, target):\n"
            "    for i in range(len(nums)):\n"
            "        for j in range(len(nums)):\n"
            "            if nums[i] + nums[j] == target:\n"
            "                return [i, j]\n"
            "    return []\n"
            "```"
        ),
        "tests": '''
def T(name, cond):
    print("TEST PASS" if cond else "TEST FAIL", name)
def ok(nums, target, res):
    if res == []:
        # pastikan memang tak ada solusi valid
        n=len(nums)
        return not any(nums[i]+nums[j]==target for i in range(n) for j in range(n) if i!=j)
    if not (isinstance(res, (list, tuple)) and len(res)==2): return False
    i, j = res
    return i != j and nums[i] + nums[j] == target
T("basic", ok([2,7,11,15],9,two_sum([2,7,11,15],9)))
T("dup_same_index", ok([3,3],6,two_sum([3,3],6)))
T("nosol_selfpair", two_sum([1,2,3],6)==[] or ok([1,2,3],6,two_sum([1,2,3],6)))
T("neg", ok([-3,4,3,90],0,two_sum([-3,4,3,90],0)))
T("zero_pair", ok([0,0,1],0,two_sum([0,0,1],0)))
T("nosol", two_sum([1,5,9],100)==[])
''',
    },
    {
        "id": "jsonflat",
        "title": "Ratakan dict bersarang ke path",
        "prompt": (
            "Tulis fungsi Python `flatten(obj, sep='.') -> dict` yang meratakan dict bersarang "
            "menjadi dict satu tingkat dengan kunci berupa path dipisah `sep`. Contoh: "
            "flatten({'a': {'b': 1}, 'c': 2}) -> {'a.b': 1, 'c': 2}. "
            "Dua aturan penting: (1) dict kosong yang berada DI DALAM (seperti {'a': {}}) "
            "menghasilkan {'a': {}}; (2) tetapi bila `obj` sendiri dict kosong, hasilnya harus "
            "dict kosong {} (bukan {'': {}}). Nilai non-dict dipertahankan apa adanya."
        ),
        "tests": '''
def T(name, cond):
    print("TEST PASS" if cond else "TEST FAIL", name)
T("basic", flatten({'a': {'b': 1}, 'c': 2}) == {'a.b': 1, 'c': 2})
T("deep", flatten({'a': {'b': {'c': 3}}}) == {'a.b.c': 3})
T("empty_inner", flatten({'a': {}}) == {'a': {}})
T("sep", flatten({'a': {'b': 1}}, sep='/') == {'a/b': 1})
T("top_empty", flatten({}) == {})
T("mixed", flatten({'x': {'y': [1,2]}, 'z': 0}) == {'x.y': [1,2], 'z': 0})
''',
    },
    {
        "id": "tokenbucket",
        "title": "Token bucket rate limiter",
        "prompt": (
            "Tulis kelas Python `TokenBucket` dengan `__init__(self, rate: float, capacity: int, "
            "now: float = 0.0)`, `allow(self, now: float) -> bool`, dan `tokens_at(self, now: float) -> float`. "
            "`rate` = token per detik, `capacity` = maksimum token. Bucket mulai penuh. "
            "Saat `allow`/`tokens_at` dipanggil dengan waktu `now` (monoton naik), isi diisi ulang "
            "secara kontinu hingga `capacity` maksimum. `allow` mengembalikan True dan mengambil 1 token "
            "bila >= 1 token tersedia, selain itu False. Penting: waktu `now` bisa lebih kecil dari "
            "sebelumnya (jangan sampai isi berkurang/negatif)."
        ),
        "tests": '''
def T(name, cond):
    print("TEST PASS" if cond else "TEST FAIL", name)
b = TokenBucket(1.0, 2, now=0.0)
T("startfull", abs(b.tokens_at(0.0) - 2.0) < 1e-9)
T("allow1", b.allow(0.0) is True)
T("allow2", b.allow(0.0) is True)
T("allow3_false", b.allow(0.0) is False)
T("refill1s", b.allow(1.0) is True)
T("refill1s_b", b.allow(1.0) is False)
T("cap", b.tokens_at(1000.0) <= 2.0 + 1e-9)
T("nonneg", b.tokens_at(-5.0) >= 0.0)
''',
    },
    {
        "id": "dag",
        "title": "Urutan topologis dengan deteksi siklus",
        "prompt": (
            "Tulis fungsi Python `topo_sort(n: int, edges: list) -> list` yang mengembalikan urutan "
            "topologis dari graf berarah dengan simpul 0..n-1. `edges` berisi pasangan (u, v) artinya "
            "u harus muncul sebelum v. Bila ada siklus, kembalikan `None`. Bila ada beberapa urutan "
            "valid, kembalikan yang mana saja. Tidak ada sisi ganda berarti."
        ),
        "tests": '''
def T(name, cond):
    print("TEST PASS" if cond else "TEST FAIL", name)
def valid_order(res, n, edges):
    if res is None: return False
    if sorted(res) != list(range(n)): return False
    pos = {v:i for i,v in enumerate(res)}
    return all(pos[u] < pos[v] for u,v in edges)
T("linear", valid_order(topo_sort(3,[(0,1),(1,2)]),3,[(0,1),(1,2)]))
T("diamond", valid_order(topo_sort(4,[(0,1),(0,2),(1,3),(2,3)]),4,[(0,1),(0,2),(1,3),(2,3)]))
T("cycle", topo_sort(2,[(0,1),(1,0)]) is None)
T("selfloop", topo_sort(1,[(0,0)]) is None)
T("empty", valid_order(topo_sort(0,[]),0,[]) or topo_sort(0,[])==[])
T("isolated", valid_order(topo_sort(3,[]),3,[]))
T("partial_cycle", topo_sort(4,[(0,1),(1,2),(2,1)]) is None)
T("disconnected", valid_order(topo_sort(4,[(0,1),(2,3)]),4,[(0,1),(2,3)]))
''',
    },
    {
        "id": "median",
        "title": "Median dua sorted array (O(log))",
        "prompt": (
            "Tulis fungsi Python `find_median_sorted(a: list, b: list) -> float` yang mengembalikan "
            "median gabungan dua array yang sudah terurut menaik. Bila gabungan berjumlah genap, "
            "kembalikan rata-rata dua nilai tengah. Salah satu (atau kedua) array boleh kosong; "
            "bila keduanya kosong kembalikan 0. Wajib O(log(min(len(a), len(b)))) — jangan "
            "menggabungkan lalu mengurutkan."
        ),
        "tests": '''
def T(name, cond):
    print("TEST PASS" if cond else "TEST FAIL", name)
T("odd", find_median_sorted([1,3],[2]) == 2.0)
T("even", find_median_sorted([1,2],[3,4]) == 2.5)
T("empty_a", find_median_sorted([],[1,2,3,4]) == 2.5)
T("empty_b", find_median_sorted([1,2,3,4],[]) == 2.5)
T("both_empty", find_median_sorted([],[]) == 0)
T("single", find_median_sorted([5],[]) == 5.0)
T("diff_len", find_median_sorted([1,3,8,9,15],[7,11,18,19,21,25]) == 11.0)
T("overlap", find_median_sorted([2,4,6],[1,3,5]) == 3.5)
''',
    },
    {
        "id": "expr",
        "title": "Parser & evaluator ekspresi aritmetika",
        "prompt": (
            "Tulis fungsi Python `evaluate(expr: str) -> float` yang menghitung ekspresi aritmetika "
            "dengan +, -, *, /, tanda kurung (), dan bilangan bulat/desimal. Hormati prioritas "
            "operator dan tanda minus uner, mis. '-3+2' dan '2*-3'. Spasi boleh diabaikan. "
            "Pembagian memakai pembagian float biasa. Ekspresi diasumsikan selalu valid."
        ),
        "tests": '''
def T(name, cond):
    print("TEST PASS" if cond else "TEST FAIL", name)
T("add", evaluate("1+2") == 3)
T("prec", evaluate("2+3*4") == 14)
T("paren", evaluate("(2+3)*4") == 20)
T("minus", evaluate("-3+2") == -1)
T("unary_mul", evaluate("2*-3") == -6)
T("nested", evaluate("2*(3+(4-1))") == 12)
T("div", abs(evaluate("10/4") - 2.5) < 1e-9)
T("decimal", abs(evaluate("1.5+2.5") - 4.0) < 1e-9)
T("space", evaluate(" 8 / 2 + 1 ") == 5)
T("double_neg", evaluate("-(-5)") == 5)
''',
    },
    {
        "id": "interval",
        "title": "Gabung interval yang tumpang tindih",
        "prompt": (
            "Tulis fungsi Python `merge_intervals(intervals: list) -> list` yang menggabungkan "
            "daftar interval tertutup [start, end] yang saling tumpang tindih atau bersentuhan "
            "(mis. [1,3] dan [3,5] dianggap bergabung menjadi [1,5]), lalu kembalikan daftar "
            "yang terurut menaik. Interval bersarang juga harus ditangani, mis. [1,10] menelan [2,3]. "
            "Input tidak dijamin terurut. Jangan memodifikasi list masukan."
        ),
        "tests": '''
def T(name, cond):
    print("TEST PASS" if cond else "TEST FAIL", name)
T("basic", merge_intervals([[1,3],[2,6],[8,10],[15,18]]) == [[1,6],[8,10],[15,18]])
T("touching", merge_intervals([[1,3],[3,5]]) == [[1,5]])
T("nested", merge_intervals([[1,10],[2,3]]) == [[1,10]])
T("unsorted", merge_intervals([[5,6],[1,2],[2,3]]) == [[1,3],[5,6]])
T("single", merge_intervals([[7,9]]) == [[7,9]])
T("empty", merge_intervals([]) == [])
T("no_merge", merge_intervals([[1,2],[4,5]]) == [[1,2],[4,5]])
arr = [[1,3],[2,6]]
_ = merge_intervals(arr)
T("no_mutate", arr == [[1,3],[2,6]])
''',
    },
    {
        "id": "wordbreak",
        "title": "Pemenggalan kata (word break) + rekonstruksi",
        "prompt": (
            "Tulis fungsi Python `word_break(s: str, words: list) -> str` yang mengembalikan SATU "
            "cara memenggal string `s` menjadi rangkaian kata dari `words` (dipisah spasi), atau "
            "string kosong '' bila tidak ada. Setiap kata di `words` boleh dipakai berkali-kali. "
            "Bila `s` kosong, kembalikan '' (string kosong). Contoh: word_break('catsanddog', "
            "['cat','cats','and','dog','sand']) -> salah satu dari 'cat sand dog' atau 'cats and dog'."
        ),
        "tests": '''
def T(name, cond):
    print("TEST PASS" if cond else "TEST FAIL", name)
def ok(s, words, out):
    if out == "": return False
    parts = out.split(" ")
    return "".join(parts) == s and all(p in words for p in parts)
T("basic", ok("catsanddog", ["cat","cats","and","dog","sand"], word_break("catsanddog", ["cat","cats","and","dog","sand"])))
T("simple", word_break("leetcode", ["leet","code"]) == "leet code")
T("none", word_break("catsandog", ["cats","dog","sand","and","cat"]) == "")
T("empty_s", word_break("", ["a"]) == "")
T("repeat", ok("aaaa", ["a"], word_break("aaaa", ["a"])))
T("overlap_choice", ok("pineapplepenapple", ["apple","pen","applepen","pine","pineapple"], word_break("pineapplepenapple", ["apple","pen","applepen","pine","pineapple"])))
T("no_words", word_break("abc", []) == "")
T("single_word", word_break("abc", ["abc"]) == "abc")
''',
    },
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="deepseek-v4-pro,deepseek-v4.1-flash")
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default="/srv/rakit/tools/bench_result.json")
    ap.add_argument("--temperature", type=float, default=0.0)
    args = ap.parse_args()

    env = load_env()
    base, key = env["AI_BASE_URL"].rstrip("/"), env["AI_API_KEY"]
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    cases = [c for c in CASES if (not args.only or c["id"] == args.only)]

    results = {}
    for model in models:
        results[model] = {}
        print(f"\n{'='*70}\nMODEL: {model}\n{'='*70}")
        for c in cases:
            r = call_model(base, key, model, c["prompt"], temperature=args.temperature)
            if not r["ok"]:
                print(f"  [{c['id']:12s}] ERROR: {r['error'][:160]}")
                results[model][c["id"]] = {"status": "error", "error": r["error"]}
                continue
            code = extract_code(r["text"])
            if not code:
                print(f"  [{c['id']:12s}] tidak ada kode")
                results[model][c["id"]] = {"status": "empty", "latency_s": r["latency_s"]}
                continue
            h = run_harness(code, c["tests"])
            print(f"  [{c['id']:12s}] {h['passed']}/{h['total']} lulus "
                  f"{'✓ SEMPURNA' if h['all_pass'] else '✗'}  "
                  f"({r['latency_s']}s, in={r['in_tokens']} out={r['out_tokens']})")
            results[model][c["id"]] = {
                "status": "ok", "passed": h["passed"], "total": h["total"],
                "all_pass": h["all_pass"], "latency_s": r["latency_s"],
                "in_tokens": r["in_tokens"], "out_tokens": r["out_tokens"],
                "code": code, "raw_out": h["raw"],
            }
            time.sleep(1)  # jaga rate limit

    # ringkasan
    print(f"\n{'='*70}\nRINGKASAN\n{'='*70}")
    summary = {}
    for model in models:
        rows = results[model]
        solved = sum(1 for c in cases if rows.get(c["id"], {}).get("all_pass"))
        total_tests = sum(rows.get(c["id"], {}).get("passed", 0) for c in cases)
        total_pos = sum(rows.get(c["id"], {}).get("total", 0) for c in cases)
        lat = [rows[c["id"]]["latency_s"] for c in cases if "latency_s" in rows.get(c["id"], {})]
        avg_lat = round(sum(lat)/len(lat), 2) if lat else None
        summary[model] = {"solved": solved, "n_cases": len(cases),
                          "tests_passed": total_tests, "tests_total": total_pos,
                          "avg_latency_s": avg_lat}
        print(f"  {model:24s} soal sempurna: {solved}/{len(cases)}  "
              f"tes: {total_tests}/{total_pos}  rata-rata {avg_lat}s")

    with open(args.out, "w") as f:
        json.dump({"summary": summary, "results": results, "cases": [c["id"] for c in cases]},
                  f, indent=2, ensure_ascii=False)
    print(f"\nHasil disimpan: {args.out}")


if __name__ == "__main__":
    main()
