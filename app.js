import * as G from './server/src/game.js';
import { verify } from './server/src/fair.js';
import { mcp, playSeat, spendGuard, pollinationsChat, listToolModels } from './agent.js';
import { MCP_URL, APP_KEY, REPO_URL, DEFAULT_MODELS, MAX_SPEND } from './config.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const tool = mcp(MCP_URL);
const app = { key: null, watch: null, rec: null, frames: null, models: [], run: null };

// ---------- the table ----------
function die(face, cls = '') { const d = el('span', `die ${cls}`, face ? FACES[face] : ''); d.setAttribute('aria-label', face ? `a ${face}` : 'a hidden die'); return d; }

// v: a view (G.view) plus optional hands to show (replay of a finished game, or the last showdown).
function renderBoard(v, { hands = null, note = '' } = {}) {
  const b = $('board'); b.className = 'board'; b.replaceChildren();
  const seats = el('div', 'seats');
  const show = hands || null;
  v.players.forEach((p) => {
    const s = el('div', 'seat');
    if (v.turn && v.turn.seat === p.seat && v.status === 'playing') s.classList.add('on');
    if (p.out) s.classList.add('out');
    const head = el('div', 'seat-head');
    head.append(el('strong', '', p.name), el('span', 'fine', p.bot ? ' house bot' : ''));
    const dice = el('div', 'dice');
    const n = show && show[p.seat] ? show[p.seat].length : p.dice;
    for (let i = 0; i < n; i++) dice.append(die(show && show[p.seat] ? show[p.seat][i] : 0, v.bid && show && show[p.seat] && show[p.seat][i] === v.bid.face ? 'hit' : ''));
    if (p.out) dice.append(el('span', 'fine', 'out'));
    s.append(head, dice);
    const last = [...v.bids].reverse().find((x) => x.seat === p.seat);
    if (last) s.append(el('div', 'bubble', last.challenge ? `Challenge!${last.say ? ' ' + last.say : ''}` : `${last.quantity} × ${FACES[last.face]}${last.say ? '  “' + last.say + '”' : ''}`));
    seats.append(s);
  });
  b.append(seats);
  const mid = el('div', 'mid');
  if (v.status === 'over') mid.append(el('p', 'big', `${v.ranking[0]} wins`), el('p', 'fine', `Ranking: ${v.ranking.join(' > ')}`));
  else if (v.status === 'lobby') mid.append(el('p', 'big', `Waiting for players (${v.players.length}/${v.config.seats})`));
  else {
    mid.append(el('p', 'big', v.bid ? `Standing bid: ${v.bid.quantity} × ${FACES[v.bid.face]} (${v.bid.quantity} ${v.bid.face}s)` : 'Round opens'));
    mid.append(el('p', 'fine', `Round ${v.round} · ${v.dice_in_play} dice in play${v.turn ? ` · ${v.turn.name} to move` : ''}${v.seconds_left != null ? ` · ${v.seconds_left}s` : ''}`));
  }
  const s = v.last_showdown;
  if (s && v.status !== 'lobby') {
    const box = el('div', 'showdown');
    box.append(el('p', '', s.timeout
      ? `Round ${s.round}: ${v.players[s.loser].name} ran out of time and lost a die.`
      : `Round ${s.round}: ${v.players[s.challenger].name} challenged ${v.players[s.bid.seat].name}'s ${s.bid.quantity} × ${s.bid.face}. There ${s.count === 1 ? 'was' : 'were'} ${s.count}. ${v.players[s.loser].name} lost a die.`));
    if (!s.timeout) {
      const row = el('div', 'reveal');
      s.hands.forEach((h, i) => { if (!h.length) return; const g = el('span', 'hand'); g.append(el('span', 'fine', v.players[i].name + ' ')); h.forEach((f) => g.append(die(f, f === s.bid.face ? 'hit' : ''))); row.append(g); });
      box.append(row);
    }
    mid.append(box);
  }
  if (note) mid.append(el('p', 'fine', note));
  b.append(mid);
  const pill = $('board-status'); pill.hidden = false; pill.textContent = v.status; pill.dataset.s = v.status;
}

// ---------- live tables ----------
async function loadTables() {
  const box = $('tables');
  try {
    const l = await tool('list_tables', {});
    box.replaceChildren();
    const add = (label, items, fmt) => {
      if (!items.length) return;
      box.append(el('h3', '', label));
      items.forEach((x) => { const a = el('button', 'item', fmt(x)); a.type = 'button'; a.onclick = () => watch(x.table); box.append(a); });
    };
    add('Playing', l.live, (x) => `${x.table} · ${x.players} players · round ${x.round}`);
    add('Waiting for players', l.open, (x) => `${x.table} · ${x.players}/${x.seats} seated · ${x.dice} dice`);
    add('Finished', l.finished, (x) => `${x.table} · ${x.winner} won`);
    if (!box.children.length) box.append(el('p', 'fine', 'No public tables right now. Start one below, or connect an agent.'));
  } catch (e) {
    box.replaceChildren(el('p', 'fine', `The game server did not answer (${e.message}). Recorded matches still work.`));
  }
}

async function watch(code) {
  stopReplay();
  const me = (app.watch = { code, version: null });
  $('board-title').textContent = `Table ${code}`;
  $('verify').hidden = true;
  while (app.watch === me) {
    try {
      const v = await tool('get_state', me.version == null ? { table: code } : { table: code, since: me.version, wait_seconds: 20 });
      if (app.watch !== me) return;
      me.version = v.version;
      renderBoard(v);
      if (v.status === 'over') {
        const r = await fetch(v.record_url); if (r.ok) showVerify(await r.json());
        return;
      }
    } catch (e) {
      if (app.watch === me) { $('board').replaceChildren(el('p', 'fine', e.message)); }
      return;
    }
  }
}

// ---------- recorded matches and replay ----------
function framesOf(rec) {
  const t = G.newTable({ code: rec.table, ...rec.config });
  rec.players.forEach((p) => G.join(t, { name: p.name, token: '', bot: p.bot }));
  const frames = [];
  for (const e of rec.events) {
    if (e.type === 'start') { G.start(t, { seed: rec.seed, commit: rec.commit, now: e.at }); continue; }
    if (e.type === 'deal') G.applyDeal(t, e.hands, e.at);
    else if (e.type === 'bid') G.bid(t, e.seat, { quantity: e.quantity, face: e.face, say: e.say, now: e.at });
    else if (e.type === 'challenge') G.challenge(t, e.seat, { say: e.say, now: e.at });
    else if (e.type === 'timeout') G.timeout(t, e.at);
    frames.push({ v: JSON.parse(JSON.stringify(G.view(t, null))), hands: t.hands ? t.hands.map((h) => h.slice()) : null, e });
  }
  return frames;
}
function label(f, rec) {
  const e = f.e, who = (s) => rec.players[s].name;
  if (e.type === 'deal') return `Round ${e.round}: dice dealt`;
  if (e.type === 'bid') return `${who(e.seat)} bids ${e.quantity} × ${e.face}${e.say ? ` — “${e.say}”` : ''}`;
  if (e.type === 'challenge') return `${who(e.seat)} challenges${e.say ? ` — “${e.say}”` : ''}`;
  return `${who(e.seat)} runs out of time`;
}
function showFrame(i) {
  const f = app.frames[i];
  $('rp-slider').value = i;
  $('rp-label').textContent = `${i + 1}/${app.frames.length} · ${label(f, app.rec)}`;
  renderBoard(f.v, { hands: f.hands, note: f.hands ? 'Replay of a finished game: every hand is shown.' : '' });
}
function stopReplay() { app.frames = null; $('replay').hidden = true; }
async function loadRecordings() {
  const box = $('recordings');
  try {
    const list = await (await fetch('recordings/index.json', { cache: 'no-store' })).json();
    box.replaceChildren();
    list.forEach((r) => { const a = el('button', 'item', r.title); a.type = 'button'; a.onclick = () => openRecording(r.file, r.title); box.append(a); if (r.note) box.append(el('p', 'fine', r.note)); });
    const want = new URLSearchParams(location.search).get('match');
    const first = list.find((r) => r.file === want) || list[0];
    if (first && !new URLSearchParams(location.search).get('table')) openRecording(first.file, first.title);
  } catch { box.replaceChildren(el('p', 'fine', 'No recordings yet.')); }
}
async function openRecording(file, title) {
  app.watch = null;
  const rec = await (await fetch(`recordings/${file}`, { cache: 'no-store' })).json();
  app.rec = rec; app.frames = framesOf(rec);
  $('board-title').textContent = title || rec.table;
  const s = $('rp-slider'); s.max = app.frames.length - 1; $('replay').hidden = false;
  showFrame(app.frames.length - 1);
  showVerify(rec);
}

// ---------- verify ----------
function showVerify(rec) {
  app.rec = rec;
  $('verify').hidden = false; $('commit').textContent = rec.commit.slice(0, 16) + '…';
  $('verify-steps').replaceChildren();
}
async function runVerify() {
  const ol = $('verify-steps'); ol.replaceChildren();
  const r = await verify(app.rec);
  for (const s of r.steps) {
    const li = el('li', s.ok ? 'ok' : 'bad', s.label);
    if (s.detail && !s.ok) li.append(el('div', 'fine', s.detail));
    ol.append(li);
    await new Promise((ok) => setTimeout(ok, 60));
  }
  ol.append(el('li', r.ok ? 'ok total' : 'bad total', r.ok ? 'Every hand came from the committed seed and every move followed the rules.' : 'This record does not check out.'));
}

// ---------- seating models ----------
const short = (id) => id.split('/').pop().slice(0, 20);
function readKey(c, e) { const k = (c && c.apiKey) || (e && e.detail && (e.detail.apiKey || e.detail.key)) || null; return typeof k === 'string' && k ? k : null; }
function wireConnect() {
  const c = $('connect');
  c.setAttribute('app-key', APP_KEY);
  Promise.race([customElements.whenDefined('polli-connect'), new Promise((r) => setTimeout(r, 8000))]).then(() => {
    if (!customElements.get('polli-connect')) { c.hidden = true; $('connect-fallback').hidden = false; }
    onKey(readKey(c));
  });
  c.addEventListener('change', (e) => onKey(readKey(c, e)));
}
function onKey(k) {
  if (k === app.key) return;
  app.key = k;
  if (!k && app.run) app.run.ctrl.abort();
  $('seat-form').hidden = !k;
  $('seat-hint').textContent = k ? 'Pick 2 to 4 models. Each turn is one call from this browser with your key; the game server only sees the bid.' : 'Sign in with Pollinations to seat models. Calls go from this browser to gen.pollinations.ai with your key; the game server only ever sees bids.';
  if (k && !app.models.length) loadModels();
}
async function loadModels() {
  try {
    app.models = (await listToolModels()).filter((m) => !m.paidOnly);
    const box = $('models'); box.replaceChildren();
    const order = [...DEFAULT_MODELS.map((id) => app.models.find((m) => m.id === id)).filter(Boolean), ...app.models.filter((m) => !DEFAULT_MODELS.includes(m.id))];
    order.slice(0, 14).forEach((m) => {
      const l = el('label', 'model'); const i = el('input'); i.type = 'checkbox'; i.value = m.id; i.checked = DEFAULT_MODELS.includes(m.id);
      l.append(i, el('span', '', ` ${short(m.id)}`), el('span', 'fine', m.health && m.health !== 'healthy' ? ` (${m.health})` : ''));
      box.append(l);
    });
  } catch (e) { $('models').replaceChildren(el('p', 'fine', `Could not load models: ${e.message}`)); }
}
function log(text, cls = '') { const li = el('li', cls, text); $('log').prepend(li); while ($('log').children.length > 60) $('log').lastChild.remove(); }

async function startGame() {
  const ids = [...document.querySelectorAll('#models input:checked')].map((i) => i.value).slice(0, 4);
  const models = ids.map((id) => app.models.find((m) => m.id === id)).filter(Boolean);
  if (!models.length) return log('Pick at least one model.', 'bad');
  const agentSeat = $('agent-seat').checked;
  const seats = models.length + (agentSeat ? 1 : 0);
  const ctrl = new AbortController(), guard = spendGuard(MAX_SPEND);
  app.run = { ctrl, guard };
  $('start').disabled = true; $('stop').hidden = false; $('log').replaceChildren();
  const spend = () => { $('spend').textContent = `${guard.calls} calls, about ${guard.spent.toFixed(5)} Pollen spent (cap ${MAX_SPEND}).`; };
  try {
    const { table } = await tool('create_table', { seats: Math.max(2, seats), dice: Number($('dice').value), public: true });
    const tokens = [];
    for (const m of models) tokens.push((await tool('join_table', { table, name: short(m.id) })).token);
    log(`Table ${table}: ${models.map((m) => short(m.id)).join(', ')} seated.`);
    watch(table);
    if (agentSeat) {
      log(`Waiting for your agent: tell it to join_table with table "${table}". The game starts when it sits down.`, 'note');
      let v = await tool('get_state', { table });
      while (v.players.length < seats && !ctrl.signal.aborted) v = await tool('get_state', { table, since: v.version, wait_seconds: 20 });
      if (ctrl.signal.aborted) throw new Error('stopped');
    }
    await tool('start_game', { table, token: tokens[0], bots: seats < 2 ? 1 : 0 });
    log('Game started. Seed committed before the first bid.');
    const chat = (body) => pollinationsChat(app.key, body, { signal: ctrl.signal });
    await Promise.all(models.map((m, i) => playSeat({
      tool, table, token: tokens[i], model: m, chat, guard, signal: ctrl.signal,
      on: (e) => {
        spend();
        const n = short(m.id);
        if (e.type === 'move') log(`${n}: ${e.name === 'bid' ? `bid ${e.args.quantity} × ${e.args.face}` : 'challenge'}${e.args.say ? ` — “${e.args.say}”` : ''}`);
        else if (e.type === 'refused') log(`${n}: refused (${e.error})`, 'bad');
        else if (e.type === 'error') log(`${n}: ${e.error}`, 'bad');
        else if (e.type === 'cap') log(`Spend cap reached; ${n} stops calling (the server clock will time it out).`, 'bad');
      }
    })));
    log('Game over.', 'note');
  } catch (e) {
    log(e.message === 'stopped' ? 'Stopped.' : `Error: ${e.message}`, 'bad');
  } finally {
    spend(); app.run = null; $('start').disabled = false; $('stop').hidden = true;
  }
}

// ---------- wiring ----------
function snippets() {
  $('snip-claude').textContent = `# Claude Code\nclaude mcp add --transport http dudo ${MCP_URL}`;
  $('snip-codex').textContent = `# Codex: ~/.codex/config.toml\n[mcp_servers.dudo]\nurl = "${MCP_URL}"`;
  $('snip-curl').textContent = `# No client at all\ncurl -s ${MCP_URL} -H 'content-type: application/json' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"join_table","arguments":{"name":"curl"}}}'`;
}
$('refresh').onclick = loadTables;
$('verify-btn').onclick = runVerify;
$('rp-slider').oninput = (e) => showFrame(Number(e.target.value));
$('rp-prev').onclick = () => app.frames && showFrame(Math.max(0, Number($('rp-slider').value) - 1));
$('rp-next').onclick = () => app.frames && showFrame(Math.min(app.frames.length - 1, Number($('rp-slider').value) + 1));
$('start').onclick = startGame;
$('stop').onclick = () => app.run && app.run.ctrl.abort();
$('src').href = REPO_URL;
snippets(); wireConnect(); loadTables(); loadRecordings();
setInterval(() => { if (!document.hidden) loadTables(); }, 15000);
const tq = new URLSearchParams(location.search).get('table');
if (tq && /^[A-Za-z]{4}$/.test(tq)) watch(tq.toUpperCase());
