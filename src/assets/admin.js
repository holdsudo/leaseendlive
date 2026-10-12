/* Lease End Live moderation (/admin/). Unlinked and noindex. Access is enforced by the API, not by
   this page: every call needs a signed-in host session (HOST_EMAILS) or the MOD_KEY.
   All user text is rendered with textContent / .value. */
(function () {
  'use strict';
  var API = (window.LEL || {}).api, SITEKEY = (window.LEL || {}).turnstile;
  var root = document.getElementById('admin-app');
  if (!API || !root) return;
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem('lel:' + k)); } catch (e) { return null; } },
    set: function (k, v) { try { if (v == null) localStorage.removeItem('lel:' + k); else localStorage.setItem('lel:' + k, JSON.stringify(v)); } catch (e) {} }
  };
  function api(path, opts) {
    opts = opts || {};
    var h = { 'Content-Type': 'application/json' }, s = store.get('session');
    if (s) h.Authorization = 'Bearer ' + s;
    return fetch(API + path, { method: opts.method || 'GET', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.error || 'Something went wrong.'); e.status = r.status; throw e; }
          return j;
        });
      });
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(label, cls, fn) { var b = el('button', 'btn btn-sm ' + cls, label); b.type = 'button'; b.addEventListener('click', fn); return b; }

  var view = 'held';

  function signInView(msg) {
    root.innerHTML = '';
    var f = el('form', 'adm-signin');
    f.appendChild(el('p', 'lead', 'Moderator sign-in'));
    if (msg) f.appendChild(el('p', 'adm-msg', msg));
    var lab = el('label', null, 'Email'); var inp = el('input'); inp.type = 'email'; inp.name = 'email'; inp.required = true; inp.autocomplete = 'email';
    lab.appendChild(inp); f.appendChild(lab);
    var ts = el('div', 'adm-ts'); f.appendChild(ts);
    var go = el('button', 'btn btn-live', 'Email me a sign-in link'); go.type = 'submit'; f.appendChild(go);
    var st = el('p', 'adm-msg'); f.appendChild(st);
    root.appendChild(f);
    var widget = null;
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true;
    s.onload = function () { if (SITEKEY) widget = window.turnstile.render(ts, { sitekey: SITEKEY, theme: 'dark' }); };
    document.head.appendChild(s);
    f.addEventListener('submit', function (e) {
      e.preventDefault(); go.disabled = true;
      var token = window.turnstile && widget != null ? window.turnstile.getResponse(widget) : '';
      api('/v1/auth/start', { method: 'POST', body: { email: inp.value, admin: true, turnstile: token, return: '/admin/' } })
        .then(function () { f.innerHTML = ''; f.appendChild(el('p', 'lead', 'If that email is a moderator, a sign-in link is on its way. Open it on this device.')); })
        .catch(function (err) { st.textContent = err.message; go.disabled = false; if (window.turnstile && widget != null) window.turnstile.reset(widget); });
    });
  }

  function postLink(p) {
    if (p.kind === 'thread') return '/community/?t=' + p.id;
    if (p.thread_id) return '/community/?t=' + p.thread_id;
    if (p.episode_id) return '/' + p.episode_id + '/#comments';
    return null;
  }

  function card(p) {
    var c = el('article', 'adm-card');
    var head = el('div', 'adm-meta');
    var who = el('b', null, p.author_name); head.appendChild(who);
    head.appendChild(document.createTextNode(' <' + p.author_email + '>'));
    if (p.author_role === 'host') head.appendChild(el('span', 'adm-tag', 'Host'));
    if (p.author_banned) head.appendChild(el('span', 'adm-tag adm-bad', 'Banned'));
    c.appendChild(head);
    var info = el('div', 'adm-meta');
    info.appendChild(el('span', 'adm-tag' + (p.status === 'held' ? ' adm-warn' : ''), p.status));
    info.appendChild(document.createTextNode(' ' + p.kind + (p.flair ? ' · ' + p.flair : '') + ' · ' + new Date(p.created_at + 'Z').toLocaleString()));
    if (p.hold_reason) info.appendChild(el('span', 'adm-reason', ' · held: ' + p.hold_reason));
    if (p.reports) info.appendChild(el('span', 'adm-reason', ' · ' + p.reports + ' report' + (p.reports > 1 ? 's' : '')));
    var href = postLink(p);
    if (href && p.status === 'live') { var a = el('a', null, ' · view'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; info.appendChild(a); }
    c.appendChild(info);
    var title = null;
    if (p.kind === 'thread') { title = el('input', 'adm-title'); title.value = p.title || ''; title.maxLength = 140; c.appendChild(title); }
    var body = el('textarea', 'adm-body'); body.value = p.body; body.rows = Math.min(14, Math.max(4, p.body.split('\n').length + 2)); body.maxLength = 4000;
    c.appendChild(body);
    var row = el('div', 'adm-actions'), msg = el('span', 'adm-msg');
    function act(action, payload) {
      row.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
      api('/v1/mod/' + p.id + '/' + action, { method: 'POST', body: payload || {} })
        .then(function () { msg.textContent = 'Done: ' + action + '.'; setTimeout(load, 700); })
        .catch(function (e) { msg.textContent = e.message; row.querySelectorAll('button').forEach(function (b) { b.disabled = false; }); });
    }
    var edited = function () { return body.value !== p.body || (title && title.value !== (p.title || '')); };
    row.appendChild(btn(p.status === 'held' ? 'Approve' : 'Save edits', 'btn-live', function () {
      if (edited()) act('redact', { body: body.value, title: title ? title.value : undefined });
      else if (p.status === 'held' || p.reports) act('approve');
      else msg.textContent = 'Nothing changed.';
    }));
    row.appendChild(btn('Remove', 'btn-ghost', function () { act('remove'); }));
    if (p.author_role !== 'host' && !p.author_banned) row.appendChild(btn('Remove all + ban author', 'btn-ghost', function () {
      if (window.confirm('Remove every post by ' + p.author_name + ' and block them from posting?')) act('ban');
    }));
    if (p.kind === 'thread' && p.status === 'live') row.appendChild(btn(p.pinned ? 'Unpin' : 'Pin', 'btn-ghost', function () { act(p.pinned ? 'unpin' : 'pin'); }));
    row.appendChild(msg);
    c.appendChild(row);
    return c;
  }

  function load() {
    api('/v1/mod/queue' + (view === 'recent' ? '?view=recent' : '')).then(function (res) {
      root.innerHTML = '';
      var bar = el('div', 'adm-bar');
      [['held', 'Needs review'], ['recent', 'Recent posts']].forEach(function (t) {
        bar.appendChild(btn(t[1], view === t[0] ? 'btn-live' : 'btn-ghost', function () { view = t[0]; load(); }));
      });
      bar.appendChild(btn('Refresh', 'btn-ghost', load));
      bar.appendChild(btn('Sign out', 'btn-ghost', function () { store.set('session', null); store.set('user', null); signInView(); }));
      root.appendChild(bar);
      root.appendChild(el('p', 'adm-help', view === 'held'
        ? 'Held and reported posts. To publish a post with private details, delete the details in the box, then Approve: your edited version goes live.'
        : 'The latest 100 posts that are not removed. Edit any post and Save to redact it after the fact.'));
      if (!res.queue.length) root.appendChild(el('p', 'lead', view === 'held' ? 'Nothing waiting. All clear.' : 'No posts yet.'));
      res.queue.forEach(function (p) { root.appendChild(card(p)); });
    }).catch(function (e) {
      if (e.status === 401) signInView(store.get('session') ? 'This account is not a moderator. Sign in with the moderator email.' : '');
      else { root.innerHTML = ''; root.appendChild(el('p', 'adm-msg', e.message)); }
    });
  }
  load();
})();
