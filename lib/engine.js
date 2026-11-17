'use strict';
/**
 * WCG Auction rules engine (authoritative, runs on the server; also unit-tested in isolation).
 *
 * Rules (from WCL_revised_auction.xlsx):
 *  - 5 teams, one captain each. Purse $70M per team.
 *  - Squad 7-8 INCLUDING the captain  => each team BUYS 6-7 players from the pool of 32.
 *  - Minimum 1 player from every category (1-4) per team.
 *  - IPL-style open bidding with increment slabs; two rounds (unsold players return in round 2).
 */

const M = 1000000;
const CATS = [1, 2, 3, 4];

const PLAYERS = [
  ['Ravi', .75, 1, 12], ['Bharath', .75, 1, 12], ['Bishesh', .9, 1, 12], ['Karan', .75, 1, 12], ['Mayank', .75, 1, 12],
  ['Vipul', .5, 1, 12], ['Vamsi', .9, 1, 12], ['Santosh', .5, 1, 12], ['Srijan', .5, 1, 12], ['Anand', .75, 1, 12],
  ['Piyush', .75, 2, 8], ['Abhishek', .75, 2, 8], ['Allwyn', .75, 2, 8], ['Aman', .75, 2, 8], ['Amlan', .75, 2, 8],
  ['Gian', .9, 2, 8], ['Utkarsh', .75, 2, 8], ['Manish', .75, 2, 8], ['Dev', .5, 2, 8], ['Amol', .75, 2, 8],
  ['Mahesh', .9, 2, 6], ['Rohit T', .75, 2, 6],
  ['Shekhar', .75, 3, 6], ['Suraj', .9, 3, 6], ['Varun', .5, 3, 6], ['Anjani', .75, 3, 4], ['Kapil', .5, 3, 4],
  ['Keval', .75, 4, 4], ['Subhendu', .75, 4, 4], ['Sudhakar', .75, 4, 4], ['Sumit', .75, 4, 4], ['Visa', .5, 4, 4],
];

const TEAMS = [
  { id: 't1', name: 'Simha Strikers',  short: 'SIM', captain: 'Hitesh',  logo: 'simha',        color: '#f5c14b' },
  { id: 't2', name: 'Scarlet Hawks',   short: 'SCH', captain: 'Saumin',  logo: 'hawks',        color: '#ff4d5a' },
  { id: 't3', name: 'Vajra Warriors',  short: 'VAJ', captain: 'Lakshmi', logo: 'vajra',        color: '#4aa8ff' },
  { id: 't4', name: 'Jhakkas Lah',     short: 'JHK', captain: 'Karthik', logo: 'jhakkas',      color: '#ffd23f' },
  { id: 't5', name: 'Game Changers XI', short: 'GCX', captain: 'Ashok',  logo: 'gamechangers', color: '#6f8cff' },
];

const DEFAULT_CONFIG = {
  purse: 70 * M,
  minSquad: 7,          // includes captain
  maxSquad: 8,          // includes captain
  captainInSquad: true,
  minPerCat: 1,
  // bid increment slabs: while current bid < upTo use inc
  slabs: [{ upTo: 20 * M, inc: 1 * M }, { upTo: -1, inc: 2 * M }],   // upTo -1 = no limit
};

function freshState() {
  return {
    rev: 0,
    seq: 0,                        // increments on every visible event (drives live animations)
    config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
    started: false,
    round: 1,
    teams: TEAMS.map(t => ({ ...t, buys: [] })),
    players: PLAYERS.map((p, i) => ({
      id: 'p' + (i + 1), name: p[0], avail: p[1], cat: p[2], base: p[3] * M,
      status: 'pool', team: null, price: null, skips: 0,
    })),
    current: null,                 // {playerId, bids:[{team,amount,ts}], call:0}
    lastEvent: null,               // {seq, type:'sold'|'unsold'|'draw'|'assigned', ...}
    log: [],                       // newest last
  };
}

/* ---------- helpers ---------- */
const player = (s, id) => s.players.find(p => p.id === id);
const teamIdx = (s, id) => s.teams.findIndex(t => t.id === id);
const minBuys = s => s.config.minSquad - (s.config.captainInSquad ? 1 : 0);
const maxBuys = s => s.config.maxSquad - (s.config.captainInSquad ? 1 : 0);
const spent = t => t.buys.reduce((n, b) => n + b.price, 0);
const purseLeft = (s, t) => s.config.purse - spent(t);
const catCount = (s, t, c) => t.buys.filter(b => player(s, b.playerId).cat === c).length;
const available = s => s.players.filter(p => p.status === 'pool' || p.status === 'unsold');

function slabInc(s, amount) {
  for (const sl of s.config.slabs) if (sl.upTo < 0 || amount < sl.upTo) return sl.inc;
  return s.config.slabs[s.config.slabs.length - 1].inc;
}

function nextBidAmount(s) {
  const c = s.current; if (!c) return null;
  const p = player(s, c.playerId);
  if (!c.bids.length) return p.base;
  const last = c.bids[c.bids.length - 1].amount;
  return last + slabInc(s, last);
}

/** Money a team must hold back to finish its minimum squad (cheapest-possible fill). Infinity = impossible. */
function reserveOf(s, t, boughtCat, boughtCount, rest) {
  const needSlots = Math.max(0, minBuys(s) - (t.buys.length + boughtCount));
  const missing = CATS.filter(c => (catCount(s, t, c) + (boughtCat === c ? 1 : 0)) < s.config.minPerCat);
  let reserve = 0;
  for (const c of missing) {
    const bases = rest.filter(x => x.cat === c).map(x => x.base);
    if (!bases.length) return { reserve: Infinity, needSlots, missing };
    reserve += Math.min(...bases);
  }
  const extra = Math.max(0, needSlots - missing.length);
  if (extra > 0) {
    const cheapest = rest.map(x => x.base).sort((a, b) => a - b);
    if (cheapest.length < extra) return { reserve: Infinity, needSlots, missing };
    for (let i = 0; i < extra; i++) reserve += cheapest[i];
  }
  return { reserve, needSlots, missing };
}

/**
 * EXACT feasibility: after team `ti` buys player `p` for `amount`, does at least one way exist to hand
 * every remaining player to a team so that all teams reach their minimum squad and category minimums,
 * stay under the squad cap, and stay within their purse (each player costed at base price - the best case)?
 * If yes, the auction can always be completed (no end-game deadlock). Small search: 5 teams x ~6 price groups.
 */
function feasible(s, ti, p, amount) {
  const rest = available(s).filter(x => !p || x.id !== p.id);
  const gmap = new Map();
  rest.forEach(x => { const k = x.cat + ':' + x.base; if (!gmap.has(k)) gmap.set(k, { cat: x.cat, base: x.base, n: 0 }); gmap.get(k).n++; });
  const groups = [...gmap.values()];
  const G = groups.length;
  const T = s.teams.map((t, j) => {
    const hit = j === ti && p;
    const buys = t.buys.length + (hit ? 1 : 0);
    return {
      purse: purseLeft(s, t) - (hit ? amount : 0),
      needCat: CATS.map(c => Math.max(0, s.config.minPerCat - (catCount(s, t, c) + (hit && p.cat === c ? 1 : 0)))),
      minLeft: Math.max(0, minBuys(s) - buys),
      cap: maxBuys(s) - buys,
    };
  });
  if (T.some(t => t.purse < 0 || t.cap < 0)) return false;
  const R0 = rest.length;
  if (R0 > T.reduce((n, t) => n + t.cap, 0)) return false;
  if (R0 < T.reduce((n, t) => n + t.minLeft, 0)) return false;
  for (const c of CATS) {
    if (rest.filter(x => x.cat === c).length < T.reduce((n, t) => n + t.needCat[c - 1], 0)) return false;
  }
  const failed = new Set();
  function rec(j, rem) {
    if (j === T.length) return rem.every(n => n === 0);
    let R = 0; for (let g = 0; g < G; g++) R += rem[g];
    let capRest = 0, minRest = 0; for (let k = j; k < T.length; k++) { capRest += T[k].cap; minRest += T[k].minLeft; }
    if (R > capRest || R < minRest) return false;
    const key = j + ':' + rem.join(',');
    if (failed.has(key)) return false;
    const t = T[j];
    const x = new Array(G).fill(0), cc = [0, 0, 0, 0];
    const pick = (g, used, cost) => {
      if (g === G) {
        if (used < t.minLeft) return false;
        for (let c = 0; c < 4; c++) if (cc[c] < t.needCat[c]) return false;
        return rec(j + 1, rem.map((n, i) => n - x[i]));
      }
      const gr = groups[g], ci = gr.cat - 1;
      const maxN = Math.min(rem[g], t.cap - used, Math.floor((t.purse - cost) / gr.base));
      for (let n = maxN; n >= 0; n--) {
        x[g] = n; cc[ci] += n;
        const ok = pick(g + 1, used + n, cost + n * gr.base);
        cc[ci] -= n; x[g] = 0;
        if (ok) return true;
      }
      return false;
    };
    const ok = pick(0, 0, 0);
    if (!ok) failed.add(key);
    return ok;
  }
  return rec(0, groups.map(g => g.n));
}

/** Cheap upper bound on what a team can pay (squad completion at cheapest bases), plus quick reasons. */
function cheapLimit(s, ti, p) {
  const t = s.teams[ti];
  const rest = available(s).filter(x => x.id !== p.id);
  if (t.buys.length >= maxBuys(s)) return { ok: false, reason: 'Squad full', maxBid: 0 };
  for (const c of CATS) {
    const needOthers = s.teams.reduce((n, o, oi) => oi === ti ? n : n + Math.max(0, s.config.minPerCat - catCount(s, o, c)), 0);
    if (rest.filter(x => x.cat === c).length < needOthers) return { ok: false, reason: `Other teams still need a Category ${c} player`, maxBid: 0 };
  }
  const needOthersTotal = s.teams.reduce((n, o, oi) => oi === ti ? n : n + Math.max(0, minBuys(s) - o.buys.length), 0);
  const mine = reserveOf(s, t, p.cat, 1, rest);
  if (rest.length < needOthersTotal + mine.needSlots) return { ok: false, reason: 'Not enough players left for every team to reach minimum squad', maxBid: 0 };
  if (mine.reserve === Infinity) return { ok: false, reason: 'No suitable players left to complete this squad', maxBid: 0 };
  const maxBid = purseLeft(s, t) - mine.reserve;
  if (maxBid < p.base) return { ok: false, reason: `Must keep ${fmtM(mine.reserve)} to complete squad`, maxBid: Math.max(0, maxBid) };
  return { ok: true, reason: '', maxBid };
}

/** Exact eligibility at a given price (default: base price). */
function eligibility(s, ti, p, amount) {
  amount = amount == null ? p.base : amount;
  const c = cheapLimit(s, ti, p);
  if (!c.ok) return c;
  if (amount > c.maxBid) return { ok: false, reason: `Above ${fmtM(c.maxBid)} the team could not complete its squad`, maxBid: c.maxBid };
  if (!feasible(s, ti, p, amount)) return { ok: false, reason: 'Would leave some team unable to complete its squad within purse', maxBid: c.maxBid };
  return { ok: true, reason: '', maxBid: c.maxBid };
}

/** Exact maximum bid (0.5M steps) for team ti on player p. */
function exactLimit(s, ti, p) {
  const c = cheapLimit(s, ti, p);
  if (!c.ok) return c;
  if (!feasible(s, ti, p, p.base)) return { ok: false, reason: 'Would leave some team unable to complete its squad within purse', maxBid: 0 };
  const step = 0.5 * M;
  let lo = Math.round(p.base / step), hi = Math.floor(c.maxBid / step);
  while (lo < hi) {                                  // feasibility is monotone in price
    const mid = Math.ceil((lo + hi) / 2);
    if (feasible(s, ti, p, mid * step)) lo = mid; else hi = mid - 1;
  }
  return { ok: true, reason: '', maxBid: lo * step };
}

/** Eligibility for every team against the current player (or null). */
function currentEligibility(s) {
  if (!s.current) return null;
  if (!s.current.limits) { const p = player(s, s.current.playerId); s.current.limits = s.teams.map((_, i) => exactLimit(s, i, p)); }
  return s.current.limits;
}

const fmtM = n => '$' + (n / M).toFixed(n % M ? 1 : 0).replace(/\.0$/, '') + 'M';

/* ---------- actions (each returns {ok, error?}) ---------- */
function snapshot(s) { const c = JSON.parse(JSON.stringify(s)); delete c._undo; return JSON.stringify(c); }
function pushUndo(s) { (s._undo = s._undo || []).push(snapshot(s)); if (s._undo.length > 40) s._undo.shift(); }
function event(s, e) { s.seq += 1; s.lastEvent = { seq: s.seq, ts: Date.now(), ...e }; s.log.push(s.lastEvent); if (s.log.length > 500) s.log.shift(); }
const err = m => ({ ok: false, error: m });
const done = () => ({ ok: true });

const CAT_ORDER = [1, 2, 3, 4];

function pickNext(s) {
  // Round 1: category sets in order (Cat 1 -> 4), random inside the set.
  const pool = s.players.filter(p => p.status === 'pool');
  if (pool.length) {
    const c = CAT_ORDER.find(c => pool.some(p => p.cat === c));
    const set = pool.filter(p => p.cat === c);
    return { p: set[Math.floor(Math.random() * set.length)], round: 1 };
  }
  const un = s.players.filter(p => p.status === 'unsold');
  if (un.length) {
    const minSkips = Math.min(...un.map(p => p.skips));
    const set = un.filter(p => p.skips === minSkips);
    return { p: set[Math.floor(Math.random() * set.length)], round: 2 };
  }
  return null;
}

function bring(s, p, round) {
  p.status = 'live'; s.current = { playerId: p.id, bids: [], call: 0, limits: null }; s.round = round; s.started = true;
  event(s, { type: 'draw', player: p.id });
}

const actions = {
  draw(s) {
    if (s.current) return err('Finish the current player first (sell or mark unsold).');
    const n = pickNext(s);
    if (!n) return err('No players left to auction.');
    pushUndo(s); bring(s, n.p, n.round); return done();
  },
  call(s, { playerId }) {
    if (s.current) return err('Finish the current player first.');
    const p = player(s, playerId);
    if (!p || !(p.status === 'pool' || p.status === 'unsold')) return err('Player is not available.');
    pushUndo(s); bring(s, p, p.status === 'unsold' ? 2 : 1); return done();
  },
  bid(s, { team, amount }) {
    if (!s.current) return err('No player on the block.');
    const ti = teamIdx(s, team); if (ti < 0) return err('Unknown team.');
    const p = player(s, s.current.playerId);
    const next = nextBidAmount(s);
    let a = amount == null ? next : Math.round(Number(amount));
    if (!Number.isFinite(a) || a < next) return err(`Bid must be at least ${fmtM(next)}.`);
    if (a % (0.5 * M) !== 0) return err('Bids must be in $0.5M steps.');
    const last = s.current.bids[s.current.bids.length - 1];
    if (last && last.team === team) return err('This team already holds the highest bid.');
    const lim = currentEligibility(s)[ti];
    if (!lim.ok) return err(`${s.teams[ti].name}: ${lim.reason}`);
    if (a > lim.maxBid) return err(`${s.teams[ti].name} can bid at most ${fmtM(lim.maxBid)} (must keep money to complete squad).`);
    s.current.bids.push({ team, amount: a, ts: Date.now() }); s.current.call = 0;
    event(s, { type: 'bid', player: p.id, team, amount: a });
    return done();
  },
  undoBid(s) {
    if (!s.current || !s.current.bids.length) return err('No bid to undo.');
    s.current.bids.pop(); s.current.call = 0; s.seq += 1; return done();
  },
  /** Host/owner: wipe every bid on the current player (price returns to base). */
  clearBids(s) {
    if (!s.current || !s.current.bids.length) return err('No bids to clear.');
    pushUndo(s); s.current.bids = []; s.current.call = 0;
    event(s, { type: 'cleared', player: s.current.playerId }); return done();
  },
  /** Host/owner: take the current player off the block without selling or marking unsold (drawn by mistake). */
  putBack(s) {
    if (!s.current) return err('No player on the block.');
    const p = player(s, s.current.playerId);
    pushUndo(s); p.status = s.round === 2 ? 'unsold' : 'pool'; s.current = null;
    event(s, { type: 'putback', player: p.id }); return done();
  },
  going(s, { n }) {
    if (!s.current || !s.current.bids.length) return err('No bids yet.');
    s.current.call = Math.max(0, Math.min(2, n | 0)); s.seq += 1;
    event(s, { type: 'going', n: s.current.call, player: s.current.playerId }); return done();
  },
  sell(s) {
    if (!s.current || !s.current.bids.length) return err('No bid to sell.');
    const p = player(s, s.current.playerId);
    const hb = s.current.bids[s.current.bids.length - 1];
    const ti = teamIdx(s, hb.team), t = s.teams[ti];
    const el = eligibility(s, ti, p, hb.amount);
    if (!el.ok) return err('Sale violates a rule: ' + el.reason);
    pushUndo(s);
    t.buys.push({ playerId: p.id, price: hb.amount, round: s.round });
    p.status = 'sold'; p.team = t.id; p.price = hb.amount;
    s.current = null;
    event(s, { type: 'sold', player: p.id, team: t.id, amount: hb.amount, round: s.round });
    return done();
  },
  unsold(s) {
    if (!s.current) return err('No player on the block.');
    if (s.current.bids.length) return err('A player with a bid cannot be marked unsold.');
    const p = player(s, s.current.playerId);
    pushUndo(s);
    p.status = 'unsold'; p.skips += 1; s.current = null;
    event(s, { type: 'unsold', player: p.id, round: s.round });
    return done();
  },
  /** Round 2 rule: team that must fill its squad takes the player at base price. */
  assignBase(s, { team }) {
    if (!s.current) return err('No player on the block.');
    if (s.current.bids.length) return err('Clear bids first, or sell to the highest bidder.');
    if (s.round !== 2) return err('Assign-at-base is only available in the unsold round (Round 2).');
    const ti = teamIdx(s, team); if (ti < 0) return err('Unknown team.');
    const p = player(s, s.current.playerId);
    const el = eligibility(s, ti, p);
    if (!el.ok) return err(`${s.teams[ti].name}: ${el.reason}`);
    pushUndo(s);
    const t = s.teams[ti];
    t.buys.push({ playerId: p.id, price: p.base, round: 2 });
    p.status = 'sold'; p.team = t.id; p.price = p.base; s.current = null;
    event(s, { type: 'sold', player: p.id, team: t.id, amount: p.base, round: 2, atBase: true });
    return done();
  },
  /** Emergency valve: host assigns the live player to any team that has a free slot and the money. */
  assignForce(s, { team, price }) {
    if (!s.current) return err('No player on the block.');
    const ti = teamIdx(s, team); if (ti < 0) return err('Unknown team.');
    const p = player(s, s.current.playerId), t = s.teams[ti];
    price = price == null ? p.base : Math.round(Number(price));
    if (!(price >= 0)) return err('Invalid price.');
    if (t.buys.length >= maxBuys(s)) return err('Squad full.');
    if (price > purseLeft(s, t)) return err('Price exceeds the remaining purse.');
    pushUndo(s);
    t.buys.push({ playerId: p.id, price, round: s.round, forced: true });
    p.status = 'sold'; p.team = t.id; p.price = price; s.current = null;
    event(s, { type: 'sold', player: p.id, team: t.id, amount: price, round: s.round, forced: true });
    return done();
  },
  undo(s) {
    if (!s._undo || !s._undo.length) return err('Nothing to undo.');
    const keepRev = s.rev, keepSeq = s.seq, undo = s._undo;
    const prev = JSON.parse(undo.pop());
    Object.keys(s).forEach(k => delete s[k]);
    Object.assign(s, prev); s._undo = undo; s.rev = keepRev; s.seq = keepSeq + 1;
    s.lastEvent = { seq: s.seq, ts: Date.now(), type: 'undo' };
    return done();
  },
  rename(s, { team, name }) {
    const t = s.teams[teamIdx(s, team)]; if (!t) return err('Unknown team.');
    name = String(name || '').trim().slice(0, 28); if (!name) return err('Name required.');
    t.name = name; return done();
  },
  settings(s, c) {
    if (s.started) return err('Settings are locked once the auction has started. Use Reset to change them.');
    const purse = Number(c.purse), minSquad = Number(c.minSquad), maxSquad = Number(c.maxSquad);
    if (!(purse > 0) || !(minSquad >= 1) || !(maxSquad >= minSquad)) return err('Check the settings values.');
    Object.assign(s.config, { purse, minSquad, maxSquad });
    if (c.slabs) s.config.slabs = c.slabs;
    return done();
  },
  reset(s) {
    const names = s.teams.map(t => t.name), cfg = s.config;
    const f = freshState(); f.config = cfg; f.teams.forEach((t, i) => t.name = names[i]);
    const rev = s.rev, seq = s.seq;
    Object.keys(s).forEach(k => delete s[k]); Object.assign(s, f); s.rev = rev; s.seq = seq + 1;
    event(s, { type: 'reset' }); return done();
  },
};

/** Apply an action. Mutates state and bumps rev on success. */
function apply(s, type, args) {
  const fn = actions[type]; if (!fn) return err('Unknown action.');
  const r = fn(s, args || {});
  if (r.ok) s.rev += 1;
  return r;
}

/** Everything the screens need, including computed rule info. */
function view(s) {
  const cur = s.current ? player(s, s.current.playerId) : null;
  const el = currentEligibility(s);
  const av = available(s);
  const teams = s.teams.map((t, i) => {
    // generic max-bid when no player is live: against the cheapest remaining player
    let generic = null;
    if (!cur && av.length) {
      const cheapest = av.slice().sort((a, b) => a.base - b.base)[0];
      generic = eligibility(s, i, cheapest);
    }
    return {
      id: t.id, name: t.name, short: t.short, captain: t.captain, logo: t.logo, color: t.color,
      buys: t.buys.map(b => ({ ...b })),
      spent: spent(t), left: purseLeft(s, t), count: t.buys.length + (s.config.captainInSquad ? 1 : 0),
      cats: CATS.map(c => catCount(s, t, c)),
      need: Math.max(0, minBuys(s) - t.buys.length),
      elig: el ? el[i] : null, genericMax: generic ? generic.maxBid : null,
    };
  });
  const pending = s.players.filter(p => p.status === 'pool' || p.status === 'live').length;
  const unsold = s.players.filter(p => p.status === 'unsold').length;
  const sold = s.players.filter(p => p.status === 'sold').length;
  return {
    rev: s.rev, seq: s.seq, config: s.config, started: s.started, round: s.round,
    complete: sold === s.players.length,
    counts: { total: s.players.length, sold, pending, unsold },
    minBuys: minBuys(s), maxBuys: maxBuys(s),
    teams, players: s.players,
    current: s.current ? { ...s.current, player: cur, next: nextBidAmount(s) } : null,
    lastEvent: s.lastEvent, log: s.log.slice(-60),
    canUndo: !!(s._undo && s._undo.length),
    // round-2 hint: exactly one team still needs players -> may take at base price
    soleNeeder: (() => {
      if (!s.current || s.round !== 2) return null;
      const ok = teams.filter(t => t.elig && t.elig.ok && t.need > 0);
      return ok.length === 1 ? ok[0].id : null;
    })(),
  };
}

module.exports = { feasible, M, CATS, freshState, apply, view, eligibility, nextBidAmount, slabInc, fmtM, player, minBuys, maxBuys, DEFAULT_CONFIG };
