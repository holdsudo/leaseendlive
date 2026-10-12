/* Lease End Live: persistent player + in-site navigation + transcript sync + forms. */
(function () {
  'use strict';
  var audio = document.getElementById('lel-audio');
  var bar = document.getElementById('pbar');
  var track = function (n, p) { if (window.lelTrack) window.lelTrack(n, p); };
  var RATES = [1, 1.25, 1.5, 1.75, 2, 0.75];
  var idxPromise = null;
  var cur = null;          // { id, ...episode index entry }
  var started = {};        // id -> true once audio_start sent
  var milestones = {};     // id -> {10:true,...}
  var listenAcc = 0, lastT = null;
  var userScrollAt = 0;

  // ---------- storage (per-viewer conveniences only; everything works without it)
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem('lel:' + k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('lel:' + k, JSON.stringify(v)); } catch (e) {} }
  };

  function index() {
    if (!idxPromise) idxPromise = fetch('/assets/episodes.json').then(function (r) { return r.json(); }).catch(function () { idxPromise = null; return {}; });
    return idxPromise;
  }
  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
  }
  function params(extra) {
    var p = { episode_id: cur ? cur.id : '', episode_title: cur ? cur.t : '', show: cur ? cur.s : '' };
    for (var k in extra) p[k] = extra[k];
    return p;
  }
  function dur() { return (isFinite(audio.duration) && audio.duration) || (cur && cur.d) || 0; }

  // ---------- player core
  function load(id, opts) {
    opts = opts || {};
    return index().then(function (idx) {
      var ep = idx[id]; if (!ep) return;
      if (!cur || cur.id !== id) {
        flushListen();
        cur = Object.assign({ id: id }, ep);
        audio.src = ep.m;
        audio.preload = 'metadata';
        var saved = store.get('pos:' + id);
        var start = opts.at != null ? opts.at : (saved && saved < ep.d - 5 ? saved : 0);
        if (start) {
          var setStart = function () { audio.currentTime = start; audio.removeEventListener('loadedmetadata', setStart); };
          audio.addEventListener('loadedmetadata', setStart);
          audio._pending = start;
        } else audio._pending = 0;
        audio.playbackRate = store.get('rate') || 1;
        store.set('last', id);
        paintBar();
        mediaSession();
      } else if (opts.at != null) {
        audio.currentTime = opts.at;
      }
      bar.hidden = false; document.body.classList.add('has-player');
      if (opts.play) {
        var p = audio.play();
        if (p && p.catch) p.catch(function (e) { console.warn('[lel] play failed', e && e.message); });
      }
      sync();
    });
  }
  function toggle() { if (!cur) return; if (audio.paused) audio.play().catch(function (e) { console.warn('[lel] play failed', e && e.message); }); else audio.pause(); }
  function seekTo(t, via) {
    if (!cur) return;
    var from = audio.currentTime;
    t = Math.max(0, Math.min(dur() - 0.25, t));
    audio.currentTime = t; lastT = t;
    track('audio_seek', params({ from: Math.round(from), to: Math.round(t), via: via || 'bar' }));
    sync();
  }
  function paintBar() {
    if (!cur) return;
    bar.querySelector('.pbar-cover').src = cur.c;
    var a = bar.querySelector('.pbar-title'); a.textContent = cur.t; a.href = cur.u;
    bar.querySelector('.pbar-show').textContent = cur.s + ' · Ep. ' + cur.n;
    bar.style.setProperty('--accent', cur.x);
    bar.querySelector('.t-dur').textContent = fmt(cur.d);
    bar.querySelector('[data-act=rate]').textContent = (audio.playbackRate || 1) + '×';
  }

  // Everything visual that depends on playback state, on whatever page is showing
  function sync() {
    var playing = cur && !audio.paused;
    var t = cur ? (audio.currentTime || audio._pending || 0) : 0;
    var d = dur(); var pct = d ? Math.min(100, t / d * 100) : 0;
    bar.classList.toggle('playing', !!playing);
    var tog = bar.querySelector('[data-act=toggle]'); tog.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    bar.querySelector('.t-cur').textContent = fmt(t);
    bar.querySelector('.pbar-progress i').style.width = pct + '%';
    var rng = bar.querySelector('.pbar-seek input'); if (!rng._drag) rng.value = Math.round(pct * 10);
    document.querySelectorAll('[data-play]').forEach(function (b) {
      var on = cur && b.getAttribute('data-play') === cur.id && playing;
      b.classList.toggle('is-playing', !!on);
      var lbl = b.querySelector('span');
      if (lbl && b.classList.contains('btn')) { if (!b._lbl) b._lbl = lbl.textContent; lbl.textContent = on ? 'Pause' : (cur && b.getAttribute('data-play') === cur.id && t > 1 ? 'Resume' : b._lbl); }
      var svg = b.querySelector('svg path'); if (svg) svg.setAttribute('d', on ? 'M6 5h4v14H6zM14 5h4v14h-4z' : 'M8 5v14l11-7z');
    });
    document.querySelectorAll('[data-wave]').forEach(function (w) {
      var mine = cur && w.getAttribute('data-wave') === cur.id;
      var f = w.querySelector('.wave-fill');
      f.style.setProperty('--w', w.clientWidth + 'px');
      f.style.width = (mine ? pct : 0) + '%';
      w.setAttribute('aria-valuenow', mine ? Math.round(t) : 0);
    });
    var art = document.querySelector('[data-episode]');
    if (art && cur && art.getAttribute('data-episode') === cur.id) {
      var tc = art.querySelector('.ep-player .t-cur'); if (tc) tc.textContent = fmt(t);
      highlight(art, t);
    }
  }
  function highlight(art, t) {
    var ps = art.querySelectorAll('.tr-body p[data-start]'), on = null;
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i], s = +p.dataset.start, e = (i + 1 < ps.length) ? +ps[i + 1].dataset.start : Infinity;
      var hit = t >= s && t < e; p.classList.toggle('on', hit); if (hit) on = p;
    }
    var follow = art.querySelector('[data-follow]');
    if (on && !audio.paused && follow && follow.checked && on !== art._lastOn && Date.now() - userScrollAt > 4000) {
      var r = on.getBoundingClientRect();
      if (r.top < 90 || r.bottom > innerHeight - 110) on.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    art._lastOn = on;
  }

  // ---------- listening analytics
  function flushListen() {
    if (listenAcc >= 1 && cur) track('listen_time', params({ seconds: Math.round(listenAcc), value: Math.round(listenAcc) }));
    listenAcc = 0;
  }
  audio.addEventListener('timeupdate', function () {
    if (!cur) return;
    var t = audio.currentTime;
    if (!audio.paused && lastT != null) {
      var dt = t - lastT;
      if (dt > 0 && dt < 3) listenAcc += dt / (audio.playbackRate || 1);   // real seconds of the listener's time
    }
    lastT = t;
    if (listenAcc >= 30) flushListen();
    var d = dur(), pct = d ? t / d * 100 : 0;
    var m = milestones[cur.id] = milestones[cur.id] || {};
    [10, 25, 50, 75, 90].forEach(function (x) { if (pct >= x && !m[x]) { m[x] = 1; track('audio_progress', params({ percent: x })); } });
    if (Math.floor(t) % 5 === 0) store.set('pos:' + cur.id, Math.floor(t));
    sync();
  });
  audio.addEventListener('play', function () {
    if (!cur) return;
    lastT = audio.currentTime;
    if (!started[cur.id]) { started[cur.id] = 1; track('audio_start', params({})); }
    track('audio_play', params({ position: Math.round(audio.currentTime) }));
    sync();
  });
  audio.addEventListener('pause', function () {
    if (!cur) return;
    flushListen();
    store.set('pos:' + cur.id, Math.floor(audio.currentTime));
    if (!audio.ended) track('audio_pause', params({ position: Math.round(audio.currentTime) }));
    sync();
  });
  audio.addEventListener('ended', function () {
    if (!cur) return;
    flushListen(); store.set('pos:' + cur.id, 0);
    track('audio_complete', params({}));
    sync();
  });
  audio.addEventListener('loadedmetadata', function () { paintBar(); sync(); });
  audio.addEventListener('ratechange', function () { bar.querySelector('[data-act=rate]').textContent = audio.playbackRate + '×'; });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushListen(); });
  addEventListener('pagehide', flushListen);

  function mediaSession() {
    if (!('mediaSession' in navigator) || !cur) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: cur.t, artist: 'Joe · ' + cur.s, album: 'Lease End Live',
      artwork: [{ src: cur.c, sizes: '400x400', type: 'image/jpeg' }, { src: cur.c.replace('-400', '-1400'), sizes: '1400x1400', type: 'image/jpeg' }] });
    var h = { play: function () { audio.play(); }, pause: function () { audio.pause(); },
      seekbackward: function () { seekTo(audio.currentTime - 15, 'media_keys'); },
      seekforward: function () { seekTo(audio.currentTime + 30, 'media_keys'); },
      seekto: function (e) { seekTo(e.seekTime, 'media_keys'); } };
    for (var k in h) { try { navigator.mediaSession.setActionHandler(k, h[k]); } catch (e) {} }
  }

  // ---------- bar controls
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var a = b.getAttribute('data-act');
    if (a === 'toggle') toggle();
    else if (a === 'back') seekTo(audio.currentTime - 15, 'bar_back');
    else if (a === 'fwd') seekTo(audio.currentTime + 30, 'bar_forward');
    else if (a === 'rate') {
      var r = RATES[(RATES.indexOf(audio.playbackRate) + 1) % RATES.length];
      audio.playbackRate = r; store.set('rate', r); track('playback_rate', params({ rate: r }));
    } else if (a === 'close') {
      audio.pause(); flushListen(); bar.hidden = true; document.body.classList.remove('has-player'); store.set('last', null);
    }
  });
  var rng = bar.querySelector('.pbar-seek input');
  rng.addEventListener('input', function () { rng._drag = true; bar.querySelector('.t-cur').textContent = fmt(rng.value / 1000 * dur()); });
  rng.addEventListener('change', function () { rng._drag = false; seekTo(rng.value / 1000 * dur(), 'bar'); });

  // ---------- page-level delegation (survives in-site navigation)
  document.addEventListener('click', function (e) {
    var pb = e.target.closest('[data-play]');
    if (pb) {
      e.preventDefault();
      var id = pb.getAttribute('data-play');
      if (cur && cur.id === id) toggle(); else load(id, { play: true });
      return;
    }
    var ts = e.target.closest('[data-seek]');
    if (ts) {
      var art = ts.closest('[data-episode]'), t = +ts.getAttribute('data-seek');
      track('transcript_jump', { seconds: t, episode_id: art.getAttribute('data-episode') });
      if (cur && cur.id === art.getAttribute('data-episode')) { seekTo(t, 'transcript'); if (audio.paused) audio.play(); }
      else load(art.getAttribute('data-episode'), { play: true, at: t });
      return;
    }
    var sh = e.target.closest('[data-share]');
    if (sh) {
      var m = sh.getAttribute('data-share'), art2 = sh.closest('[data-episode]');
      var ep = art2 && art2.getAttribute('data-episode');
      track('share', { method: m, episode_id: ep || '' });
      if (m === 'embed') {
        e.preventDefault();
        var box = sh.parentNode.parentNode.querySelector('.embed-box');
        if (!box) {
          box = document.createElement('div'); box.className = 'embed-box';
          box.innerHTML = '<label class="small muted">Embed this episode on your site</label><textarea rows="3" readonly></textarea>';
          box.querySelector('textarea').value = sh.getAttribute('data-code');
          sh.parentNode.after(box);
        }
        var ta = box.querySelector('textarea'); ta.focus(); ta.select();
        if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(function () { sh.textContent = 'Embed code copied'; });
        return;
      }
      if (m === 'copy' || m === 'time') {
        e.preventDefault();
        var url = location.origin + location.pathname;
        if (m === 'time' && cur && cur.id === ep && audio.currentTime > 1) url += '?t=' + Math.floor(audio.currentTime);
        var done = function () { var o = sh.textContent; sh.textContent = 'Link copied'; setTimeout(function () { sh.textContent = o; }, 1800); };
        if (navigator.share && matchMedia('(pointer:coarse)').matches) navigator.share({ url: url, title: document.title }).catch(function () {});
        else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { prompt('Copy this link', url); });
      }
      return;
    }
    var pl = e.target.closest('[data-platform]');
    if (pl) track('platform_click', { platform: pl.getAttribute('data-platform'), show: pl.getAttribute('data-show'), where: pl.getAttribute('data-where') });
    var tr = e.target.closest('[data-track]');
    if (tr) track('cta_click', { cta: tr.getAttribute('data-track'), link_url: tr.href || '' });
    var mb = e.target.closest('.menu-btn');
    if (mb) { var open = mb.getAttribute('aria-expanded') !== 'true'; mb.setAttribute('aria-expanded', open); document.getElementById('mnav').classList.toggle('open', open); }
  });

  // waveform scrubbing (click or drag)
  document.addEventListener('pointerdown', function (e) {
    var w = e.target.closest('[data-wave]'); if (!w) return;
    var id = w.getAttribute('data-wave');
    var at = function (ev) { var r = w.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); };
    var frac = at(e);
    var move = function (ev) { frac = at(ev); w.querySelector('.wave-fill').style.width = frac * 100 + '%'; };
    var up = function () {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      index().then(function (idx) {
        var d = (cur && cur.id === id) ? dur() : (idx[id] || {}).d || 0;
        if (cur && cur.id === id) { seekTo(frac * d, 'wave'); if (audio.paused) audio.play(); }
        else load(id, { play: true, at: frac * d });
      });
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
  document.addEventListener('keydown', function (e) {
    var w = e.target.closest && e.target.closest('[data-wave]');
    if (w && cur && w.getAttribute('data-wave') === cur.id && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault(); seekTo(audio.currentTime + (e.key === 'ArrowLeft' ? -10 : 10), 'keys'); return;
    }
    if (!cur || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A') { e.preventDefault(); toggle(); }
    else if (e.key === 'k') toggle();
    else if (e.key === 'j') seekTo(audio.currentTime - 15, 'keys');
    else if (e.key === 'l') seekTo(audio.currentTime + 30, 'keys');
  });
  addEventListener('wheel', function () { userScrollAt = Date.now(); }, { passive: true });
  addEventListener('touchmove', function () { userScrollAt = Date.now(); }, { passive: true });
  addEventListener('resize', sync);

  // ---------- Ask Joe form
  document.addEventListener('submit', function (e) {
    var f = e.target; if (f.id !== 'ask-form') return;
    e.preventDefault();
    var st = f.querySelector('.ask-status'); st.className = 'ask-status';
    var v = function (n) { return (f.elements[n].value || '').trim(); };
    if (!v('name') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email')) || v('question').length < 10) {
      st.textContent = 'Please add your first name, a valid email and your question.'; st.classList.add('err'); return;
    }
    var fd = new FormData();
    fd.append('name', v('name')); fd.append('email', v('email'));
    fd.append('topic', 'Podcast question for ' + v('show') + ' (leaseendlive.com)');
    fd.append('message', v('question') + (v('where') ? '\n\nCity/state: ' + v('where') : ''));
    fd.append('company_website', v('company_website'));
    fd.append('landing', location.href);
    var btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
    // Cross-site POST to Champion's lead intake. The response is opaque (no CORS), so a
    // network failure is the only error we can see.
    fetch(window.LEL.ask, { method: 'POST', mode: 'no-cors', body: fd }).then(function () {
      track('ask_submit', { show: v('show') });
      f.reset(); st.textContent = 'Thanks! Your question is on its way to Joe.'; st.classList.add('ok');
    }).catch(function () {
      st.innerHTML = 'That didn’t send. Please email <a href="mailto:info@championautofinance.com">info@championautofinance.com</a>.'; st.classList.add('err');
    }).finally(function () { btn.disabled = false; btn.textContent = 'Send my question'; });
  });

  // ---------- in-site navigation: swap <main> so the audio never stops
  function internal(a) {
    if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return false;
    if (/\.(xml|mp3|vtt|json|jpg|png|svg)$/i.test(a.pathname) || /^\/(audio|feeds|transcripts)\//.test(a.pathname)) return false;
    if (a.pathname === location.pathname && a.hash) return false;
    return true;
  }
  function go(url, push) {
    return fetch(url, { headers: { 'X-Requested-With': 'lel' } }).then(function (r) {
      if (!r.ok && r.status !== 404) throw 0; return r.text();
    }).then(function (txt) {
      var doc = new DOMParser().parseFromString(txt, 'text/html');
      var nm = doc.getElementById('main'); if (!nm) throw 0;
      document.getElementById('main').replaceWith(nm);
      document.title = doc.title;
      ['description'].forEach(function (n) { var a = document.querySelector('meta[name=' + n + ']'), b = doc.querySelector('meta[name=' + n + ']'); if (a && b) a.content = b.content; });
      var c1 = document.querySelector('link[rel=canonical]'), c2 = doc.querySelector('link[rel=canonical]'); if (c1 && c2) c1.href = c2.href;
      document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) { s.remove(); });
      doc.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) { document.head.appendChild(s); });
      ['.nav', '.mnav'].forEach(function (sel) { var a = document.querySelector(sel), b = doc.querySelector(sel); if (a && b) a.innerHTML = b.innerHTML; });
      var mb = document.querySelector('.menu-btn'); mb.setAttribute('aria-expanded', 'false'); document.getElementById('mnav').classList.remove('open');
      if (push) history.pushState({}, '', url);
      var u = new URL(url, location.href);
      if (u.hash && document.querySelector(u.hash)) document.querySelector(u.hash).scrollIntoView(); else scrollTo(0, 0);
      initPage();
      if (window.lelPageView) window.lelPageView();
    }).catch(function () { location.href = url; });
  }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('a[href]'); if (!internal(a)) return;
    e.preventDefault(); go(a.href, true);
  });
  addEventListener('popstate', function () { go(location.href, false); });

  // ---------- per-page setup
  function initPage() {
    var art = document.querySelector('[data-episode]');
    var t = new URLSearchParams(location.search).get('t');
    if (art && t != null && !isNaN(+t)) load(art.getAttribute('data-episode'), { at: +t });
    sync();
  }
  // restore the last episode (paused) so a returning listener can pick up where they left off
  var last = store.get('last');
  if (last && !new URLSearchParams(location.search).get('t')) load(last, {});
  initPage();
})();
