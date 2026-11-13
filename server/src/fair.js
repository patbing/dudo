// Commit and reveal. The server commits to SHA-256(seed) before the first bid and reveals the seed at the end;
// anyone can then re-deal every hand and re-run the rules on the public log. crypto.subtle: Worker, browser, Node.
import * as G from './game.js';

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
export const sha256hex = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

export function newSeed() { const a = new Uint8Array(32); crypto.getRandomValues(a); return hex(a); }
export function newToken() { const a = new Uint8Array(16); crypto.getRandomValues(a); return hex(a); }

// Dice for one seat in one round: bytes of SHA-256("seed:round:seat:counter"); a byte below 252 gives byte % 6 + 1 (no modulo bias).
export async function deal(seed, round, seat, n) {
  const out = [];
  for (let c = 0; out.length < n; c++) {
    const b = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${seed}:${round}:${seat}:${c}`)));
    for (const x of b) { if (x < 252) out.push((x % 6) + 1); if (out.length === n) break; }
  }
  return out;
}
export const dealAll = (seed, round, sizes) => Promise.all(sizes.map((n, seat) => deal(seed, round, seat, n)));

// Deals whatever is pending on table t (after start or a showdown).
export async function dealIfDue(t, now) {
  if (t.dealPending) G.applyDeal(t, await dealAll(t.seed, t.round, G.handSizes(t)), now);
}

// Re-runs a public record. Returns { ok, steps: [{ label, ok, detail? }] }, stopping at the first failure.
export async function verify(rec) {
  const steps = [];
  const step = (label, ok, detail) => { steps.push({ label, ok, ...(detail ? { detail } : {}) }); return ok; };
  const fail = () => ({ ok: false, steps });
  try {
    if (!step('The seed matches the commitment shown before the first bid', typeof rec.seed === 'string' && await sha256hex(rec.seed) === rec.commit)) return fail();
    const t = G.newTable({ code: rec.table, ...rec.config });
    rec.players.forEach((p) => G.join(t, { name: p.name, token: '', bot: p.bot }));
    let started = false, last = -Infinity;
    for (const e of rec.events) {
      if (!(Number.isFinite(e.at) && e.at >= last)) { step('The log runs forward in time', false, `${e.type} at ${e.at}`); return fail(); }
      last = e.at;
      if (e.type === 'start') {
        const same = e.commit === rec.commit && JSON.stringify(e.config) === JSON.stringify(rec.config) &&
          JSON.stringify(e.players) === JSON.stringify(rec.players.map((p) => ({ name: p.name, bot: p.bot })));
        if (!step('The start of the log names the same players, settings and commitment', same)) return fail();
        G.start(t, { seed: rec.seed, commit: rec.commit, now: e.at }); started = true; continue;
      }
      if (!started) { step('The log starts with start', false); return fail(); }
      // The clock: a move must land before the turn's deadline, a timeout at or after it.
      if (e.type !== 'deal' && (e.type === 'timeout' ? e.at < t.deadline : e.at >= t.deadline)) {
        step(`Round ${t.round}: ${e.type} logged on the wrong side of the turn clock`, false); return fail();
      }
      if (e.type === 'deal') {
        if (e.round !== t.round || !t.dealPending) { step(`Round ${e.round}: dealt out of order`, false); return fail(); }
        const want = await dealAll(rec.seed, t.round, G.handSizes(t));
        if (JSON.stringify(want) !== JSON.stringify(e.hands)) { step(`Round ${e.round}: the hands are the ones the seed deals`, false, `logged ${JSON.stringify(e.hands)}, seed deals ${JSON.stringify(want)}`); return fail(); }
        G.applyDeal(t, want, e.at);
        continue;
      }
      const round = t.round;
      if (e.type === 'bid') G.bid(t, e.seat, { quantity: e.quantity, face: e.face, say: e.say, now: e.at });
      else if (e.type === 'challenge') G.challenge(t, e.seat, { say: e.say, now: e.at });
      else if (e.type === 'timeout') { if (e.seat !== t.turn) { step(`Round ${round}: timeout logged for a player not on turn`, false); return fail(); } G.timeout(t, e.at); }
      else { step(`Unknown event ${e.type}`, false); return fail(); }
      if (e.type !== 'bid') {
        const s = t.last_showdown;
        step(`Round ${round}: ${s.timeout ? `${t.players[s.loser].name} ran out of time` : `${s.count} x ${s.bid.face} against a bid of ${s.bid.quantity}`}, ${t.players[s.loser].name} loses a die`, true);
      }
    }
    if (!step('The game ended', t.status === 'over')) return fail();
    if (!step('The ranking follows from the rules', JSON.stringify(t.ranking) === JSON.stringify(rec.ranking), `rules give ${t.ranking.join(', ')}`)) return fail();
    return { ok: true, steps };
  } catch (e) {
    step('A logged move breaks the rules', false, e.message);
    return fail();
  }
}
