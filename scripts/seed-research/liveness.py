#!/usr/bin/env python3
"""Polite liveness check for researched employer websites.

Usage: python3 -I liveness.py <research_dir>
Reads every slice_*.jsonl in <research_dir>, makes ONE GET per distinct website (through curl, so the
environment proxy and CA bundle are honoured), and writes <research_dir>/liveness.json:
  { "<website>": {"status": 200, "final_url": "...", "ok": true, "reason": null}, ... }
A site is "ok" unless DNS/connection fails or it returns 404/410. 401/403/429 (bot protection) count as live.
"""
import json, subprocess, sys, glob, os
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

research_dir = sys.argv[1]
sites = set()
for path in sorted(glob.glob(os.path.join(research_dir, "slice_*.jsonl"))):
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            w = (rec.get("website") or "").strip()
            if w:
                sites.add(w)

def check(url):
    try:
        out = subprocess.run(
            ["curl", "-sS", "-o", "/dev/null", "-L", "--max-time", "25", "--max-redirs", "6",
             "-A", "AJIS/1.0 (personal job-search research; one request per site)",
             "-w", "%{http_code} %{url_effective}", url],
            capture_output=True, text=True, timeout=40)
        code_s, _, final = out.stdout.strip().partition(" ")
        code = int(code_s or 0)
    except Exception as e:  # noqa: BLE001
        return url, {"status": 0, "final_url": None, "ok": False, "reason": str(e)[:200]}
    if code == 0:
        return url, {"status": 0, "final_url": None, "ok": False, "reason": (out.stderr or "connection failed").strip()[:200]}
    ok = code not in (404, 410) and code < 500
    return url, {"status": code, "final_url": final or None, "ok": ok, "reason": None if ok else f"HTTP {code}"}

# One request per host; different hosts in parallel (at most 8 at a time).
results = {}
with ThreadPoolExecutor(max_workers=8) as ex:
    for url, res in ex.map(check, sorted(sites)):
        results[url] = res
# Retry 5xx / connection failures once, sequentially, to avoid dropping sites for a transient error.
for url, res in list(results.items()):
    if not res["ok"]:
        _, again = check(url)
        if again["ok"]:
            results[url] = again
with open(os.path.join(research_dir, "liveness.json"), "w", encoding="utf-8") as f:
    json.dump(results, f, indent=1)
dead = [u for u, r in results.items() if not r["ok"]]
print(f"checked={len(results)} live={len(results) - len(dead)} dead={len(dead)}")
for u in dead[:40]:
    print("  DEAD", u, results[u]["reason"])
