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
        : (path === '/login' ? '' : '<a class="navlink" href="/login" title="Hosts and the owner (Admin) sign in here">🔑 Host / Admin sign in</a>');
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
     COACH — contextual spotlight tips on the real buttons/tiles. Switch ON/OFF anytime.
     Each page has one or more tour "groups". A group with a `trigger` starts by itself the first
     time that element appears (e.g. the bid buttons once a player is drawn).
     ==================================================================== */
  const TOURS = {
    '/': [{ id: 'main', steps: [
      { sel: '.hero', title: 'Welcome to the WCG Mega Draft 👋', body: 'This site runs the auction for the Weekend Cricket Group Champions League. Anyone can watch; only hosts run it. Quick tour?' },
      { sel: '.cta a[href="/live"]', title: 'Watch live', body: 'Captains and spectators open the <b>Live Auction</b> — no sign-in needed.' },
      { sel: '.cta a[href="/host"]', title: 'Running the auction?', body: 'The <b>Auctioneer Console</b> is for hosts. You\'ll be asked to sign in first.' },
      { sel: '.userchip a, .userchip', title: 'Host & Admin sign-in', body: 'Hosts and the owner (Admin) sign in here. The owner lands on the Admin page to invite hosts.' },
      { sel: '.navlink[href="/sitemap"]', title: 'Lost? Open the map', body: 'The <b>🗺 Map</b> lists every page and what it\'s for.' },
    ] }],
    '/live': [{ id: 'main', steps: [
      { sel: '#block', title: 'The player on the block', body: 'Name, category, availability and base price of whoever is being auctioned right now.' },
      { sel: '#bidcard .bignum, #bidcard', title: 'The current bid', body: 'Highest bid and who holds it. "Going once / twice" flashes here.' },
      { sel: '#teams .team', title: 'A team board', body: 'Purse left, squad slots (gold dot = captain) and categories covered. A glowing board is the top bidder; a dimmed one can\'t bid on this player.' },
      { sel: '#myTeam', title: 'Pick your team', body: 'Choose your team to outline it on the board — handy on a phone.' },
      { sel: '#soundBtn', title: 'Sound', body: 'Turn on hammer and chime sounds. Tap once — browsers block sound until you do.' },
      { sel: '#fsBtn', title: 'Fullscreen for the TV', body: 'Go fullscreen when the auction is on a big screen.' },
    ] }],
    '/squads': [{ id: 'main', steps: [
      { sel: '#copyAll', title: 'Share to WhatsApp', body: 'Copies every squad as plain text you can paste into the group.' },
      { sel: '#sq .card', title: 'A squad', body: 'Captain, players with category and price, spend and purse left. "To be picked" slots are still open.' },
      { sel: '#sq .copy', title: 'Copy one squad', body: 'Copy just this team\'s squad.' },
    ] }],
    '/host': [
      { id: 'main', steps: [
        { sel: '#drawBtn', title: 'Start here: draw a player', body: 'Click <b>Draw next player</b> (or press <kbd>N</kbd>). Category 1 comes first, then 2, 3 and 4.' },
        { sel: '#pool .pc', title: 'Or call a specific player', body: 'Between players you can click any name in the pool to bring that player to the block.' },
        { sel: '#menuBtn', title: 'Menu', body: 'Rename teams, download results, <b>back up</b> the auction, restore or reset. Do a backup before the real thing.' },
      ] },
      { id: 'bid', trigger: '.tbtns .tb', steps: [
        { sel: '.tbtns .tb', pos: 'above', title: 'Tap a team to place its bid', body: 'When a captain calls a bid, tap their tile (or press <kbd>1</kbd>–<kbd>5</kbd>). It shows the next bid amount. Greyed-out tiles can\'t legally bid — hover for the reason.' },
        { sel: '#cbBtn', title: 'Jump bids', body: 'If a captain jumps the price, pick the team and amount here.' },
        { sel: '#callBtn', pos: 'above', title: 'Going once… twice… SOLD', body: 'Click (or press <kbd>Space</kbd>) three times. The live screen celebrates for everyone.' },
        { sel: '#undoBid', title: 'Made a mistake?', body: '<b>Undo last bid</b> removes a mis-tapped bid. <b>Undo last action</b> reverses a sale.' },
        { sel: '#unsoldBtn', title: 'Nobody bids?', body: 'Mark the player <b>Unsold</b>. They return in Round 2.' },
      ] },
    ],
    '/admin': [{ id: 'main', steps: [
      { sel: '#swBtn', title: 'Practice ↔ Live', body: 'The site starts in <b>practice mode</b>. When you\'re ready for the real auction, click here to go live — this clears practice data.' },
      { sel: '#inv', title: 'Invite a host', body: 'Type their email and click Invite. They get a link to create a password (or can use Google with that address).' },
      { sel: '#users', title: 'Your hosts', body: 'Resend a link, send a password reset, or remove someone (signs them out at once).' },
      { sel: '#health', title: 'Setup check', body: 'Shows whether email, Google sign-in and the persistent disk are configured.' },
      { sel: '#audit', title: 'Audit trail', body: 'Logins, invites and the go-live switch are recorded here.' },
    ] }],
    '/sitemap': [{ id: 'main', steps: [
      { sel: '#guide a:nth-child(3)', title: 'Pick your role', body: 'Each tile takes you to the right page — captains and spectators to Live, hosts to the console, the owner to Admin.' },
      { sel: '#pages .grp:nth-child(2)', title: 'Locked pages', body: 'Pages marked 🔒 need a sign-in.' },
    ] }],
  };
  const seenKey = 'wcg-coach-seen', onKey = 'wcg-coach';
  const isOn = () => localStorage.getItem(onKey) !== 'off';
  const seen = () => { try { return JSON.parse(localStorage.getItem(seenKey) || '{}'); } catch (_) { return {}; } };
  const markSeen = g => { const s = seen(); s[path + '#' + g.id] = 1; localStorage.setItem(seenKey, JSON.stringify(s)); };
  const groups = TOURS[path] || [];
  let ring, card, steps = null, grp = null, idx = -1, tick = null, ptoggle, watch = null;
  const find = sel => { for (const s of sel.split(',')) { const e = document.querySelector(s.trim()); if (e && e.getBoundingClientRect().height > 0) return e; } return null; };

  function mount() {
    ptoggle = el('button', { id: 'coachToggle', className: 'coachtoggle noprint', title: 'Turn the guided tips on or off' });
    ptoggle.onclick = () => { if (isOn()) { localStorage.setItem(onKey, 'off'); stop(); } else { localStorage.setItem(onKey, 'on'); if (groups.length) start(groups[0]); } paint(); };
    document.body.appendChild(ptoggle); paint();
    if (groups.length) watch = setInterval(autoStart, 900);
  }
  function autoStart() {
    if (!isOn() || steps) return;
    const sn = seen();
    for (const g of groups) {
      if (sn[path + '#' + g.id]) continue;
      if (g.trigger ? !find(g.trigger) : !find(g.steps[0].sel)) continue;
      start(g); return;
    }
  }
  function paint() {
    ptoggle.innerHTML = `🎓 Coach: <b>${isOn() ? 'ON' : 'OFF'}</b>` + (isOn() && groups.length && !steps ? ' <span class="replay" title="Replay the tips for this page">↻</span>' : '');
    ptoggle.classList.toggle('on', isOn());
    const r = ptoggle.querySelector('.replay');
    if (r) r.onclick = e => { e.stopPropagation(); const g = groups.slice().reverse().find(g => !g.trigger || find(g.trigger)) || groups[0]; start(g); };
  }
  function start(g) {
    stop(true); grp = g; steps = g.steps.filter(s => find(s.sel)); if (!steps.length) { steps = null; return; }
    ring = el('div', { className: 'coachring' }); card = el('div', { className: 'coachcard', role: 'dialog' }); document.body.append(ring, card);
    idx = 0; show(); tick = setInterval(place, 300); window.addEventListener('resize', place); window.addEventListener('keydown', keys); paint();
  }
  function stop(keep) {
    clearInterval(tick); window.removeEventListener('resize', place); window.removeEventListener('keydown', keys);
    if (ring) ring.remove(); if (card) card.remove(); ring = card = null; steps = null; idx = -1; if (!keep) paint();
  }
  const keys = e => { if (e.key === 'Escape') { markSeen(grp); stop(); } else if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); };
  function go(d) { const n = idx + d; if (n < 0) return; if (n >= steps.length) { markSeen(grp); stop(); return; } idx = n; show(); }
  function show() {
    const s = steps[idx];
    card.innerHTML = `<div class="cstep">Tip ${idx + 1} of ${steps.length}</div><h4>${s.title}</h4><p>${s.body}</p>
      <div class="cbtns"><button class="btn sm ghost" data-a="off">Turn coach off</button><span style="flex:1"></span>${idx > 0 ? '<button class="btn sm" data-a="back">Back</button>' : ''}<button class="btn sm gold" data-a="next">${idx === steps.length - 1 ? 'Done' : 'Next'}</button></div>`;
    card.querySelector('[data-a=next]').onclick = () => go(1);
    const b = card.querySelector('[data-a=back]'); if (b) b.onclick = () => go(-1);
    card.querySelector('[data-a=off]').onclick = () => { localStorage.setItem(onKey, 'off'); markSeen(grp); stop(); };
    const t = find(s.sel); if (t) { const r = t.getBoundingClientRect(); if (r.top < 90 || r.bottom > innerHeight - 90) t.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    setTimeout(place, 80);
  }
  /* put the tip card right next to the highlighted element: below, above, right, left — never pinned to the page bottom */
  function place() {
    if (!ring || !card) return; const s = steps[idx], t = find(s.sel); const vw = innerWidth, vh = innerHeight;
    if (!t) { ring.style.opacity = 0; return; }
    const r = t.getBoundingClientRect(), pad = 6, gap = 14;
    Object.assign(ring.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px', opacity: 1 });
    const cw = Math.min(card.offsetWidth || 340, vw - 20), ch = card.offsetHeight || 160, clampX = x => Math.min(Math.max(10, x), vw - cw - 10), clampY = y => Math.min(Math.max(10, y), vh - ch - 10);
    card.style.right = card.style.bottom = 'auto'; card.style.width = '';
    const opts = [
      [clampX(r.left + r.width / 2 - cw / 2), r.bottom + pad + gap, r.bottom + pad + gap + ch < vh - 10],   // below
      [clampX(r.left + r.width / 2 - cw / 2), r.top - pad - gap - ch, r.top - pad - gap - ch > 10],          // above
      [r.right + pad + gap, clampY(r.top + r.height / 2 - ch / 2), r.right + pad + gap + cw < vw - 10],        // right
      [r.left - pad - gap - cw, clampY(r.top + r.height / 2 - ch / 2), r.left - pad - gap - cw > 10],          // left
    ];
    if (s.pos === 'above') opts.unshift(opts.splice(1, 1)[0]);
    const o = opts.find(o => o[2]);
    if (o) { card.style.left = o[0] + 'px'; card.style.top = o[1] + 'px'; }
    else { card.style.left = clampX(r.left + 16) + 'px'; card.style.top = clampY(r.top + 16) + 'px'; }   // very large target: sit inside its top-left corner
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  W.coach = { start: () => { localStorage.setItem(onKey, 'on'); if (groups.length) start(groups[0]); paint(); }, isOn };
})();
