'use strict';
/**
 * WCG Cricket Auction server - zero dependencies (Node >= 18).
 *  - Authoritative auction state lives here; every screen subscribes over Server-Sent Events.
 *  - Spectators/captains need no account. Hosts sign in (email+password or Google); the owner also gets /admin.
 *  - HOST_PIN (optional env) remains as an emergency host fallback.
 *  - State is saved to DATA_DIR (set it to a Render persistent-disk path to survive restarts).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('./lib/engine');

const PORT = process.env.PORT || 3000;
const HOST_PIN = process.env.HOST_PIN || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC = path.join(__dirname, 'public');
const STARTED = Date.now();
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { console.warn(e.message); }
const A = require('./lib/auth')(DATA_DIR);

let state = E.freshState();
try { if (fs.existsSync(STATE_FILE)) { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); console.log('Restored auction state, rev', state.rev); } }
catch (e) { console.warn('Could not restore state:', e.message); }

/* Data migration: when the default roster/rules change (E.DATA_VERSION), an auction that has not started (or is in practice) is moved to the new defaults. */
if ((state.dataVersion || 1) < E.DATA_VERSION) {
  if (!state.started || A.site.practice) {
    const f = E.freshState(); (state.teams || []).forEach((t, i) => { if (f.teams[i] && t.name) f.teams[i].name = t.name; });
    f.rev = (state.rev || 0) + 1; f.seq = (state.seq || 0) + 1; state = f; console.log('Migrated auction data to version', E.DATA_VERSION, '(new roster and rules)');
  } else console.warn('Auction is live and started: NOT migrating to the new roster/rules. Owner can use Players > "Load sheet defaults" when appropriate.');
}
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
try { fs.mkdirSync(PHOTO_DIR, { recursive: true }); } catch (e) { console.warn(e.message); }

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state)); fs.renameSync(STATE_FILE + '.tmp', STATE_FILE); } catch (e) { console.warn('save failed', e.message); } }, 200);
}

/* ---------- live clients (SSE) ---------- */
const clients = new Set();
let lastView = null;
function currentView() {
  if (!(lastView && lastView.rev === state.rev && lastView.seq === state.seq)) lastView = E.view(state);
  return Object.assign({}, lastView, { practice: A.site.practice, stream: A.site.stream || null });
}
function broadcast() {
  const data = 'data: ' + JSON.stringify(currentView()) + '\n\n';
  for (const res of clients) { try { res.write(data); } catch (_) { clients.delete(res); } }
}
setInterval(() => { for (const res of clients) { try { res.write(': hb\n\n'); } catch (_) { clients.delete(res); } } }, 20000);

/* ---------- helpers ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.xml': 'application/xml' };
const ROUTES = { '/': 'index.html', '/host': 'host.html', '/live': 'live.html', '/squads': 'squads.html', '/players': 'players.html', '/login': 'login.html', '/reset': 'login.html', '/admin': 'admin.html', '/sitemap': 'sitemap.html' };

const secureReq = req => (req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https' || !!req.socket.encrypted;
const baseUrl = req => (process.env.PUBLIC_URL || `${secureReq(req) ? 'https' : 'http'}://${req.headers.host}`).replace(/\/$/, '');
const ipOf = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'x';

function json(res, code, obj, extra) { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, extra || {})); res.end(JSON.stringify(obj)); }
function body(req, limit = 2e6) {
  return new Promise((ok, bad) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > limit) { bad(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(e); } });
  });
}
function sameOrigin(req) { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host; } catch (_) { return false; } }

/** Who is calling? {email, role, via} | null.  role: owner | host.  Emergency PIN counts as host. */
const pinFails = new Map();
function who(req) {
  const u = A.sessionUser(req); if (u) return { email: u.email, role: u.role, name: u.name, via: 'session' };
  const given = req.headers['x-host-pin']; if (!HOST_PIN || !given) return null;
  const ip = ipOf(req), f = pinFails.get(ip) || { n: 0, until: 0 };
  if (Date.now() < f.until) return 'locked';
  const a = crypto.createHash('sha256').update(String(given)).digest(), b = crypto.createHash('sha256').update(HOST_PIN).digest();
  if (crypto.timingSafeEqual(a, b)) { pinFails.delete(ip); return { email: 'emergency-pin', role: 'host', via: 'pin' }; }
  f.n += 1; if (f.n >= 8) { f.until = Date.now() + 60000; f.n = 0; } pinFails.set(ip, f); return null;
}
function needHost(req, res) { const w = who(req); if (w === 'locked') { json(res, 429, { error: 'Too many wrong PINs. Wait a minute.' }); return null; } if (!w) { json(res, 401, { error: 'Please sign in as host.' }); return null; } if (req.method !== 'GET' && !sameOrigin(req)) { json(res, 403, { error: 'Cross-site request blocked.' }); return null; } return w; }
function needOwner(req, res) { const w = needHost(req, res); if (!w) return null; if (w.role !== 'owner') { json(res, 403, { error: 'Owner only.' }); return null; } return w; }

function csv() {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = [['Player', 'Category', 'Availability', 'Base price', 'Status', 'Team', 'Captain', 'Sold price', 'Round']];
  for (const p of state.players) {
    const t = state.teams.find(t => t.id === p.team), b = t && t.buys.find(b => b.playerId === p.id);
    rows.push([p.name, p.cat, Math.round(p.avail * 100) + '%', p.base, p.status.toUpperCase(), t ? t.name : '', t ? t.captain : '', p.price ?? '', b ? b.round : '']);
  }
  rows.push([]); rows.push(['TEAM', 'Captain', 'Players bought', 'Spent', 'Purse left']);
  for (const t of state.teams) rows.push([t.name, t.captain, t.buys.length, t.buys.reduce((n, b) => n + b.price, 0), state.config.purse - t.buys.reduce((n, b) => n + b.price, 0)]);
  if (A.site.practice) rows.unshift(['PRACTICE MODE - results do not count']);
  return rows.map(r => r.map(q).join(',')).join('\n');
}
function resetAuction() {
  E.apply(state, 'reset', {}); state._undo = []; persist(); broadcast();
}
const loginOk = (res, req, u, extra) => { A.touchLogin(u); A.audit(u.email, 'login', ''); json(res, 200, Object.assign({ ok: true, role: u.role, email: u.email }, extra || {}), { 'Set-Cookie': A.cookieFor(u, secureReq(req)) }); };

/** YouTube link -> {kind:'video'|'channel', id}. Accepts watch / youtu.be / live / embed / shorts URLs, a bare 11-char id, or a /channel/UC... link. */
function parseYouTube(input) {
  const t = String(input || '').trim(); if (!t) return null;
  if (/^[\w-]{11}$/.test(t)) return { kind: 'video', id: t };
  let u; try { u = new URL(/^https?:/i.test(t) ? t : 'https://' + t); } catch (_) { return { error: 'That does not look like a YouTube link.' }; }
  const h = u.hostname.replace(/^www\.|^m\./, '');
  if (!['youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(h)) return { error: 'Only YouTube links are supported.' };
  if (h === 'youtu.be') { const id = u.pathname.split('/')[1]; return /^[\w-]{11}$/.test(id || '') ? { kind: 'video', id } : { error: 'Could not find the video id in that link.' }; }
  const v = u.searchParams.get('v'); if (/^[\w-]{11}$/.test(v || '')) return { kind: 'video', id: v };
  const m = u.pathname.match(/^\/(?:live|embed|shorts|v)\/([\w-]{11})/); if (m) return { kind: 'video', id: m[1] };
  const c = u.pathname.match(/^\/channel\/(UC[\w-]{22})/); if (c) return { kind: 'channel', id: c[1] };
  if (u.pathname.startsWith('/@')) return { error: 'Channel @name links cannot be embedded. Open your live video and paste its address (youtube.com/watch?v=… or youtube.com/live/…).' };
  return { error: 'Could not find a video in that link.' };
}
const PHOTO_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
function photoFile(id) { for (const e of ['jpg', 'png', 'webp']) { const f = path.join(PHOTO_DIR, id + '.' + e); if (fs.existsSync(f)) return { f, mime: Object.keys(PHOTO_EXT).find(k => PHOTO_EXT[k] === e) }; } return null; }
function sniff(buf) { if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'; if (buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png'; if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp'; return null; }
function savePhoto(id, dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '')); if (!m) return 'Please choose a JPEG, PNG or WebP image.';
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 1.5e6) return 'Image is too large (max 1.5 MB after resizing).';
  const real = sniff(buf); if (!real) return 'That file is not a valid image.';
  removePhoto(id); fs.writeFileSync(path.join(PHOTO_DIR, id + '.' + PHOTO_EXT[real]), buf); return null;
}
function removePhoto(id) { for (const e of ['jpg', 'png', 'webp']) { try { fs.unlinkSync(path.join(PHOTO_DIR, id + '.' + e)); } catch (_) {} } }

/* ---------- API ---------- */
async function api(req, res, p) {
  const m = req.method;
  if (p === '/api/state') return json(res, 200, currentView());
  if (p === '/api/site') return json(res, 200, { practice: A.site.practice, practiceSince: A.site.practiceSince, googleClientId: process.env.GOOGLE_CLIENT_ID || null, stream: A.site.stream || null });
  if (p === '/api/me') { const w = who(req); if (!w || w === 'locked') return json(res, 401, { error: 'Not signed in' }); return json(res, 200, { email: w.email, role: w.role, name: w.name, via: w.via }); }

  if (m === 'POST' && p.startsWith('/api/auth/')) {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-site request blocked.' });
    const b = await body(req, 20000); const ip = ipOf(req);
    if (p === '/api/auth/logout') return json(res, 200, { ok: true }, { 'Set-Cookie': A.clearCookie(secureReq(req)) });
    if (p === '/api/auth/login') {
      const email = A.normEmail(b.email);
      if (A.limited('login:' + ip, 12, 600000) || (email && A.limited('loginE:' + email, 8, 600000))) return json(res, 429, { error: 'Too many attempts. Wait a few minutes.' });
      const u = email && A.users[email]; const good = await A.checkPw(b.password, u && u.passHash);
      if (!u || !good || u.status !== 'active') { A.audit(email || '?', 'login-failed', ip); return json(res, 401, { error: 'Email or password is incorrect. Haven\'t set a password yet? Use "Create or reset password".' }); }
      return loginOk(res, req, u);
    }
    if (p === '/api/auth/request') {
      const email = A.normEmail(b.email);
      if (A.limited('req:' + ip, 6, 3600000) || (email && A.limited('reqE:' + email, 3, 3600000))) return json(res, 429, { error: 'Too many requests. Try again later.' });
      const generic = { ok: true, message: 'If that email is on the host list, a link is on its way. Check your inbox (and spam).' };
      const u = email && A.users[email]; if (!u) { A.audit(email || '?', 'link-request-unknown', ip); return json(res, 200, generic); }
      const first = !u.passHash, raw = A.makeToken(email, first ? 'invite' : 'reset', first ? 7 * 86400000 : 3600000);
      const mail = A.linkMail(baseUrl(req) + '/reset?token=' + raw, first ? 'invite' : 'reset');
      await A.sendMail(email, mail.subject, mail.html, mail.text); A.audit(email, 'link-requested', ''); return json(res, 200, generic);
    }
    if (p === '/api/auth/token') { const t = A.peekToken(b.token); return json(res, 200, t ? { valid: true, email: t.email, purpose: t.purpose } : { valid: false }); }
    if (p === '/api/auth/reset') {
      if (A.limited('reset:' + ip, 15, 600000)) return json(res, 429, { error: 'Too many attempts.' });
      const problem = A.pwProblem(b.password); if (problem) return json(res, 400, { error: problem });
      const t = A.consumeToken(b.token); if (!t) return json(res, 400, { error: 'This link has expired or was already used. Request a new one.' });
      const u = A.users[t.email]; if (!u) return json(res, 400, { error: 'This account no longer exists.' });
      await A.setPassword(u, b.password); A.audit(u.email, t.purpose === 'invite' ? 'password-created' : 'password-reset', ''); return loginOk(res, req, u);
    }
    if (p === '/api/auth/google') {
      if (A.limited('google:' + ip, 20, 600000)) return json(res, 429, { error: 'Too many attempts.' });
      const g = await A.verifyGoogle(String(b.credential || '')); if (g.error) return json(res, 400, { error: g.error });
      const u = g.email && A.users[g.email];
      if (!u) { A.audit(g.email || '?', 'google-denied', ''); return json(res, 403, { error: `${g.email} hasn't been invited as a host. Ask the owner to invite this address.` }); }
      u.googleSub = u.googleSub || g.sub; if (!u.name || u.name === g.email.split('@')[0]) u.name = g.name || u.name;
      if (u.googleSub !== g.sub) return json(res, 403, { error: 'This email is linked to a different Google account.' });
      return loginOk(res, req, u);
    }
    return json(res, 404, { error: 'Unknown endpoint' });
  }

  /* ----- host-level ----- */
  if (p === '/api/login' && m === 'POST') { const w = who(req); return json(res, w && w !== 'locked' ? 200 : w === 'locked' ? 429 : 401, { ok: !!w && w !== 'locked' }); }
  if (p === '/api/act' && m === 'POST') {
    const w = needHost(req, res); if (!w) return;
    const b = await body(req);
    if (['reset', 'loadDefaults'].includes(b.type) && !A.site.practice && w.role !== 'owner') return json(res, 403, { error: 'Only the owner can reset the auction once it is live. Use Undo to fix mistakes.' });
    if (b.type === 'setPhoto') return json(res, 400, { ok: false, error: 'Use the photo upload.' });
    const byName = b.type === 'loadDefaults' ? new Map(state.players.filter(x => x.photo).map(x => [x.name.toLowerCase(), x.id])) : null;
    const r = E.apply(state, b.type, b);
    if (r.ok && b.type === 'removePlayer') removePhoto(String(b.id || ''));
    if (r.ok && byName) {   // roster reloaded: re-key photo files (ids changed) so photos follow the player names
      const moved = [];
      for (const pl of state.players) { const old = byName.get(pl.name.toLowerCase()); const pf = old && photoFile(old); if (pf) moved.push([pl.id, fs.readFileSync(pf.f), pf.mime]); }
      for (const f of fs.readdirSync(PHOTO_DIR)) { try { fs.unlinkSync(path.join(PHOTO_DIR, f)); } catch (_) {} }
      for (const [id, buf, mime] of moved) fs.writeFileSync(path.join(PHOTO_DIR, id + '.' + PHOTO_EXT[mime]), buf);
    }
    if (r.ok) { persist(); broadcast(); if (['reset', 'loadDefaults', 'assignForce', 'settings', 'rename', 'addPlayer', 'updatePlayer', 'removePlayer', 'setTier'].includes(b.type)) A.audit(w.email, 'auction-' + b.type, ''); }
    return json(res, r.ok ? 200 : 400, r.ok ? { ok: true, rev: state.rev } : { ok: false, error: r.error });
  }
  if (p === '/api/player/photo' && m === 'POST') {
    const w = needHost(req, res); if (!w) return;
    const b = await body(req, 3e6); const pl = state.players.find(x => x.id === String(b.id || '')); if (!pl) return json(res, 404, { error: 'Unknown player.' });
    if (b.remove) { removePhoto(pl.id); E.apply(state, 'setPhoto', { id: pl.id, v: 0 }); persist(); broadcast(); return json(res, 200, { ok: true }); }
    const bad = savePhoto(pl.id, b.image); if (bad) return json(res, 400, { error: bad });
    E.apply(state, 'setPhoto', { id: pl.id, v: Date.now() }); A.audit(w.email, 'player-photo', pl.name); persist(); broadcast(); return json(res, 200, { ok: true, v: pl.photo });
  }
  if (p === '/api/stream' && m === 'POST') {
    const w = needHost(req, res); if (!w) return;
    const b = await body(req, 5000);
    if (!String(b.url || '').trim()) { delete A.site.stream; A.persistSite(); broadcast(); A.audit(w.email, 'stream-off', ''); return json(res, 200, { ok: true, stream: null }); }
    const y = parseYouTube(b.url); if (!y || y.error) return json(res, 400, { error: (y && y.error) || 'Could not read that link.' });
    A.site.stream = { kind: y.kind, id: y.id, url: String(b.url).trim().slice(0, 200), by: w.email, at: new Date().toISOString() }; A.persistSite(); broadcast(); A.audit(w.email, 'stream-set', y.id);
    return json(res, 200, { ok: true, stream: A.site.stream });
  }
  if (p === '/api/backup' && m === 'GET') {
    const w = needHost(req, res); if (!w) return;
    const copy = JSON.parse(JSON.stringify(state)); delete copy._undo; copy.photos = {};
    for (const pl of state.players) { const pf = pl.photo && photoFile(pl.id); if (pf) copy.photos[pl.id] = 'data:' + pf.mime + ';base64,' + fs.readFileSync(pf.f).toString('base64'); }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="WCG-auction-backup-rev${state.rev}.json"` }); return res.end(JSON.stringify(copy, null, 1));
  }
  if (p === '/api/restore' && m === 'POST') {
    const w = needHost(req, res); if (!w) return;
    const b = await body(req, 30e6);
    if (!b || !Array.isArray(b.players) || !Array.isArray(b.teams) || b.players.length < 1 || b.teams.length !== 5) return json(res, 400, { error: 'That file does not look like an auction backup.' });
    const photos = b.photos || {}; delete b.photos; b.dataVersion = b.dataVersion || 1;
    for (const pl of b.players) { removePhoto(pl.id); if (photos[pl.id] && !savePhoto(pl.id, photos[pl.id])) pl.photo = pl.photo || Date.now(); else pl.photo = 0; }
    const rev = state.rev, seq = state.seq; state = b; state.rev = rev + 1; state.seq = seq + 1; state._undo = []; if (state.current) state.current.limits = null;
    A.audit(w.email, 'auction-restore', ''); persist(); broadcast(); return json(res, 200, { ok: true });
  }

  /* ----- owner-only ----- */
  if (p.startsWith('/api/admin/')) {
    const w = needOwner(req, res); if (!w) return;
    if (p === '/api/admin/overview' && m === 'GET') {
      const v = currentView();
      return json(res, 200, {
        me: w.email, site: A.site, users: Object.values(A.users).map(A.publicUser).sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || a.email.localeCompare(b.email)),
        auction: { rev: v.rev, started: v.started, round: v.round, complete: v.complete, counts: v.counts, clients: clients.size },
        mail: { configured: A.mailConfigured(), from: process.env.MAIL_FROM || 'WCG Auction <onboarding@resend.dev>' }, google: { configured: A.googleConfigured() },
        emergencyPin: !!HOST_PIN, persistentDisk: !!process.env.DATA_DIR, uptimeSec: Math.round((Date.now() - STARTED) / 1000), audit: A.auditLog.slice(-60).reverse(), publicUrl: baseUrl(req),
      });
    }
    if (m !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    const b = await body(req, 20000);
    if (p === '/api/admin/invite' || p === '/api/admin/user/link') {
      const r = A.invite(b.email, w.email);
      if (r.error && !(p === '/api/admin/user/link' && A.users[A.normEmail(b.email)])) return json(res, 400, { error: r.error });
      const u = r.user || A.users[A.normEmail(b.email)], first = !u.passHash;
      const raw = A.makeToken(u.email, first ? 'invite' : 'reset', first ? 7 * 86400000 : 3600000), link = baseUrl(req) + '/reset?token=' + raw;
      const mail = A.linkMail(link, first ? 'invite' : 'reset', w.name || 'Karthik'); const sent = await A.sendMail(u.email, mail.subject, mail.html, mail.text);
      A.audit(w.email, p.endsWith('invite') ? 'invite' : 'send-link', u.email);
      return json(res, 200, { ok: true, emailSent: !!sent.sent, emailError: sent.error || null, link });
    }
    if (p === '/api/admin/user/remove') { const r = A.removeUser(b.email); if (r.error) return json(res, 400, { error: r.error }); A.audit(w.email, 'remove-user', b.email); return json(res, 200, { ok: true }); }
    if (p === '/api/admin/practice') {
      const on = !!b.on, want = on ? 'START PRACTICE' : 'GO LIVE';
      if (String(b.confirm || '').trim().toUpperCase() !== want) return json(res, 400, { error: `Type ${want} to confirm.` });
      A.site.practice = on; A.site.practiceSince = new Date().toISOString().slice(0, 10); A.site.changedBy = w.email; A.persistSite();
      resetAuction(); A.audit(w.email, on ? 'practice-on' : 'go-live', 'auction data cleared'); return json(res, 200, { ok: true, practice: on });
    }
    if (p === '/api/admin/reset') { resetAuction(); A.audit(w.email, 'auction-reset', ''); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: 'Unknown endpoint' });
  }
  return json(res, 404, { error: 'Unknown endpoint' });
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname;
  try {
    if (p === '/healthz') return json(res, 200, { ok: true, rev: state.rev });
    if (p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n'); res.write('data: ' + JSON.stringify(currentView()) + '\n\n');
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (p === '/api/export.csv') { res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="WCG-auction-results.csv"' }); return res.end(csv()); }
    if (p.startsWith('/api/')) return await api(req, res, p);

    if (p.startsWith('/photo/')) {
      const pf = photoFile(decodeURIComponent(p.slice(7)).replace(/[^\w-]/g, ''));
      if (!pf) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': pf.mime, 'Cache-Control': url.searchParams.get('v') ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(pf.f).pipe(res);
    }
    const file = ROUTES[p] || p.replace(/^\/+/, '');
    const full = path.normalize(path.join(PUBLIC, file));
    if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    fs.readFile(full, (e, data) => {
      if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      const ext = path.extname(full);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
      res.end(data);
    });
  } catch (e) {
    console.error(e); if (!res.headersSent) json(res, 500, { error: 'Server error' }); else res.end();
  }
});
server.keepAliveTimeout = 65000;
server.listen(PORT, () => console.log(`WCG Auction on :${PORT} | owner ${A.OWNER_EMAIL} | mail ${A.mailConfigured() ? 'Resend' : 'NOT configured (links go to log)'} | google ${A.googleConfigured() ? 'on' : 'off'} | practice ${A.site.practice ? 'ON' : 'off'}`));
