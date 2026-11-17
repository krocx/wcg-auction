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
  return Object.assign({}, lastView, { practice: A.site.practice });
}
function broadcast() {
  const data = 'data: ' + JSON.stringify(currentView()) + '\n\n';
  for (const res of clients) { try { res.write(data); } catch (_) { clients.delete(res); } }
}
setInterval(() => { for (const res of clients) { try { res.write(': hb\n\n'); } catch (_) { clients.delete(res); } } }, 20000);

/* ---------- helpers ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.xml': 'application/xml' };
const ROUTES = { '/': 'index.html', '/host': 'host.html', '/live': 'live.html', '/squads': 'squads.html', '/login': 'login.html', '/reset': 'login.html', '/admin': 'admin.html', '/sitemap': 'sitemap.html' };

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

/* ---------- API ---------- */
async function api(req, res, p) {
  const m = req.method;
  if (p === '/api/state') return json(res, 200, currentView());
  if (p === '/api/site') return json(res, 200, { practice: A.site.practice, practiceSince: A.site.practiceSince, googleClientId: process.env.GOOGLE_CLIENT_ID || null });
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
    const r = E.apply(state, b.type, b);
    if (r.ok) { persist(); broadcast(); if (['reset', 'assignForce', 'settings', 'rename'].includes(b.type)) A.audit(w.email, 'auction-' + b.type, ''); }
    return json(res, r.ok ? 200 : 400, r.ok ? { ok: true, rev: state.rev } : { ok: false, error: r.error });
  }
  if (p === '/api/backup' && m === 'GET') {
    const w = needHost(req, res); if (!w) return;
    const copy = JSON.parse(JSON.stringify(state)); delete copy._undo;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="WCG-auction-backup-rev${state.rev}.json"` }); return res.end(JSON.stringify(copy, null, 1));
  }
  if (p === '/api/restore' && m === 'POST') {
    const w = needHost(req, res); if (!w) return;
    const b = await body(req, 5e6);
    if (!b || !Array.isArray(b.players) || !Array.isArray(b.teams) || b.players.length !== 32 || b.teams.length !== 5) return json(res, 400, { error: 'That file does not look like an auction backup.' });
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
