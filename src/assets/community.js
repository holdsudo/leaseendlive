/* Lease End Live community: episode likes + comments, the community board, and email sign-in.
   Talks to the Cloudflare Worker at window.LEL.api. All user text is rendered with textContent. */
(function () {
  'use strict';
  var API = (window.LEL || {}).api, SITEKEY = (window.LEL || {}).turnstile;
  if (!API) return;
  var track = function (n, p) { if (window.lelTrack) window.lelTrack(n, p || {}); };
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem('lel:' + k)); } catch (e) { return null; } },
    set: function (k, v) { try { if (v == null) localStorage.removeItem('lel:' + k); else localStorage.setItem('lel:' + k, JSON.stringify(v)); } catch (e) {} }
  };
  function device() {
    var d = store.get('device');
    if (!d) { d = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)); store.set('device', d); }
    return d;
  }
  function me() { return store.get('user'); }
  function api(path, opts) {
    opts = opts || {};
    var h = { 'Content-Type': 'application/json' }, s = store.get('session');
    if (s) h.Authorization = 'Bearer ' + s;
    return fetch(API + path, { method: opts.method || 'GET', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401 && s) { store.set('session', null); store.set('user', null); }
          if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
          return j;
        });
      });
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function ago(iso) {
    var s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 60) return 'just now';
    var u = [[31536000, 'y'], [2592000, 'mo'], [604800, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm']];
    for (var i = 0; i < u.length; i++) if (s >= u[i][0]) return Math.floor(s / u[i][0]) + u[i][1] + ' ago';
  }
  function flash(box, msg, ok) { box.textContent = msg; box.className = 'c-msg ' + (ok ? 'ok' : 'err'); }

  // ---------------------------------------------------------------- sign-in modal
  var modal = null, tsWidget = null;
  function loadTurnstile(cb) {
    if (window.turnstile) return cb();
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true; s.onload = cb;
    document.head.appendChild(s);
  }
  function signIn(reason) {
    if (!modal) {
      modal = el('div', 'c-modal'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'c-modal-h');
      modal.innerHTML = '<div class="c-modal-card"><button class="c-x" aria-label="Close">&times;</button>' +
        '<h3 id="c-modal-h">Join the conversation</h3><p class="muted small c-why"></p>' +
        '<form class="c-auth"><label><span>Display name</span><input name="name" maxlength="40" autocomplete="nickname" required placeholder="e.g. Jessica R."></label>' +
        '<label><span>Email <span class="muted">(never shown)</span></span><input name="email" type="email" autocomplete="email" required></label>' +
        '<div class="c-ts"></div><button class="btn btn-live btn-block" type="submit">Email me a sign-in link</button>' +
        '<p class="c-msg" role="status" aria-live="polite"></p>' +
        '<p class="fine-sm">By posting you agree to the <a href="/community/rules/">community rules</a>. Don’t share account numbers, SSNs or other private details. Posts are public.</p></form></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', function (e) { if (e.target === modal || e.target.closest('.c-x')) close(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal.classList.contains('open')) close(); });
      modal.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target, msg = f.querySelector('.c-msg'), btn = f.querySelector('button[type=submit]');
        var token = window.turnstile && tsWidget != null ? window.turnstile.getResponse(tsWidget) : '';
        btn.disabled = true;
        api('/v1/auth/start', { method: 'POST', body: { name: f.name.value, email: f.email.value, turnstile: token, return: location.pathname + location.search } })
          .then(function () {
            track('community_signin_start', {});
            f.innerHTML = '<p class="c-sent"><b>Check your email.</b><br>We sent a link to ' + f.email.value.replace(/[<>&"]/g, '') +
              '. Open it on this device and your post will go up automatically.</p>';
          })
          .catch(function (err) { flash(msg, err.message); btn.disabled = false; if (window.turnstile && tsWidget != null) window.turnstile.reset(tsWidget); });
      });
    }
    modal.querySelector('.c-why').textContent = reason || 'Confirm your email once and you can comment, reply and vote.';
    modal.classList.add('open'); document.body.classList.add('c-lock');
    setTimeout(function () { var i = modal.querySelector('input[name=name]'); if (i) i.focus(); }, 50);
    loadTurnstile(function () {
      var box = modal.querySelector('.c-ts');
      if (box && tsWidget == null && SITEKEY) tsWidget = window.turnstile.render(box, { sitekey: SITEKEY, theme: 'dark', size: 'flexible' });
    });
    function close() { modal.classList.remove('open'); document.body.classList.remove('c-lock'); }
  }

  // Post now, or save it and ask the person to confirm their email first.
  function submitPost(payload, done) {
    if (!me()) {
      store.set('draft', payload);
      signIn('Confirm your email to publish. We’ll post this for you as soon as you click the link.');
      return Promise.resolve(null);
    }
    return api('/v1/posts', { method: 'POST', body: payload }).then(function (r) {
      track(payload.kind === 'thread' ? 'community_thread' : payload.kind === 'reply' ? 'community_reply' : 'episode_comment', { episode_id: payload.episode_id || '' });
      if (done) done(r); return r;
    });
  }

  // ---------------------------------------------------------------- shared post UI
  function postNode(p, opts) {
    var n = el('article', 'c-post' + (p.held ? ' held' : '') + (p.removed ? ' removed' : '')); n.dataset.id = p.id;
    var head = el('div', 'c-head');
    var who = el('span', 'c-who', p.author.name); head.appendChild(who);
    if (p.author.host) head.appendChild(el('span', 'c-badge', 'Host'));
    head.appendChild(el('time', 'c-time', ago(p.created_at))).setAttribute('datetime', p.created_at);
    n.appendChild(head);
    if (p.held) n.appendChild(el('p', 'c-note', 'Waiting for review. Only you can see this for now.'));
    if (p.title && opts.showTitle) n.appendChild(el('h3', 'c-title', p.title));
    n.appendChild(el('div', 'c-body', p.removed ? '[removed]' : p.body));
    if (p.removed) return n;
    var bar = el('div', 'c-bar');
    var up = el('button', 'c-vote' + (p.voted ? ' on' : '')); up.type = 'button'; up.setAttribute('aria-pressed', p.voted);
    up.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l7 8h-4v8H9v-8H5z"/></svg><span></span>';
    up.querySelector('span').textContent = p.score; up.setAttribute('aria-label', 'Upvote');
    up.addEventListener('click', function () {
      if (!me()) return signIn('Confirm your email once to vote.');
      if (p.mine) return;
      var on = !up.classList.contains('on');
      api('/v1/posts/' + p.id + '/vote', { method: 'POST', body: { on: on } }).then(function (r) {
        up.classList.toggle('on', r.voted); up.setAttribute('aria-pressed', r.voted); up.querySelector('span').textContent = r.score;
        track('community_vote', { on: r.voted });
      }).catch(function (e) { alertInline(n, e.message); });
    });
    if (p.mine) up.disabled = true;
    bar.appendChild(up);
    if (opts.onReply) { var rb = el('button', 'c-link', 'Reply'); rb.type = 'button'; rb.addEventListener('click', function () { opts.onReply(p, n); }); bar.appendChild(rb); }
    if (p.mine) {
      var del = el('button', 'c-link', 'Delete'); del.type = 'button';
      del.addEventListener('click', function () {
        if (!confirmInline(del)) return;
        api('/v1/posts/' + p.id, { method: 'DELETE' }).then(function () { n.querySelector('.c-body').textContent = '[removed]'; n.classList.add('removed'); bar.remove(); });
      });
      bar.appendChild(del);
    } else {
      var rep = el('button', 'c-link', 'Report'); rep.type = 'button';
      rep.addEventListener('click', function () {
        if (!confirmInline(rep, 'Report?')) return;
        api('/v1/posts/' + p.id + '/report', { method: 'POST', body: { device: device(), reason: 'reader report' } })
          .then(function () { rep.textContent = 'Reported'; rep.disabled = true; track('community_report', {}); });
      });
      bar.appendChild(rep);
    }
    n.appendChild(bar);
    return n;
  }
  // two-tap confirm instead of a browser dialog
  function confirmInline(btn, label) {
    if (btn.dataset.armed) return true;
    btn.dataset.armed = '1'; var t = btn.textContent; btn.textContent = (label || 'Sure?') + ' Tap again';
    setTimeout(function () { delete btn.dataset.armed; btn.textContent = t; }, 3000);
    return false;
  }
  function alertInline(node, msg) { var m = el('p', 'c-msg err', msg); node.appendChild(m); setTimeout(function () { m.remove(); }, 4000); }

  function composer(placeholder, withTitle, flairs, onSubmit, small) {
    var f = el('form', 'c-compose' + (small ? ' small' : ''));
    if (withTitle) {
      var row = el('div', 'c-row');
      var t = el('input'); t.name = 'title'; t.maxLength = 140; t.placeholder = 'Title: what do you want to ask or share?'; t.required = true; row.appendChild(t);
      var s = el('select'); s.name = 'flair'; s.setAttribute('aria-label', 'Flair');
      flairs.forEach(function (fl) { var o = el('option', null, fl); o.value = fl; s.appendChild(o); }); row.appendChild(s);
      f.appendChild(row);
    }
    var ta = el('textarea'); ta.name = 'body'; ta.rows = small ? 3 : 4; ta.maxLength = 4000; ta.placeholder = placeholder; ta.required = true;
    f.appendChild(ta);
    var foot = el('div', 'c-foot');
    var who = el('span', 'muted small'); var u = me();
    who.textContent = u ? 'Posting as ' + u.name : 'You’ll confirm your email once before your first post.';
    foot.appendChild(who);
    var b = el('button', 'btn btn-live btn-sm', small ? 'Reply' : 'Post'); b.type = 'submit'; foot.appendChild(b);
    f.appendChild(foot);
    var msg = el('p', 'c-msg'); msg.setAttribute('role', 'status'); f.appendChild(msg);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (ta.value.trim().length < 2) return flash(msg, 'Write a little more first.');
      b.disabled = true;
      onSubmit({ body: ta.value, title: withTitle ? f.title.value : undefined, flair: withTitle ? f.flair.value : undefined })
        .then(function (r) {
          b.disabled = false;
          if (!r) return;   // waiting on email confirmation
          f.reset(); flash(msg, r.notice || 'Posted.', !r.notice);
        })
        .catch(function (err) { b.disabled = false; flash(msg, err.message); });
    });
    return f;
  }

  // ---------------------------------------------------------------- episode: likes + comments
  function initEpisode() {
    var sec = document.querySelector('[data-social-episode]'); if (!sec || sec.dataset.ready) return;
    sec.dataset.ready = '1';
    var id = sec.getAttribute('data-social-episode');
    var likeBtns = document.querySelectorAll('[data-like="' + id + '"]');
    var list = sec.querySelector('.c-list'), count = sec.querySelector('.c-count');
    function paintLikes(r) {
      likeBtns.forEach(function (b) { b.classList.toggle('on', r.liked); b.setAttribute('aria-pressed', r.liked); b.querySelector('span').textContent = r.likes || ''; b.disabled = false; });
    }
    likeBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        var on = !b.classList.contains('on'); b.disabled = true;
        api('/v1/episode/' + id + '/like', { method: 'POST', body: { device: device(), on: on } }).then(function (r) { paintLikes(r); track('episode_like', { episode_id: id, on: r.liked }); })
          .catch(function () { b.disabled = false; });
      });
    });
    function render(comments) {
      list.innerHTML = '';
      var live = comments.filter(function (c) { return !c.removed || comments.some(function (k) { return k.parent_id === c.id && !k.removed; }); });
      count.textContent = live.filter(function (c) { return !c.removed; }).length || '';
      var top = live.filter(function (c) { return !c.parent_id || !live.some(function (k) { return k.id === c.parent_id; }); });
      top.sort(function (a, b) { return b.score - a.score || Date.parse(b.created_at) - Date.parse(a.created_at); });
      if (!top.length) list.appendChild(el('p', 'muted c-empty', 'No comments yet. Start the conversation.'));
      top.forEach(function (c) {
        var node = postNode(c, { onReply: reply });
        var kids = live.filter(function (k) { return k.parent_id === c.id; });
        if (kids.length) { var wrap = el('div', 'c-kids'); kids.forEach(function (k) { wrap.appendChild(postNode(k, { onReply: reply })); }); node.appendChild(wrap); }
        list.appendChild(node);
      });
    }
    function reply(p, node) {
      if (node.querySelector('.c-compose')) return;
      var f = composer('Reply to ' + p.author.name + '…', false, null, function (v) {
        return submitPost({ kind: 'comment', episode_id: id, parent_id: p.parent_id || p.id, body: v.body }, load);
      }, true);
      node.appendChild(f); f.querySelector('textarea').focus();
    }
    function load() {
      return api('/v1/episode/' + id + '?device=' + encodeURIComponent(device())).then(function (r) { paintLikes(r); render(r.comments); })
        .catch(function () { list.innerHTML = ''; list.appendChild(el('p', 'muted', 'Comments are unavailable right now.')); });
    }
    sec.querySelector('.c-new').appendChild(composer('What did you think? Ask a question or share your situation…', false, null, function (v) {
      return submitPost({ kind: 'comment', episode_id: id, body: v.body }, load);
    }));
    load();
  }

  // ---------------------------------------------------------------- community board
  function initCommunity() {
    var app = document.getElementById('community-app'); if (!app || app.dataset.ready) return;
    app.dataset.ready = '1';
    var params = new URLSearchParams(location.search);
    var tid = params.get('t');
    if (tid) return threadView(app, tid);
    var state = { sort: params.get('sort') || 'hot', flair: params.get('flair') || '' };
    app.innerHTML = '';
    var top = el('div', 'c-toolbar');
    var tabs = el('div', 'c-tabs');
    ['hot', 'new', 'top'].forEach(function (s) {
      var b = el('button', 'chip' + (state.sort === s ? ' on' : ''), s[0].toUpperCase() + s.slice(1)); b.type = 'button';
      b.addEventListener('click', function () { state.sort = s; tabs.querySelectorAll('.chip').forEach(function (x) { x.classList.toggle('on', x === b); }); load(); });
      tabs.appendChild(b);
    });
    top.appendChild(tabs);
    var newBtn = el('button', 'btn btn-live btn-sm', 'New post'); newBtn.type = 'button'; top.appendChild(newBtn);
    app.appendChild(top);
    var flairBar = el('div', 'c-flairs'); app.appendChild(flairBar);
    var formWrap = el('div', 'c-newthread'); formWrap.hidden = true; app.appendChild(formWrap);
    var listEl = el('div', 'c-threads'); app.appendChild(listEl);
    var stat = document.querySelector('[data-members]');
    newBtn.addEventListener('click', function () { formWrap.hidden = !formWrap.hidden; if (!formWrap.hidden) { var i = formWrap.querySelector('input'); if (i) i.focus(); } });
    function load() {
      var q = '?sort=' + state.sort + (state.flair ? '&flair=' + encodeURIComponent(state.flair) : '');
      api('/v1/community' + q).then(function (r) {
        if (stat) stat.textContent = r.members === 1 ? '1 member' : r.members + ' members';
        if (!flairBar.childNodes.length) {
          ['All'].concat(r.flairs).forEach(function (fl) {
            var b = el('button', 'chip' + ((fl === 'All' && !state.flair) || fl === state.flair ? ' on' : ''), fl); b.type = 'button';
            b.addEventListener('click', function () { state.flair = fl === 'All' ? '' : fl; flairBar.querySelectorAll('.chip').forEach(function (x) { x.classList.toggle('on', x === b); }); load(); });
            flairBar.appendChild(b);
          });
          formWrap.appendChild(composer('Share the details: what your lease says, what you’ve been quoted, what you’re weighing…', true, r.flairs, function (v) {
            return submitPost({ kind: 'thread', title: v.title, flair: v.flair, body: v.body }, function (res) {
              if (res.post && !res.post.held) location.search = '?t=' + res.post.id; else load();
            });
          }));
        }
        listEl.innerHTML = '';
        if (!r.threads.length) listEl.appendChild(el('p', 'muted c-empty', state.flair ? 'No posts with this flair yet.' : 'No posts yet. Be the first to ask a question.'));
        r.threads.forEach(function (t) {
          var row = el('a', 'c-thread' + (t.held ? ' held' : '')); row.href = '/community/?t=' + t.id;
          var sc = el('div', 'c-score'); sc.appendChild(el('b', null, String(t.score))); sc.appendChild(el('span', null, 'votes')); row.appendChild(sc);
          var main = el('div', 'c-thread-main');
          var meta = el('div', 'c-meta'); meta.appendChild(el('span', 'c-flair', t.flair));
          meta.appendChild(el('span', null, t.author.name + (t.author.host ? ' (Host)' : '') + ' · ' + ago(t.created_at)));
          if (t.held) meta.appendChild(el('span', 'c-flair warn', 'In review'));
          main.appendChild(meta); main.appendChild(el('h3', null, t.title));
          main.appendChild(el('p', 'muted small clamp2', t.body));
          main.appendChild(el('span', 'meta', t.reply_count === 1 ? '1 reply' : t.reply_count + ' replies'));
          row.appendChild(main); listEl.appendChild(row);
        });
      }).catch(function (e) { listEl.innerHTML = ''; listEl.appendChild(el('p', 'muted', e.message)); });
    }
    load();
  }

  function threadView(app, tid) {
    app.innerHTML = '';
    var back = el('a', 'c-back', '← All posts'); back.href = '/community/'; app.appendChild(back);
    var host = el('div'); app.appendChild(host);
    function load() {
      api('/v1/thread/' + encodeURIComponent(tid)).then(function (r) {
        host.innerHTML = '';
        document.title = r.thread.title + ' | Lease End Live Community';
        var t = postNode(r.thread, { showTitle: true }); t.classList.add('c-op');
        t.insertBefore(el('span', 'c-flair', r.thread.flair), t.firstChild);
        host.appendChild(t);
        host.appendChild(el('h2', 'c-h', r.replies.length === 1 ? '1 reply' : r.replies.length + ' replies'));
        if (!r.thread.held) host.appendChild(composer('Add a reply…', false, null, function (v) {
          return submitPost({ kind: 'reply', thread_id: r.thread.id, body: v.body }, load);
        }));
        var rs = r.replies, tops = rs.filter(function (x) { return !x.parent_id || !rs.some(function (k) { return k.id === x.parent_id; }); });
        tops.forEach(function (p) {
          var node = postNode(p, { onReply: function (pp, n) {
            if (n.querySelector('.c-compose')) return;
            var f = composer('Reply to ' + pp.author.name + '…', false, null, function (v) {
              return submitPost({ kind: 'reply', thread_id: r.thread.id, parent_id: pp.parent_id || pp.id, body: v.body }, load);
            }, true);
            n.appendChild(f); f.querySelector('textarea').focus();
          } });
          var kids = rs.filter(function (k) { return k.parent_id === p.id; });
          if (kids.length) { var w = el('div', 'c-kids'); kids.forEach(function (k) { w.appendChild(postNode(k, {})); }); node.appendChild(w); }
          host.appendChild(node);
        });
      }).catch(function (e) { host.innerHTML = ''; host.appendChild(el('p', 'muted', e.message)); });
    }
    load();
  }

  // ---------------------------------------------------------------- email link landing page
  function initVerify() {
    var box = document.getElementById('verify-app'); if (!box || box.dataset.ready) return;
    box.dataset.ready = '1';
    var q = new URLSearchParams(location.search), t = q.get('t'), r = q.get('r') || '/community/';
    if (!/^\/[^/]/.test(r) && r !== '/') r = '/community/';
    if (!t) { box.textContent = 'This link is missing its code. Request a new sign-in link from any comment box.'; return; }
    api('/v1/auth/verify', { method: 'POST', body: { token: t } }).then(function (res) {
      store.set('session', res.session); store.set('user', res.user);
      track('community_signin_verified', {});
      history.replaceState({}, '', '/verify/');
      var draft = store.get('draft');
      if (!draft) { box.textContent = 'You’re in. Taking you back…'; return setTimeout(function () { location.href = r; }, 900); }
      box.textContent = 'You’re in. Posting your message…';
      return api('/v1/posts', { method: 'POST', body: draft }).then(function (p) {
        store.set('draft', null);
        var dest = draft.kind === 'thread' && p.post && !p.post.held ? '/community/?t=' + p.post.id : r;
        box.textContent = p.notice || 'Posted! Taking you back…';
        setTimeout(function () { location.href = dest; }, p.notice ? 3500 : 900);
      });
    }).catch(function (e) { box.textContent = e.message; });
  }

  function init() { initEpisode(); initCommunity(); initVerify(); }
  document.addEventListener('lel:page', init);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
