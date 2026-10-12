#!/usr/bin/env python3
"""Drip-feed producer: render, align, import and publish every queued episode (runs on the Mac).

  python3 tools/produce.py [~/caf-podcast/queue.json]

For each queue entry not yet in content/episodes/: render the script in Joe's voice
(~/caf-podcast/gen.py, paragraph-cached), check the related-guide link returns 200, write the
.meta.json, import with word-level alignment, make the share card, build, then commit + push.
Episodes carry future dates, so they stay hidden until the daily 6:05 AM ET build publishes them.
Safe to re-run: finished episodes are skipped.
"""
import json, os, subprocess, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POD = os.path.expanduser("~/caf-podcast")
QUEUE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(POD, "queue.json")


def run(cmd, cwd=None):
    print("  $", " ".join(cmd[:4]), "...", flush=True)
    subprocess.run(cmd, cwd=cwd, check=True)


def link_ok(url):
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "leaseendlive-producer"})
        return urllib.request.urlopen(req, timeout=20).status == 200
    except Exception:
        return False


def push(msg):
    tok = subprocess.run(["gh", "auth", "token", "-u", "holdsudo"], capture_output=True, text=True, check=True).stdout.strip()
    run(["git", "add", "-A"], cwd=ROOT)
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode == 0:
        return
    run(["git", "commit", "-q", "-m", msg + "\n\nCo-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"], cwd=ROOT)
    helper = f"!f(){{ echo username=x-access-token; echo password={tok}; }}; f"
    run(["git", "-c", "credential.helper=", "-c", f"credential.helper={helper}", "push", "-q"], cwd=ROOT)


for e in json.load(open(QUEUE)):
    out = os.path.join(ROOT, "content/episodes", e["show"], e["slug"] + ".json")
    if os.path.exists(out):
        continue
    print(f"\n=== {e['show']} #{e['number']} {e['date'][:10]}  {e['title']}", flush=True)
    script = os.path.join(POD, e["script"])
    base = os.path.splitext(os.path.basename(script))[0]
    show_dir = os.path.dirname(script)
    run(["python3", os.path.join(POD, "gen.py"), os.path.basename(script), base], cwd=show_dir)
    meta = dict(e.get("meta", {}))
    meta["links"] = [l for l in meta.get("links", []) if link_ok(l[1])][:1]
    json.dump(meta, open(out[:-5] + ".meta.json", "w"), indent=1)
    run(["python3", "tools/import_episode.py", e["show"], str(e["number"]), e["date"], e["slug"],
         os.path.join(show_dir, base + ".mp3"), "--script", script, "--title", e["title"], "--summary", e["summary"]], cwd=ROOT)
    run(["python3", "tools/make_og.py"], cwd=ROOT)
    run(["python3", "build.py", "--preview"], cwd=ROOT)      # fails loudly if anything is malformed
    push(f"Queue {e['show']} #{e['number']} for {e['date'][:10]}: {e['title']}")
print("\nqueue complete", flush=True)
