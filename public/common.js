/* Shared helpers for all WCG Auction screens */
(function () {
  const W = window.WCG = {};
  W.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  W.M = 1000000;
  W.money = n => { if (n == null) return '—'; const m = n / 1e6; return '$' + (Number.isInteger(m) ? m : m.toFixed(1)) + 'M'; };
  W.badge = (t, size) => `<img class="badge" style="--s:${size || 56}px" src="/img/${t.logo}.png" alt="${W.esc(t.name)}" loading="eager">`;
  W.catLabel = c => 'Category ' + c;
  W.pct = a => Math.round((a || 0) * 100) + '%';

  /** Subscribe to live state. Falls back to polling if SSE is blocked. */
  W.connect = function (onState, onStatus) {
    let es, poll, last = -1;
    const handle = st => { onState(st); last = st.rev; };
    const startPoll = () => {
      if (poll) return;
      poll = setInterval(() => fetch('/api/state', { cache: 'no-store' }).then(r => r.json()).then(handle).catch(() => onStatus && onStatus(false)), 2000);
    };
    const open = () => {
      try { es = new EventSource('/events'); } catch (e) { startPoll(); return; }
      es.onopen = () => { onStatus && onStatus(true); if (poll) { clearInterval(poll); poll = null; } };
      es.onmessage = ev => { try { handle(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
      es.onerror = () => { onStatus && onStatus(false); startPoll(); };
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
    const ensure = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } } return ctx; };
    const tone = (f, t0, d, type = 'sine', v = .15) => {
      const c = ensure(); if (!c || !on) return; const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, c.currentTime + t0); g.gain.linearRampToValueAtTime(v, c.currentTime + t0 + .02); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + t0 + d);
      o.connect(g); g.connect(c.destination); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + d + .05);
    };
    return {
      get on() { return on; },
      toggle() { on = !on; localStorage.setItem('wcg-sound', on ? '1' : '0'); if (on) { ensure(); this.bid(); } return on; },
      bid() { tone(660, 0, .12, 'triangle'); tone(880, .08, .14, 'triangle'); },
      going() { tone(300, 0, .25, 'square', .08); },
      sold() { tone(130, 0, .35, 'sawtooth', .3); [523, 659, 784, 1047].forEach((f, i) => tone(f, .25 + i * .11, .35, 'triangle', .18)); },
      unsold() { tone(220, 0, .3, 'sawtooth', .12); tone(165, .25, .45, 'sawtooth', .12); },
      draw() { [392, 523, 659].forEach((f, i) => tone(f, i * .09, .2, 'sine', .14)); },
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
