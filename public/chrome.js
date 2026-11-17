/* Shared page chrome: practice banner, "Map" + account chip in the top bar, footer with credits, and the Coach (guided tour). */
(function () {
  const W = window.WCG = window.WCG || {};
  const path = (location.pathname.replace(/\/+$/, '') || '/');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (tag, attrs, html) => { const e = document.createElement(tag); Object.assign(e, attrs || {}); if (html != null) e.innerHTML = html; return e; };
  W.me = null;

  /* ---------- practice banner ---------- */
  let bar = null, practice = null;
  W.setPractice = function (on) {
    if (on === practice) return; practice = on;
    if (!bar) { bar = el('div', { id: 'practiceBar', className: 'practicebar' }); document.body.insertBefore(bar, document.body.firstChild); }
    bar.style.display = on ? '' : 'none';
    bar.innerHTML = `<b>🧪 PRACTICE MODE</b> — nothing here counts. Try everything; the owner will switch to <b>live</b> before the real auction. ${W.me && W.me.role === 'owner' ? '<a href="/admin">Manage</a>' : ''}`;
    document.body.classList.toggle('is-practice', !!on);
  };
  fetch('/api/site').then(r => r.json()).then(s => W.setPractice(!!s.practice)).catch(() => { });

  /* ---------- account chip + Map link in the top bar ---------- */
  function paintNav() {
    const nav = document.querySelector('.topbar .nav'); if (!nav || nav.dataset.chrome) return; nav.dataset.chrome = 1;
    if (!nav.querySelector('a[href="/sitemap"]')) nav.insertBefore(el('a', { className: 'navlink' + (path === '/sitemap' ? ' on' : ''), href: '/sitemap', title: 'Site map' }, '🗺 Map'), nav.querySelector('.dot') || null);
    const chip = el('span', { className: 'userchip' }); nav.appendChild(chip);
    W.paintChip = () => {
      const m = W.me;
      chip.innerHTML = m ? `<a class="navlink" href="${m.role === 'owner' ? '/admin' : '/host'}" title="${esc(m.email)}">${m.role === 'owner' ? '👑 Admin' : '🎙 Host'}</a><button class="navlink" id="signOut">Sign out</button>`
        : (path === '/login' ? '' : '<a class="navlink" href="/login?next=' + encodeURIComponent(path) + '">Host sign in</a>');
      const so = chip.querySelector('#signOut'); if (so) so.onclick = () => fetch('/api/auth/logout', { method: 'POST' }).then(() => { localStorage.removeItem('wcg-pin'); location.href = '/'; });
    };
    W.paintChip();
  }
  fetch('/api/me').then(r => r.ok ? r.json() : null).then(m => { W.me = m; paintNav(); W.paintChip && W.paintChip(); if (practice !== null) { const p = practice; practice = null; W.setPractice(p); } }).catch(() => { paintNav(); });
  document.addEventListener('DOMContentLoaded', paintNav); if (document.readyState !== 'loading') paintNav();

  /* ---------- footer with credits ---------- */
  function footer() {
    if (document.getElementById('sitefoot')) return;
    const f = el('footer', { id: 'sitefoot', className: 'sitefoot noprint' }, `
      <nav><a href="/">Home</a><a href="/live">Live</a><a href="/squads">Squads</a><a href="/host">Host</a><a href="/sitemap">Site map</a></nav>
      <div class="credit">Developed by Karthik - with 75% commitment ;)</div>`);
    (document.querySelector('.page') || document.body).appendChild(f);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', footer); else footer();

  /* ====================================================================
     COACH — a spotlight tour that can be switched on/off at any time.
     ==================================================================== */
  const TOURS = {
    '/': [
      { sel: '.hero', title: 'Welcome to the WCG Mega Draft 👋', body: 'This site runs the auction for the Weekend Cricket Group Champions League. Anyone can watch; only hosts can run it. Let\'s take a 30-second tour.' },
      { sel: '.cta', title: 'Three doors in', body: '<b>Live Auction</b> is for captains and spectators. <b>Team Squads</b> shows who bought whom. <b>Auctioneer Console</b> is for the host (sign-in needed).' },
      { sel: '#teams', title: 'The five teams', body: 'Each team has a captain. Squads are 7–8 players <i>including</i> the captain, with at least one player from every category.' },
      { sel: '.rules', title: 'How bidding works', body: 'Players come up by category. Bids rise in $1M steps (then $2M). Highest bid wins; unsold players return in Round 2.' },
      { sel: '#sitefoot', title: 'Lost? Use the Site map', body: 'The <b>🗺 Map</b> button in the top bar and this footer always get you around. Switch the Coach off anytime with the 🎓 button.' },
    ],
    '/live': [
      { sel: '#block', title: 'On the block', body: 'The player currently being auctioned: name, category, availability and base price.' },
      { sel: '#bidcard', title: 'Current bid', body: 'The highest bid, who holds it, and the last few raises. When the host says "going once / twice", a banner appears here.' },
      { sel: '#teams', title: 'Team boards', body: 'Each card shows purse left, squad slots (gold dot = captain) and which categories are covered. A glowing card is the current top bidder; dimmed means that team can\'t bid on this player.' },
      { sel: '#myTeam', title: 'Pick your team', body: 'Choose your team to highlight it with a dashed outline — handy on a phone.' },
      { sel: '#soundBtn', title: 'Sound & fullscreen', body: 'Turn on hammer and chime sounds, or go fullscreen for the TV. Big moments (SOLD, UNSOLD) take over the screen.' },
    ],
    '/squads': [
      { sel: '.tools', title: 'Share the squads', body: 'Copy all squads as WhatsApp text, print to PDF, or download the results as CSV.' },
      { sel: '#sq', title: 'Squads fill up live', body: 'Each card shows the captain, players with category and price, spend and purse left. "To be picked" slots are still open.' },
      { sel: '#pending', title: 'Still to come', body: 'Players not yet sold (or unsold and waiting for Round 2).' },
    ],
    '/host': [
      { sel: '#stage', title: 'Your control room', body: 'Everything for the current player lives here. Start with <b>Draw next player</b> (or press <kbd>N</kbd>). Category 1 comes first, then 2, 3 and 4.', note: 'Draw a player to see the bid buttons.' },
      { sel: '.tbtns', title: 'Take bids by tapping a team', body: 'When a captain calls a bid, tap their team (or press <kbd>1</kbd>–<kbd>5</kbd>). The button shows the next bid. Greyed-out teams can\'t legally bid — hover to see why.', note: 'Appears once a player is on the block.' },
      { sel: '#callBtn', title: 'Going once… twice… SOLD', body: 'Tap (or press <kbd>Space</kbd>) three times: going once, going twice, SOLD. The live screen celebrates for everyone.', note: 'Enabled after the first bid.' },
      { sel: '#pool', title: 'Player pool', body: 'All 32 players by category. Between players you can tap a name to call that player to the block.' },
      { sel: '#log', title: 'Activity & undo', body: 'Every bid and sale is logged. Mistakes happen — use <b>Undo last bid</b> or <b>Undo last action</b>.' },
      { sel: '#menuBtn', title: 'Menu', body: 'Rename teams, download results, <b>back up</b> the auction, restore, reset, or sign out. Do a backup before the real thing.' },
    ],
    '/admin': [
      { sel: '#practiceCard', title: 'Practice vs Live', body: 'The whole site starts in <b>practice mode</b>. When you\'re ready for the real auction, switch to Live — this clears practice data.' },
      { sel: '#usersCard', title: 'Who can host', body: 'Invite hosts by email. They get a link to create a password (or can sign in with Google using the same address). Only invited people can ever sign in.' },
      { sel: '#healthCard', title: 'Setup check', body: 'See at a glance whether email, Google sign-in and the persistent disk are configured.' },
      { sel: '#auditCard', title: 'Audit trail', body: 'Logins, invites, resets and go-live switches are recorded here.' },
    ],
    '/sitemap': [
      { sel: '#guide', title: 'Not sure where to go?', body: 'Pick your role here and we\'ll point you to the right page.' },
      { sel: '#pages', title: 'Every page, one list', body: 'Lock icons show where a sign-in is needed.' },
    ],
  };
  const seenKey = 'wcg-coach-seen', onKey = 'wcg-coach';
  const isOn = () => localStorage.getItem(onKey) !== 'off';
  const seen = () => { try { return JSON.parse(localStorage.getItem(seenKey) || '{}'); } catch (_) { return {}; } };
  const markSeen = () => { const s = seen(); s[path] = 1; localStorage.setItem(seenKey, JSON.stringify(s)); };
  const steps = TOURS[path];
  let ring, card, idx = -1, tick = null, ptoggle;

  function mount() {
    ptoggle = el('button', { id: 'coachToggle', className: 'coachtoggle noprint', title: 'Turn the guided tips on or off' });
    ptoggle.onclick = () => { if (isOn()) { localStorage.setItem(onKey, 'off'); stop(); } else { localStorage.setItem(onKey, 'on'); if (steps) start(0); } paint(); };
    document.body.appendChild(ptoggle); paint();
    if (steps && isOn() && !seen()[path]) setTimeout(() => { if (isOn() && idx < 0) start(0); }, 1100);
  }
  function paint() {
    ptoggle.innerHTML = `🎓 Coach: <b>${isOn() ? 'ON' : 'OFF'}</b>`; ptoggle.classList.toggle('on', isOn());
    if (isOn() && steps && idx < 0) ptoggle.innerHTML += ' <span class="replay" title="Replay this page\'s tour">↻</span>';
    const r = ptoggle.querySelector('.replay'); if (r) r.onclick = e => { e.stopPropagation(); start(0); };
  }
  function start(i) {
    if (!steps) return; stop(true);
    ring = el('div', { className: 'coachring' }); card = el('div', { className: 'coachcard', role: 'dialog' });
    document.body.append(ring, card); idx = i; show(); tick = setInterval(place, 350); window.addEventListener('resize', place); window.addEventListener('keydown', keys);
  }
  function stop(keepToggle) {
    clearInterval(tick); window.removeEventListener('resize', place); window.removeEventListener('keydown', keys);
    if (ring) ring.remove(); if (card) card.remove(); ring = card = null; idx = -1; if (!keepToggle) paint();
  }
  const keys = e => { if (e.key === 'Escape') { markSeen(); stop(); } else if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); };
  function go(d) { const n = idx + d; if (n < 0) return; if (n >= steps.length) { markSeen(); stop(); return; } idx = n; show(); }
  function show() {
    const s = steps[idx], t = document.querySelector(s.sel), has = t && t.getBoundingClientRect().height > 0;
    card.innerHTML = `<div class="cstep">Step ${idx + 1} of ${steps.length}</div><h4>${s.title}</h4><p>${s.body}</p>${!has && s.note ? `<p class="cnote">💡 ${s.note}</p>` : ''}
      <div class="cbtns"><button class="btn sm ghost" data-a="off">Turn coach off</button><span style="flex:1"></span>${idx > 0 ? '<button class="btn sm" data-a="back">Back</button>' : ''}<button class="btn sm gold" data-a="next">${idx === steps.length - 1 ? 'Done' : 'Next'}</button></div>`;
    card.querySelector('[data-a=next]').onclick = () => go(1);
    const b = card.querySelector('[data-a=back]'); if (b) b.onclick = () => go(-1);
    card.querySelector('[data-a=off]').onclick = () => { localStorage.setItem(onKey, 'off'); markSeen(); stop(); };
    if (has) t.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(place, 60);
  }
  function place() {
    if (!ring || !card) return; const s = steps[idx], t = document.querySelector(s.sel); const vw = innerWidth, vh = innerHeight;
    const has = t && t.getBoundingClientRect().height > 0, r = has ? t.getBoundingClientRect() : { left: vw / 2, top: vh * .35, width: 0, height: 0, right: vw / 2, bottom: vh * .35 };
    const pad = has ? 8 : 0;
    Object.assign(ring.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px', opacity: 1 });
    const cw = card.offsetWidth, ch = card.offsetHeight;
    if (vw < 640) { card.style.left = '10px'; card.style.right = '10px'; card.style.top = 'auto'; card.style.bottom = '64px'; card.style.width = 'auto'; return; }
    card.style.right = 'auto'; card.style.bottom = 'auto'; card.style.width = '';
    let top, left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), vw - cw - 12);
    if (!has) { top = vh * .35 + 20; left = vw / 2 - cw / 2; }
    else if (r.bottom + ch + 24 < vh) top = r.bottom + 18; else if (r.top - ch - 24 > 0) top = r.top - ch - 18; else { top = Math.max(12, vh - ch - 70); left = Math.min(Math.max(12, r.right - cw - 20), vw - cw - 12); }
    card.style.top = top + 'px'; card.style.left = left + 'px';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  W.coach = { start: () => { localStorage.setItem(onKey, 'on'); start(0); paint(); }, isOn };
})();
