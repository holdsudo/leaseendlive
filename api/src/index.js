/* Lease End Live community API (Cloudflare Worker + D1).
 *
 * Episode likes (no account), episode comments, a Reddit-style community board, upvotes, reports,
 * passwordless sign-in by emailed link, and moderation. Posts go live immediately unless they look
 * risky (links, contact details, numbers that could be account/SSN/VIN, flagged words), in which
 * case they are held for review and only their author sees them.
 *
 * Secrets: TURNSTILE_SECRET, RESEND_API_KEY, HMAC_KEY, MOD_KEY.  Vars: see wrangler.toml.
 */

const FLAIRS = ['Buyout Question', 'Payoff & Residual', 'Equity Check', 'Financing', 'Keys or Keep', 'Success Story', 'General'];
const LIMITS = { name: 40, title: 140, body: 4000 };

// ------------------------------------------------------------------ helpers
const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
async function sha256(s) { return b64url(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function hmac(env, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.HMAC_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
const clean = (s, max) => String(s || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
const json = (data, status, headers) => new Response(JSON.stringify(data), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

async function ipHash(env, req) {
  const day = new Date().toISOString().slice(0, 10);   // rotates daily; raw IPs are never stored
  return (await sha256(`${req.headers.get('CF-Connecting-IP') || '0'}|${day}|${env.HMAC_KEY}`)).slice(0, 22);
}

async function rateLimit(env, key, max, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT n, reset_at FROM rate WHERE k = ?').bind(key).first();
  if (!row || row.reset_at <= now) {
    await env.DB.prepare('INSERT OR REPLACE INTO rate (k, n, reset_at) VALUES (?, 1, ?)').bind(key, now + windowSec).run();
    return;
  }
  if (row.n >= max) throw new HttpError(429, 'Slow down a little and try again shortly.');
  await env.DB.prepare('UPDATE rate SET n = n + 1 WHERE k = ?').bind(key).run();
}

async function verifyTurnstile(env, token, req) {
  if (!token) throw new HttpError(400, 'Please complete the quick human check.');
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET); form.append('response', token);
  form.append('remoteip', req.headers.get('CF-Connecting-IP') || '');
  const r = await (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })).json();
  if (!r.success) throw new HttpError(400, 'The human check failed. Please try again.');
}

// Episode ids are validated against the live site so nobody can create pages for made-up episodes.
let epCache = { at: 0, ids: null };
async function episodeExists(env, id) {
  if (!epCache.ids || Date.now() - epCache.at > 10 * 60 * 1000) {
    const r = await fetch(`${env.SITE_URL}/assets/episodes.json`, { cf: { cacheTtl: 300 } });
    if (r.ok) epCache = { at: Date.now(), ids: new Set(Object.keys(await r.json())) };
  }
  return !!(epCache.ids && epCache.ids.has(id));
}

// ------------------------------------------------------------------ moderation rules
const FLAGGED = ['fuck', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'retard', 'kike', 'spic', 'chink', 'whore', 'slut', 'kill yourself', 'kys'];
function holdReason(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|us|biz|info|xyz|ly)\b)/i.test(text)) return 'contains a link';
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) return 'contains an email address';
  if (/\b\d{3}[-\s.]?\d{2}[-\s.]?\d{4}\b/.test(text)) return 'contains a number that may be an SSN';
  if (/\d{9,}/.test(text.replace(/[\s-]/g, ''))) return 'contains a long number (possible account number)';
  if (/\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(text)) return 'contains a phone number';
  if (/\b[A-HJ-NPR-Z0-9]{17}\b/.test(text.toUpperCase()) && /\d/.test(text)) return 'contains a possible VIN';
  if (FLAGGED.some((w) => t.includes(' ' + w) || t.includes(w + ' '))) return 'flagged language';
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 40 && letters === letters.toUpperCase()) return 'all caps';
  return null;
}

// ------------------------------------------------------------------ email
async function sendEmail(env, to, subject, html, text) {
  if (!env.RESEND_API_KEY) { console.log('EMAIL (no RESEND_API_KEY set):', to, subject); throw new HttpError(503, 'Email sign-in is not switched on yet. Please try again soon.'); }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, text, reply_to: env.MOD_EMAIL }),
  });
  if (!r.ok) { console.log('resend error', r.status, await r.text()); throw new HttpError(502, 'We could not send the email. Please try again.'); }
}

const mailShell = (inner) => `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0b1222">
<div style="font-size:20px;font-weight:800;letter-spacing:-.01em">Lease End <span style="color:#e90102">Live</span></div>${inner}
<p style="color:#6b7891;font-size:12px;margin-top:28px">Lease End Live is published by Champion Auto Finance. Champion Auto Finance is not a lender; approvals and terms are subject to lender underwriting.</p></div>`;

async function notifyMods(env, post, reason, user) {
  if (!env.RESEND_API_KEY || !env.MOD_EMAIL) return;
  const base = `${env.API_URL}/v1/mod/review?id=${post.id}`;
  const sig = await hmac(env, `review:${post.id}`);
  const where = post.kind === 'comment' ? `episode ${post.episode_id}` : post.kind === 'thread' ? 'a new community thread' : `a reply in thread #${post.thread_id}`;
  const html = mailShell(`<p>A post on ${esc(where)} needs review: <b>${esc(reason)}</b>.</p>
<p><b>${esc(user.name)}</b> (${esc(user.email)}) wrote:</p><blockquote style="border-left:3px solid #ccc;margin:0;padding:8px 12px;white-space:pre-wrap">${post.title ? `<b>${esc(post.title)}</b><br>` : ''}${esc(post.body)}</blockquote>
<p><a href="${base}&sig=${sig}" style="display:inline-block;background:#0b1222;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Review this post</a></p>`);
  try { await sendEmail(env, env.MOD_EMAIL, `Lease End Live: post held for review (${reason})`, html, `A post needs review (${reason}). ${base}&sig=${sig}`); } catch (e) { console.log('mod notify failed', e.message); }
}

// ------------------------------------------------------------------ auth
async function currentUser(env, req) {
  const h = req.headers.get('Authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  const th = await sha256(h.slice(7));
  return env.DB.prepare('SELECT u.id, u.name, u.email, u.role, u.banned FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').bind(th).first();
}
async function requireUser(env, req) {
  const u = await currentUser(env, req);
  if (!u) throw new HttpError(401, 'Please confirm your email to post.');
  if (u.banned) throw new HttpError(403, 'This account can no longer post.');
  return u;
}

async function authStart(env, req, body) {
  const email = clean(body.email, 200).toLowerCase();
  const name = clean(body.name, LIMITS.name).replace(/\s+/g, ' ');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
  if (name.length < 2) throw new HttpError(400, 'Please enter a display name (at least 2 characters).');
  if (holdReason(name)) throw new HttpError(400, 'Please choose a different display name.');
  const ip = await ipHash(env, req);
  await rateLimit(env, `auth-ip:${ip}`, 6, 3600);
  await rateLimit(env, `auth-email:${await sha256(email)}`, 4, 3600);
  await verifyTurnstile(env, body.turnstile, req);
  const token = randomToken();
  await env.DB.prepare("INSERT INTO magic_links (token_hash, email, name, expires_at) VALUES (?, ?, ?, datetime('now', '+30 minutes'))")
    .bind(await sha256(token), email, name).run();
  const ret = /^\/[a-z0-9\-/?=&#._%]*$/i.test(body.return || '') ? body.return : '/community/';
  const link = `${env.SITE_URL}/verify/?t=${token}&r=${encodeURIComponent(ret)}`;
  await sendEmail(env, email, 'Confirm your email for Lease End Live',
    mailShell(`<p>Hi ${esc(name)},</p><p>Tap the button to confirm your email and post on Lease End Live. The link works for 30 minutes.</p>
<p><a href="${link}" style="display:inline-block;background:#e90102;color:#fff;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:700">Confirm and continue</a></p>
<p style="color:#6b7891;font-size:13px">Your email is never shown publicly. If you didn't ask for this, you can ignore it.</p>`),
    `Confirm your email for Lease End Live: ${link}\n\nIf you didn't ask for this, ignore this email.`);
  return { ok: true };
}

async function authVerify(env, body) {
  const th = await sha256(String(body.token || ''));
  const m = await env.DB.prepare("SELECT * FROM magic_links WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')").bind(th).first();
  if (!m) throw new HttpError(400, 'That link has expired or was already used. Please request a new one.');
  await env.DB.prepare('UPDATE magic_links SET used = 1 WHERE token_hash = ?').bind(th).run();
  const hosts = (env.HOST_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const role = hosts.includes(m.email) ? 'host' : 'member';
  await env.DB.prepare(`INSERT INTO users (email, name, role, verified_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = CASE WHEN users.role = 'host' THEN 'host' ELSE excluded.role END,
    verified_at = COALESCE(users.verified_at, excluded.verified_at)`).bind(m.email, m.name, role).run();
  const u = await env.DB.prepare('SELECT id, name, role, banned FROM users WHERE email = ?').bind(m.email).first();
  const session = randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id) VALUES (?, ?)').bind(await sha256(session), u.id).run();
  return { session, user: { id: u.id, name: u.name, role: u.role } };
}

// ------------------------------------------------------------------ reads
function shapePost(p, me, myVotes) {
  return { id: p.id, kind: p.kind, episode_id: p.episode_id, thread_id: p.thread_id, parent_id: p.parent_id,
    title: p.title, body: p.status === 'removed' ? '' : p.body, flair: p.flair, status: p.status,
    held: p.status === 'held', removed: p.status === 'removed', score: p.score, reply_count: p.reply_count,
    created_at: p.created_at + 'Z', author: { id: p.user_id, name: p.status === 'removed' ? '[removed]' : p.author_name, host: p.author_role === 'host' },
    mine: !!(me && me.id === p.user_id), voted: !!(myVotes && myVotes.has(p.id)) };
}
const POST_COLS = 'p.*, u.name AS author_name, u.role AS author_role';
async function visible(env, where, binds, me, order) {
  // live posts for everyone; held posts only for their author
  const q = `SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE ${where} AND (p.status = 'live' OR (p.status = 'held' AND p.user_id = ?)) ${order || ''}`;
  return (await env.DB.prepare(q).bind(...binds, me ? me.id : -1).all()).results;
}
async function votesFor(env, me, ids) {
  if (!me || !ids.length) return new Set();
  const r = await env.DB.prepare(`SELECT post_id FROM votes WHERE user_id = ? AND post_id IN (${ids.map(() => '?').join(',')})`).bind(me.id, ...ids).all();
  return new Set(r.results.map((x) => x.post_id));
}

async function getEpisode(env, req, id, url) {
  const me = await currentUser(env, req);
  const device = clean(url.searchParams.get('device'), 64);
  const likes = (await env.DB.prepare('SELECT COUNT(*) AS n FROM episode_likes WHERE episode_id = ?').bind(id).first()).n;
  const liked = device ? !!(await env.DB.prepare('SELECT 1 FROM episode_likes WHERE episode_id = ? AND device = ?').bind(id, device).first()) : false;
  const rows = await visible(env, "p.episode_id = ? AND p.kind IN ('comment','reply')", [id], me, 'ORDER BY p.created_at ASC');
  const mv = await votesFor(env, me, rows.map((r) => r.id));
  return { episode_id: id, likes, liked, comments: rows.map((r) => shapePost(r, me, mv)) };
}

function hot(p) {
  const hours = (Date.now() - Date.parse(p.created_at + 'Z')) / 3.6e6;
  return (p.score + p.reply_count * 0.5 + 1) / Math.pow(hours + 2, 1.5);
}
async function community(env, req, url) {
  const me = await currentUser(env, req);
  const sort = ['hot', 'new', 'top'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'hot';
  const flair = FLAIRS.includes(url.searchParams.get('flair')) ? url.searchParams.get('flair') : null;
  const where = "p.kind = 'thread'" + (flair ? ' AND p.flair = ?' : '');
  const order = sort === 'top' ? 'ORDER BY p.score DESC, p.created_at DESC' : 'ORDER BY p.created_at DESC';
  let rows = await visible(env, where, flair ? [flair] : [], me, order + ' LIMIT 200');
  if (sort === 'hot') rows.sort((a, b) => hot(b) - hot(a));
  rows = rows.slice(0, 60);
  const mv = await votesFor(env, me, rows.map((r) => r.id));
  const members = (await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE verified_at IS NOT NULL AND banned = 0').first()).n;
  return { flairs: FLAIRS, members, threads: rows.map((r) => shapePost(r, me, mv)) };
}
async function thread(env, req, id) {
  const me = await currentUser(env, req);
  const t = (await visible(env, "p.id = ? AND p.kind = 'thread'", [id], me))[0];
  if (!t) throw new HttpError(404, 'That thread does not exist or was removed.');
  const replies = await visible(env, "p.thread_id = ? AND p.kind = 'reply'", [id], me, 'ORDER BY p.created_at ASC');
  const mv = await votesFor(env, me, [t.id, ...replies.map((r) => r.id)]);
  return { thread: shapePost(t, me, mv), replies: replies.map((r) => shapePost(r, me, mv)), flairs: FLAIRS };
}

// ------------------------------------------------------------------ writes
async function createPost(env, req, body) {
  const me = await requireUser(env, req);
  await rateLimit(env, `post:${me.id}`, 12, 3600);
  await rateLimit(env, `post-ip:${await ipHash(env, req)}`, 30, 3600);
  const kind = body.kind;
  const text = clean(body.body, LIMITS.body);
  if (text.length < 2) throw new HttpError(400, 'Write a little more before posting.');
  let episode_id = null, thread_id = null, parent_id = null, title = null, flair = null;
  if (kind === 'comment') {
    episode_id = clean(body.episode_id, 120);
    if (!(await episodeExists(env, episode_id))) throw new HttpError(404, 'Unknown episode.');
    if (body.parent_id) {
      const par = await env.DB.prepare("SELECT id, parent_id FROM posts WHERE id = ? AND episode_id = ? AND status != 'removed'").bind(+body.parent_id, episode_id).first();
      if (!par) throw new HttpError(404, 'The comment you replied to is gone.');
      parent_id = par.parent_id || par.id;   // one level of nesting keeps threads readable
    }
  } else if (kind === 'thread') {
    title = clean(body.title, LIMITS.title);
    if (title.length < 5) throw new HttpError(400, 'Give your post a title (at least 5 characters).');
    flair = FLAIRS.includes(body.flair) ? body.flair : 'General';
  } else if (kind === 'reply') {
    thread_id = +body.thread_id;
    const t = await env.DB.prepare("SELECT id FROM posts WHERE id = ? AND kind = 'thread' AND status = 'live'").bind(thread_id).first();
    if (!t) throw new HttpError(404, 'That thread is not open for replies.');
    if (body.parent_id) {
      const par = await env.DB.prepare("SELECT id, parent_id FROM posts WHERE id = ? AND thread_id = ?").bind(+body.parent_id, thread_id).first();
      if (par) parent_id = par.parent_id || par.id;
    }
  } else throw new HttpError(400, 'Unknown post type.');

  const reason = me.role === 'host' ? null : holdReason(`${title || ''}\n${text}`);
  const status = reason ? 'held' : 'live';
  const r = await env.DB.prepare(`INSERT INTO posts (kind, episode_id, thread_id, parent_id, user_id, title, body, flair, status, hold_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`).bind(kind, episode_id, thread_id, parent_id, me.id, title, text, flair, status, reason).first();
  if (status === 'live') {
    if (kind === 'reply') await env.DB.prepare("UPDATE posts SET reply_count = reply_count + 1, last_activity = datetime('now') WHERE id = ?").bind(thread_id).run();
    if (parent_id) await env.DB.prepare('UPDATE posts SET reply_count = reply_count + 1 WHERE id = ?').bind(parent_id).run();
  } else await notifyMods(env, r, reason, me);
  return { post: shapePost({ ...r, author_name: me.name, author_role: me.role }, me, new Set()),
    notice: reason ? `Your post is waiting for a quick review because it ${reason}. Only you can see it until then.` : null };
}

async function vote(env, req, id, body) {
  const me = await requireUser(env, req);
  const p = await env.DB.prepare("SELECT id, user_id FROM posts WHERE id = ? AND status = 'live'").bind(id).first();
  if (!p) throw new HttpError(404, 'Post not found.');
  if (body.on) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO votes (post_id, user_id) VALUES (?, ?)').bind(id, me.id).run();
    if (r.meta.changes) await env.DB.prepare('UPDATE posts SET score = score + 1 WHERE id = ?').bind(id).run();
  } else {
    const r = await env.DB.prepare('DELETE FROM votes WHERE post_id = ? AND user_id = ?').bind(id, me.id).run();
    if (r.meta.changes) await env.DB.prepare('UPDATE posts SET score = score - 1 WHERE id = ?').bind(id).run();
  }
  const s = await env.DB.prepare('SELECT score FROM posts WHERE id = ?').bind(id).first();
  return { score: s.score, voted: !!body.on };
}

async function likeEpisode(env, req, id, body) {
  if (!(await episodeExists(env, id))) throw new HttpError(404, 'Unknown episode.');
  const device = clean(body.device, 64);
  if (!/^[a-z0-9-]{16,64}$/i.test(device)) throw new HttpError(400, 'Bad request.');
  const ip = await ipHash(env, req);
  await rateLimit(env, `like:${ip}`, 60, 3600);
  if (body.on) {
    const sameNet = (await env.DB.prepare('SELECT COUNT(*) AS n FROM episode_likes WHERE episode_id = ? AND ip_hash = ?').bind(id, ip).first()).n;
    if (sameNet < 5) await env.DB.prepare('INSERT OR IGNORE INTO episode_likes (episode_id, device, ip_hash) VALUES (?, ?, ?)').bind(id, device, ip).run();
  } else await env.DB.prepare('DELETE FROM episode_likes WHERE episode_id = ? AND device = ?').bind(id, device).run();
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM episode_likes WHERE episode_id = ?').bind(id).first()).n;
  const liked = !!(await env.DB.prepare('SELECT 1 FROM episode_likes WHERE episode_id = ? AND device = ?').bind(id, device).first());
  return { likes: n, liked };
}

async function report(env, req, id, body) {
  const me = await currentUser(env, req);
  const reporter = me ? `u${me.id}` : `d${clean(body.device, 64)}|${await ipHash(env, req)}`;
  await rateLimit(env, `report:${await ipHash(env, req)}`, 20, 3600);
  const p = await env.DB.prepare(`SELECT ${POST_COLS} FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND p.status = 'live'`).bind(id).first();
  if (!p) return { ok: true };
  await env.DB.prepare('INSERT OR IGNORE INTO reports (post_id, reason, reporter) VALUES (?, ?, ?)').bind(id, clean(body.reason, 200), reporter).run();
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE post_id = ?').bind(id).first()).n;
  if (n >= 3) {   // three separate reports hide a post until a moderator looks
    await env.DB.prepare("UPDATE posts SET status = 'held', hold_reason = 'reported by readers' WHERE id = ?").bind(id).run();
    await notifyMods(env, p, 'reported by readers', { name: p.author_name, email: '(see moderation queue)' });
  }
  return { ok: true };
}

async function deleteOwn(env, req, id) {
  const me = await requireUser(env, req);
  const r = await env.DB.prepare("UPDATE posts SET status = 'removed', hold_reason = 'removed by author' WHERE id = ? AND user_id = ?").bind(id, me.id).run();
  if (!r.meta.changes) throw new HttpError(404, 'Post not found.');
  return { ok: true };
}

// ------------------------------------------------------------------ moderation
async function modAction(env, id, action) {
  const p = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first();
  if (!p) throw new HttpError(404, 'Post not found.');
  if (action === 'approve') {
    await env.DB.prepare("UPDATE posts SET status = 'live', hold_reason = NULL WHERE id = ?").bind(id).run();
    await env.DB.prepare('DELETE FROM reports WHERE post_id = ?').bind(id).run();
    if (p.status === 'held' && p.kind === 'reply') await env.DB.prepare("UPDATE posts SET reply_count = reply_count + 1, last_activity = datetime('now') WHERE id = ?").bind(p.thread_id).run();
  } else if (action === 'remove') {
    await env.DB.prepare("UPDATE posts SET status = 'removed', hold_reason = 'removed by moderator' WHERE id = ?").bind(id).run();
  } else if (action === 'ban') {
    await env.DB.prepare("UPDATE posts SET status = 'removed', hold_reason = 'removed by moderator' WHERE user_id = ? AND status != 'removed'").bind(p.user_id).run();
    await env.DB.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind(p.user_id).run();
  } else throw new HttpError(400, 'Unknown action.');
  return { ok: true, id, action };
}
function requireMod(env, req) {
  const h = req.headers.get('Authorization') || '';
  if (!env.MOD_KEY || h !== `Bearer ${env.MOD_KEY}`) throw new HttpError(401, 'Moderator key required.');
}
async function modQueue(env) {
  const rows = (await env.DB.prepare(`SELECT p.*, u.name AS author_name, u.email AS author_email,
      (SELECT COUNT(*) FROM reports r WHERE r.post_id = p.id) AS reports
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.status = 'held' OR p.id IN (SELECT post_id FROM reports) ORDER BY p.created_at DESC LIMIT 200`).all()).results;
  return { queue: rows };
}
// Email links open a confirmation page; the action itself is a POST so link scanners can't trigger it.
async function modReviewPage(env, url, method, form) {
  const id = +url.searchParams.get('id'), sig = url.searchParams.get('sig') || '';
  if (sig !== (await hmac(env, `review:${id}`))) return new Response('Link not valid.', { status: 403 });
  let done = '';
  if (method === 'POST') { const a = form.get('a'); await modAction(env, id, a); done = `<p style="color:#0a7d3e"><b>Done: ${esc(a)}.</b></p>`; }
  const p = await env.DB.prepare('SELECT p.*, u.name AS author_name, u.email AS author_email FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?').bind(id).first();
  if (!p) return new Response('Post not found.', { status: 404 });
  const btn = (a, label, color) => `<button name="a" value="${a}" style="background:${color};color:#fff;border:0;padding:10px 16px;border-radius:8px;font-weight:700;cursor:pointer;margin-right:8px">${label}</button>`;
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Review post</title>
${mailShell(`${done}<p>Status: <b>${esc(p.status)}</b>${p.hold_reason ? ` (${esc(p.hold_reason)})` : ''}</p>
<p><b>${esc(p.author_name)}</b> &lt;${esc(p.author_email)}&gt; · ${esc(p.kind)}${p.episode_id ? ' on ' + esc(p.episode_id) : ''}</p>
<blockquote style="border-left:3px solid #ccc;margin:0 0 16px;padding:8px 12px;white-space:pre-wrap">${p.title ? `<b>${esc(p.title)}</b><br>` : ''}${esc(p.body)}</blockquote>
<form method="post">${btn('approve', 'Approve', '#0a7d3e')}${btn('remove', 'Remove', '#b42318')}${btn('ban', 'Remove + ban author', '#3b0a0a')}</form>`)}`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// ------------------------------------------------------------------ router
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { headers: h });
    try {
      const p = url.pathname;
      let m;
      if (p === '/v1/mod/review') return await modReviewPage(env, url, req.method, req.method === 'POST' ? await req.formData() : null);
      const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
      let out;
      if (p === '/v1/health') out = { ok: true };
      else if ((m = p.match(/^\/v1\/episode\/([a-z0-9-]+\/[a-z0-9-]+)$/)) && req.method === 'GET') out = await getEpisode(env, req, m[1], url);
      else if ((m = p.match(/^\/v1\/episode\/([a-z0-9-]+\/[a-z0-9-]+)\/like$/)) && req.method === 'POST') out = await likeEpisode(env, req, m[1], body);
      else if (p === '/v1/auth/start' && req.method === 'POST') out = await authStart(env, req, body);
      else if (p === '/v1/auth/verify' && req.method === 'POST') out = await authVerify(env, body);
      else if (p === '/v1/me') { const u = await currentUser(env, req); out = { user: u ? { id: u.id, name: u.name, role: u.role } : null }; }
      else if (p === '/v1/posts' && req.method === 'POST') out = await createPost(env, req, body);
      else if ((m = p.match(/^\/v1\/posts\/(\d+)\/vote$/)) && req.method === 'POST') out = await vote(env, req, +m[1], body);
      else if ((m = p.match(/^\/v1\/posts\/(\d+)\/report$/)) && req.method === 'POST') out = await report(env, req, +m[1], body);
      else if ((m = p.match(/^\/v1\/posts\/(\d+)$/)) && req.method === 'DELETE') out = await deleteOwn(env, req, +m[1]);
      else if (p === '/v1/community' && req.method === 'GET') out = await community(env, req, url);
      else if ((m = p.match(/^\/v1\/thread\/(\d+)$/)) && req.method === 'GET') out = await thread(env, req, +m[1]);
      else if (p === '/v1/mod/queue') { requireMod(env, req); out = await modQueue(env); }
      else if ((m = p.match(/^\/v1\/mod\/(\d+)\/(approve|remove|ban)$/)) && req.method === 'POST') { requireMod(env, req); out = await modAction(env, +m[1], m[2]); }
      else throw new HttpError(404, 'Not found.');
      return json(out, 200, h);
    } catch (e) {
      if (!(e instanceof HttpError)) console.log('error', e.stack || e);
      return json({ error: e instanceof HttpError ? e.message : 'Something went wrong. Please try again.' }, e.status || 500, h);
    }
  },
};
