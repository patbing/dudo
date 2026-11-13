// Plays a full game over HTTP against a Dudo MCP URL and verifies the published record. No dependencies.
// node tools/smoke.mjs https://dudo.<sub>.workers.dev/mcp    (default: http://127.0.0.1:8787/mcp)
import { botMove } from '../server/src/bot.js';
import { verify } from '../server/src/fair.js';
import { pathToFileURL } from 'node:url';

export async function rpc(url, method, params = {}, { modern = false, id = 1 } = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  let body = { jsonrpc: '2.0', id, method, params };
  if (modern) {
    headers['mcp-protocol-version'] = '2026-07-28'; headers['mcp-method'] = method;
    if (method === 'tools/call') headers['mcp-name'] = params.name;
    body.params = { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } };
  }
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.code} ${j.error.message}`);
  return j.result;
}
export async function tool(url, name, args, opts) {
  const res = await rpc(url, 'tools/call', { name, arguments: args }, opts);
  const text = res.content[0].text;
  if (res.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
}

export async function smoke(url, log = console.log) {
  const init = await rpc(url, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
  log(`legacy initialize: ${init.protocolVersion}`);
  const disc = await rpc(url, 'server/discover', {}, { modern: true });
  log(`modern discover: ${disc.supportedVersions.join(', ')}`);
  const list = await rpc(url, 'tools/list', {}, { modern: true });
  log(`tools: ${list.tools.map((t) => t.name).join(', ')}`);

  const me = await tool(url, 'join_table', { name: 'smoke' }, { modern: true });
  log(`joined ${me.table} as seat ${me.seat}`);
  let v = await tool(url, 'start_game', { table: me.table, token: me.token, bots: 2 });
  let moves = 0;
  for (let i = 0; i < 300 && v.status !== 'over'; i++) {
    if (!v.your_turn) { v = await tool(url, 'get_state', { table: me.table, token: me.token, wait_seconds: 20 }); continue; }
    const m = botMove(v);
    v = m.type === 'bid'
      ? await tool(url, 'bid', { table: me.table, token: me.token, quantity: m.quantity, face: m.face, say: moves === 0 ? 'smoke test opening' : undefined })
      : await tool(url, 'challenge', { table: me.table, token: me.token });
    moves++;
  }
  if (v.status !== 'over') throw new Error('game did not finish');
  log(`over after ${moves} of my moves, ranking ${v.ranking.join(' > ')}`);
  const rec = await (await fetch(v.record_url)).json();
  const check = await verify(rec);
  log(`verify: ${check.ok ? 'OK' : 'FAILED'} (${check.steps.length} steps)`);
  if (!check.ok) throw new Error(JSON.stringify(check.steps.at(-1)));
  return { table: me.table, record: rec, moves };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  smoke(process.argv[2] || 'http://127.0.0.1:8787/mcp').catch((e) => { console.error(e.message); process.exit(1); });
}
