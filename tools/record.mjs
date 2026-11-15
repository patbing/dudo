// Seats Pollinations models at one table from Node and saves the verified record.
// POLLINATIONS_KEY=... node tools/record.mjs --models a,b,c --dice 3 --cap 0.05 [--url https://.../mcp] [--agents 0] --out recordings/x.json
// Without --url it runs the same server code in memory. --agents N leaves N seats for outside agents (prints the code and waits).
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { mcp, playSeat, spendGuard, pollinationsChat, listToolModels } from '../agent.js';
import { verify } from '../server/src/fair.js';
import { startLocal } from '../server/local.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const key = process.env.POLLINATIONS_KEY;
if (!key) { console.error('Set POLLINATIONS_KEY.'); process.exit(1); }
const ids = arg('models', 'z-ai/glm-5.3-flash,deepseek/deepseek-v4.1-flash,minimax/minimax-m3.1-flash,openai/gpt-5.4-nano').split(',');
const dice = Number(arg('dice', '3')), cap = Number(arg('cap', '0.05')), agents = Number(arg('agents', '0'));
const out = arg('out', null), title = arg('title', null);

let server = null, url = arg('url', null);
if (!url) { server = await startLocal(0); url = `http://127.0.0.1:${server.address().port}/mcp`; }
const tool = mcp(url);
const all = await listToolModels();
const models = ids.map((id) => all.find((m) => m.id === id) || (() => { throw new Error(`model ${id} not listed with tools`); })());
const short = (id) => id.split('/').pop().slice(0, 20);
const guard = spendGuard(cap);
const stats = Object.fromEntries(models.map((m) => [m.id, { moves: 0, refused: 0, errors: [], calls: 0 }]));

const seats = models.length + agents;
const { table } = await tool('create_table', { seats: Math.max(2, seats), dice, public: true });
const tokens = [];
for (const m of models) tokens.push((await tool('join_table', { table, name: short(m.id) })).token);
console.log(`table ${table} at ${url}`);
if (agents) {
  console.log(`waiting for ${agents} agent(s): join_table with table "${table}"`);
  let v = await tool('get_state', { table });
  while (v.players.length < seats) v = await tool('get_state', { table, since: v.version, wait_seconds: 20 });
}
await tool('start_game', { table, token: tokens[0], bots: seats < 2 ? 1 : 0, house: 'code' });
const t0 = Date.now();
const results = await Promise.all(models.map((m, i) => playSeat({
  tool, table, token: tokens[i], model: m, guard,
  chat: async (body) => { stats[m.id].calls++; return pollinationsChat(key, body); },
  on: (e) => {
    const s = stats[m.id], n = short(m.id);
    if (e.type === 'move') { s.moves++; console.log(`${n}: ${e.name} ${e.name === 'bid' ? `${e.args.quantity}x${e.args.face}` : ''}${e.args.say ? ` "${e.args.say}"` : ''}`); }
    else if (e.type === 'refused') { s.refused++; console.log(`${n}: refused (${e.error})`); }
    else if (e.type === 'error') { s.errors.push(e.error); console.log(`${n}: error ${e.error}`); }
    else if (e.type === 'cap') console.log(`${n}: spend cap`);
  }
})));
const rec = await (await fetch(url.replace(/\/mcp$/, `/record/${table}`))).json();
const check = await verify(rec);
console.log(`ranking ${rec.ranking.join(' > ')} | verify ${check.ok ? 'OK' : 'FAILED'} | ${guard.calls} calls, about ${guard.spent.toFixed(5)} Pollen | ${Math.round((Date.now() - t0) / 1000)} s`);
console.log(JSON.stringify(stats));
if (out) {
  rec.meta = { recorded: new Date().toISOString(), server: server ? 'local (same code, in memory)' : url, models: models.map((m) => m.id), calls: guard.calls, pollen_estimate: Number(guard.spent.toFixed(5)), stats, stopped: results.filter((r) => r.stopped).length };
  writeFileSync(out, JSON.stringify(rec, null, 1));
  if (title) {
    const idx = existsSync('recordings/index.json') ? JSON.parse(readFileSync('recordings/index.json', 'utf8')).filter((r) => !r.file.startsWith('dev-')) : [];
    const file = out.split('/').pop();
    writeFileSync('recordings/index.json', JSON.stringify([...idx.filter((r) => r.file !== file), { file, title, note: arg('note', '') }], null, 1));
  }
  console.log(`saved ${out}`);
}
server?.close();
process.exit(check.ok ? 0 : 1);
