#!/usr/bin/env python3
"""Bring a rendered episode into the site (runs on the Mac; needs ffmpeg).

  python3 tools/import_episode.py <show-slug> <number> <date> <slug> <mp3> [segments.json] \
      --title "..." --summary "..." [--notes notes.html]

<date> is when the episode goes live, ISO 8601 with offset (2026-10-13T06:00:00-04:00).
The site build hides episodes dated in the future, so a scheduled build publishes them.
Writes audio/<show>/<slug>.mp3 and content/episodes/<show>/<slug>.json (peaks for the
waveform, duration, byte size and the timed transcript).
"""
import argparse, json, os, shutil, subprocess, struct, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument("show"); ap.add_argument("number", type=int); ap.add_argument("date")
ap.add_argument("slug"); ap.add_argument("mp3"); ap.add_argument("segments", nargs="?")
ap.add_argument("--title", required=True); ap.add_argument("--summary", required=True)
ap.add_argument("--notes", help="HTML file with show notes (optional)")
a = ap.parse_args()

site = json.load(open(os.path.join(ROOT, "content/site.json")))
if a.show not in [s["slug"] for s in site["shows"]]:
    raise SystemExit(f"unknown show {a.show}")

dst = os.path.join(ROOT, "audio", a.show, a.slug + ".mp3")
shutil.copyfile(a.mp3, dst)
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                            "-of", "csv=p=0", dst], capture_output=True, text=True).stdout)

# 180 waveform bars: peak of each slice, scaled 0-100, gently compressed so speech reads well
pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", dst, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                     capture_output=True).stdout
n = len(pcm) // 2
samples = struct.unpack(f"<{n}h", pcm[:n * 2])
BARS = 180; step = max(1, n // BARS)
peaks = [max((abs(x) for x in samples[i * step:(i + 1) * step]), default=0) for i in range(BARS)]
top = max(peaks) or 1
peaks = [max(4, round(100 * (p / top) ** 0.7)) for p in peaks]

segs, chapter_starts = [], []
if a.segments:
    raw = json.load(open(a.segments))
    segs = [s for s in raw if not s.get("break")]
    # a chapter starts at the top of the episode and after every '---' section break
    chapter_starts = [0.0] + [raw[i + 1]["start"] for i, s in enumerate(raw[:-1]) if s.get("break") and not raw[i + 1].get("break")]

ep = {
    "show": a.show, "number": a.number, "slug": a.slug, "date": a.date,
    "title": a.title, "summary": a.summary,
    "notes_html": open(a.notes).read() if a.notes else "",
    "audio": f"audio/{a.show}/{a.slug}.mp3", "bytes": os.path.getsize(dst),
    "duration": round(dur, 2), "peaks": peaks, "segments": segs, "chapter_starts": chapter_starts,
    "guid": str(uuid.uuid5(uuid.NAMESPACE_URL, f"https://leaseendlive.com/{a.show}/{a.slug}/")),
}
out = os.path.join(ROOT, "content/episodes", a.show, a.slug + ".json")
json.dump(ep, open(out, "w"), indent=1)
print(f"{out}  {dur:.1f}s  {ep['bytes']/1e6:.2f} MB  {len(segs)} transcript segments")
