'use strict';
// End-to-end auth test: spawns the server, mocks Google's tokeninfo, reads emailed links from the server log.
const { spawn } = require('child_process'); const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const assert = require('assert');
const PORT = 3200 + Math.floor(Math.random() * 500), GPORT = PORT + 1000, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcg-'));
const base = `http://localhost:${PORT}`;
let log = '';
const gmock = http.createServer((req, res) => { const t = new URL(req.url, 'http://x').searchParams.get('id_token'); res.setHeader('content-type', 'application/json');
  const T = { good: { aud: 'CID', email: 'friend@example.com', email_verified: 'true', sub: 'sub-1', name: 'Friend', exp: String(Date.now() / 1000 + 600) }, stranger: { aud: 'CID', email: 'nobody@example.com', email_verified: 'true', sub: 's2', exp: String(Date.now() / 1000 + 600) }, wrongaud: { aud: 'X', email: 'friend@example.com', email_verified: 'true', sub: 'sub-1', exp: String(Date.now() / 1000 + 600) } };
  if (T[t]) res.end(JSON.stringify(T[t])); else { res.statusCode = 400; res.end('{}'); } }).listen(GPORT);
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dir, OWNER_EMAIL: 'owner@example.com', HOST_PIN: 'pin123', GOOGLE_CLIENT_ID: 'CID', GOOGLE_TOKENINFO_URL: `http://localhost:${GPORT}/tokeninfo`, RESEND_API_KEY: '' } });
srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client() { let cookie = ''; return async (p, body, extra = {}) => { const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', cookie, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }); const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { s: r.status, j: await r.json().catch(() => ({})) }; }; }
const linkFromLog = () => { const m = [...log.matchAll(/(http:\/\/[^\s]+\/reset\?token=[\w-]+)/g)]; return m.length ? m[m.length - 1][1] : null; };
(async () => {
  await sleep(1200);
  const anon = client(), owner = client(), host = client();
  // anonymous cannot act or open admin
  assert.equal((await anon('/api/act', { type: 'draw' })).s, 401); assert.equal((await anon('/api/admin/overview')).s, 401); assert.equal((await anon('/api/me')).s, 401);
  assert.equal((await anon('/api/state')).j.practice, true, 'starts in practice mode');
  // owner never set a password: login fails, request link works, unknown email gets the same generic reply and no link
  assert.equal((await owner('/api/auth/login', { email: 'owner@example.com', password: 'whatever123' })).s, 401);
  const unk = await anon('/api/auth/request', { email: 'stranger@example.com' }); assert.equal(unk.s, 200); assert.ok(!linkFromLog(), 'no link for unknown email');
  const req = await owner('/api/auth/request', { email: 'owner@example.com' }); assert.equal(req.s, 200); await sleep(100);
  const link = linkFromLog(); assert.ok(link, 'owner link logged'); const token = new URL(link).searchParams.get('token');
  assert.equal((await owner('/api/auth/reset', { token, password: 'short' })).s, 400);
  const set = await owner('/api/auth/reset', { token, password: 'OwnerPassw0rd!' }); assert.equal(set.s, 200); assert.equal(set.j.role, 'owner');
  assert.equal((await owner('/api/auth/reset', { token, password: 'OwnerPassw0rd!' })).s, 400, 'token is single-use');
  assert.equal((await owner('/api/me')).j.role, 'owner');
  // wrong password
  assert.equal((await client()('/api/auth/login', { email: 'owner@example.com', password: 'nope-nope-nope' })).s, 401);
  // owner invites a host
  const inv = await owner('/api/admin/invite', { email: 'Friend@Example.com' }); assert.equal(inv.s, 200); assert.ok(inv.j.link.includes('/reset?token='));
  assert.equal((await host('/api/auth/reset', { token: new URL(inv.j.link).searchParams.get('token'), password: 'FriendPass123!' })).s, 200);
  assert.equal((await host('/api/me')).j.role, 'host');
  // host can run the auction, cannot touch admin
  assert.equal((await host('/api/act', { type: 'draw' })).s, 200); assert.equal((await host('/api/admin/overview')).s, 403); assert.equal((await host('/api/admin/practice', { on: false, confirm: 'GO LIVE' })).s, 403);
  // cross-site POST blocked
  assert.equal((await host('/api/act', { type: 'undo' }, { origin: 'https://evil.example' })).s, 403);
  // emergency PIN works as host but not admin
  const pin = client(); assert.equal((await pin('/api/act', { type: 'undo' }, { 'x-host-pin': 'pin123' })).s, 200); assert.equal((await pin('/api/admin/overview', undefined, { 'x-host-pin': 'pin123' })).s, 403);
  // Google: invited address works; stranger and wrong audience are refused
  const g = client(); assert.equal((await g('/api/auth/google', { credential: 'good' })).s, 200); assert.equal((await g('/api/me')).j.email, 'friend@example.com');
  assert.equal((await client()('/api/auth/google', { credential: 'stranger' })).s, 403); assert.equal((await client()('/api/auth/google', { credential: 'wrongaud' })).s, 400);
  // owner overview never leaks hashes
  const ov = await owner('/api/admin/overview'); assert.equal(ov.s, 200); assert.ok(!JSON.stringify(ov.j).includes('scrypt')); assert.equal(ov.j.users.length, 2);
  // practice -> live clears data and flips the flag; needs the typed confirmation
  await owner('/api/act', { type: 'draw' });
  assert.equal((await owner('/api/admin/practice', { on: false, confirm: 'nope' })).s, 400);
  assert.equal((await owner('/api/admin/practice', { on: false, confirm: 'go live' })).s, 200);
  const st = (await anon('/api/state')).j; assert.equal(st.practice, false); assert.equal(st.counts.sold, 0); assert.equal(st.current, null); assert.equal(st.started, false);
  // removing a host kills their session immediately
  assert.equal((await owner('/api/admin/user/remove', { email: 'friend@example.com' })).s, 200); assert.equal((await host('/api/me')).s, 401); assert.equal((await owner('/api/admin/user/remove', { email: 'owner@example.com' })).s, 400);
  // password reset invalidates old sessions
  const o2 = client(); await o2('/api/auth/login', { email: 'owner@example.com', password: 'OwnerPassw0rd!' }); assert.equal((await o2('/api/me')).s, 200);
  await owner('/api/auth/request', { email: 'owner@example.com' }); await sleep(100); const t2 = new URL(linkFromLog()).searchParams.get('token');
  assert.equal((await client()('/api/auth/reset', { token: t2, password: 'NewOwnerPass456!' })).s, 200); assert.equal((await o2('/api/me')).s, 401, 'old sessions revoked on password change');
  console.log('auth tests passed'); cleanup(0);
})().catch(e => { console.error('FAILED:', e.message); console.error(e.stack.split('\n')[1]); console.error(log.slice(-600)); cleanup(1); });
function cleanup(code) { srv.kill(); gmock.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(code); }
