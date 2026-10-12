#!/usr/bin/env python3
"""Render a 1200x630 social card per episode into src/img/og/ (needs Google Chrome; run on the Mac).
  python3 tools/make_og.py          # only episodes missing a card
  python3 tools/make_og.py --all"""
import glob, html, json, os, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
site = json.load(open(os.path.join(ROOT, "content/site.json"))); shows = {s["slug"]: s for s in site["shows"]}
out_dir = os.path.join(ROOT, "src/img/og"); os.makedirs(out_dir, exist_ok=True)
for f in sorted(glob.glob(os.path.join(ROOT, "content/episodes/*/*.json"))):
    if f.endswith(".meta.json"): continue
    ep = json.load(open(f)); s = shows[ep["show"]]
    out = os.path.join(out_dir, f"{ep['show']}-{ep['slug']}.jpg")
    if os.path.exists(out) and "--all" not in sys.argv: continue
    cover = os.path.join(ROOT, f"src/img/{ep['show']}-cover-800.jpg")
    t = html.escape(ep["title"]); size = 76 if len(ep["title"]) < 34 else 62 if len(ep["title"]) < 52 else 52
    page = f"""<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Inter:wght@600;700&display=swap" rel="stylesheet">
<style>*{{margin:0;box-sizing:border-box}}body{{width:1200px;height:630px;overflow:hidden;font-family:Inter;color:#fff;position:relative;
background:radial-gradient(700px 420px at 0% 0%,{s['accent']}55,transparent 65%),radial-gradient(600px 500px at 110% 120%,rgba(233,1,2,.35),transparent 60%),#061024}}
.brand{{position:absolute;left:64px;top:52px;display:flex;gap:12px;align-items:center;font:700 30px 'Bricolage Grotesque'}}
.brand b{{color:#ff5b3a}}.dot{{width:16px;height:16px;border-radius:50%;background:#ff5b3a;box-shadow:0 0 0 7px rgba(255,91,58,.25)}}
.ep{{position:absolute;left:64px;top:150px;width:660px;font:700 22px Inter;letter-spacing:.14em;text-transform:uppercase;color:{s['accent']}}}
h1{{position:absolute;left:64px;top:196px;width:660px;font:800 {size}px/1.02 'Bricolage Grotesque';letter-spacing:-.035em}}
.by{{position:absolute;left:64px;bottom:56px;font:600 24px Inter;color:#9aa8bf}}
.play{{position:absolute;left:64px;bottom:120px;display:flex;gap:14px;align-items:center;font:700 24px Inter}}
.play i{{width:64px;height:64px;border-radius:50%;background:#fff;display:grid;place-items:center}}
.play i:after{{content:"";border-left:22px solid #061024;border-top:14px solid transparent;border-bottom:14px solid transparent;margin-left:6px}}
img.logo{{position:absolute;left:64px;top:50px;height:48px;width:auto;border-radius:0;box-shadow:none}}
img{{position:absolute;right:64px;top:105px;width:420px;height:420px;border-radius:24px;box-shadow:0 30px 60px rgba(0,0,0,.6)}}</style></head><body>
<img class="logo" src="file://{ROOT}/src/img/logo-header.png">
<div class="ep">{html.escape(s['title'])} · Ep. {ep['number']}</div><h1>{t}</h1>
<div class="play"><i></i>Listen · {round(ep['duration']) if ep['duration'] < 90 else round(ep['duration']/60)} {'sec' if ep['duration'] < 90 else 'min'}</div>
<div class="by">with Joe · Champion Auto Finance</div><img src="file://{cover}"></body></html>"""
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as h: h.write(page)
    png = out[:-4] + ".png"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--window-size=1200,630",
                    "--virtual-time-budget=4000", f"--screenshot={png}", "file://" + h.name], capture_output=True)
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "85", png, "--out", out], capture_output=True)
    os.remove(png); os.remove(h.name); print("og:", os.path.basename(out))

def brand_cards():
    cards = {f"{sl}-og.jpg": (f"src/img/{sl}-cover-800.jpg", sh["title"], sh["subtitle"]) for sl, sh in shows.items()}
    for name, (cov, title, sub) in cards.items():
        page = f"""<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=Inter:wght@600&display=swap" rel="stylesheet">
<style>*{{margin:0}}body{{width:1200px;height:630px;overflow:hidden;position:relative;color:#fff;font-family:Inter;background:#061024}}
.bg{{position:absolute;inset:-40px;background:url(file://{ROOT}/{cov}) center/cover;filter:blur(40px) brightness(.35)}}
.c{{position:absolute;right:70px;top:65px;width:500px;height:500px;border-radius:24px;box-shadow:0 30px 70px rgba(0,0,0,.7)}}
.l{{position:absolute;left:70px;top:70px;height:56px}}h1{{position:absolute;left:70px;top:230px;width:520px;font:800 72px/1 'Bricolage Grotesque';letter-spacing:-.03em}}
p{{position:absolute;left:70px;top:{230+ (160 if len(title) > 14 else 90)}px;width:520px;font:600 28px/1.3 Inter;color:#c9d3e4}}.by{{position:absolute;left:70px;bottom:70px;font:600 22px Inter;color:#9aa8bf;letter-spacing:.12em;text-transform:uppercase}}</style></head><body>
<div class="bg"></div><img class="l" src="file://{ROOT}/src/img/logo-header.png"><h1>{html.escape(title)}</h1><p>{html.escape(sub)}</p><div class="by">A podcast by Champion Auto Finance</div><img class="c" src="file://{ROOT}/{cov}"></body></html>"""
        shoot(page, os.path.join(ROOT, "src/img", name))
    page = f"""<!doctype html><html><head><meta charset="utf-8"><style>*{{margin:0}}body{{width:1200px;height:630px;overflow:hidden;position:relative;
background:radial-gradient(700px 420px at 95% -10%,rgba(233,1,2,.45),transparent 60%),radial-gradient(600px 500px at -10% 110%,rgba(61,139,255,.4),transparent 60%),#061024}}
.l{{position:absolute;left:70px;top:70px;width:640px}}.c{{position:absolute;bottom:70px;width:250px;height:250px;border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.6)}}</style></head><body>
<img class="l" src="file://{ROOT}/src/img/logo-full-white.png"><img class="c" style="left:70px" src="file://{ROOT}/src/img/lease-end-minute-cover-800.jpg"><img class="c" style="left:345px" src="file://{ROOT}/src/img/keys-or-keep-cover-800.jpg"></body></html>"""
    shoot(page, os.path.join(ROOT, "src/img/og-default.jpg"))


def shoot(page, out):
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as h: h.write(page)
    png = out[:-4] + ".png"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--window-size=1200,630",
                    "--virtual-time-budget=4000", f"--screenshot={png}", "file://" + h.name], capture_output=True)
    subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "85", png, "--out", out], capture_output=True)
    os.remove(png); os.remove(h.name); print("card:", os.path.basename(out))


brand_cards()
