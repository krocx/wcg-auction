/* Shared helpers for all WCG Auction screens */
(function () {
  const W = window.WCG = {};
  W.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  W.M = 1000000;
  W.money = n => { if (n == null) return '—'; return '$' + (+(n / 1e6).toFixed(2)) + 'M'; };
  W.badge = (t, size) => `<img class="badge" style="--s:${size || 56}px" src="/img/${t.logo}.png" alt="${W.esc(t.name)}" loading="eager">`;
  /* ---- player pictures ---- */
  W.photoUrl = p => p && p.photo ? `/photo/${encodeURIComponent(p.id)}?v=${p.photo}` : null;
  const initials = n => String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  /** Round face picture (or initials on a tinted disc). */
  W.avatar = (p, size, ring) => {
    const u = W.photoUrl(p), s = size || 48;
    return `<span class="avatar" style="--s:${s}px;${ring ? '--ring:' + ring + ';' : ''}">${u ? `<img src="${u}" alt="${W.esc(p.name)}" loading="lazy">` : `<b>${W.esc(initials(p && p.name))}</b>`}</span>`;
  };
  let jid = 0;
  /** The player's face on a jersey in the team's colours + crest. team may be null (neutral kit). Width = size px. */
  W.jersey = (p, team, size, opts) => {
    opts = opts || {}; const id = 'j' + (++jid), c = (team && team.jersey) || ['#2a3a5e', '#9db2dd'], u = W.photoUrl(p), crest = team ? `/img/${team.logo}.png` : null;
    const nm = W.esc(String(p.name || '').toUpperCase().slice(0, 12));
    return `<svg class="jersey" viewBox="0 0 240 300" width="${size || 200}" role="img" aria-label="${W.esc(p.name)}${team ? ' in ' + W.esc(team.name) + ' jersey' : ''}">
 <defs><clipPath id="${id}c"><circle cx="120" cy="66" r="50"/></clipPath><linearGradient id="${id}g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient></defs>
 <path d="M72 74 L22 108 L42 152 L62 136 L62 284 L178 284 L178 136 L198 152 L218 108 L168 74 Q120 112 72 74Z" fill="${c[0]}"/>
 <path d="M72 74 L22 108 L42 152 L62 136 L62 284 L178 284 L178 136 L198 152 L218 108 L168 74 Q120 112 72 74Z" fill="url(#${id}g)"/>
 <path d="M62 136 L62 284 L74 284 L74 142Z M178 136 L178 284 L166 284 L166 142Z" fill="${c[1]}"/>
 <path d="M28 120 L44 150 M212 120 L196 150" stroke="${c[1]}" stroke-width="9" stroke-linecap="round"/>
 <path d="M72 74 Q120 112 168 74" fill="none" stroke="${c[1]}" stroke-width="9" stroke-linecap="round"/>
 ${crest ? `<image href="${crest}" x="94" y="150" width="52" height="52" preserveAspectRatio="xMidYMid meet"/>` : ''}
 <text x="120" y="238" text-anchor="middle" font-family="Nunito,Arial,sans-serif" font-weight="900" font-size="${Math.round(Math.max(11, Math.min(20, 112 / Math.max(5, nm.length))))}" letter-spacing="1" fill="${c[1]}">${nm}</text>
 <circle cx="120" cy="66" r="54" fill="#0b1220" stroke="#fff" stroke-width="4"/>
 ${u ? `<image href="${u}" x="70" y="16" width="100" height="100" clip-path="url(#${id}c)" preserveAspectRatio="xMidYMin slice"/>` : `<circle cx="120" cy="66" r="50" fill="#1b2a4d"/><text x="120" y="82" text-anchor="middle" font-family="Nunito,Arial,sans-serif" font-weight="900" font-size="42" fill="#cfe0ff">${W.esc(initials(p.name))}</text>`}
</svg>`;
  };
  W.catLabel = c => 'Category ' + c;
  W.pct = a => Math.round((a || 0) * 100) + '%';

  /** Subscribe to live state. Falls back to polling if SSE is blocked. */
  W.connect = function (onState, userStatus) {
    let es, poll;
    const handle = st => { if (W.setPractice && st.practice !== undefined) W.setPractice(st.practice); onState(st); };
    const status = ok => {
      let b = document.getElementById('offbar');
      if (!ok && !b) { b = document.createElement('div'); b.id = 'offbar'; b.className = 'offbar'; b.textContent = '⚠ Connection lost — reconnecting…'; document.body.appendChild(b); }
      if (ok && b) b.remove();
      userStatus && userStatus(ok);
    };
    const startPoll = () => {
      if (poll) return;
      poll = setInterval(() => fetch('/api/state', { cache: 'no-store' }).then(r => r.json()).then(st => { status(true); handle(st); }).catch(() => status(false)), 2000);
    };
    const open = () => {
      try { es = new EventSource('/events'); } catch (e) { startPoll(); return; }
      es.onopen = () => { status(true); if (poll) { clearInterval(poll); poll = null; } };
      es.addEventListener('react', ev => { try { W.onReact && W.onReact(JSON.parse(ev.data)); } catch (e) { } });
      es.onmessage = ev => { try { handle(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
      es.onerror = () => { status(false); startPoll(); };
    };
    open();
  };

  W.toast = (msg, ok) => {
    let box = document.getElementById('toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const d = document.createElement('div'); d.className = 'toast' + (ok ? ' ok' : ''); d.textContent = msg; box.appendChild(d);
    setTimeout(() => d.remove(), ok ? 2200 : 5000);
  };

  /** Tiny WebAudio sound kit (muted until the viewer enables it - browsers block autoplay). */
  W.sound = (function () {
    let ctx = null, on = localStorage.getItem('wcg-sound') === '1';
    const ensure = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); ctx.__out = ctx.createDynamicsCompressor(); ctx.__out.threshold.value = -14; ctx.__out.ratio.value = 6; ctx.__out.connect(ctx.destination); } catch (e) { ctx = null; } } return ctx; };
    const tone = (f, t0, d, type = 'sine', v = .15) => {
      const c = ensure(); if (!c || !on) return; const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, c.currentTime + t0); g.gain.linearRampToValueAtTime(v, c.currentTime + t0 + .02); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + t0 + d);
      o.connect(g); g.connect(c.__out); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + d + .05);
    };
    /* ---- crowd: clapping + "Yayy!" cheers, synthesised (no audio files). Every call is randomised so it never sounds the same. ---- */
    let nb = null;
    const noise = c => { if (!nb) { nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } return nb; };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const clap = (t0, v) => {
      const c = ensure(); const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), T = c.currentTime + t0;
      s.buffer = noise(c); f.type = 'bandpass'; f.frequency.value = rnd(1100, 3600); f.Q.value = rnd(.6, 1.6);
      g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(v, T + .002); g.gain.exponentialRampToValueAtTime(.0001, T + rnd(.03, .09));
      s.connect(f); f.connect(g); g.connect(c.__out); s.start(T, rnd(0, 1.5), .14);
    };
    /** A room full of people clapping: a burst of random hand-claps that swells quickly and fades. */
    const applause = (dur, dens) => {
      if (!on || !ensure()) return; const n = Math.floor(dur * dens);
      for (let i = 0; i < n; i++) { const t = Math.random() * dur, env = Math.min(1, t / .5) * Math.pow(1 - t / dur, .7); if (Math.random() < env) clap(t, rnd(.16, .5) * (.4 + env)); }
    };
    /** One singing/shouting voice: sawtooth through two moving formant filters (vowel glide) with vibrato. */
    const voice = (t0, dur, f0, f1, fm, vol) => {
      const c = ensure(); const T = c.currentTime + t0, o = c.createOscillator(), l = c.createOscillator(), lg = c.createGain(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, T); o.frequency.linearRampToValueAtTime(f1, T + dur * .75);
      l.frequency.value = rnd(4.8, 6.4); lg.gain.value = f0 * .018; l.connect(lg); lg.connect(o.frequency);
      g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(vol, T + .07); g.gain.setValueAtTime(vol, T + dur * .6); g.gain.exponentialRampToValueAtTime(.0001, T + dur);
      [0, 1].forEach(k => { const bp = c.createBiquadFilter(), bg = c.createGain(); bp.type = 'bandpass'; bp.Q.value = 5 + k * 3; bp.frequency.setValueAtTime(fm[0][k], T); bp.frequency.linearRampToValueAtTime(fm[1][k], T + dur * .5); bg.gain.value = k ? 2.2 : 3.5; o.connect(bp); bp.connect(bg); bg.connect(g); });
      const nz = c.createBufferSource(), nf = c.createBiquadFilter(), ng = c.createGain();   // a little breath
      nz.buffer = noise(c); nf.type = 'bandpass'; nf.frequency.value = 2800; ng.gain.setValueAtTime(0, T); ng.gain.linearRampToValueAtTime(vol * .35, T + .05); ng.gain.exponentialRampToValueAtTime(.0001, T + dur * .8); nz.connect(nf); nf.connect(ng); ng.connect(c.__out); nz.start(T, rnd(0, 1.2), dur);
      g.connect(c.__out); o.start(T); l.start(T); o.stop(T + dur + .05); l.stop(T + dur + .05);
    };
    const YAY = [[330, 2400], [620, 1900]], AWW = [[720, 1250], [470, 950]], WHOO = [[420, 900], [350, 800]];
    /** "Yayyy!" from a crowd of 5-10 voices; style is random: kids / mixed / big crowd, sometimes with a whistle. */
    const cheer = () => {
      if (!on || !ensure()) return; const c = ensure(), style = ['kids', 'mixed', 'mixed', 'big'][Math.floor(Math.random() * 4)];
      const n = style === 'big' ? 10 : style === 'kids' ? 6 : 8, lo = style === 'kids' ? 300 : style === 'big' ? 150 : 170, hi = style === 'kids' ? 480 : style === 'big' ? 330 : 400;
      for (let i = 0; i < n; i++) { const f = rnd(lo, hi), d = rnd(.7, 1.25); voice(rnd(0, .22), d, f, f * rnd(1.15, 1.4), YAY, .085 / Math.sqrt(n / 6)); }
      if (Math.random() < .35) tone(rnd(2300, 3000), .1, .5, 'sine', .035);              // whistle
      if (Math.random() < .5) setTimeout(() => { for (let i = 0; i < 4; i++) voice(rnd(0, .15), rnd(.6, .9), rnd(200, 420), rnd(260, 520), YAY, .09); }, rnd(900, 1500));   // second wave
    };
    const aww = () => { if (!on || !ensure()) return; for (let i = 0; i < 7; i++) { const f = rnd(200, 380); voice(rnd(0, .25), rnd(.9, 1.4), f, f * .7, AWW, .09); } };
    return {
      get on() { return on; },
      toggle() { on = !on; localStorage.setItem('wcg-sound', on ? '1' : '0'); if (on) { ensure(); this.bid(); setTimeout(() => applause(1.3, 50), 150); } return on; },
      bid() { tone(660, 0, .12, 'triangle'); tone(880, .08, .14, 'triangle'); },
      going() { tone(300, 0, .25, 'square', .08); },
      sold() { tone(130, 0, .35, 'sawtooth', .3); [523, 659, 784, 1047].forEach((f, i) => tone(f, .25 + i * .11, .35, 'triangle', .18)); },
      unsold() { tone(220, 0, .3, 'sawtooth', .12); tone(165, .25, .45, 'sawtooth', .12); setTimeout(aww, 350); },
      draw() { [392, 523, 659].forEach((f, i) => tone(f, i * .09, .2, 'sine', .14)); },
      /** SOLD! = fanfare + a random-length round of applause + a "Yayy!" */
      celebrate() { this.sold(); const d = rnd(4, 6.5); setTimeout(() => { applause(d, rnd(60, 95)); cheer(); }, 450); },
      applause, cheer, aww,
    };
  })();

  /** Confetti burst on a <canvas>. */
  W.confetti = function (canvas, colors, ms = 5000) {
    const ctx = canvas.getContext('2d'); const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; ctx.scale(dpr, dpr);
    const P = Array.from({ length: 220 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 300, y: innerHeight * .45, vx: (Math.random() - .5) * 16, vy: -Math.random() * 16 - 4,
      s: 5 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: colors[Math.floor(Math.random() * colors.length)], star: Math.random() < .25,
    }));
    const t0 = performance.now(); let raf;
    (function frame(t) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      const age = t - t0;
      P.forEach(p => {
        p.vy += .32; p.x += p.vx; p.y += p.vy; p.vx *= .992; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - age / ms);
        if (p.star) { ctx.beginPath(); for (let i = 0; i < 5; i++) { ctx.lineTo(Math.cos((i * 72 - 90) * Math.PI / 180) * p.s, Math.sin((i * 72 - 90) * Math.PI / 180) * p.s); ctx.lineTo(Math.cos((i * 72 - 54) * Math.PI / 180) * p.s * .45, Math.sin((i * 72 - 54) * Math.PI / 180) * p.s * .45); } ctx.fill(); }
        else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      });
      if (age < ms) raf = requestAnimationFrame(frame); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })(t0);
    return () => cancelAnimationFrame(raf);
  };

  /** Plain-text squad block, handy for pasting into WhatsApp. */
  W.squadText = (t, players) => {
    const byId = Object.fromEntries(players.map(p => [p.id, p]));
    const lines = [`🏏 ${t.name} — Captain ${t.captain}`];
    t.buys.forEach(b => { const p = byId[b.playerId]; lines.push(`• ${p.name} (Cat ${p.cat}) — ${W.money(b.price)}`); });
    lines.push(`Spent ${W.money(t.spent)} · Purse left ${W.money(t.left)}`);
    return lines.join('\n');
  };
})();
