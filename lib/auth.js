'use strict';
/**
 * Host accounts for the WCG auction. Zero dependencies.
 *  - Allow-list model: only the owner and people the owner invites can ever sign in (spectators need no account).
 *  - Passwords: scrypt. Sessions: signed HttpOnly cookie. Links: single-use random tokens stored hashed.
 *  - Email: Resend API when RESEND_API_KEY is set, otherwise the link is printed to the server log (and shown to the owner in /admin).
 *  - Google: ID token verified against Google's tokeninfo endpoint (audience must equal GOOGLE_CLIENT_ID).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'karthik.asvsrk@gmail.com').trim().toLowerCase();
const DAY = 86400000;

module.exports = function createAuth(dataDir) {
  const F = n => path.join(dataDir, n);
  const load = (n, d) => { try { return JSON.parse(fs.readFileSync(F(n), 'utf8')); } catch (_) { return d; } };
  const timers = {};
  const save = (n, v) => { clearTimeout(timers[n]); timers[n] = setTimeout(() => { try { fs.writeFileSync(F(n) + '.tmp', JSON.stringify(v)); fs.renameSync(F(n) + '.tmp', F(n)); } catch (e) { console.warn('save', n, e.message); } }, 150); };

  const users = load('users.json', {});          // email -> user
  const tokens = load('tokens.json', {});        // sha256(token) -> {email,purpose,exp}
  const site = Object.assign({ practice: true, practiceSince: new Date().toISOString().slice(0, 10), changedBy: 'system' }, load('site.json', {}));
  const auditLog = load('audit.json', []);

  let secret = process.env.SESSION_SECRET;
  if (!secret) { secret = load('secret.json', {}).s; if (!secret) { secret = crypto.randomBytes(32).toString('hex'); try { fs.writeFileSync(F('secret.json'), JSON.stringify({ s: secret }), { mode: 0o600 }); } catch (_) { } } }

  const persistUsers = () => save('users.json', users), persistTokens = () => save('tokens.json', tokens), persistSite = () => save('site.json', site);
  if (!users[OWNER_EMAIL]) { users[OWNER_EMAIL] = { email: OWNER_EMAIL, name: 'Owner', role: 'owner', passHash: null, googleSub: null, status: 'invited', sv: 1, createdAt: new Date().toISOString(), lastLoginAt: null }; persistUsers(); }
  else if (users[OWNER_EMAIL].role !== 'owner') { users[OWNER_EMAIL].role = 'owner'; persistUsers(); }

  const sha = s => crypto.createHash('sha256').update(s).digest('hex');
  const b64 = b => Buffer.from(b).toString('base64url');
  const normEmail = e => { e = String(e || '').trim().toLowerCase(); return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e) && e.length <= 254 ? e : null; };

  /* ---------- audit ---------- */
  function audit(who, action, detail) { auditLog.push({ ts: new Date().toISOString(), who: who || 'system', action, detail: detail || '' }); if (auditLog.length > 300) auditLog.shift(); save('audit.json', auditLog); }

  /* ---------- passwords ---------- */
  async function hashPw(pw) { const salt = crypto.randomBytes(16); const h = await scrypt(pw, salt, 64); return 'scrypt$' + salt.toString('hex') + '$' + h.toString('hex'); }
  async function checkPw(pw, stored) {
    if (!stored) { await scrypt(String(pw), Buffer.alloc(16), 64); return false; }   // keep timing similar
    const [, s, h] = stored.split('$'); const calc = await scrypt(String(pw), Buffer.from(s, 'hex'), 64); const want = Buffer.from(h, 'hex');
    return calc.length === want.length && crypto.timingSafeEqual(calc, want);
  }
  const pwProblem = pw => (typeof pw !== 'string' || pw.length < 10) ? 'Use at least 10 characters.' : pw.length > 200 ? 'Password is too long.' : null;

  /* ---------- tokens (create-password / reset links) ---------- */
  function makeToken(email, purpose, ttlMs) {
    const raw = crypto.randomBytes(32).toString('base64url'); const now = Date.now();
    for (const k of Object.keys(tokens)) if (tokens[k].exp < now || (tokens[k].email === email)) delete tokens[k];   // one live link per person
    tokens[sha(raw)] = { email, purpose, exp: now + ttlMs }; persistTokens(); return raw;
  }
  const peekToken = raw => { const t = tokens[sha(String(raw || ''))]; return t && t.exp > Date.now() ? t : null; };
  function consumeToken(raw) { const t = peekToken(raw); if (t) { delete tokens[sha(raw)]; persistTokens(); } return t; }

  /* ---------- sessions ---------- */
  const sign = p => crypto.createHmac('sha256', secret).update(p).digest('base64url');
  function cookieFor(user, secure) {
    const payload = b64(JSON.stringify({ e: user.email, sv: user.sv, x: Date.now() + 14 * DAY }));
    return `wcg_session=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 86400}${secure ? '; Secure' : ''}`;
  }
  const clearCookie = secure => `wcg_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
  function sessionUser(req) {
    const m = /(?:^|;\s*)wcg_session=([^;]+)/.exec(req.headers.cookie || ''); if (!m) return null;
    const [payload, sig] = m[1].split('.'); if (!payload || !sig) return null;
    const good = sign(payload); if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
    let p; try { p = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch (_) { return null; }
    const u = users[p.e]; if (!u || p.x < Date.now() || p.sv !== u.sv || u.status !== 'active') return null;
    return u;
  }

  /* ---------- rate limit ---------- */
  const buckets = new Map();
  function limited(key, max, windowMs) {
    const now = Date.now(); const b = (buckets.get(key) || []).filter(t => now - t < windowMs);
    if (b.length >= max) { buckets.set(key, b); return true; } b.push(now); buckets.set(key, b); return false;
  }
  setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some(t => now - t < 3600000)) buckets.delete(k); }, 600000).unref();

  /* ---------- email ---------- */
  const mailConfigured = () => !!process.env.RESEND_API_KEY;
  async function sendMail(to, subject, html, text) {
    if (!mailConfigured()) { console.log(`[mail not configured] To: ${to}\n${subject}\n${text}\n`); return { sent: false }; }
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.MAIL_FROM || 'WCG Auction <onboarding@resend.dev>', to: [to], subject, html, text }),
      });
      if (!r.ok) { console.warn('Resend error', r.status, (await r.text()).slice(0, 300)); return { sent: false, error: 'Email provider rejected the message (' + r.status + ')' }; }
      return { sent: true };
    } catch (e) { console.warn('mail failed', e.message); return { sent: false, error: e.message }; }
  }
  function linkMail(link, purpose, who) {
    const first = purpose === 'invite';
    const subject = first ? 'You are invited to host the WCG Cricket Auction' : 'Reset your WCG Auction password';
    const lead = first ? `${who || 'The owner'} invited you to run the WCG Champions League auction. Create your password to get started.` : 'Use the button below to choose a new password.';
    const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;background:#0a1a44;color:#fff;border-radius:16px">
      <h2 style="color:#f7c85b;margin:0 0 8px">WCG Champions League</h2><p style="line-height:1.5">${lead}</p>
      <p><a href="${link}" style="display:inline-block;background:#f7c85b;color:#251800;padding:12px 22px;border-radius:999px;font-weight:700;text-decoration:none">Create my password</a></p>
      <p style="font-size:12px;color:#9fb4e6">This link works once and expires in ${first ? '7 days' : '1 hour'}. If you didn't expect this email, ignore it.</p></div>`;
    return { subject, html, text: `${lead}\n\n${link}\n\nThis link works once and expires in ${first ? '7 days' : '1 hour'}.` };
  }

  /* ---------- Google ---------- */
  const googleConfigured = () => !!process.env.GOOGLE_CLIENT_ID;
  async function verifyGoogle(credential) {
    if (!googleConfigured()) return { error: 'Google sign-in is not set up.' };
    try {
      const base = process.env.GOOGLE_TOKENINFO_URL || 'https://oauth2.googleapis.com/tokeninfo';
      const r = await fetch(base + '?id_token=' + encodeURIComponent(credential));
      if (!r.ok) return { error: 'Google could not verify this sign-in.' };
      const t = await r.json();
      if (t.aud !== process.env.GOOGLE_CLIENT_ID) return { error: 'Sign-in was issued for a different app.' };
      if (String(t.email_verified) !== 'true') return { error: 'Your Google email is not verified.' };
      if (t.exp && Number(t.exp) * 1000 < Date.now()) return { error: 'Sign-in expired. Try again.' };
      return { email: normEmail(t.email), sub: t.sub, name: t.name || '' };
    } catch (e) { return { error: 'Could not reach Google.' }; }
  }

  /* ---------- optional bootstrap: OWNER_INITIAL_PASSWORD sets the owner's first password ---------- */
  const bootPw = process.env.OWNER_INITIAL_PASSWORD;
  if (bootPw && !users[OWNER_EMAIL].passHash && !pwProblem(bootPw)) {
    hashPw(bootPw).then(h => { const o = users[OWNER_EMAIL]; if (!o.passHash) { o.passHash = h; o.status = 'active'; o.sv = (o.sv || 1) + 1; persistUsers(); console.log('Owner password set from OWNER_INITIAL_PASSWORD (remove that env var now).'); } });
  } else if (bootPw && pwProblem(bootPw)) console.warn('OWNER_INITIAL_PASSWORD ignored: ' + pwProblem(bootPw));

  /* ---------- user management ---------- */
  const publicUser = u => ({ email: u.email, name: u.name, role: u.role, status: u.status, hasPassword: !!u.passHash, google: !!u.googleSub, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, invitedBy: u.invitedBy || null });
  function invite(email, by) {
    const e = normEmail(email); if (!e) return { error: 'That email address looks invalid.' };
    let u = users[e];
    if (u && u.status === 'active' && u.passHash) return { error: 'That person already has an account. Use "Send reset link" if they forgot their password.' };
    if (!u) { u = users[e] = { email: e, name: e.split('@')[0], role: 'host', passHash: null, googleSub: null, status: 'invited', sv: 1, createdAt: new Date().toISOString(), lastLoginAt: null, invitedBy: by }; persistUsers(); }
    return { user: u };
  }
  function removeUser(email) {
    const e = normEmail(email), u = users[e]; if (!u) return { error: 'No such user.' }; if (u.role === 'owner') return { error: 'The owner cannot be removed.' };
    delete users[e]; for (const k of Object.keys(tokens)) if (tokens[k].email === e) delete tokens[k]; persistUsers(); persistTokens(); return { ok: true };
  }
  async function setPassword(user, pw) { user.passHash = await hashPw(pw); user.status = 'active'; user.sv = (user.sv || 1) + 1; persistUsers(); }
  function touchLogin(u) { u.lastLoginAt = new Date().toISOString(); u.status = 'active'; persistUsers(); }

  return {
    OWNER_EMAIL, users, site, auditLog, normEmail, audit, pwProblem, hashPw, checkPw, makeToken, peekToken, consumeToken, cookieFor, clearCookie, sessionUser,
    limited, mailConfigured, sendMail, linkMail, googleConfigured, verifyGoogle, publicUser, invite, removeUser, setPassword, touchLogin, persistUsers, persistSite,
  };
};
