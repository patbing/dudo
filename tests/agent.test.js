import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocal } from '../server/local.js';
import { makeCall } from '../server/src/tools.js';
import { playSeat, spendGuard, prompt, toolCall, pollinationsChat } from '../agent.js';

const model = { id: 'stub', inPrice: 1e-7, outPrice: 1e-6, effort: false };
const usage = { prompt_tokens: 500, completion_tokens: 50 };
const asCall = (name, args) => ({ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] }, usage });

async function setup() {
  const { lobby, table } = await createLocal();
  const call = makeCall({ lobby, table, recordBase: 'http://x' });
  const tool = (n, a) => call(n, a, '');
  const me = await tool('join_table', { name: 'Model' });
  await tool('start_game', { table: me.table, token: me.token, bots: 1 });
  return { tool, me };
}

test('legal calls are forwarded; one retry after a refusal', async () => {
  const { tool, me } = await setup();
  const seen = [];
  let n = 0;
  // First answer of each turn is illegal (face 7), the retry uses the legal minimum taken from the prompt.
  const chat = async (body) => {
    n++;
    const last = body.messages.at(-1).content;
    if (!/refused/.test(last)) return asCall('bid', { quantity: 1, face: 7 });
    const st = await tool('get_state', { table: me.table, token: me.token });
    return st.bid ? asCall('challenge', {}) : asCall('bid', { quantity: 1, face: 2, say: 'twos' });
  };
  const r = await playSeat({ tool, table: me.table, token: me.token, model, chat, guard: spendGuard(1), on: (e) => seen.push(e.type) });
  assert.equal(r.state.status, 'over');
  assert.ok(seen.includes('refused') && seen.includes('move'));
  assert.equal(seen.filter((t) => t === 'refused').length, seen.filter((t) => t === 'move').length);
});

test('the spend cap stops calls before they are sent', async () => {
  const { tool, me } = await setup();
  let calls = 0;
  const guard = spendGuard(0.0001); // worst case of one call is 2000*1e-7 + 600*1e-6 = 0.0008
  const r = await playSeat({ tool, table: me.table, token: me.token, model, chat: async () => { calls++; return asCall('challenge', {}); }, guard });
  assert.equal(r.stopped, 'cap'); assert.equal(calls, 0);
});

test('prompt and parsing', () => {
  const v = { round: 2, dice_in_play: 5, players: [{ seat: 0, name: 'A', dice: 3 }, { seat: 1, name: 'B', dice: 2 }], you: { seat: 0, dice: [4, 4, 1] },
    bids: [{ seat: 1, quantity: 2, face: 4, say: 'fours' }], bid: { seat: 1, quantity: 2, face: 4 }, legal: { min_bid: { quantity: 2, face: 5 }, max_quantity: 5 }, last_showdown: null };
  const u = prompt(v)[1].content;
  assert.match(u, /Your dice: 4 4 1/); assert.match(u, /B bid 2 x 4 \("fours"\)/); assert.match(u, /lowest raise is 2 x 5/);
  assert.deepEqual(toolCall({ tool_calls: [{ function: { name: 'bid', arguments: '{"quantity":"3","face":5}' } }] }), { name: 'bid', args: { quantity: 3, face: 5 } });
  assert.equal(toolCall({ content: 'I challenge' }), null);
});

test('a provider that rejects reasoning_effort gets the call once more without it', async () => {
  const sent = [];
  const fetchFn = async (url, o) => {
    const b = JSON.parse(o.body); sent.push(b.reasoning_effort || null);
    return b.reasoning_effort
      ? new Response(JSON.stringify({ error: { message: 'Property reasoning_effort has an invalid value: low.' } }), { status: 400 })
      : new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage }), { status: 200 });
  };
  const r = await pollinationsChat('sk_test', { model: 'x', messages: [], max_tokens: 10, reasoning_effort: 'low' }, { fetchFn });
  assert.deepEqual(sent, ['low', null]);
  assert.equal(r.message.content, 'ok');
  const other = await pollinationsChat('sk_test', { model: 'x', messages: [], reasoning_effort: 'low' }, { fetchFn: async () => new Response('{}', { status: 400 }) });
  assert.match(other.error, /HTTP 400/);
});
