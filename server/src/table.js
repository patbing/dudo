// One table: the rules plus storage, the clock, long-poll waiters and the house bots.
// Platform-free: the Durable Object and the local Node server both wrap this class.
import * as G from './game.js';
import { newSeed, newToken, sha256hex, dealIfDue } from './fair.js';
import { botMove } from './bot.js';
import { prompt, request, toolCall, spendGuard } from '../../agent.js';

const BOT_NAMES = ['Croupier', 'Croupier II', 'Croupier III', 'Croupier IV'];
export const LOBBY_TTL = 30 * 60 * 1000, OVER_TTL = 7 * 24 * 3600 * 1000;
const MAX_WAITERS = 16, MAX_MUTATIONS = 2000;
export const HOUSE_CAP = 0.02; // Pollen per game for the house model; past it the code bot moves

// Is a model's tool call a legal move in view v? Returns an error sentence or null.
export function illegal(v, call) {
  if (call.name === 'challenge') return v.bid ? null : 'There is no bid to challenge yet; open with bid.';
  const { quantity: q, face: f } = call.args, lg = v.legal;
  if (!Number.isInteger(q) || !Number.isInteger(f) || f < 1 || f > 6 || q < 1) return 'quantity and face must be whole numbers, face 1 to 6.';
  if (q > lg.max_quantity) return `quantity can be at most ${lg.max_quantity}.`;
  if (v.bid && !(q > v.bid.quantity || (q === v.bid.quantity && f > v.bid.face))) return `Your bid must beat ${v.bid.quantity} x ${v.bid.face}.`;
  return null;
}

export class TableCore {
  // io: { load(): t|null, save(t), del(), setAlarm(ms|null), notify(info), now(), house?(): model|null, chat?(body, ms) }
  // house/chat are optional: without them the house is always the code bot.
  constructor(io) { this.io = io; this.t = null; this.q = Promise.resolve(); this.waiters = []; this.mutations = 0; }
  async init() { this.t = (await this.io.load()) || null; }

  run(fn) { const p = this.q.then(fn); this.q = p.catch(() => {}); return p; }
  need() { if (!this.t) throw new Error('No table with that code. Call list_tables or join_table without a code.'); return this.t; }
  seatOf(token) {
    if (token == null || token === '') return null;
    const p = this.need().players.find((x) => x.token === token);
    if (!p) throw new Error('That token is not seated at this table.');
    return p.seat;
  }
  info() {
    const t = this.t;
    return { table: t.code, status: t.status, public: t.config.public, players: t.players.length, seats: t.config.seats, dice: t.config.dice, round: t.round, created: t.created, updated: t.updated, winner: t.ranking ? t.ranking[0] : null };
  }

  // Everything that changes the table goes through here: tick, apply, deal, bots, save, alarm, wake waiters.
  async mutate(fn) {
    const t = this.need(), now = this.io.now();
    if (this.mutations >= MAX_MUTATIONS && t.status !== 'playing') throw new Error('This table has reached its move limit.');
    const out = fn(t, now); // a refused move throws here and does not count
    this.mutations++;
    await this.settle(now);
    return out;
  }
  async settle(now) {
    const t = this.t;
    for (let i = 0; i < 400; i++) {
      await dealIfDue(t, now);
      if (t.status !== 'playing' || t.turn == null || t.players[t.turn].bot !== true) break;
      const m = botMove(G.view(t, t.turn));
      if (m.type === 'bid') G.bid(t, t.turn, { quantity: m.quantity, face: m.face, now }); else G.challenge(t, t.turn, { now });
    }
    await this.io.save(t);
    await this.io.setAlarm(this.nextAlarm());
    // The lobby only lists status, seats and round: skip the call when none of them changed.
    const info = this.info(), key = JSON.stringify([info.status, info.players, info.round, info.winner]);
    if (key !== this.lastKey) { this.lastKey = key; await this.io.notify(info); }
    this.wake();
    this.houseTurn();
  }

  // A house model seat (bot = model id) thinks outside the queue, then moves through it like any player.
  houseTurn() {
    const t = this.t;
    if (this.thinking || !t || t.status !== 'playing' || t.dealPending || t.turn == null || typeof t.players[t.turn].bot !== 'string') return;
    const seat = t.turn, version = t.version;
    this.thinking = true;
    this.houseMove(seat)
      .then((m) => this.run(async () => {
        const tt = this.t;
        if (!tt || tt.version !== version || tt.turn !== seat || tt.status !== 'playing' || await this.tickNow()) return;
        await this.mutate((x, now) => (m.name === 'bid' ? G.bid(x, seat, { ...m.args, now }) : G.challenge(x, seat, { say: m.args.say, now })));
      }))
      .catch(() => {}) // the turn clock covers anything left undone
      .finally(() => { this.thinking = false; this.houseTurn(); });
  }
  async houseMove(seat) {
    const v = G.view(this.t, seat);
    // After an eviction the model is looked up again; its id is the seat's bot field.
    if (!this.model && this.io.house) this.model = await this.io.house().catch(() => null);
    const model = this.model && this.model.id === this.t.players[seat].bot ? this.model : null;
    this.guard ||= spendGuard(HOUSE_CAP);
    const messages = prompt(v);
    for (let attempt = 0; attempt < 2 && model && this.io.chat; attempt++) {
      const body = request(model, messages);
      if (!this.guard.allows(model, body)) break;
      const ms = Math.min(25000, (this.t.deadline || Infinity) - this.io.now() - 2000);
      if (!(ms > 3000)) break;
      const r = await this.io.chat(body, ms);
      this.guard.add(model, body, r.usage);
      if (r.error) { if ([401, 402, 403].includes(r.status)) break; continue; }
      const call = toolCall(r.message), why = call ? illegal(v, call) : 'Reply with exactly one tool call: bid or challenge.';
      if (!why) return call;
      messages.push({ role: 'assistant', content: call ? `${call.name} ${JSON.stringify(call.args)}` : (r.message && r.message.content) || '' }, { role: 'user', content: `${why} Try again with one tool call.` });
    }
    // No legal move from the model in time, or its cap is reached: the code bot moves for it, and says so.
    const m = botMove(v), say = '(code move: no legal move from the model)';
    return m.type === 'bid' ? { name: 'bid', args: { quantity: m.quantity, face: m.face, say } } : { name: 'challenge', args: { say } };
  }
  nextAlarm() {
    const t = this.t;
    if (t.status === 'playing' && t.deadline) return t.deadline;
    if (t.status === 'lobby') return t.created + LOBBY_TTL;
    return t.updated + OVER_TTL;
  }
  wake() { this.waiters = this.waiters.filter((w) => { if (w.ready()) { w.done(); return false; } return true; }); }

  // The alarm (or any request) applies a timeout once the turn clock has run out, and expires old tables.
  tick() {
    return this.run(async () => {
      const t = this.t; if (!t) return;
      const now = this.io.now();
      if (t.status === 'playing' && t.deadline && now >= t.deadline) await this.mutate((tt) => G.timeout(tt, now));
      else if ((t.status === 'lobby' && now >= t.created + LOBBY_TTL) || (t.status === 'over' && now >= t.updated + OVER_TTL)) {
        await this.io.notify({ ...this.info(), gone: true }); await this.io.del(); this.t = null;
      }
    });
  }

  create(code, cfg) {
    return this.run(async () => {
      if (this.t) throw new Error('Table code collision; try again.');
      this.t = G.newTable({ code, ...cfg, now: this.io.now() });
      await this.settle(this.io.now());
      return { table: code, next: `Table ${code} is open. Call join_table with table "${code}" and a name.` };
    });
  }
  join(name) {
    return this.run(async () => {
      const token = newToken();
      const seat = await this.mutate((t, now) => G.join(t, { name, token, now }));
      const t = this.t;
      return { table: t.code, token, seat, players: t.players.map((p) => p.name), next: 'Keep the token secret and pass it on every call. Call start_game when everyone is seated (alone, a house player sits down), then get_state with your token and wait_seconds 20.' };
    });
  }
  start(token, bots, house) {
    return this.run(async () => {
      const seat = this.seatOf(token), t = this.need();
      if (t.status !== 'lobby') throw new Error('The game has already started; call get_state.');
      const free = t.config.seats - t.players.length;
      const n = bots == null ? (t.players.length === 1 ? 1 : 0) : bots;
      if (!Number.isInteger(n) || n < 0 || n > 4) throw new Error('bots must be a whole number from 0 to 4.');
      if (n > free) throw new Error(`Only ${free} seat(s) are free for bots.`);
      if (house != null && house !== 'model' && house !== 'code') throw new Error('house must be "model" or "code".');
      const model = n > 0 && house !== 'code' && this.io.house ? await this.io.house().catch(() => null) : null;
      if (model) this.model = model;
      const seed = newSeed(), commit = await sha256hex(seed);
      await this.mutate((tt, now) => {
        const title = model && model.title.slice(0, 20);
        if (model) G.join(tt, { name: tt.players.some((p) => p.name.toLowerCase() === title.toLowerCase()) ? 'House model' : title, token: newToken(), bot: model.id, now });
        for (let i = model ? 1 : 0; i < n; i++) G.join(tt, { name: BOT_NAMES.find((b) => !tt.players.some((p) => p.name.toLowerCase() === b.toLowerCase())), token: newToken(), bot: true, now });
        G.start(tt, { seed, commit, now });
      });
      const v = G.view(this.t, seat);
      if (n > 0) v.house = model ? `${model.title} (Pollinations) takes the first house seat, called from this server with its own capped key.` : house === 'model' ? 'No house model is available right now, so Croupier (code) sits down.' : 'Croupier (code) sits down.';
      return v;
    });
  }
  move(token, kind, args) {
    return this.run(async () => {
      const seat = this.seatOf(token);
      if (seat == null) throw new Error('token is required.');
      // A move that arrives after its clock ran out must not land on the next round's fresh hands.
      if (await this.tickNow()) throw new Error('Your clock ran out before this move arrived, so you lost a die. Call get_state.');
      await this.mutate((t, now) => kind === 'bid'
        ? G.bid(t, seat, { quantity: args.quantity, face: args.face, say: args.say, now })
        : G.challenge(t, seat, { say: args.say, now }));
      return G.view(this.t, seat);
    });
  }
  async tickNow() {
    const t = this.t, now = this.io.now();
    if (t && t.status === 'playing' && t.deadline && now >= t.deadline) { await this.mutate((tt) => G.timeout(tt, now)); return true; }
    return false;
  }

  // Long-poll: with a token, return when it is your turn or the game is over; with `since`, when anything changes.
  async getState(token, wait = 0, since) {
    await this.tick();
    const seat = this.seatOf(token);
    const ready = () => {
      const t = this.t; if (!t) return true;
      if (since != null && t.version > since) return true;
      if (seat != null && since == null) return t.status === 'over' || (t.status === 'playing' && !t.dealPending && t.turn === seat);
      return false;
    };
    const w = Math.max(0, Math.min(20, Number.isInteger(wait) ? wait : 0));
    if (w > 0 && !ready() && (seat != null || since != null) && this.waiters.length < MAX_WAITERS) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== waiter); resolve(); }, w * 1000);
        const waiter = { ready, done: () => { clearTimeout(timer); resolve(); } };
        this.waiters.push(waiter);
      });
    }
    this.need();
    const v = G.view(this.t, seat);
    if (this.t.deadline && this.t.status === 'playing') v.seconds_left = Math.max(0, Math.round((this.t.deadline - this.io.now()) / 1000));
    return v;
  }

  record() { return G.record(this.need()); }
}
