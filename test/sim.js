'use strict';
// Randomised full-auction simulations: every run must end with all players sold and every rule satisfied.
const E = require('../lib/engine');
const M = E.M;
let stuck = 0, runs = Number(process.argv[2] || 15), maxR2 = 0, forcedUsed = 0;
for (let r = 0; r < runs; r++) {
  const s = E.freshState();
  const strict = r % 5 === 4; if (strict) s.config.minPerCat = 1;   // every 5th run also exercises the optional category minimum
  const aggr = [0.2, 0.5, 0.9, 1.4][r % 4];           // how aggressive bidders are
  let guard = 0;
  while (s.players.some(p => p.status !== 'sold') && guard++ < 400) {
    let res = E.apply(s, 'draw'); if (!res.ok) { console.log('draw failed', res.error); break; }
    const p = E.player(s, s.current.playerId);
    // random bidding war
    const want = s.teams.map(() => p.base + Math.floor(Math.random() * aggr * 8 * 4) * 0.25 * M);
    let tries = 0;
    while (tries++ < 200) {
      const order = s.teams.map((_, i) => i).sort(() => Math.random() - .5);
      let moved = false;
      for (const i of order) {
        const nx = E.nextBidAmount(s);
        if (nx <= want[i] && Math.random() < .7) { const x = E.apply(s, 'bid', { team: s.teams[i].id }); if (x.ok) { moved = true; } }
      }
      if (!moved) break;
    }
    if (s.current.bids.length) { const x = E.apply(s, 'sell'); if (!x.ok) { console.log('sell failed', x.error); break; } }
    else if (s.round === 2) {
      // round 2: assign at base to a team that needs players and is eligible, else mark unsold again
      const v = E.view(s);
      const cand = v.teams.filter(t => t.elig.ok).sort((a, b) => b.need - a.need)[0];
      if (cand && Math.random() < .6) E.apply(s, 'assignBase', { team: cand.id });
      else if (cand) { E.apply(s, 'bid', { team: cand.id }); E.apply(s, 'sell'); }
      else E.apply(s, 'unsold');
    } else E.apply(s, 'unsold');
  }
  const unsoldLeft = s.players.filter(p => p.status !== 'sold');
  if (unsoldLeft.length) {
    // deadlock: try emergency valve
    stuck++;
    if (stuck <= 3) {
      const v = E.view(s);
      console.log(`run ${r}: STUCK with ${unsoldLeft.map(p => p.name + '(' + p.cat + ',' + p.base / M + 'M)').join(', ')} | teams:`,
        v.teams.map(t => `${t.short} buys${t.buys.length} left${t.left / M}M cats${t.cats} elig=${t.elig ? t.elig.ok + ':' + t.elig.reason : '-'}`));
    }
    continue;
  }
  // invariants
  for (const t of s.teams) {
    const n = t.buys.length;
    if (n < E.minBuys(s) || n > E.maxBuys(s)) throw new Error(`run ${r} ${t.short} buys ${n}`);
    const spent = t.buys.reduce((a, b) => a + b.price, 0);
    if (spent > s.config.purse) throw new Error('overspent');
    if (strict) for (const c of E.CATS) if (!t.buys.some(b => E.player(s, b.playerId).cat === c)) throw new Error(`run ${r} ${t.short} missing cat ${c}`);
  }
  if (s.teams.reduce((a, t) => a + t.buys.length, 0) !== s.players.length) throw new Error('count');
}
console.log(`${runs} runs, deadlocks: ${stuck}`);
process.exit(stuck ? 1 : 0);

