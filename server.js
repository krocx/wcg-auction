'use strict';
/**
 * WCG Cricket Auction server - zero dependencies (Node >= 18).
 *  - Authoritative auction state lives here; every screen subscribes over Server-Sent Events.
 *  - Host actions need the host PIN (env HOST_PIN). Everything else is read-only.
 *  - State is saved to DATA_DIR/state.json (set DATA_DIR to a Render persistent-disk path to survive restarts).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('./lib/engine');

const PORT = process.env.PORT || 3000;
const HOST_PIN = process.env.HOST_PIN || 'wcg2027';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC = path.join(__dirname, 'public');

let state = E.freshState();
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(STATE_FILE)) { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); console.log('Restored auction state, rev', state.rev); }
} catch (e) { console.warn('Could not restore state:', e.message); }

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state)); fs.renameSync(STATE_FILE + '.tmp', STATE_FILE); } catch (e) { console.warn('save failed', e.message); }
  }, 200);
}

/* ---------- live clients (SSE) ---------- */
const clients = new Set();
let lastView = null;
function currentView() { return lastView && lastView.rev === state.rev && lastView.seq === state.seq ? lastView : (lastView = E.view(state)); }
function broadcast() {
  const data = 'data: ' + JSON.stringify(currentView()) + '\n\n';
  for (const res of clients) { try { res.write(data); } catch (_) { clients.delete(res); } }
}
setInterval(() => { for (const res of clients) { try { res.write(': hb\n\n'); } catch (_) { clients.delete(res); } } }, 20000);

/* ---------- helpers ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const ROUTES = { '/': 'index.html', '/host': 'host.html', '/live': 'live.html', '/squads': 'squads.html', '/rules': 'index.html' };

function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function body(req, limit = 2e6) {
  return new Promise((ok, bad) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > limit) { bad(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { bad(e); } });
  });
}
const failures = new Map();
function pinOk(req) {
  const ip = req.socket.remoteAddress || 'x';
  const f = failures.get(ip) || { n: 0, until: 0 };
  if (Date.now() < f.until) return 'locked';
  const given = String(req.headers['x-host-pin'] || '');
  const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(HOST_PIN).digest();
  if (crypto.timingSafeEqual(a, b)) { failures.delete(ip); return true; }
  f.n += 1; if (f.n >= 8) { f.until = Date.now() + 60000; f.n = 0; } failures.set(ip, f);
  return false;
}
function csv() {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = [['Player', 'Category', 'Availability', 'Base price', 'Status', 'Team', 'Captain', 'Sold price', 'Round']];
  for (const p of state.players) {
    const t = state.teams.find(t => t.id === p.team);
    const b = t && t.buys.find(b => b.playerId === p.id);
    rows.push([p.name, p.cat, Math.round(p.avail * 100) + '%', p.base, p.status.toUpperCase(), t ? t.name : '', t ? t.captain : '', p.price ?? '', b ? b.round : '']);
  }
  rows.push([]);
  rows.push(['TEAM', 'Captain', 'Players bought', 'Spent', 'Purse left']);
  for (const t of state.teams) rows.push([t.name, t.captain, t.buys.length, t.buys.reduce((n, b) => n + b.price, 0), state.config.purse - t.buys.reduce((n, b) => n + b.price, 0)]);
  return rows.map(r => r.map(q).join(',')).join('\n');
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/healthz') return json(res, 200, { ok: true, rev: state.rev });
    if (p === '/api/state') return json(res, 200, currentView());
    if (p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n'); res.write('data: ' + JSON.stringify(currentView()) + '\n\n');
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (p === '/api/export.csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="WCG-auction-results.csv"' }); return res.end(csv());
    }
    if (p === '/api/login' && req.method === 'POST') { const r = pinOk(req); return json(res, r === true ? 200 : r === 'locked' ? 429 : 401, { ok: r === true }); }
    if (p === '/api/backup' && req.method === 'GET') {
      if (pinOk(req) !== true) return json(res, 401, { error: 'Host PIN required.' });
      const copy = JSON.parse(JSON.stringify(state)); delete copy._undo;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="WCG-auction-backup-rev${state.rev}.json"` }); return res.end(JSON.stringify(copy, null, 1));
    }
    if (p === '/api/restore' && req.method === 'POST') {
      if (pinOk(req) !== true) return json(res, 401, { error: 'Host PIN required.' });
      const b = await body(req, 5e6);
      if (!b || !Array.isArray(b.players) || !Array.isArray(b.teams) || b.players.length !== 32 || b.teams.length !== 5) return json(res, 400, { error: 'That file does not look like an auction backup.' });
      const rev = state.rev, seq = state.seq; state = b; state.rev = rev + 1; state.seq = seq + 1; state._undo = []; if (state.current) state.current.limits = null;
      persist(); broadcast(); return json(res, 200, { ok: true });
    }
    if (p === '/api/act' && req.method === 'POST') {
      const pin = pinOk(req);
      if (pin !== true) return json(res, pin === 'locked' ? 429 : 401, { error: pin === 'locked' ? 'Too many wrong PINs. Wait a minute.' : 'Wrong host PIN.' });
      const b = await body(req);
      const r = E.apply(state, b.type, b);
      if (r.ok) { persist(); broadcast(); }
      return json(res, r.ok ? 200 : 400, r.ok ? { ok: true, rev: state.rev } : { ok: false, error: r.error });
    }

    // static
    let file = ROUTES[p] || p.replace(/^\/+/, '');
    const full = path.normalize(path.join(PUBLIC, file));
    if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    fs.readFile(full, (e, data) => {
      if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      const ext = path.extname(full);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
      res.end(data);
    });
  } catch (e) {
    console.error(e); if (!res.headersSent) json(res, 500, { error: 'Server error' }); else res.end();
  }
});
server.keepAliveTimeout = 65000;
server.listen(PORT, () => console.log(`WCG Auction on :${PORT}  (host PIN ${process.env.HOST_PIN ? 'from env' : 'DEFAULT "wcg2027" - set HOST_PIN!'})`));
