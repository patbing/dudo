// Lets a Pollinations model play one seat. Runs unchanged in the page and in Node (tools/record.mjs).
// The visitor's key only ever goes to gen.pollinations.ai; the game server gets MCP tool calls with table and token.
export const API = 'https://gen.pollinations.ai';

// A minimal MCP client: legacy JSON-RPC, no handshake needed (the server serves tools/call directly).
export function mcp(url, fetchFn = fetch) {
  let id = 0;
  return async function tool(name, args) {
    const r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message);
    if (j.result.isError) throw new Error(j.result.content[0].text);
    return JSON.parse(j.result.content[0].text);
  };
}

export const RULES = [
  "You are playing Dudo (liar's dice) against other players. Every player has a hidden hand of dice.",
  'A bid claims that at least QUANTITY dice across ALL hands show FACE. Ones are not wild; only the exact face counts.',
  'Each bid must beat the standing one: a higher quantity, or the same quantity with a higher face.',
  'On your turn either raise with bid, or call challenge if you think the standing bid is false.',
  'At a challenge all hands are shown. If the bid holds, the challenger loses a die; if not, the bidder does.',
  'Lose all your dice and you are out. Last player with dice wins.',
  'Each unseen die shows a given face with probability 1/6. You may bluff, and you may add a short line of table talk in `say`.',
  'Reply with exactly one tool call.'
].join(' ');

export const MODEL_TOOLS = [
  { type: 'function', function: { name: 'bid', description: 'Claim at least `quantity` dice across all hands show `face`.', parameters: { type: 'object', properties: { quantity: { type: 'integer', minimum: 1 }, face: { type: 'integer', minimum: 1, maximum: 6 }, say: { type: 'string', maxLength: 140, description: 'Optional table talk.' } }, required: ['quantity', 'face'] } } },
  { type: 'function', function: { name: 'challenge', description: 'Call the standing bid a lie.', parameters: { type: 'object', properties: { say: { type: 'string', maxLength: 140 } } } } }
];

const nameOf = (v, seat) => (v.you && seat === v.you.seat ? 'you' : (v.players[seat] || {}).name || `seat ${seat}`);

// One user message from the state: no growing history, each turn is an independent call.
export function prompt(v) {
  const you = v.you, lines = [];
  lines.push(`Round ${v.round}. Dice in play: ${v.dice_in_play}. ` + v.players.filter((p) => p.dice > 0).map((p) => `${p.seat === you.seat ? 'you' : p.name} ${p.dice}`).join(', ') + '.');
  lines.push(`Your dice: ${you.dice.join(' ')}.`);
  if (v.bids.length) lines.push('This round so far: ' + v.bids.map((b) => b.challenge ? `${nameOf(v, b.seat)} challenged` : `${nameOf(v, b.seat)} bid ${b.quantity} x ${b.face}${b.say ? ` ("${b.say}")` : ''}`).join('; ') + '.');
  const s = v.last_showdown;
  if (s && s.round === v.round - 1) {
    lines.push(s.timeout ? `Last round ${nameOf(v, s.loser)} ran out of time.` : `Last round ${nameOf(v, s.challenger)} challenged ${nameOf(v, s.bid.seat)}'s ${s.bid.quantity} x ${s.bid.face}; there were ${s.count}. ${nameOf(v, s.loser)} lost a die.`);
  }
  const lg = v.legal;
  if (!v.bid) lines.push(`You open this round: call bid (quantity 1 to ${lg.max_quantity}, face 1 to 6).`);
  else lines.push(`Standing bid: ${v.bid.quantity} x ${v.bid.face} by ${nameOf(v, v.bid.seat)}. ` + (lg.min_bid ? `The lowest raise is ${lg.min_bid.quantity} x ${lg.min_bid.face}; quantity at most ${lg.max_quantity}. Call bid or challenge.` : 'No raise is possible: call challenge.'));
  return [{ role: 'system', content: RULES }, { role: 'user', content: lines.join('\n') }];
}

export function request(model, messages) {
  return {
    model: model.id, messages, tools: MODEL_TOOLS, tool_choice: 'required', max_tokens: model.effort ? 3000 : 600, // DeepSeek writes its reasoning as text: 1500 ran out 7 times in the pilot
    ...(model.effort ? { reasoning_effort: 'low' } : {}),
    seed: Math.floor(Math.random() * 2147483647) // Pollinations caches identical bodies
  };
}

// Parses the first tool call; returns { name, args } or null.
export function toolCall(message) {
  const c = message && message.tool_calls && message.tool_calls[0];
  if (!c || !c.function) return null;
  let args = {};
  try { args = typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : (c.function.arguments || {}); } catch { return null; }
  if (c.function.name === 'bid') return { name: 'bid', args: { quantity: Number(args.quantity), face: Number(args.face), ...(args.say ? { say: String(args.say).slice(0, 140) } : {}) } };
  if (c.function.name === 'challenge') return { name: 'challenge', args: args.say ? { say: String(args.say).slice(0, 140) } : {} };
  return null;
}

// POST /v1/chat/completions with the visitor's key. Resolves { message, usage } or { error, status }.
export async function pollinationsChat(key, body, { fetchFn = fetch, timeoutMs = 90000, signal } = {}) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const stop = () => ctrl.abort();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const r = await fetchFn(`${API}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch { /* not JSON */ }
    if (!r.ok) return { error: `HTTP ${r.status}: ${String((j && j.error && (j.error.message || j.error)) || txt).slice(0, 200)}`, status: r.status };
    return { message: j && j.choices && j.choices[0] && j.choices[0].message, usage: j && j.usage };
  } catch (e) {
    return { error: ctrl.signal.aborted && !signal?.aborted ? 'timed out' : String(e.message || e), status: 0 };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
}

// Shared spend guard for every seat in a game: cost from usage at listed prices, failed calls at worst case.
export function spendGuard(cap) {
  return {
    cap, spent: 0, calls: 0,
    worst(model, body) { return 2000 * model.inPrice + body.max_tokens * model.outPrice; },
    add(model, body, usage) {
      this.calls++;
      const ok = usage && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens);
      this.spent += ok ? usage.prompt_tokens * model.inPrice + usage.completion_tokens * model.outPrice : this.worst(model, body);
    },
    allows(model, body) { return this.spent + this.worst(model, body) <= this.cap; }
  };
}

// Plays one seat until the game is over. chat(body) -> { message, usage } | { error }.
// on(event) gets { type: 'think'|'move'|'refused'|'error'|'cap'|'done', ... } for the page or the log.
export async function playSeat({ tool, table, token, model, chat, guard, on = () => {}, signal }) {
  let v = await tool('get_state', { table, token });
  while (v.status !== 'over' && !signal?.aborted) {
    if (v.status === 'playing' && v.you && v.you.dice.length === 0 && v.players[v.you.seat].dice === 0) break; // out
    if (!v.your_turn) { v = await tool('get_state', { table, token, wait_seconds: 20 }); continue; }
    const messages = prompt(v);
    let moved = false;
    for (let attempt = 0; attempt < 2 && !moved && !signal?.aborted; attempt++) {
      const body = request(model, messages);
      if (!guard.allows(model, body)) { on({ type: 'cap', spent: guard.spent }); return { stopped: 'cap' }; }
      on({ type: 'think', attempt });
      const r = await chat(body);
      guard.add(model, body, r.usage);
      if (r.error) { on({ type: 'error', error: r.error }); if (r.status === 401 || r.status === 402 || r.status === 403) return { stopped: r.error }; continue; }
      const call = toolCall(r.message);
      if (!call) {
        on({ type: 'refused', error: 'no tool call' });
        messages.push({ role: 'assistant', content: (r.message && r.message.content) || '' }, { role: 'user', content: 'Reply with exactly one tool call: bid or challenge.' });
        continue;
      }
      try {
        v = await tool(call.name, { table, token, ...call.args });
        moved = true;
        on({ type: 'move', ...call });
      } catch (e) {
        on({ type: 'refused', error: e.message, call });
        messages.push({ role: 'assistant', content: `${call.name} ${JSON.stringify(call.args)}` }, { role: 'user', content: `The table refused that: ${e.message} Try again with one tool call.` });
      }
    }
    // Two failures: do nothing; the server clock penalises the seat. Wait for the next turn.
    if (!moved) { const ver = v.version; while (v.version === ver && v.status !== 'over' && !signal?.aborted) v = await tool('get_state', { table, token, since: ver, wait_seconds: 20 }); }
  }
  on({ type: 'done', ranking: v.ranking });
  return { state: v };
}

// A free text model list with prices, tools only (GET /v1/models, no key needed).
export async function listToolModels(fetchFn = fetch) {
  const j = await (await fetchFn(`${API}/v1/models`, { credentials: 'omit', cache: 'no-store' })).json();
  return (j.data || j.models || []).filter((m) => {
    const sp = m.supported_parameters || [], p = m.pricing || {};
    return m.category === 'text' && !m.community && sp.includes('tools') && sp.includes('tool_choice') && p.completionTextTokens && !(m.health && m.health.status === 'down');
  }).map((m) => ({
    id: m.id, title: m.title || m.id, paidOnly: !!m.paid_only, health: m.health && m.health.status,
    inPrice: Number(m.pricing.promptTextTokens) || 0, outPrice: Number(m.pricing.completionTextTokens) || 0,
    effort: (m.supported_parameters || []).includes('reasoning_effort')
  }));
}
