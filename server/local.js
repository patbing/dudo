// Local server for tests and page work: the same MCP code in memory, plus the repo's static files.
// node server/local.js [port]   ->   http://127.0.0.1:8787/mcp  and  http://127.0.0.1:8787/ (the page)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handle } from './src/mcp.js';
import { makeCall } from './src/tools.js';
import { TableCore } from './src/table.js';
import { LobbyCore } from './src/lobby.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

export async function createLocal({ now = () => Date.now() } = {}) {
  const lobby = new LobbyCore({ load: () => null, save: () => {}, now });
  await lobby.init();
  const tables = new Map();
  const table = (code) => {
    if (!tables.has(code)) {
      let timer = null;
      const core = new TableCore({
        load: () => null, save: () => {}, del: () => { tables.delete(code); }, now,
        setAlarm: (ms) => { clearTimeout(timer); timer = ms ? setTimeout(() => core.tick(), Math.max(0, ms - now())) : null; if (timer?.unref) timer.unref(); },
        notify: (info) => lobby.update(info)
      });
      // No init(): nothing is stored locally, and an async init could race the first create.
      tables.set(code, core);
    }
    return tables.get(code);
  };
  return { lobby, tables, table };
}

export async function startLocal(port = 8787) {
  const { lobby, table } = await createLocal();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 65536) break; }
    try {
      if (url.pathname === '/mcp') {
        const call = makeCall({ lobby, table, recordBase: `http://${req.headers.host}` });
        const r = await handle({ method: req.method, headers: req.headers, body }, (n, a) => call(n, a, req.socket.remoteAddress));
        res.writeHead(r.status, r.headers); return res.end(r.body);
      }
      const rec = /^\/record\/([A-Za-z]{4})$/.exec(url.pathname);
      if (rec) {
        try { const out = table(rec[1].toUpperCase()).record(); res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); return res.end(JSON.stringify(out)); }
        catch (e) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: e.message })); }
      }
      const path = normalize(join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
      if (!path.startsWith(normalize(ROOT))) { res.writeHead(403); return res.end(); }
      const data = await readFile(path);
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(data);
    } catch (e) {
      res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found');
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2]) || 8787;
  await startLocal(port);
  console.log(`dudo local: http://127.0.0.1:${port}/mcp`);
}
