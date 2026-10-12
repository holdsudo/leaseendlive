#!/usr/bin/env python3
"""Word-level timing for the teleprompter transcript (runs on the Mac: needs ffmpeg + whisper-cli).

  python3 tools/align.py <audio.mp3> <script.txt>  ->  JSON on stdout

The displayed words always come from the script (what Joe was given to read); whisper only supplies
WHEN each word was spoken. Script words are matched to recognised words in order (difflib); words
whisper misheard or wrote differently ("eighteen thousand" vs "18,000") get times interpolated
between their matched neighbours by character length.

Output: {"segments": [{"start","end","text","words":[[word,start,end],...]}...], "chapter_starts": [...]}
Paragraphs are blank-line separated; a '---' line marks a chapter break.
"""
import difflib, json, os, re, subprocess, sys, tempfile

MODEL = os.path.expanduser("~/models/ggml-base.en.bin")
norm = lambda w: re.sub(r"[^a-z0-9]", "", w.lower())


def recognise(audio):
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, "a.wav")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", audio, "-ar", "16000", "-ac", "1", wav], check=True)
        subprocess.run(["whisper-cli", "-m", MODEL, "-f", wav, "-ml", "1", "-sow", "-oj", "-of", os.path.join(d, "w"), "-np"],
                       check=True, capture_output=True)
        out = json.load(open(os.path.join(d, "w.json")))["transcription"]
    words = []
    for t in out:
        txt = t["text"].strip()
        if not txt or txt.startswith("["): continue
        for i, part in enumerate(txt.split()):   # rare multi-word segments
            words.append((norm(part), t["offsets"]["from"] / 1000, t["offsets"]["to"] / 1000))
    return [w for w in words if w[0]]


def align(audio, script):
    blocks = [b.strip() for b in open(script).read().split("\n\n") if b.strip()]
    paras, breaks = [], []
    for b in blocks:
        if b == "---": breaks.append(len(paras)); continue
        paras.append(b.split())
    flat = [(pi, w) for pi, p in enumerate(paras) for w in p]
    rec = recognise(audio)
    times = [None] * len(flat)
    sm = difflib.SequenceMatcher(None, [norm(w) for _, w in flat], [r[0] for r in rec], autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1): times[i1 + k] = [rec[j1 + k][1], rec[j1 + k][2]]
        elif tag == "replace" and j2 > j1:
            # spread the recognised span over the script words, weighted by length
            s, e = rec[j1][1], rec[j2 - 1][2]
            lens = [max(1, len(flat[i][1])) for i in range(i1, i2)]; tot = sum(lens); t = s
            for k, i in enumerate(range(i1, i2)):
                d = (e - s) * lens[k] / tot; times[i] = [t, t + d]; t += d
    # fill words whisper skipped entirely, between known neighbours
    n = len(times); i = 0
    end_audio = rec[-1][2] if rec else 0
    while i < n:
        if times[i] is None:
            j = i
            while j < n and times[j] is None: j += 1
            s = times[i - 1][1] if i > 0 else 0.0
            e = times[j][0] if j < n else end_audio
            lens = [max(1, len(flat[k][1])) for k in range(i, j)]; tot = sum(lens); t = s
            for k in range(i, j):
                d = max(0.0, e - s) * lens[k - i] / tot; times[k] = [t, t + d]; t += d
            i = j
        else: i += 1
    for k in range(1, n):   # monotonic
        if times[k][0] < times[k - 1][0]: times[k][0] = times[k - 1][0]
        if times[k][1] < times[k][0]: times[k][1] = times[k][0]
    segs, k = [], 0
    for pi, p in enumerate(paras):
        ws = [[w, round(times[k + j][0], 2), round(times[k + j][1], 2)] for j, w in enumerate(p)]; k += len(p)
        segs.append({"start": ws[0][1], "end": ws[-1][2], "text": " ".join(p), "words": ws})
    matched = sum(b.size for b in sm.get_matching_blocks())
    return {"segments": segs, "chapter_starts": [0.0] + [segs[b]["start"] for b in breaks if b < len(segs)],
            "match_rate": round(matched / max(1, n), 3)}


if __name__ == "__main__":
    print(json.dumps(align(sys.argv[1], sys.argv[2])))
