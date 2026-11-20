'use strict';
const E = require('../lib/engine'), assert = require('assert');
const s = E.freshState();
E.apply(s, 'draw'); const id = s.current.playerId, t = s.teams[0].id;
assert(!E.apply(s, 'clearBids').ok, 'clearBids with no bids must fail');
assert(E.apply(s, 'bid', { team: t }).ok); assert(E.apply(s, 'bid', { team: s.teams[1].id }).ok);
assert(E.apply(s, 'clearBids').ok && s.current.bids.length === 0, 'clearBids empties bids');
assert(E.apply(s, 'undo').ok && s.current.bids.length === 2, 'undo restores cleared bids');
assert(E.apply(s, 'putBack').ok && !s.current && E.player(s, id).status === 'pool', 'putBack returns player to pool');
assert(!E.apply(s, 'putBack').ok, 'putBack with nobody on block fails');
console.log('actions tests passed');

// 0.25M ladder: custom 16.5 -> next call is 16.75; any 0.25 step accepted; 16.6 rejected
{
  const s = E.freshState(); E.apply(s, 'draw'); const p = E.player(s, s.current.playerId); p.base = 12e6; s.current.bids = [];
  assert.strictEqual(E.nextBidAmount(s), 12e6);
  assert(E.apply(s, 'bid', { team: s.teams[0].id }).ok); assert.strictEqual(E.nextBidAmount(s), 12.25e6, 'default step is 250K');
  assert(E.apply(s, 'bid', { team: s.teams[1].id, amount: 16.5e6 }).ok);
  assert.strictEqual(E.nextBidAmount(s), 16.75e6);
  assert(!E.apply(s, 'bid', { team: s.teams[0].id, amount: 16.6e6 }).ok, 'off-ladder bid rejected');
  assert(E.apply(s, 'bid', { team: s.teams[0].id, amount: 16.75e6 }).ok);
  console.log('ladder tests passed');
}
// fully random draw across categories (not Cat 1 first)
{
  const seen = new Set();
  for (let i = 0; i < 60; i++) { const s = E.freshState(); E.apply(s, 'draw'); seen.add(E.player(s, s.current.playerId).cat); }
  assert(seen.size >= 3, 'draw must come from every category, got ' + [...seen]);
  assert.strictEqual(E.freshState().config.minPerCat, 0); assert.strictEqual(E.freshState().players.length, 37);
  console.log('random draw tests passed');
}
// roster editing
{
  const s = E.freshState();
  assert(E.apply(s, 'addPlayer', { name: 'Zed', cat: 2, base: 8e6, avail: 80 }).ok); assert.strictEqual(s.players.length, 38);
  assert(!E.apply(s, 'addPlayer', { name: 'zed', cat: 2, base: 8e6 }).ok, 'duplicate name rejected');
  assert(!E.apply(s, 'addPlayer', { name: 'Q', cat: 9, base: 8e6 }).ok, 'bad category rejected');
  const z = s.players[37]; assert.strictEqual(z.avail, .8);
  assert(E.apply(s, 'updatePlayer', { id: z.id, cat: 1, base: 12e6 }).ok && z.cat === 1 && z.base === 12e6);
  assert(E.apply(s, 'setTier', { cat: 4, base: 5e6 }).ok && s.players.filter(p => p.cat === 4).every(p => p.base === 5e6));
  E.apply(s, 'draw'); const live = E.player(s, s.current.playerId);
  assert(!E.apply(s, 'updatePlayer', { id: live.id, base: 1e6 }).ok, 'price locked while live');
  assert(E.apply(s, 'updatePlayer', { id: live.id, name: live.name + ' X' }).ok, 'rename allowed while live');
  assert(!E.apply(s, 'removePlayer', { id: live.id }).ok, 'cannot remove live player');
  // undo never rolls back roster edits
  E.apply(s, 'bid', { team: s.teams[0].id }); E.apply(s, 'updatePlayer', { id: z.id, name: 'Zedd' }); E.apply(s, 'addPlayer', { name: 'Newbie', cat: 3, base: 6e6 });
  assert(E.apply(s, 'undo').ok); assert.strictEqual(E.player(s, z.id).name, 'Zedd'); assert(s.players.some(p => p.name === 'Newbie'), 'added player survives undo');
  // reset keeps roster
  E.apply(s, 'reset'); assert(s.players.some(p => p.name === 'Newbie') && s.players.every(p => p.status === 'pool'), 'reset keeps roster');
  E.apply(s, 'loadDefaults'); assert.strictEqual(s.players.length, 37);
  console.log('roster tests passed');
}
