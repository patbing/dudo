import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../server/src/game.js';
import { deal, dealAll, dealIfDue, verify, sha256hex, newSeed } from '../server/src/fair.js';
import { botMove } from '../server/src/bot.js';

function table2(hands = [[2, 2, 5], [2, 3, 6]]) {
  const t = G.newTable({ code: 'TEST', dice: 3, seats: 2 });
  G.join(t, { name: 'Ann', token: 'a' });
  G.join(t, { name: 'Bob', token: 'b' });
  G.start(t, { seed: 's', commit: 'c' });
  G.applyDeal(t, hands);
  return t;
}

test('bids must rise; turn order', () => {
  const t = table2();
  assert.throws(() => G.bid(t, 1, { quantity: 1, face: 2 }), /not your turn/);
  G.bid(t, 0, { quantity: 2, face: 2 });
  assert.equal(t.turn, 1);
  assert.throws(() => G.bid(t, 1, { quantity: 2, face: 2 }), /must beat/);
  assert.throws(() => G.bid(t, 1, { quantity: 1, face: 6 }), /must beat/);
  assert.throws(() => G.bid(t, 1, { quantity: 7, face: 6 }), /quantity must be/);
  G.bid(t, 1, { quantity: 2, face: 3 });
  assert.deepEqual(G.legal(t).min_bid, { quantity: 2, face: 4 });
});

test('showdown: true bid costs the challenger, false bid costs the bidder; loser opens', () => {
  let t = table2();
  G.bid(t, 0, { quantity: 3, face: 2 }); // there are three 2s
  G.challenge(t, 1, {});
  assert.equal(t.players[1].dice, 2);
  assert.equal(t.last_showdown.count, 3);
  assert.equal(t.opener, 1);
  assert.ok(t.dealPending);
  t = table2();
  G.bid(t, 0, { quantity: 4, face: 2 });
  G.challenge(t, 1, {});
  assert.equal(t.players[0].dice, 2);
  assert.equal(t.opener, 0);
});

test('two timeouts in a row knock a player out; ranking', () => {
  const t = table2();
  G.timeout(t); // Ann 3 -> 2
  assert.equal(t.players[0].dice, 2);
  G.applyDeal(t, [[1, 1], [2, 2, 2]]);
  G.timeout(t); // Ann again: out
  assert.equal(t.status, 'over');
  assert.deepEqual(t.ranking, ['Bob', 'Ann']);
});

test('views never leak another hand or the seed', () => {
  const t = table2();
  for (const v of [G.view(t, 0), G.view(t, null)]) {
    const s = JSON.stringify(v);
    assert.ok(!s.includes('"seed"'));
    assert.ok(!('hands' in v));
  }
  assert.deepEqual(G.view(t, 0).you.dice, [2, 2, 5]);
  assert.ok(!JSON.stringify(G.view(t, 0)).includes('[2,3,6]'));
  assert.ok(G.view(t, 0).legal && !G.view(t, 1).legal);
});

test('dice are uniform (60,000 rolls within 3%)', async () => {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 2000; r++) for (const d of await deal('seed', r, 0, 30)) c[d]++;
  for (let f = 1; f <= 6; f++) assert.ok(Math.abs(c[f] / 60000 - 1 / 6) < 0.005, `face ${f}: ${c[f]}`);
  assert.deepEqual(await deal('x', 1, 2, 5), await deal('x', 1, 2, 5));
});

// Every view of every seat and of a spectator, at every step: no other hand of the running round, no seed before the end.
function checkSecrecy(t) {
  for (const seat of [null, ...t.players.map((p) => p.seat)]) {
    const v = G.view(t, seat), s = JSON.stringify(v);
    if (t.status !== 'over') assert.ok(!s.includes(t.seed), 'seed leaked');
    assert.ok(!('hands' in v), 'hands field in a view');
    if (t.status === 'playing' && v.last_showdown) assert.ok(v.last_showdown.round < t.round, 'showdown of the running round');
    if (seat == null) assert.ok(!('you' in v), 'spectator got a hand');
    else if (t.hands && t.hands[seat]) assert.deepEqual(v.you.dice, t.hands[seat], 'a seat sees its own dice only');
  }
}

async function playOut(names = ['Ann', 'Bob', 'Cy'], maxMoves = 500) {
  const t = G.newTable({ code: 'PLAY', dice: 3, seats: names.length });
  names.forEach((n, i) => G.join(t, { name: n, token: String(i), bot: true }));
  const seed = newSeed();
  G.start(t, { seed, commit: await sha256hex(seed) });
  let positions = 0;
  for (let i = 0; i < maxMoves && t.status === 'playing'; i++) {
    await dealIfDue(t, i);
    checkSecrecy(t);
    if (t.status !== 'playing') break;
    const v = G.view(t, t.turn);
    const m = botMove(v);
    positions++;
    if (m.type === 'bid') G.bid(t, t.turn, { quantity: m.quantity, face: m.face, now: i }); // throws if illegal
    else G.challenge(t, t.turn, { now: i });
  }
  return { t, positions };
}

test('the bot always makes a legal move, and no view of any seat leaks (1,000+ positions)', async () => {
  let positions = 0, games = 0;
  while (positions < 1000) { const r = await playOut(); assert.equal(r.t.status, 'over'); positions += r.positions; games++; }
  assert.ok(games > 5);
});

test('verify accepts a real record and rejects tampering', async () => {
  const { t } = await playOut();
  const rec = G.record(t);
  assert.equal((await verify(rec)).ok, true);
  const clone = () => JSON.parse(JSON.stringify(rec));

  const badSeed = clone(); badSeed.seed = newSeed();
  assert.equal((await verify(badSeed)).ok, false);

  const badHand = clone(); const d = badHand.events.find((e) => e.type === 'deal');
  d.hands[0][0] = d.hands[0][0] === 6 ? 1 : d.hands[0][0] + 1;
  assert.equal((await verify(badHand)).ok, false);

  const badBid = clone(); const b = badBid.events.find((e) => e.type === 'bid');
  b.face = 7;
  assert.equal((await verify(badBid)).ok, false);

  const badRank = clone(); badRank.ranking = badRank.ranking.slice().reverse();
  assert.equal((await verify(badRank)).ok, false);

  const badStart = clone(); badStart.players[0].name = 'Mallory';
  assert.equal((await verify(badStart)).ok, false, 'renamed player without the start event');

  const badClock = clone(); const ch = badClock.events.findLastIndex((e) => e.type === 'challenge');
  badClock.events[ch] = { type: 'timeout', at: badClock.events[ch - 1].at + 1, seat: badClock.events[ch].seat };
  assert.equal((await verify(badClock)).ok, false, 'a timeout before the deadline');

  const badTime = clone(); badTime.events.at(-1).at = 0;
  assert.equal((await verify(badTime)).ok, false, 'time running backwards');
});

test('dealAll matches deal per seat', async () => {
  const all = await dealAll('q', 3, [2, 0, 4]);
  assert.deepEqual(all, [await deal('q', 3, 0, 2), [], await deal('q', 3, 2, 4)]);
});
