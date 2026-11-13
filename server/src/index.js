// Cloudflare Worker: /mcp, /record/{table}, and the two Durable Objects. No secrets, no outbound fetch.
import { DurableObject } from 'cloudflare:workers';
import { handle } from './mcp.js';
import { makeCall } from './tools.js';
import { TableCore } from './table.js';
import { LobbyCore } from './lobby.js';

const PAGE = 'https://patbing.github.io/dudo/';
const lobbyOf = (env) => env.LOBBY.get(env.LOBBY.idFromName('lobby'));

export class Table extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const s = ctx.storage;
    this.core = new TableCore({
      load: () => s.get('t'), save: (t) => s.put('t', t), del: () => s.deleteAll(),
      setAlarm: (ms) => (ms ? s.setAlarm(ms) : s.deleteAlarm()),
      notify: (info) => lobbyOf(env).update(info), now: () => Date.now()
    });
    ctx.blockConcurrencyWhile(() => this.core.init());
  }
  create(code, cfg) { return this.core.create(code, cfg); }
  join(name) { return this.core.join(name); }
  start(token, bots) { return this.core.start(token, bots); }
  move(token, kind, args) { return this.core.move(token, kind, args); }
  getState(token, wait, since) { return this.core.getState(token, wait, since); }
  async record() { await this.core.tick(); return this.core.record(); }
  alarm() { return this.core.tick(); }
}

export class Lobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new LobbyCore({ load: () => ctx.storage.get('d'), save: (d) => ctx.storage.put('d', d), now: () => Date.now() });
    ctx.blockConcurrencyWhile(() => this.core.init());
  }
  async alloc(ip) { const c = this.core.alloc(ip); await this.ctx.storage.put('d', this.core.d); return c; }
  update(info) { return this.core.update(info); }
  quick() { return this.core.quick(); }
  list() { return this.core.list(); }
}

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url), ip = request.headers.get('cf-connecting-ip') || '';
    if (url.pathname === '/' && request.method === 'GET') return json(200, { app: "Dudo (liar's dice)", mcp: `${url.origin}/mcp`, page: PAGE });
    const rec = /^\/record\/([A-Za-z]{4})$/.exec(url.pathname);
    if (rec && request.method === 'GET') {
      try { return json(200, await env.TABLE.get(env.TABLE.idFromName(rec[1].toUpperCase())).record(), { 'access-control-allow-origin': '*' }); }
      catch (e) { return json(404, { error: e.message }, { 'access-control-allow-origin': '*' }); }
    }
    if (url.pathname !== '/mcp') return json(404, { error: 'Not found. The MCP endpoint is /mcp.' });
    if (request.method === 'POST' && env.RL) {
      const { success } = await env.RL.limit({ key: ip || 'none' });
      if (!success) return json(429, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Too many requests; slow down.' } });
    }
    const headers = {};
    for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;
    const call = makeCall({ lobby: lobbyOf(env), table: (c) => env.TABLE.get(env.TABLE.idFromName(c)), recordBase: url.origin });
    const r = await handle({ method: request.method, headers, body: request.method === 'POST' ? await request.text() : '' }, (name, args) => call(name, args, ip));
    return new Response(r.body || null, { status: r.status, headers: r.headers });
  }
};
