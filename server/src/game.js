// Dudo (liar's dice) rules as a pure reducer over a plain object.
// No clock, no storage, no randomness: `now` and dealt hands are arguments, so the page can replay a record.
// Every refusal throws an Error whose message is a sentence for the player.

export const LIMITS = { dice: [1, 5], seats: [2, 6], turn_seconds: [20, 120] };

function int(v, lo, hi, def, label) {
  if (v === undefined || v === null) return def;
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${label} must be a whole number from ${lo} to ${hi}.`);
  return v;
}

export function newTable({ code, dice, seats, turn_seconds, public: pub, now = 0 } = {}) {
  return {
    v: 1, code, status: 'lobby', version: 0, created: now, updated: now,
    config: {
      dice: int(dice, ...LIMITS.dice, 3, 'dice'),
      seats: int(seats, ...LIMITS.seats, 4, 'seats'),
      turn_seconds: int(turn_seconds, ...LIMITS.turn_seconds, 60, 'turn_seconds'),
      public: pub !== false
    },
    players: [], commit: null, seed: null, round: 0, hands: null, dealPending: false,
    opener: null, turn: null, bid: null, bids: [], deadline: null, last_showdown: null,
    out: [], ranking: null, events: []
  };
}

const touch = (t, now) => { t.version++; t.updated = now; return t; };
const active = (t) => t.players.filter((p) => p.dice > 0).map((p) => p.seat);
export const diceInPlay = (t) => t.players.reduce((a, p) => a + p.dice, 0);

function nextActive(t, seat) {
  const n = t.players.length;
  for (let i = 1; i <= n; i++) { const s = (seat + i) % n; if (t.players[s].dice > 0) return s; }
  return null;
}

export function cleanName(name) {
  const s = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (s.length < 1 || s.length > 20) throw new Error('name must be 1 to 20 characters.');
  return s;
}
export function cleanSay(say) {
  if (say === undefined || say === null || say === '') return undefined;
  const s = String(say).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 140);
  return s || undefined;
}

export function join(t, { name, token, bot = false, now = 0 }) {
  if (t.status !== 'lobby') throw new Error('This table has already started; join another one or create_table.');
  if (t.players.length >= t.config.seats) throw new Error('This table is full.');
  const nm = cleanName(name);
  if (t.players.some((p) => p.name.toLowerCase() === nm.toLowerCase())) throw new Error(`The name "${nm}" is taken at this table; pick another.`);
  const seat = t.players.length;
  t.players.push({ seat, name: nm, token, bot, dice: 0, timeouts: 0 });
  touch(t, now);
  return seat;
}

// Starts the game; the caller then deals (dealPending) with fair.dealAll and calls applyDeal.
// `seed` stays in the server's copy and only appears in views once the game is over.
export function start(t, { seed, commit, now = 0 }) {
  if (t.status !== 'lobby') throw new Error('The game has already started.');
  if (t.players.length < 2) throw new Error('At least two players are needed (start_game adds a house player when you are alone).');
  for (const p of t.players) p.dice = t.config.dice;
  t.status = 'playing'; t.seed = seed; t.commit = commit; t.round = 1; t.opener = 0; t.dealPending = true;
  t.events.push({ type: 'start', at: now, players: t.players.map((p) => ({ name: p.name, bot: p.bot })), config: t.config, commit });
  return touch(t, now);
}

export const handSizes = (t) => t.players.map((p) => p.dice);

export function applyDeal(t, hands, now = 0) {
  if (!t.dealPending) throw new Error('No deal is due.');
  t.hands = hands.map((h) => h.slice());
  t.dealPending = false; t.bid = null; t.bids = [];
  t.turn = t.opener; t.deadline = now + t.config.turn_seconds * 1000;
  t.events.push({ type: 'deal', at: now, round: t.round, hands: t.hands.map((h) => h.slice()) });
  return touch(t, now);
}

function onTurn(t, seat) {
  if (t.status !== 'playing') throw new Error(t.status === 'over' ? 'The game is over.' : 'The game has not started; call start_game.');
  if (t.dealPending) throw new Error('The dice are being dealt; call get_state.');
  if (seat !== t.turn) throw new Error(`It is not your turn; it is ${t.players[t.turn].name}'s. Call get_state with wait_seconds.`);
}

export function legal(t) {
  const max = diceInPlay(t);
  if (!t.bid) return { min_bid: { quantity: 1, face: 1 }, max_quantity: max, can_challenge: false };
  const b = t.bid;
  const min = b.face < 6 ? { quantity: b.quantity, face: b.face + 1 } : { quantity: b.quantity + 1, face: 1 };
  return { min_bid: min.quantity <= max ? min : null, max_quantity: max, can_challenge: true };
}

export function bid(t, seat, { quantity, face, say, now = 0 }) {
  onTurn(t, seat);
  const max = diceInPlay(t);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) throw new Error(`quantity must be a whole number from 1 to ${max} (the dice in play).`);
  if (!Number.isInteger(face) || face < 1 || face > 6) throw new Error('face must be a whole number from 1 to 6.');
  const b = t.bid;
  if (b && !(quantity > b.quantity || (quantity === b.quantity && face > b.face))) {
    throw new Error(`Your bid must beat ${b.quantity} x ${b.face}: a higher quantity, or the same quantity with a higher face. Or call challenge.`);
  }
  const s = cleanSay(say);
  t.bid = { seat, quantity, face };
  t.bids.push({ seat, quantity, face, ...(s ? { say: s } : {}) });
  t.players[seat].timeouts = 0;
  t.events.push({ type: 'bid', at: now, seat, quantity, face, ...(s ? { say: s } : {}) });
  t.turn = nextActive(t, seat); t.deadline = now + t.config.turn_seconds * 1000;
  return touch(t, now);
}

function endRound(t, loser, showdown, now) {
  t.last_showdown = { round: t.round, hands: t.hands, ...showdown, loser };
  const p = t.players[loser];
  if (p.dice === 0 && !t.out.includes(loser)) t.out.push(loser);
  t.hands = null; t.bid = null; t.turn = null; t.deadline = null;
  const left = active(t);
  if (left.length <= 1) {
    t.status = 'over';
    t.ranking = [...left, ...t.out.slice().reverse()].map((s) => t.players[s].name);
    return touch(t, now);
  }
  t.opener = p.dice > 0 ? loser : nextActive(t, loser);
  t.round++; t.dealPending = true;
  return touch(t, now);
}

export function challenge(t, seat, { say, now = 0 }) {
  onTurn(t, seat);
  if (!t.bid) throw new Error('There is no bid to challenge yet; you open the round, so call bid.');
  const s = cleanSay(say);
  const b = t.bid;
  const count = t.hands.flat().filter((d) => d === b.face).length;
  const loser = count >= b.quantity ? seat : b.seat;
  t.players[seat].timeouts = 0;
  t.events.push({ type: 'challenge', at: now, seat, ...(s ? { say: s } : {}) });
  if (s) t.bids.push({ seat, challenge: true, say: s });
  t.players[loser].dice--;
  return endRound(t, loser, { bid: b, challenger: seat, count, timeout: false, bids: t.bids }, now);
}

// The caller decides that the clock ran out; the reducer only applies the penalty to the seat on turn.
export function timeout(t, now = 0) {
  if (t.status !== 'playing' || t.dealPending || t.turn == null) throw new Error('No turn is running.');
  const seat = t.turn, p = t.players[seat];
  p.timeouts++;
  p.dice = p.timeouts >= 2 ? 0 : p.dice - 1;
  t.events.push({ type: 'timeout', at: now, seat });
  return endRound(t, seat, { bid: t.bid, challenger: null, count: null, timeout: true, bids: t.bids }, now);
}

// What one seat (or a spectator, seat = null) may see. Never another hand of the current round, never the seed before the end.
export function view(t, seat = null) {
  const v = {
    table: t.code, status: t.status, version: t.version, round: t.round, dice_in_play: diceInPlay(t), commit: t.commit,
    config: t.config,
    players: t.players.map((p) => ({ seat: p.seat, name: p.name, dice: p.dice, bot: p.bot, out: t.status !== 'lobby' && p.dice === 0 })),
    turn: t.turn == null ? null : { seat: t.turn, name: t.players[t.turn].name },
    deadline: t.deadline, bid: t.bid, bids: t.bids, last_showdown: t.last_showdown
  };
  if (t.status === 'over') { v.ranking = t.ranking; v.seed = t.seed; }
  if (seat != null && t.players[seat]) {
    const p = t.players[seat];
    v.you = { seat, name: p.name, dice: t.hands && t.hands[seat] ? t.hands[seat].slice() : [] };
    v.your_turn = t.status === 'playing' && !t.dealPending && t.turn === seat;
    if (v.your_turn) v.legal = legal(t);
    v.next = nextHint(t, v);
  }
  return v;
}

function nextHint(t, v) {
  if (t.status === 'lobby') return 'Waiting for players. Call start_game when ready (alone, a house player sits down).';
  if (t.status === 'over') return `The game is over. Ranking: ${t.ranking.join(', ')}.`;
  if (v.you.dice.length === 0 && t.players[v.you.seat].dice === 0) return 'You are out of dice. Watch with get_state, or stop.';
  if (!v.your_turn) return 'Not your turn. Call get_state with your token and wait_seconds 20.';
  if (!t.bid) return 'Your turn to open: call bid with a quantity and face.';
  return `Your turn: call bid with something higher than ${t.bid.quantity} x ${t.bid.face}, or call challenge.`;
}

// The public record of a finished game: everything verify() needs, nothing secret left.
export function record(t) {
  if (t.status !== 'over') throw new Error('The record is published when the game is over.');
  return { app: 'dudo', v: 1, table: t.code, config: t.config, players: t.players.map((p) => ({ name: p.name, bot: p.bot })), commit: t.commit, seed: t.seed, events: t.events, ranking: t.ranking };
}
