#!/usr/bin/env python3
"""Build leaseendlive.com into dist/. Python standard library only, so it runs the
same on the Mac and in GitHub Actions.

  python3 build.py            # live build: episodes dated in the future are left out
  python3 build.py --preview  # include future-dated episodes (local review only)

Source of truth: content/site.json + content/episodes/<show>/*.json + audio/ + src/.
"""
import json, os, shutil, sys, html, glob, re
from datetime import datetime, timezone
from email.utils import format_datetime
from urllib.parse import quote

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")
PREVIEW = "--preview" in sys.argv
SITE = json.load(open(os.path.join(ROOT, "content/site.json")))
BASE = SITE["url"].rstrip("/")
NOW = datetime.now(timezone.utc)
E = lambda s: html.escape(str(s), quote=True)
SHOWS = {s["slug"]: s for s in SITE["shows"]}
ASSET_V = str(int(max(os.path.getmtime(p) for p in glob.glob(os.path.join(ROOT, "src/assets/*")))))

PLATFORM_LABELS = [("apple", "Apple Podcasts"), ("spotify", "Spotify"), ("youtube", "YouTube"),
                   ("amazon", "Amazon Music"), ("iheart", "iHeartRadio"), ("pocketcasts", "Pocket Casts")]


def load_episodes():
    eps = []
    for f in glob.glob(os.path.join(ROOT, "content/episodes/*/*.json")):
        if f.endswith(".meta.json"):
            continue
        ep = json.load(open(f))
        mf = f[:-5] + ".meta.json"
        if os.path.exists(mf):
            ep.update(json.load(open(mf)))
        ep.setdefault("seo_title", ep["title"]); ep.setdefault("takeaways", []); ep.setdefault("links", []); ep.setdefault("keywords", [])
        ep["chapters_resolved"] = [{"title": t, "start": st} for t, st in zip([c[0] for c in ep.get("chapters", [])], ep.get("chapter_starts", [])) if st is not None]
        ep["_dt"] = datetime.fromisoformat(ep["date"])
        if ep["_dt"] > NOW and not PREVIEW:
            continue
        s = SHOWS[ep["show"]]
        ep["url"] = f"/{ep['show']}/{ep['slug']}/"
        ep["show_title"] = s["title"]
        ep["accent"] = s["accent"]
        ep["cover"] = f"/img/{ep['show']}-cover-1400.jpg"
        ep["file_url"] = f"{BASE}/{ep['audio']}"
        # OP3 prefix: open, free, no-login download counting across every podcast app
        ep["media_url"] = (f"https://op3.dev/e,pg={s['guid']}/{BASE.split('://')[1]}/{ep['audio']}"
                           if SITE.get("op3") else ep["file_url"])
        eps.append(ep)
    eps.sort(key=lambda e: e["_dt"], reverse=True)
    return eps


def hms(sec):
    sec = int(round(sec)); h, r = divmod(sec, 3600); m, s = divmod(r, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def nice_len(sec):
    return f"{round(sec)} sec" if sec < 90 else f"{round(sec / 60)} min"


def nice_date(dt):
    return dt.strftime("%b %-d, %Y")


def write(rel, text):
    p = os.path.join(DIST, rel.lstrip("/"))
    if p.endswith("/"): p += "index.html"
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "w", encoding="utf-8").write(text)


# ---------------------------------------------------------------- page shell
def iso_dur(sec):
    sec = int(round(sec)); return f"PT{sec // 3600}H{sec % 3600 // 60}M{sec % 60}S" if sec >= 3600 else f"PT{sec // 60}M{sec % 60}S"


def crumbs_ld(crumbs):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": BASE + u} for i, (n, u) in enumerate(crumbs)]}


def layout(path, title, desc, body, *, og_image="/img/og-default.jpg", og_alt=None, jsonld=None, kind="website", feed=None,
           crumbs=None, extra_head="", keywords=None, robots="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"):
    full_title = title if SITE["name"] in title else f"{title} | {SITE['name']}"
    jsonld = list(jsonld or [])
    if crumbs: jsonld.append(crumbs_ld([("Home", "/")] + crumbs))
    v = SITE.get("verify", {})
    verify = "".join(f'<meta name="{n}" content="{E(v[k])}">' for k, n in
                     [("google", "google-site-verification"), ("bing", "msvalidate.01"), ("yandex", "yandex-verification"), ("facebook", "facebook-domain-verification")] if v.get(k))
    tw = SITE.get("twitter")
    canon = BASE + path
    feeds = "".join(f'<link rel="alternate" type="application/rss+xml" title="{E(s["title"])}" href="/feeds/{s["slug"]}.xml">'
                    for s in SITE["shows"] if not feed or s["slug"] == feed)
    ga = SITE.get("ga4_id") or ""
    nav = [("/", "Home"), ("/lease-end-minute/", "Lease End Minute"), ("/keys-or-keep/", "Keys or Keep"), ("/about/", "About Joe")]
    navhtml = "".join(f'<a href="{h}"{" aria-current=\"page\"" if (h == path or (h != "/" and path.startswith(h))) else ""}>{E(t)}</a>' for h, t in nav)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{E(full_title)}</title>
<meta name="description" content="{E(desc)}">
<meta name="robots" content="{robots}">
<meta name="author" content="Joe, Champion Auto Finance">
<meta name="publisher" content="Champion Auto Finance">
{f'<meta name="keywords" content="{E(", ".join(keywords))}">' if keywords else ''}
<link rel="canonical" href="{E(canon)}">
<meta property="og:type" content="{kind}">
<meta property="og:site_name" content="{E(SITE['name'])}">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="{E(title)}">
<meta property="og:description" content="{E(desc)}">
<meta property="og:url" content="{E(canon)}">
<meta property="og:image" content="{BASE}{og_image}">
<meta property="og:image:secure_url" content="{BASE}{og_image}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{E(og_alt or title)}">
<link rel="image_src" href="{BASE}{og_image}">
<meta itemprop="name" content="{E(title)}">
<meta itemprop="description" content="{E(desc)}">
<meta itemprop="image" content="{BASE}{og_image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{E(title)}">
<meta name="twitter:description" content="{E(desc)}">
<meta name="twitter:image" content="{BASE}{og_image}">
<meta name="twitter:image:alt" content="{E(og_alt or title)}">
{f'<meta name="twitter:site" content="{E(tw)}">' if tw else ''}
{extra_head}
{verify}
<meta name="theme-color" content="#081226">
<meta name="color-scheme" content="dark">
<meta name="application-name" content="Lease End Live">
<meta name="apple-mobile-web-app-title" content="Lease End Live">
<meta name="format-detection" content="telephone=no">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/img/favicon-32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/img/favicon-48.png" type="image/png" sizes="48x48">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="sitemap" type="application/xml" href="/sitemap.xml">
<link rel="author" href="/about/">
<link rel="me" href="https://championautofinance.com/">
{feeds}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/site.css?v={ASSET_V}">
<script>window.LEL={{ga:"{E(ga)}",ask:"{E(SITE['ask_endpoint'])}"}};</script>
<script defer src="/assets/analytics.js?v={ASSET_V}"></script>
<script defer src="/assets/app.js?v={ASSET_V}"></script>
{"".join(f'<script type="application/ld+json">{json.dumps(j, ensure_ascii=False)}</script>' for j in jsonld)}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap top-in">
    <a class="logo" href="/" aria-label="Lease End Live home"><img src="/img/logo-header.png" alt="Lease End Live" width="607" height="96"></a>
    <nav class="nav" aria-label="Main">{navhtml}</nav>
    <a class="btn btn-sm btn-live" href="/ask/" data-track="cta_ask_header">Ask Joe</a>
    <button class="menu-btn" aria-label="Menu" aria-expanded="false" aria-controls="mnav"><span></span><span></span></button>
  </div>
  <nav id="mnav" class="mnav" aria-label="Mobile">{navhtml}<a href="/ask/">Ask Joe a question</a></nav>
</header>
<main id="main" data-path="{E(path)}">
{body}
</main>
<footer class="foot">
  <div class="wrap foot-grid">
    <div>
      <a class="logo logo-foot" href="/"><img src="/img/logo-full-white.png" alt="Lease End Live: Lease End Minute and Keys or Keep, by Champion Auto Finance" width="1200" height="364" loading="lazy"></a>
      <p class="muted small">Podcasts from <a href="{E(SITE['company']['url'])}" data-track="cta_company" rel="noopener">Champion Auto Finance</a>, hosted by Joe, Managing Director.</p>
    </div>
    <div>
      <h4>Listen</h4>
      <a href="/lease-end-minute/">The Lease End Minute</a><a href="/keys-or-keep/">Keys or Keep</a>
      <a href="/feeds/lease-end-minute.xml">Lease End Minute RSS</a><a href="/feeds/keys-or-keep.xml">Keys or Keep RSS</a>
    </div>
    <div>
      <h4>Contact</h4>
      <a href="{E(SITE['company']['phone_href'])}" data-track="cta_call">{E(SITE['company']['phone'])}</a>
      <a href="/ask/">Ask Joe a question</a><a href="/privacy/">Privacy</a>
    </div>
  </div>
  <div class="wrap fine">
    <p>{E(SITE['disclosure'])}</p>
    <p>{E(SITE['ai_disclosure'])}</p>
    <p>© {NOW.year} Champion Auto Finance.</p>
  </div>
</footer>
<div class="pbar" id="pbar" hidden>
  <div class="pbar-in wrap">
    <img class="pbar-cover" alt="" width="52" height="52">
    <div class="pbar-meta"><a class="pbar-title" href="#"></a><span class="pbar-show"></span></div>
    <div class="pbar-ctl">
      <button class="ic" data-act="back" aria-label="Back 15 seconds"><svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="16.5" text-anchor="middle" font-size="6.5" font-weight="700">15</text></svg></button>
      <button class="ic play" data-act="toggle" aria-label="Play"><svg class="i-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><svg class="i-pause" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg></button>
      <button class="ic" data-act="fwd" aria-label="Forward 30 seconds"><svg viewBox="0 0 24 24"><path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="16.5" text-anchor="middle" font-size="6.5" font-weight="700">30</text></svg></button>
    </div>
    <div class="pbar-seek"><span class="t-cur">0:00</span><input type="range" min="0" max="1000" value="0" aria-label="Seek"><span class="t-dur">0:00</span></div>
    <button class="chip" data-act="rate" aria-label="Playback speed">1×</button>
    <button class="ic close" data-act="close" aria-label="Close player"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none"/></svg></button>
  </div>
  <div class="pbar-progress"><i></i></div>
</div>
<audio id="lel-audio" preload="none"></audio>
</body>
</html>
"""


# ---------------------------------------------------------------- components
PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'


def play_btn(ep, label="Play", cls="btn btn-play"):
    return (f'<button class="{cls}" data-play="{E(ep["show"])}/{E(ep["slug"])}" aria-label="{E(label)}: {E(ep["title"])}">'
            f'{PLAY_SVG}<span>{E(label)}</span></button>')


def ep_row(ep):
    return f"""<li class="ep-row" style="--accent:{ep['accent']}">
  <img src="{ep['cover'].replace('-1400', '-400')}" alt="" width="64" height="64" loading="lazy">
  <div class="ep-row-main">
    <span class="eyebrow">{E(ep['show_title'])} · Ep. {ep['number']}</span>
    <a class="ep-row-title" href="{ep['url']}">{E(ep['title'])}</a>
    <p class="muted small clamp2">{E(ep['summary'])}</p>
    <span class="meta">{nice_date(ep['_dt'])} · {nice_len(ep['duration'])}</span>
  </div>
  {play_btn(ep, "Play", "btn-round")}
</li>"""


def platform_links(show, where):
    links = show.get("platforms") or {}
    items = [f'<a class="plat" href="{E(links[k])}" rel="noopener" target="_blank" data-platform="{k}" data-where="{where}" data-show="{show["slug"]}">{E(lbl)}</a>'
             for k, lbl in PLATFORM_LABELS if links.get(k)]
    items.append(f'<a class="plat" href="/feeds/{show["slug"]}.xml" data-platform="rss" data-where="{where}" data-show="{show["slug"]}">RSS feed</a>')
    return f'<div class="plats">{"".join(items)}</div>'


def waveform(ep):
    bars = "".join(f'<i style="height:{p}%"></i>' for p in ep["peaks"])
    return (f'<div class="wave" data-wave="{E(ep["show"])}/{E(ep["slug"])}" role="slider" tabindex="0" aria-label="Seek within episode" '
            f'aria-valuemin="0" aria-valuemax="{int(ep["duration"])}" aria-valuenow="0"><div class="wave-bars">{bars}</div>'
            f'<div class="wave-fill"><div class="wave-bars">{bars}</div></div></div>')


# ---------------------------------------------------------------- pages
def org_ld():
    return {"@context": "https://schema.org", "@type": ["Organization", "FinancialService"], "@id": "https://championautofinance.com/#organization",
            "name": "Champion Auto Finance", "url": "https://championautofinance.com/", "telephone": "+1-732-618-2036",
            "email": SITE["owner_email"], "logo": BASE + "/img/icon-512.png", "areaServed": "US",
            "description": "Lease buyout financing partner for drivers nationwide. Not a lender; approvals and terms are subject to lender underwriting.",
            "sameAs": SITE.get("same_as", [])}


def person_ld():
    return {"@type": "Person", "@id": BASE + "/about/#joe", "name": "Joe", "jobTitle": "Managing Director",
            "url": BASE + "/about/", "worksFor": {"@id": "https://championautofinance.com/#organization", "@type": "Organization", "name": "Champion Auto Finance"},
            "knowsAbout": ["Lease buyouts", "Auto lease payoff quotes", "Lease equity", "Auto financing"]}


def page_home(eps):
    latest = eps[0] if eps else None
    shows_html = ""
    for s in SITE["shows"]:
        se = [e for e in eps if e["show"] == s["slug"]]
        shows_html += f"""<a class="show-card" href="/{s['slug']}/" style="--accent:{s['accent']}">
  <img src="/img/{s['slug']}-cover-800.jpg" alt="{E(s['title'])} cover art" width="400" height="400" loading="lazy">
  <div><h3>{E(s['title'])}</h3><p>{E(s['subtitle'])}</p><span class="meta">{len(se)} episode{'s' if len(se) != 1 else ''} · All episodes →</span></div>
</a>"""
    hero_card = ""
    if latest:
        hero_card = f"""<div class="hero-card" style="--accent:{latest['accent']}">
  <div class="hero-card-top"><img src="{latest['cover'].replace('-1400', '-400')}" alt="" width="88" height="88">
  <div><span class="eyebrow"><span class="live-dot sm"></span> Latest · {E(latest['show_title'])}</span><a class="hero-ep-title" href="{latest['url']}">{E(latest['title'])}</a>
  <span class="meta">{nice_date(latest['_dt'])} · {nice_len(latest['duration'])}</span></div></div>
  {waveform(latest)}
  <div class="hero-card-ctl">{play_btn(latest, "Play episode")}<a class="link" href="{latest['url']}">Transcript & notes →</a></div>
</div>"""
    body = f"""
<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <span class="eyebrow">Podcasts from Champion Auto Finance</span>
      <h1>Your lease is ending.<br><span class="grad">Here's what to do about it.</span></h1>
      <p class="lead">{E(SITE['tagline'])} Quick tips in <a href="/lease-end-minute/">The Lease End Minute</a>, real questions worked through on <a href="/keys-or-keep/">Keys or Keep</a></p>
      <div class="hero-cta">{play_btn(latest, "Play the latest") if latest else ""}<a class="btn btn-ghost" href="/ask/" data-track="cta_ask_hero">Ask Joe a question</a></div>
    </div>
    {hero_card}
  </div>
</section>
<section class="wrap section"><div class="sec-head"><h2>The shows</h2></div><div class="shows">{shows_html}</div></section>
<section class="wrap section"><div class="sec-head"><h2>Latest episodes</h2></div><ul class="ep-list">{''.join(ep_row(e) for e in eps[:12])}</ul></section>
<section class="wrap section">
  <div class="band">
    <div><span class="eyebrow">Ask Joe</span><h2>Got a lease-end question?</h2><p class="muted">Send it in. Joe answers listener questions on Keys or Keep We never use your last name on air.</p></div>
    <a class="btn btn-live" href="/ask/" data-track="cta_ask_band">Send your question</a>
  </div>
</section>
<section class="wrap section about-mini">
  <div class="avatar" aria-hidden="true">J</div>
  <div><span class="eyebrow">Your host</span><h2>Joe</h2><p class="muted">{E(SITE['host']['bio'])}</p><a class="link" href="/about/">More about Joe →</a></div>
</section>"""
    ld = [{"@context": "https://schema.org", "@type": "WebSite", "@id": BASE + "/#website", "name": SITE["name"], "alternateName": "leaseendlive.com",
           "url": BASE + "/", "description": SITE["tagline"], "inLanguage": "en-US", "publisher": {"@id": "https://championautofinance.com/#organization"}},
          org_ld(), dict(person_ld(), **{"@context": "https://schema.org"}),
          {"@context": "https://schema.org", "@type": "ItemList", "name": "Lease End Live podcasts", "itemListElement": [
              {"@type": "ListItem", "position": i + 1, "url": f"{BASE}/{s['slug']}/", "name": s["title"]} for i, s in enumerate(SITE["shows"])]}]
    return layout("/", "Lease End Live: Lease Buyout Podcast with Joe from Champion Auto Finance",
                  "Free lease buyout podcasts: should you buy your leased car or hand back the keys? Short tips on The Lease End Minute and listener Q&A on Keys or Keep, from Joe, Managing Director at Champion Auto Finance.",
                  body, jsonld=ld, og_alt="Lease End Live: lease buyout podcasts with Joe")


def page_show(s, eps):
    se = [e for e in eps if e["show"] == s["slug"]]
    body = f"""
<section class="show-hero" style="--accent:{s['accent']}">
  <div class="wrap show-hero-grid">
    <img class="show-cover" src="/img/{s['slug']}-cover-800.jpg" alt="{E(s['title'])} cover art" width="320" height="320">
    <div>
      <span class="eyebrow">A Lease End Live podcast · Hosted by Joe</span>
      <h1>{E(s['title'])}</h1>
      <p class="lead">{E(s['description'])}</p>
      <div class="hero-cta">{play_btn(se[0], "Play latest") if se else ""}</div>
      <h4 class="sub-h">Follow the show</h4>
      {platform_links(s, "show_page")}
    </div>
  </div>
</section>
<section class="wrap section"><div class="sec-head"><h2>All episodes</h2><span class="meta">{len(se)} total</span></div><ul class="ep-list">{''.join(ep_row(e) for e in se) or '<li class="muted">First episode coming soon.</li>'}</ul></section>"""
    ld = [{"@context": "https://schema.org", "@type": "PodcastSeries", "@id": f"{BASE}/{s['slug']}/#series", "name": s["title"],
           "alternateName": s.get("seo_title", s["title"]), "description": s["description"], "abstract": s["subtitle"],
           "url": f"{BASE}/{s['slug']}/", "image": f"{BASE}/img/{s['slug']}-cover-1400.jpg", "webFeed": f"{BASE}/feeds/{s['slug']}.xml",
           "inLanguage": "en-US", "genre": ["Personal finance", "Automotive"], "isAccessibleForFree": True,
           "identifier": {"@type": "PropertyValue", "propertyID": "podcast:guid", "value": s["guid"]},
           "numberOfEpisodes": len(se), "startDate": se[-1]["date"] if se else None,
           "author": person_ld(), "creator": person_ld(), "publisher": org_ld(),
           "episode": [{"@type": "PodcastEpisode", "name": e["title"], "url": BASE + e["url"], "datePublished": e["date"], "episodeNumber": e["number"]} for e in se]}]
    return layout(f"/{s['slug']}/", s.get("seo_title", s["title"]), s["description"][:300], body, og_image=f"/img/{s['slug']}-og.jpg",
                  og_alt=f"{s['title']} podcast cover", jsonld=ld, feed=s["slug"], crumbs=[(s["title"], f"/{s['slug']}/")],
                  keywords=s.get("keywords"))


def page_episode(ep, eps):
    s = SHOWS[ep["show"]]
    se = [e for e in eps if e["show"] == ep["show"]]
    i = se.index(ep)
    newer, older = (se[i - 1] if i > 0 else None), (se[i + 1] if i + 1 < len(se) else None)
    def para(g):
        words = g.get("words")
        body = " ".join(f'<span class="w" data-s="{w[1]}">{E(w[0])}</span>' for w in words) if words else E(g["text"])
        return f'<p data-start="{g["start"]}" data-end="{g["end"]}"><button class="ts" data-seek="{g["start"]}" aria-label="Play from {hms(g["start"])}">{hms(g["start"])}</button> {body}</p>'
    tr = "".join(para(g) for g in ep["segments"])
    nav = ""
    if older: nav += f'<a class="ep-nav prev" href="{older["url"]}"><span class="meta">← Previous</span>{E(older["title"])}</a>'
    if newer: nav += f'<a class="ep-nav next" href="{newer["url"]}"><span class="meta">Next →</span>{E(newer["title"])}</a>'
    more = [e for e in se if e is not ep][:3] + [e for e in eps if e["show"] != ep["show"]][:2]
    share = quote(BASE + ep["url"])
    embed_url = f"{BASE}/embed{ep['url']}"
    embed_code = f'<iframe src="{embed_url}" width="100%" height="180" frameborder="0" loading="lazy" title="{E(ep["title"])} | {E(ep["show_title"])}"></iframe>'
    take = "".join(f"<li>{E(t)}</li>" for t in ep["takeaways"])
    chaps = "".join(f'<li><button class="ts" data-seek="{c["start"]}">{hms(c["start"])}</button> {E(c["title"])}</li>' for c in ep["chapters_resolved"])
    # One contextual link to championautofinance.com per episode, no more (no link-farm footprint).
    guides = "".join(f'<li><a href="{E(u)}" data-track="guide_link">{E(n)}</a></li>' for n, u in ep["links"][:1])
    og = f"/img/og/{ep['show']}-{ep['slug']}.jpg"
    if not os.path.exists(os.path.join(ROOT, "src", og.lstrip("/"))): og = f"/img/{ep['show']}-og.jpg"
    body = f"""
<article class="ep" style="--accent:{ep['accent']}" data-episode="{E(ep['show'])}/{E(ep['slug'])}">
  <section class="ep-hero">
    <div class="wrap ep-hero-grid">
      <img class="show-cover" src="{ep['cover'].replace('-1400', '-800')}" alt="{E(ep['show_title'])} podcast cover art" width="280" height="280">
      <div>
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/{ep['show']}/">{E(ep['show_title'])}</a> / <span>Episode {ep['number']}</span></nav>
        <h1>{E(ep['title'])}</h1>
        <p class="dek">{E(ep['seo_title']) if ep['seo_title'] != ep['title'] else ''}</p>
        <p class="lead">{E(ep['summary'])}</p>
        <span class="meta"><time datetime="{ep['date']}">{nice_date(ep['_dt'])}</time> · {nice_len(ep['duration'])} · Hosted by <a href="/about/" rel="author">Joe</a>, Managing Director at Champion Auto Finance</span>
        <div class="ep-player">{play_btn(ep, "Play episode", "btn btn-play big")}{waveform(ep)}<span class="wave-time"><span class="t-cur">0:00</span> / {hms(ep['duration'])}</span></div>
        <div class="share">
          <button class="chip" data-share="copy">Copy link</button>
          <button class="chip" data-share="time">Share at current time</button>
          <a class="chip" data-share="x" href="https://twitter.com/intent/tweet?url={share}&text={quote(ep['title'])}" target="_blank" rel="noopener">Post on X</a>
          <a class="chip" data-share="facebook" href="https://www.facebook.com/sharer/sharer.php?u={share}" target="_blank" rel="noopener">Facebook</a>
          <a class="chip" data-share="linkedin" href="https://www.linkedin.com/sharing/share-offsite/?url={share}" target="_blank" rel="noopener">LinkedIn</a>
          <a class="chip" data-share="download" href="{E(ep['file_url'])}" download>Download MP3</a>
          <button class="chip" data-share="embed" data-code="{E(embed_code)}">Embed</button>
        </div>
      </div>
    </div>
  </section>
  <div class="wrap ep-body">
    <div class="ep-main">
      {f'<section class="takeaways"><h2>Key takeaways</h2><ul class="ticks">{take}</ul></section>' if take else ''}
      {f'<section class="chapters"><h2>Chapters</h2><ol class="chap-list">{chaps}</ol></section>' if chaps else ''}
      {('<section class="notes"><h2>Show notes</h2>' + ep['notes_html'] + '</section>') if ep.get('notes_html') else ''}
      <section class="transcript" id="transcript">
        <div class="sec-head"><h2>Full transcript</h2><div class="tr-tools"><label class="follow"><input type="checkbox" checked data-follow> Follow along</label><button class="chip" data-tr-expand aria-expanded="false">Expand</button></div></div>
        <p class="tr-hint muted small">Press play and the transcript follows along word by word. Tap any word to jump there.</p>
        <div class="tr-body" tabindex="0" aria-label="Episode transcript">{tr or '<p class="muted">Transcript coming soon.</p>'}</div>
      </section>
      {f'<section class="guides"><h2>Related guide</h2><ul class="ticks">{guides}</ul></section>' if guides else ''}
      <p class="fine-sm">{E(SITE['disclosure'])} {E(SITE['ai_disclosure'])}</p>
      <nav class="ep-navs" aria-label="More from this show">{nav}</nav>
    </div>
    <aside class="ep-side">
      <div class="side-card"><h4>Follow {E(s['title'])}</h4>{platform_links(s, "episode_page")}</div>
      <div class="side-card cta-card"><h4>Thinking about buying out your lease?</h4><p class="muted small">Champion Auto Finance helps arrange financing for drivers buying the car they already lease, nationwide.</p>
        <a class="btn btn-live btn-block" href="{E(SITE['company']['quote_url'])}&utm_campaign={E(ep['show'])}&utm_content={E(ep['slug'])}" data-track="cta_quote_episode" rel="nofollow noopener">Get a buyout quote</a>
        <p class="fine-sm">Not a lender. Approvals and terms are subject to lender underwriting.</p></div>
      <div class="side-card"><h4>Have a question?</h4><p class="muted small">Joe may answer it on the show.</p><a class="link" href="/ask/">Ask Joe →</a></div>
    </aside>
  </div>
  <section class="wrap section"><div class="sec-head"><h2>Keep listening</h2></div><ul class="ep-list">{''.join(ep_row(e) for e in more)}</ul></section>
</article>"""
    transcript_text = " ".join(g["text"] for g in ep["segments"])
    audio_obj = {"@type": "AudioObject", "contentUrl": ep["file_url"], "embedUrl": embed_url, "encodingFormat": "audio/mpeg",
                 "duration": iso_dur(ep["duration"]), "contentSize": f"{ep['bytes']} B", "name": ep["title"],
                 "uploadDate": ep["date"], "inLanguage": "en-US"}
    if transcript_text: audio_obj["transcript"] = transcript_text
    ld = [{"@context": "https://schema.org", "@type": "PodcastEpisode", "@id": BASE + ep["url"] + "#episode",
           "name": ep["title"], "alternativeHeadline": ep["seo_title"], "headline": ep["seo_title"], "description": ep["summary"],
           "abstract": " ".join(ep["takeaways"]) or ep["summary"], "keywords": ", ".join(ep["keywords"]),
           "url": BASE + ep["url"], "datePublished": ep["date"], "dateModified": ep.get("modified", ep["date"]),
           "episodeNumber": ep["number"], "timeRequired": iso_dur(ep["duration"]), "inLanguage": "en-US",
           "image": BASE + ep["cover"], "thumbnailUrl": BASE + ep["cover"].replace("-1400", "-400"),
           "associatedMedia": audio_obj, "audio": audio_obj,
           "isAccessibleForFree": True, "about": [{"@type": "Thing", "name": k} for k in ep["keywords"]],
           "partOfSeries": {"@type": "PodcastSeries", "@id": f"{BASE}/{s['slug']}/#series", "name": s["title"], "url": f"{BASE}/{s['slug']}/", "webFeed": f"{BASE}/feeds/{s['slug']}.xml"},
           "author": person_ld(), "creator": person_ld(), "actor": person_ld(), "publisher": org_ld(),
           "potentialAction": {"@type": "ListenAction", "target": BASE + ep["url"]}}]
    if ep["chapters_resolved"]:
        ld[0]["hasPart"] = [{"@type": "Clip", "name": c["title"], "startOffset": int(c["start"]), "url": f"{BASE}{ep['url']}?t={int(c['start'])}"} for c in ep["chapters_resolved"]]
    extra = (f'<meta property="og:audio" content="{E(ep["file_url"])}"><meta property="og:audio:secure_url" content="{E(ep["file_url"])}"><meta property="og:audio:type" content="audio/mpeg">'
             f'<meta property="article:published_time" content="{ep["date"]}"><meta property="article:modified_time" content="{ep.get("modified", ep["date"])}">'
             f'<meta property="article:author" content="{BASE}/about/"><meta property="article:section" content="{E(ep["show_title"])}">'
             + "".join(f'<meta property="article:tag" content="{E(k)}">' for k in ep["keywords"]) +
             f'<meta name="twitter:player" content="{embed_url}"><meta name="twitter:player:width" content="480"><meta name="twitter:player:height" content="180">'
             f'<meta name="twitter:label1" content="Listen time"><meta name="twitter:data1" content="{nice_len(ep["duration"])}">'
             f'<meta name="twitter:label2" content="Show"><meta name="twitter:data2" content="{E(ep["show_title"])}">'
             f'<link rel="alternate" type="application/json+oembed" href="{BASE}/oembed/{ep["show"]}/{ep["slug"]}.json" title="{E(ep["title"])}">')
    return layout(ep["url"], ep["seo_title"], ep["summary"], body, og_image=og, og_alt=f"{ep['title']}: {ep['show_title']} with Joe",
                  jsonld=ld, kind="article", feed=ep["show"], crumbs=[(ep["show_title"], f"/{ep['show']}/"), (ep["title"], ep["url"])],
                  extra_head=extra, keywords=ep["keywords"])


def page_about():
    body = f"""
<section class="wrap section narrow">
  <div class="about-hero"><div class="avatar xl" aria-hidden="true">J</div>
  <div><span class="eyebrow">Your host</span><h1>Joe</h1><p class="lead">{E(SITE['host']['title'])}</p></div></div>
  <p>{E(SITE['host']['bio'])}</p>
  <p>Lease End Live is where Champion Auto Finance shares what we know about the end of a car lease: how buyouts work, what the numbers mean, and how to decide whether to keep the car or hand back the keys. Two shows live here:</p>
  <ul class="ticks"><li><a href="/lease-end-minute/">The Lease End Minute</a>: one practical tip in about a minute.</li>
  <li><a href="/keys-or-keep/">Keys or Keep</a>: listener-style questions worked through step by step.</li></ul>
  <h2>How we make the show</h2>
  <p>{E(SITE['ai_disclosure'])}</p>
  <h2>About Champion Auto Finance</h2>
  <p>{E(SITE['disclosure'])}</p>
  <p><a class="btn btn-live" href="{E(SITE['company']['quote_url'])}" data-track="cta_quote_about" rel="nofollow noopener">Get a lease buyout quote</a></p>
</section>"""
    ld = [{"@context": "https://schema.org", "@type": "ProfilePage", "url": BASE + "/about/", "mainEntity": person_ld()}, org_ld()]
    return layout("/about/", "About Joe, Managing Director at Champion Auto Finance", "Meet Joe, Managing Director at Champion Auto Finance and host of The Lease End Minute and Keys or Keep, podcasts about lease buyouts.",
                  body, jsonld=ld, kind="profile", crumbs=[("About Joe", "/about/")])


def page_ask():
    opts = "".join(f'<option value="{E(s["title"])}">{E(s["title"])}</option>' for s in SITE["shows"])
    body = f"""
<section class="wrap section narrow">
  <span class="eyebrow">Ask Joe</span>
  <h1>Send Joe your lease-end question</h1>
  <p class="lead">Buying out your lease, mileage, payoff quotes, equity, what the dealer told you. Ask anything. Joe may answer it on the show.</p>
  <form class="ask" id="ask-form" novalidate>
    <div class="row2">
      <label>First name<input name="name" autocomplete="given-name" required></label>
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
    </div>
    <div class="row2">
      <label>City and state <span class="muted">(optional)</span><input name="where" autocomplete="address-level2" placeholder="e.g. Queens, NY"></label>
      <label>For which show?<select name="show">{opts}<option value="Either">Either is fine</option></select></label>
    </div>
    <label>Your question<textarea name="question" rows="6" required placeholder="My lease ends in March and..."></textarea></label>
    <label class="hp" aria-hidden="true">Company website<input name="company_website" tabindex="-1" autocomplete="off"></label>
    <p class="fine-sm">If we use your question on air we will use your first name and city only, and may shorten or edit it. Please don't include account numbers or other sensitive details. Your question goes to Champion Auto Finance (info@championautofinance.com); see our <a href="/privacy/">privacy note</a>.</p>
    <button class="btn btn-live" type="submit">Send my question</button>
    <p class="ask-status" role="status" aria-live="polite"></p>
  </form>
</section>"""
    return layout("/ask/", "Ask a Lease Buyout Question", "Send Joe your lease-end or lease buyout question. He may answer it on the Keys or Keep podcast.", body,
                  crumbs=[("Ask Joe", "/ask/")], jsonld=[{"@context": "https://schema.org", "@type": "ContactPage", "url": BASE + "/ask/", "name": "Ask Joe a question"}])


def page_privacy():
    body = f"""
<section class="wrap section narrow prose">
  <h1>Privacy</h1>
  <p>Lease End Live is run by Champion Auto Finance.</p>
  <h2>Listening statistics</h2>
  <p>We use Google Analytics to understand how the site is used: which pages are viewed, which episodes are played, and roughly how long people listen. Episode audio is delivered through <a href="https://op3.dev" rel="noopener">OP3</a>, an open podcast statistics service that counts downloads without selling or sharing listener data. We do not use advertising trackers.</p>
  <h2>Your preferences</h2>
  <p>Your browser remembers where you stopped in each episode and your playback speed so you can pick up where you left off. That stays on your device.</p>
  <h2>Questions you send</h2>
  <p>Questions sent through <a href="/ask/">Ask Joe</a> go by email to Champion Auto Finance. We use them to answer you and, if we feature your question, we use only your first name and city.</p>
  <p>Champion Auto Finance's full privacy policy: <a href="https://championautofinance.com/privacy-policy/" rel="noopener">championautofinance.com/privacy-policy</a>. Contact: info@championautofinance.com.</p>
</section>"""
    return layout("/privacy/", "Privacy", "How Lease End Live handles analytics and listener questions.", body, crumbs=[("Privacy", "/privacy/")])


def page_embed(ep):
    """Minimal standalone player for iframes (other sites, X player cards). noindex; links back to the episode."""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(ep['title'])} | {E(ep['show_title'])}</title><meta name="robots" content="noindex,follow"><link rel="canonical" href="{BASE}{ep['url']}">
<style>*{{box-sizing:border-box;margin:0}}body{{font:14px/1.4 Inter,system-ui,sans-serif;background:#0b1222;color:#eef2f9;height:100vh;overflow:hidden}}
.e{{display:flex;gap:14px;align-items:center;padding:14px;height:100%;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:radial-gradient(400px 160px at 100% 0,{ep['accent']}33,transparent 70%),#0b1222}}
img{{width:120px;height:120px;border-radius:10px;flex:none}}.m{{flex:1;min-width:0}}.s{{color:{ep['accent']};font-weight:700;font-size:11px;letter-spacing:.1em;text-transform:uppercase}}
a.t{{display:block;color:#fff;font-weight:700;font-size:16px;margin:4px 0 10px;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}a.t:hover{{text-decoration:underline}}
.r{{display:flex;align-items:center;gap:10px}}button{{width:44px;height:44px;border-radius:50%;border:0;background:#fff;cursor:pointer;flex:none;display:grid;place-items:center}}button svg{{width:20px;height:20px}}
input{{flex:1;accent-color:{ep['accent']}}}.tm{{font-variant-numeric:tabular-nums;color:#9aa8bf;font-size:12px}}.b{{margin-top:8px;font-size:11px;color:#6b7891}}.b a{{color:#9aa8bf}}
@media(max-width:420px){{img{{width:72px;height:72px}}}}</style></head><body>
<div class="e"><img src="{ep['cover'].replace('-1400', '-400')}" alt="">
<div class="m"><div class="s">{E(ep['show_title'])} · Ep. {ep['number']}</div><a class="t" href="{BASE}{ep['url']}" target="_blank" rel="noopener">{E(ep['title'])}</a>
<div class="r"><button id="p" aria-label="Play"><svg viewBox="0 0 24 24"><path id="i" d="M8 5v14l11-7z"/></svg></button><input id="s" type="range" min="0" max="1000" value="0" aria-label="Seek"><span class="tm" id="tm">{hms(ep['duration'])}</span></div>
<div class="b">Listen on <a href="{BASE}/" target="_blank" rel="noopener">Lease End Live</a> · from Champion Auto Finance</div></div></div>
<audio id="a" preload="none" src="{E(ep['media_url'])}"></audio>
<script>var a=document.getElementById('a'),p=document.getElementById('p'),i=document.getElementById('i'),s=document.getElementById('s'),tm=document.getElementById('tm');
function f(x){{x=Math.floor(x||0);return Math.floor(x/60)+':'+String(x%60).padStart(2,'0')}}
p.onclick=function(){{a.paused?a.play():a.pause()}};a.onplay=function(){{i.setAttribute('d','M6 5h4v14H6zM14 5h4v14h-4z')}};a.onpause=function(){{i.setAttribute('d','M8 5v14l11-7z')}};
a.ontimeupdate=function(){{if(a.duration){{s.value=a.currentTime/a.duration*1000;tm.textContent=f(a.currentTime)+' / '+f(a.duration)}}}};s.oninput=function(){{if(a.duration)a.currentTime=s.value/1000*a.duration}};</script>
</body></html>"""


def page_404():
    body = """<section class="wrap section narrow center"><h1>That page isn't here.</h1><p class="lead">It may have moved. The latest episodes are on the home page.</p><p><a class="btn btn-live" href="/">Go to the home page</a></p></section>"""
    return layout("/404.html", "Page not found", "Page not found", body, robots="noindex,follow")


# ---------------------------------------------------------------- feeds etc.
def X(s): return html.escape(str(s), quote=False)


def feed(s, eps):
    se = [e for e in eps if e["show"] == s["slug"]]
    cats = ""
    for c in s["categories"]:
        cats += (f'<itunes:category text="{X(c[0])}"><itunes:category text="{X(c[1])}"/></itunes:category>' if len(c) > 1
                 else f'<itunes:category text="{X(c[0])}"/>')
    items = ""
    for e in se:
        tk = "".join(f"<li>{X(t)}</li>" for t in e["takeaways"])
        gd = "".join(f'<li><a href="{X(u)}">{X(n)}</a></li>' for n, u in e["links"][:1])
        notes = (f"<p>{X(e['summary'])}</p>" + (f"<p>Key takeaways:</p><ul>{tk}</ul>" if tk else "") + e.get("notes_html", "") +
                 (f"<p>Read more:</p><ul>{gd}</ul>" if gd else "") +
                 f'<p>Transcript: <a href="{BASE}{e["url"]}">{BASE}{e["url"]}</a></p>'
                 f"<p>{X(SITE['disclosure'])}</p><p>{X(SITE['ai_disclosure'])}</p>")
        items += f"""
  <item>
    <title>{X(e['title'])}</title>
    <link>{BASE}{e['url']}</link>
    <guid isPermaLink="false">{e['guid']}</guid>
    <pubDate>{format_datetime(e['_dt'])}</pubDate>
    <description><![CDATA[{notes}]]></description>
    <content:encoded><![CDATA[{notes}]]></content:encoded>
    <enclosure url="{X(e['media_url'])}" length="{e['bytes']}" type="audio/mpeg"/>
    <itunes:title>{X(e['title'])}</itunes:title>
    <itunes:episode>{e['number']}</itunes:episode>
    <itunes:episodeType>full</itunes:episodeType>
    <itunes:duration>{int(round(e['duration']))}</itunes:duration>
    <itunes:explicit>false</itunes:explicit>
    <itunes:image href="{BASE}{e['cover']}"/>
    <itunes:summary>{X(e['summary'])}</itunes:summary>
    <podcast:transcript url="{BASE}/transcripts/{e['show']}/{e['slug']}.vtt" type="text/vtt" language="en"/>{f"""
    <podcast:chapters url="{BASE}/chapters/{e['show']}/{e['slug']}.json" type="application/json+chapters"/>""" if e["chapters_resolved"] else ""}
    <podcast:person role="host" href="{BASE}/about/">Joe</podcast:person>
    <podcast:transcript url="{BASE}{e['url']}#transcript" type="text/html" language="en"/>
  </item>"""
    last = format_datetime(se[0]["_dt"]) if se else format_datetime(NOW)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel>
  <title>{X(s['title'])}</title>
  <link>{BASE}/{s['slug']}/</link>
  <atom:link href="{BASE}/feeds/{s['slug']}.xml" rel="self" type="application/rss+xml"/>
  <language>{SITE['language']}</language>
  <copyright>© {NOW.year} Champion Auto Finance</copyright>
  <description><![CDATA[{s['description']} {SITE['disclosure']} {SITE['ai_disclosure']}]]></description>
  <lastBuildDate>{format_datetime(NOW)}</lastBuildDate>
  <pubDate>{last}</pubDate>
  <image><url>{BASE}/img/{s['slug']}-cover-1400.jpg</url><title>{X(s['title'])}</title><link>{BASE}/{s['slug']}/</link></image>
  <itunes:author>Champion Auto Finance</itunes:author>
  <itunes:subtitle>{X(s['subtitle'])}</itunes:subtitle>
  <itunes:summary>{X(s['description'])}</itunes:summary>
  <itunes:owner><itunes:name>{X(SITE['owner_name'])}</itunes:name><itunes:email>{X(SITE['owner_email'])}</itunes:email></itunes:owner>
  <itunes:image href="{BASE}/img/{s['slug']}-cover.jpg"/>
  {cats}
  <itunes:explicit>false</itunes:explicit>
  <itunes:type>episodic</itunes:type>
  <podcast:guid>{s['guid']}</podcast:guid>
  <podcast:locked owner="{X(SITE['owner_email'])}">yes</podcast:locked>
  <podcast:medium>podcast</podcast:medium>
  <podcast:person role="host" href="{BASE}/about/">Joe</podcast:person>{items}
</channel>
</rss>
"""


def vtt(ep):
    def t(x):
        ms = int(round(x * 1000)); h, r = divmod(ms, 3600000); m, r = divmod(r, 60000); s, ms = divmod(r, 1000)
        return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"
    out = ["WEBVTT", ""]
    for g in ep["segments"]:
        out += [f"{t(g['start'])} --> {t(g['end'])}", f"<v Joe>{g['text']}", ""]
    return "\n".join(out)


def main():
    if os.path.isdir(DIST): shutil.rmtree(DIST)
    shutil.copytree(os.path.join(ROOT, "src"), DIST)
    eps = load_episodes()
    for e in eps:
        os.makedirs(os.path.join(DIST, os.path.dirname(e["audio"])), exist_ok=True)
        shutil.copyfile(os.path.join(ROOT, e["audio"]), os.path.join(DIST, e["audio"]))
        write(f"/transcripts/{e['show']}/{e['slug']}.vtt", vtt(e))
        write(e["url"], page_episode(e, eps))
    write("/", page_home(eps))
    for s in SITE["shows"]:
        write(f"/{s['slug']}/", page_show(s, eps))
        write(f"/feeds/{s['slug']}.xml", feed(s, eps))
    write("/about/", page_about()); write("/ask/", page_ask()); write("/privacy/", page_privacy())
    for e in eps:
        write(f"/embed{e['url']}", page_embed(e))
        write(f"/oembed/{e['show']}/{e['slug']}.json", json.dumps({
            "version": "1.0", "type": "rich", "provider_name": SITE["name"], "provider_url": BASE + "/", "title": e["title"],
            "author_name": "Joe, Champion Auto Finance", "author_url": BASE + "/about/", "width": 480, "height": 180,
            "thumbnail_url": BASE + e["cover"].replace("-1400", "-400"), "thumbnail_width": 400, "thumbnail_height": 400,
            "html": f'<iframe src="{BASE}/embed{e["url"]}" width="100%" height="180" frameborder="0" loading="lazy" title="{E(e["title"])}"></iframe>'}))
        if e["chapters_resolved"]:
            write(f"/chapters/{e['show']}/{e['slug']}.json", json.dumps({"version": "1.2.0", "chapters": [
                {"startTime": c["start"], "title": c["title"], "url": BASE + e["url"]} for c in e["chapters_resolved"]]}))
    write("/manifest.webmanifest", json.dumps({"name": SITE["name"], "short_name": "Lease End Live", "start_url": "/", "display": "standalone",
        "background_color": "#080d19", "theme_color": "#080d19", "description": SITE["tagline"],
        "icons": [{"src": "/img/icon-192.png", "sizes": "192x192", "type": "image/png"}, {"src": "/img/icon-512.png", "sizes": "512x512", "type": "image/png"},
                  {"src": "/img/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]}))
    llms = [f"# {SITE['name']}", "", f"> {SITE['tagline']} Podcasts about lease buyouts and the end of a car lease, published by Champion Auto Finance.", "",
            SITE["disclosure"], "", "## Shows"]
    llms += [f"- [{s['title']}]({BASE}/{s['slug']}/): {s['subtitle']} RSS: {BASE}/feeds/{s['slug']}.xml" for s in SITE["shows"]]
    llms += ["", "## Episodes (each page has a full transcript)"] + [f"- [{e['show_title']}: {e['title']}]({BASE}{e['url']}): {e['summary']}" for e in eps]
    llms += ["", "## About", f"- [Joe, Managing Director at Champion Auto Finance]({BASE}/about/)", "- [Champion Auto Finance](https://championautofinance.com/)"]
    write("/llms.txt", "\n".join(llms) + "\n")
    if SITE.get("indexnow_key"): write(f"/{SITE['indexnow_key']}.txt", SITE["indexnow_key"])
    write("/404.html", page_404())
    # client-side episode index for the player (no peaks/segments: those are read from the page)
    idx = {f"{e['show']}/{e['slug']}": {"t": e["title"], "s": e["show_title"], "u": e["url"], "a": "/" + e["audio"],
           "m": ("/" + e["audio"]) if PREVIEW else e["media_url"], "c": e["cover"].replace("-1400", "-400"), "d": e["duration"], "n": e["number"], "x": e["accent"]}
           for e in eps}
    write("/assets/episodes.json", json.dumps(idx, separators=(",", ":")))
    newest = eps[0]["date"] if eps else NOW.isoformat()
    def last(show): return next((e["date"] for e in eps if e["show"] == show), newest)
    rows = [("/", newest, "/img/og-default.jpg", "Lease End Live")]
    rows += [(f"/{s['slug']}/", last(s["slug"]), f"/img/{s['slug']}-cover-1400.jpg", s["title"]) for s in SITE["shows"]]
    rows += [(e["url"], e.get("modified", e["date"]), e["cover"], e["title"]) for e in eps]
    rows += [("/about/", newest, None, None), ("/ask/", newest, None, None)]
    write("/sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">'
          + "".join(f"<url><loc>{BASE}{u}</loc><lastmod>{d[:10]}</lastmod>"
                    + (f"<image:image><image:loc>{BASE}{img}</image:loc><image:title>{X(t)}</image:title></image:image>" if img else "") + "</url>"
                    for u, d, img, t in rows) + "</urlset>\n")
    write("/robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n")
    write("/CNAME", BASE.split("://")[1] + "\n")
    write("/.nojekyll", "")
    print(f"built {len(eps)} episodes{' (preview)' if PREVIEW else ''} -> {DIST}")


if __name__ == "__main__":
    main()
