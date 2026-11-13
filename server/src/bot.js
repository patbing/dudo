// "Croupier": the code-only house bot. It gets exactly the view a seated player gets (view(t, seat)), nothing more.
// Returns { type: 'bid', quantity, face } or { type: 'challenge' }.

function atLeast(k, n, p) { // P(Binomial(n, p) >= k)
  if (k <= 0) return 1;
  if (k > n) return 0;
  let sum = 0, c = 1;
  for (let i = 0; i <= n; i++) {
    if (i >= k) sum += c * p ** i * (1 - p) ** (n - i);
    c = (c * (n - i)) / (i + 1);
  }
  return sum;
}

export function botMove(v) {
  const mine = v.you.dice, unknown = v.dice_in_play - mine.length;
  const count = (f) => mine.filter((d) => d === f).length;
  const holds = (q, f) => atLeast(q - count(f), unknown, 1 / 6);
  // Most common face in hand, ties to the higher face.
  let best = 6;
  for (let f = 6; f >= 1; f--) if (count(f) > count(best)) best = f;
  const lg = v.legal;
  if (!v.bid) return { type: 'bid', quantity: Math.max(1, Math.min(lg.max_quantity, count(best) + Math.round(unknown / 6))), face: best };
  if (holds(v.bid.quantity, v.bid.face) < 0.35 || !lg.min_bid) return { type: 'challenge' };
  const q = best > v.bid.face ? v.bid.quantity : v.bid.quantity + 1;
  if (q <= lg.max_quantity && holds(q, best) >= 0.35) return { type: 'bid', quantity: q, face: best };
  // The cheapest raise; if even that is unlikely, calling the standing bid is the better gamble.
  if (holds(lg.min_bid.quantity, lg.min_bid.face) < holds(v.bid.quantity, v.bid.face) * 0.5) return { type: 'challenge' };
  return { type: 'bid', quantity: lg.min_bid.quantity, face: lg.min_bid.face };
}
