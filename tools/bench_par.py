
import json, sys, time, importlib.util, concurrent.futures as cf
spec=importlib.util.spec_from_file_location("b","/srv/rakit/tools/bench_model.py")
b=importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
env=b.load_env(); base,key=env["AI_BASE_URL"].rstrip("/"),env["AI_API_KEY"]
models=open("/srv/rakit/tools/models.txt").read().strip().split(",")
out=open("/srv/rakit/tools/bench_all.jsonl","w")
lock=__import__("threading").Lock()

def work(m,c):
    r=b.call_model(base,key,m,c["prompt"],temperature=0.0,max_tokens=6000,timeout=90)
    if not r["ok"]:
        return {"model":m,"case":c["id"],"status":"error","error":r["error"][:150],"latency":r["latency_s"]}
    code=b.extract_code(r["text"])
    h=b.run_harness(code,c["tests"]) if code else {"passed":0,"total":0,"all_pass":False}
    return {"model":m,"case":c["id"],"status":"ok","passed":h["passed"],"total":h["total"],
            "all_pass":h["all_pass"],"latency":r["latency_s"],
            "in":r["in_tokens"],"out":r["out_tokens"]}

jobs=[(m,c) for m in models for c in b.CASES]
done=0
with cf.ThreadPoolExecutor(max_workers=6) as ex:
    futs={ex.submit(work,m,c):(m,c) for m,c in jobs}
    for f in cf.as_completed(futs):
        res=f.result(); done+=1
        with lock:
            out.write(json.dumps(res)+"\n"); out.flush()
        m,c=futs[f]
        flag="OK " if res.get("all_pass") else ("ERR" if res["status"]!="ok" else "   ")
        if res["status"]=="ok":
            print(f"[{done}/{len(jobs)}] {flag} {m:20s} {res['case']:12s} {res['passed']}/{res['total']} {res['latency']}s out={res['out']}", flush=True)
        else:
            print(f"[{done}/{len(jobs)}] ERR {m:20s} {res['case']:12s} {res.get('error','')[:60]}", flush=True)
out.close()
print("SELESAI TOTAL", flush=True)
