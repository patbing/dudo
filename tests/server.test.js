import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../server/src/mcp.js';
import { makeCall } from '../server/src/tools.js';
import { createLocal, startLocal } from '../server/local.js';
import { smoke, tool } from '../tools/smoke.mjs';

const H = (extra = {}) => ({ 'content-type': 'application/json', ...extra });
const post = (body, headers = H()) => handle({ method: 'POST', headers, body: JSON.stringify(body) }, async (n, a) => ({ called: n, a }));
const modernH = (method, name) => H({ 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...(name ? { 'mcp-name': name } : {}) });
const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };

test('transport: methods, origin, body, notifications', async () => {
  assert.equal((await handle({ method: 'GET', headers: {}, body: '' })).status, 405);
  assert.equal((await handle({ method: 'OPTIONS', headers: { origin: 'https://patbing.github.io' }, body: '' })).status, 204);
  const other = await handle({ method: 'POST', headers: H({ origin: 'https://other.example' }), body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) }, async () => ({}));
  assert.equal(other.status, 200); assert.equal(other.headers['access-control-allow-origin'], 'https://other.example');
  const ok = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, H({ origin: 'http://127.0.0.1:5500' }));
  assert.equal(ok.headers['access-control-allow-origin'], 'http://127.0.0.1:5500');
  assert.ok(!ok.headers['access-control-allow-headers'].includes('authorization'));
  assert.equal((await handle({ method: 'POST', headers: H(), body: 'nope' })).status, 400);
  assert.equal((await handle({ method: 'POST', headers: H(), body: '[]' })).status, 400);
  assert.equal((await handle({ method: 'POST', headers: H(), body: 'x'.repeat(9000) })).status, 400);
  assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
});

test('legacy: initialize, bare tools/list and tools/call without headers', async () => {
  const init = JSON.parse((await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })).body);
  assert.equal(init.result.protocolVersion, '2025-11-25');
  const old = JSON.parse((await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })).body);
  assert.equal(old.result.protocolVersion, '2025-06-18');
  const list = JSON.parse((await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).body);
  assert.equal(list.result.tools.length, 7);
  assert.ok(!('resultType' in list.result));
  const call = JSON.parse((await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_tables', arguments: {} } })).body);
  assert.equal(JSON.parse(call.result.content[0].text).called, 'list_tables');
});

test('modern: headers must match, unknown version and method', async () => {
  const good = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta } }, modernH('tools/list'));
  const r = JSON.parse(good.body).result;
  assert.equal(r.resultType, 'complete'); assert.equal(typeof r.ttlMs, 'number'); assert.ok(r._meta['io.modelcontextprotocol/serverInfo']);
  const enc = '=?base64?' + Buffer.from('get_state').toString('base64') + '?=';
  const call = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_state', arguments: {}, _meta: meta } }, modernH('tools/call', enc));
  assert.equal(call.status, 200);
  const mism = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bid', arguments: {}, _meta: meta } }, modernH('tools/call', 'challenge'));
  assert.equal(mism.status, 400); assert.equal(JSON.parse(mism.body).error.code, -32020);
  const noMeta = await post({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} }, modernH('tools/list'));
  assert.equal(JSON.parse(noMeta.body).error.code, -32020);
  const ver = await post({ jsonrpc: '2.0', id: 5, method: 'tools/list', params: { _meta: meta } }, H({ 'mcp-protocol-version': '2099-01-01', 'mcp-method': 'tools/list' }));
  assert.equal(ver.status, 400); assert.equal(JSON.parse(ver.body).error.code, -32022);
  const unk = await post({ jsonrpc: '2.0', id: 6, method: 'resources/list', params: { _meta: meta } }, modernH('resources/list'));
  assert.equal(unk.status, 404);
});

test('tools: quick match, bots, long-poll wakes, timeout, record', async () => {
  let clock = 1_000_000;
  const { lobby, table } = await createLocal({ now: () => clock });
  const call = makeCall({ lobby, table, recordBase: 'http://x' });
  const a = await call('join_table', { name: 'Ann' }, '1.1.1.1');
  const b = await call('join_table', { name: 'Bob' }, '2.2.2.2');
  assert.equal(a.table, b.table, 'quick match seats the second player at the open table');
  await assert.rejects(call('join_table', { table: a.table, name: 'ann' }), /taken/);
  const listed = await call('list_tables', {});
  assert.equal(listed.open[0].players, 2);
  const s = await call('start_game', { table: a.table, token: a.token, bots: 0 });
  assert.equal(s.status, 'playing');
  assert.ok(!JSON.stringify(s).includes(table(a.table).t.seed));
  // Bob waits; Ann's bid wakes him.
  const waiting = call('get_state', { table: a.table, token: b.token, wait_seconds: 20 });
  await call('bid', { table: a.table, token: a.token, quantity: 1, face: 2, say: 'hi' });
  const woke = await waiting;
  assert.equal(woke.your_turn, true); assert.equal(woke.bids[0].say, 'hi');
  // Bob lets his clock run out twice: he is out and Ann wins.
  clock += 61_000; await table(a.table).tick();
  let st = await call('get_state', { table: a.table, token: a.token });
  assert.equal(st.players[1].dice, 2);
  if (st.your_turn) { await call('bid', { table: a.table, token: a.token, quantity: 1, face: 3 }); }
  clock += 61_000; await table(a.table).tick();
  st = await call('get_state', { table: a.table });
  if (st.status !== 'over') { clock += 61_000; await table(a.table).tick(); st = await call('get_state', { table: a.table }); }
  assert.equal(st.status, 'over');
  assert.ok(st.seed && st.record_url.endsWith(`/record/${a.table}`));
  await assert.rejects(call('bid', { table: a.table, token: 'f'.repeat(32), quantity: 9, face: 6 }), /not seated/);});

test('a move after the clock ran out is refused, not applied to the next round', async () => {
  let clock = 5_000_000;
  const { lobby, table } = await createLocal({ now: () => clock });
  const call = makeCall({ lobby, table, recordBase: 'http://x' });
  const a = await call('join_table', { name: 'Ann' }); const b = await call('join_table', { table: a.table, name: 'Bob' });
  await call('start_game', { table: a.table, token: a.token });
  clock += 61_000; // Ann (on turn) lets the clock run out, then her bid arrives
  await assert.rejects(call('bid', { table: a.table, token: a.token, quantity: 1, face: 3 }), /clock ran out/);
  const v = await call('get_state', { table: a.table, token: b.token });
  assert.equal(v.round, 2); assert.equal(v.bids.length, 0); assert.equal(v.players[0].dice, 2);
});

test('quick match skips open tables nobody touched for two minutes', async () => {
  let clock = 9_000_000;
  const { lobby, table } = await createLocal({ now: () => clock });
  const call = makeCall({ lobby, table, recordBase: 'http://x' });
  const ghost = await call('join_table', { name: 'curl' });
  clock += 121_000;
  const fresh = await call('join_table', { name: 'agent' });
  assert.notEqual(fresh.table, ghost.table);
});

test('smoke: a full game over HTTP against the local server, verified', async () => {
  const server = await startLocal(0);
  const port = server.address().port;
  try {
    const r = await smoke(`http://127.0.0.1:${port}/mcp`, () => {});
    assert.equal(r.record.players.length, 3);
  } finally { server.close(); }
});
