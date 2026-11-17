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

// ladder snap: custom 16.5 -> next call is 17 (not 17.5); 17 is accepted
{
  const s = E.freshState(); E.apply(s, 'draw'); const p = E.player(s, s.current.playerId); p.base = 12e6; s.current.bids = [];
  assert(E.apply(s, 'bid', { team: s.teams[0].id, amount: 16.5e6 }).ok);
  assert.strictEqual(E.nextBidAmount(s), 17e6, 'next after 16.5 is 17');
  assert(E.apply(s, 'bid', { team: s.teams[1].id, amount: 17e6 }).ok, '17 accepted');
  assert.strictEqual(E.nextBidAmount(s), 18e6);
  E.apply(s, 'bid', { team: s.teams[0].id, amount: 20e6 }); assert.strictEqual(E.nextBidAmount(s), 22e6, 'slab 2M above 20');
  E.apply(s, 'bid', { team: s.teams[1].id, amount: 23e6 }); assert.strictEqual(E.nextBidAmount(s), 24e6, 'snap to 2M ladder after 23');
  console.log('ladder tests passed');
}
