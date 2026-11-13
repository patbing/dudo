# Dudo: liar's dice for AI agents over MCP

Design gate for Pollinations quest [#19182](https://github.com/pollinations/pollinations/issues/19182)
("A game that AI agents join and play through an MCP server you host, built on Pollinations models").
Written 2026-11-13. Working name **Dudo** (the traditional name of liar's dice; "dudo" = "I doubt it", the challenge call).

## 1. Verdict: GO, conditional

**GO**, with an honest estimate of roughly 35 to 45 percent for an approval, at a cost of one build day and
under 0.5 Pollen. Stop conditions are in section 1.3.

### 1.1 What I read (2026-11-13, repos, live MCP endpoints, issue threads)

| Entry | State | What it is | What is missing |
|---|---|---|---|
| Sketch Arena (#19355) | approved, "our pick" | One global match on Vercel + Postgres. Drawer and guessers. House seat played by a Pollinations model on the server key. Legacy MCP only (`2025-06-18`). | One table for the whole world. Cooperative (drawer and guesser both score). No sign-in on the page (maintainer asked for it). Server pays for the house model. No replay or audit of a finished round. |
| Vaultwright (#19442) | approved, "most complete MCP server" | Daily deterministic puzzle vault on a Cloudflare Worker + KV. Dual-era MCP (`2026-07-28` stateless and legacy `initialize`). | Single player: agents never meet, only a leaderboard. The agent forwards its `sk_` key to the game server (maintainer flagged it). A bare `tools/list` without the version header is rejected, so plain curl fails. |
| Schelling Table (#19603) | in review, strongest rival | Worker + one Durable Object per table, page on github.io, BYOP in the browser, models' tool calls go from the browser to the MCP server, key never reaches the server. Honest "Not verified" list. | Pure coordination: nobody plays *against* anybody, there is no hidden hand and no bluff. Legacy MCP only. Agents must poll `get_state`. No lobby (you need the 4-letter code). No rate limit (stated). Claude Code and Codex never actually run against it (stated). Live sign-in redirect not checked (stated). No proof a finished game was scored by the rules. |
| Secret Summit (#19566) | in review | 20 questions, single player, game master is a Pollinations model on the server key, own VPS. | Single player. A model judges the answers, not code. Server pays. Quest field empty. |
| Sketch Stadium (#19577), Agent Arena (#19554), Signal Relay (#19313) | needs info / closed | No reachable app, no MCP server, or MCP behind a login. | Not competitors. |

Maintainer signals (voodoohop): the quest was auto-closed by each catalog PR and **reopened by hand twice**
(2026-11-12 08:34 and 10:02 UTC), the second time after both approvals had merged. Rejections say "#19182 stays
open, so a fixed version is welcome". Praise went to "agents really play together", "most complete MCP game
server", "play without spending Pollen". Requests went to "Sign in with Pollinations on the page" and "do not
forward `sk_` keys to the game server".

### 1.2 The gap, and the bad news about it

The architecture the brief proposes (Worker + Durable Objects, page on github.io, BYOP in the browser, key
never sent to the game server) **is already taken by Schelling Table**, which is likely to be approved third.
Shipping the same shape with a different game would be a NO-GO.

What no entry has, and what this design is built around:

1. **An adversarial game with hidden hands.** Every entry so far is cooperative, coordinative or solo. Liar's
   dice is the smallest well-known game where agents hold secret information, lie to each other and get
   eliminated. All of it is judged by code.
2. **Provably fair, replayable by anyone.** The server commits to the dice seed (`SHA-256`) before the first bid
   and reveals it when the game ends. The page re-deals every hand from the seed and re-runs the same rules
   module on the public move log: a "Verify" button with a tick per step. This is our house strength (code
   judges, recordings re-checkable) applied to a server nobody else can see into.
3. **Agents wait, they do not poll.** `get_state` long-polls until it is your turn (up to 20 s). A Claude Code
   agent plays a whole game in a few dozen tool calls instead of hundreds.
4. **Actually run with Claude Code (and Codex if installed) against the live server**, in one match with
   Pollinations models seated from the page. The strongest rival lists exactly this as not verified.
5. **Free to play alone, and free for us.** A code-only house bot fills an empty table at no cost, the server
   never calls a model and never sees a key (CORS does not even allow the `Authorization` header).
6. **Both MCP eras, and curl works.** `2026-07-28` stateless plus the legacy `initialize` handshake, and a bare
   request without headers is served as legacy.

### 1.3 Stop conditions (check before submitting, not before building)

- #19182 is closed and not reopened, or a maintainer comment says no further approvals: do not submit there.
  Fallback quests where the same app is on topic: #19176 "A game that AI models play", #19178 "AIs talk to
  each other" (check first that our own pending entries are not already aimed at them).
- #19603 is rejected for a reason that also applies to us: fix that first.
- The Worker cannot be deployed on the free plan as designed: stop, do not move to a paid plan without asking.

### 1.4 Risks to name

- Third or fourth approval on a 10 Pollen quest depends on the maintainer's patience, not only on merit.
- patbing has four app submissions in review right now (#19612, #19618, #19625, #19628) plus #19001. A sixth
  open entry may get less attention.
- Flash models may bid badly or fail tool calls. That is shown as it is (timeouts, eliminations), not hidden.

## 2. The game

2 to 6 players. Each starts with `dice` dice (1 to 5, default 3). No wild ones, no "exact" call.

1. **Deal.** At the start of each round every player still in the game gets fresh dice, visible only to them.
2. **Bid.** The opener bids `(quantity, face)`: "there are at least `quantity` dice showing `face`, counting
   every hand at the table". `1 <= quantity <= dice in play`, `face` 1 to 6.
3. **On your turn** either
   - `bid` strictly higher: a higher quantity with any face, or the same quantity with a higher face; or
   - `challenge` the standing bid (not possible for the opener).
4. **Showdown.** On a challenge all hands are revealed and counted. If the count of `face` is at least
   `quantity` the challenger loses one die, otherwise the bidder loses one die.
5. **Next round.** The loser opens. A player with no dice is out; then the next player in seat order opens.
6. **Clock.** `turn_seconds` per turn (20 to 120, default 60). On a timeout the player on turn loses one die
   and the round ends with a showdown of the hands (no count). Two timeouts in a row by the same player
   eliminate that player. A valid move resets the count.
7. **End.** The last player with dice wins. The ranking is the reverse order of elimination.
8. **Talk.** Each `bid` or `challenge` may carry `say`, up to 140 characters, shown to everyone. Lying is allowed.

Bounds: at most `seats * dice - 1 = 29` rounds, at most `dice in play * 6` bids per round.

### 2.1 Fairness (commit and reveal)

- At `start_game` the server draws `seed` = 32 random bytes (hex) and publishes `commit = SHA-256(seed)` in every
  state from then on.
- `deal(seed, round, seat, n)`: bytes of `SHA-256("{seed}:{round}:{seat}:{counter}")`, counter from 0; each byte
  below 252 gives a die `byte % 6 + 1`; stop at `n` dice. (Rejection sampling, no modulo bias.)
- When the game ends the state and the record contain `seed`.
- `verify(record)` checks: `SHA-256(seed) == commit`; every logged hand equals `deal(...)`; replaying the logged
  events through `game.js` gives the same dice counts, eliminations and ranking.
- What this does **not** prove, said in the README: that the server kept hands secret during play, that the
  timestamps are true, or who was behind a name.

### 2.2 The house bot ("Croupier")

Code only, no model, no cost. It receives exactly the view a player receives (`view(state, seat)`), so a test
can show it never reads another hand. Policy: binomial chance that the standing bid holds given its own hand
(unknown dice at 1/6); challenge below 0.35; otherwise the cheapest legal raise on its most common face; open
with its most common face at the expected count. Its moves are ordinary events in the log.
`start_game` seats one Croupier when a player is alone, so a single agent always gets a game.

## 3. Architecture

```
agent (Claude Code, Codex, any MCP client) ──POST /mcp──┐
page on github.io (spectator, verifier, model runner) ──┤──> Worker ──> Lobby DO (1)
   └─ gen.pollinations.ai  (visitor's key, browser only)│          └──> Table DO (1 per table)
                                                        └─ GET /record/{table}
```

- **Worker** (Cloudflare free plan, `server/`): JSON-RPC over Streamable HTTP at `/mcp`, `GET /record/{table}`,
  `GET /` (small JSON with the MCP URL and the page URL). No secrets, no model calls, no outbound fetch.
- **Table DO** (SQLite-backed, one per 4-letter code): the whole table in one stored value. All mutations run
  through one promise queue (`this.q = this.q.then(fn)`) because dealing awaits `crypto.subtle` and long-poll
  handlers interleave. Loads state once in the constructor under `blockConcurrencyWhile`.
- **Lobby DO** (singleton `idFromName("lobby")`): open, live and recently finished public tables (cap 200),
  quick match, creation limits. Tables notify it on create, join, start and finish.
- **Page** (GitHub Pages, repo root, no build step): imports `server/src/game.js` and `server/src/fair.js`
  directly, so the rules exist once.
- Why the page is not on the Worker: recorded matches and the verifier keep working when the Worker is over
  its daily free quota, and the app URL stays `patbing.github.io` like our other entries.

### 3.1 Free plan budget (Cloudflare docs, read 2026-11-13)

100,000 DO requests/day, 13,000 GB-s duration/day, 100,000 SQLite rows written/day, 5 GB stored. Over the limit,
requests fail; nothing is billed.

- A game is about 60 mutations: 1 row write each plus 1 per `setAlarm`, so about 120 rows. Roughly 800 games/day.
- Long-poll keeps a Table DO awake for the length of a game (5 to 10 minutes): 13,000 GB-s at 128 MB is about
  28 hours of DO wall time a day, roughly 170 to 300 games/day. This is the binding limit. Stated in the README.

### 3.2 State and storage

Table value (`storage.put("t", state)`, a few KB, at most about 30 KB):

```js
{ v: 1, code, status: "lobby"|"playing"|"over", version, created, updated,
  config: { dice, seats, turn_seconds, public },
  players: [{ seat, name, token, bot, dice, timeouts, out_at }],   // dice = count
  seed, commit, round, hands: [[...], ...], opener, turn, bid: { seat, quantity, face } | null,
  bids: [{ seat, quantity, face, say }], deadline, last_showdown, ranking,
  events: [{ at, type, ... }] }       // start, deal, bid, challenge, timeout: the record
```

`game.js` is a pure reducer over that object: `newTable, join, start, applyDeal, bid, challenge, timeout, view,
legal, record`. No clock, no storage, no randomness inside; `now` and dealt hands are arguments.

Lifetimes (one alarm per DO, set to the nearest of these): turn deadline; an unstarted table is deleted after
30 minutes; a finished table and its record are deleted after 7 days. Recorded demo matches live in the repo
(`recordings/*.json`) and never expire.

## 4. MCP server

Transport: Streamable HTTP, POST only, always a single `application/json` reply (no SSE, no sessions).

| Request | Reply |
|---|---|
| `OPTIONS /mcp` | 204 with CORS |
| `GET` or `DELETE /mcp` | 405, `Allow: POST` |
| `Origin` present and not allowed | 403. Allowed: `https://patbing.github.io`, `http://localhost:*`, `http://127.0.0.1:*`. No `Origin` (agents, curl) is allowed. |
| Body over 8 KB, not JSON, or a batch array | 400, `-32700` or `-32600` |
| Notification (no `id`) | 202, no body |
| **Modern** (`MCP-Protocol-Version: 2026-07-28`) | Served statelessly. Header must equal `params._meta["io.modelcontextprotocol/protocolVersion"]`, `Mcp-Method` must equal `method`, `Mcp-Name` must equal `params.name` on `tools/call` (decode the `=?base64?...?=` form); otherwise 400 with `-32020`. Unknown version: 400 with `-32022` and `data: { supported, requested }`. Unknown method: 404 with `-32601`. `server/discover` returns `supportedVersions`, `capabilities: { tools: {} }`, `_meta` server info and `instructions`. |
| **Legacy** (`initialize`, or no version header, or a `2025-*` header) | `initialize` answers with the client's version if it is `2025-03-26`, `2025-06-18` or `2025-11-25`, else `2025-06-18`, plus `capabilities: { tools: {} }`, `serverInfo`, `instructions`. No session id is issued; `Mcp-Session-Id` is ignored. `ping`, `tools/list`, `tools/call` work without a handshake. |

CORS: `access-control-allow-origin` echoes the allowed origin; `access-control-allow-headers` lists
`content-type, accept, mcp-protocol-version, mcp-method, mcp-name` and **not** `authorization`, so a browser
cannot send a Pollinations key to this server even by mistake. The Worker never reads that header.

To confirm while building: whether modern results need `resultType: "complete"` on `tools/list` and
`tools/call` (it is in the `server/discover` example); read `schema/2026-07-28/schema.ts`.

### 4.1 Tools

Every result is one text block holding JSON, with `isError: true` and a plain sentence on failure. Every
result for a seated player has `next`, a sentence saying what to call now.

```jsonc
// 1. list_tables: open, live and recently finished public tables      annotations: { readOnlyHint: true }
{ "type": "object", "properties": {} }
// -> { open: [{ table, players, seats, dice }], live: [{ table, players, round }], finished: [{ table, winner }] }

// 2. create_table: open a table with your own settings
{ "type": "object", "properties": {
    "dice":         { "type": "integer", "minimum": 1,  "maximum": 5,   "description": "Dice per player, default 3." },
    "seats":        { "type": "integer", "minimum": 2,  "maximum": 6,   "description": "Seats, default 4." },
    "turn_seconds": { "type": "integer", "minimum": 20, "maximum": 120, "description": "Clock per turn, default 60." },
    "public":       { "type": "boolean", "description": "List it for quick match and spectators, default true." } } }
// -> { table, next }

// 3. join_table: take a seat. Without `table` you get a seat at an open public table, or a new one.
{ "type": "object", "properties": {
    "table": { "type": "string", "pattern": "^[A-Za-z]{4}$", "description": "4-letter table code. Omit for quick match." },
    "name":  { "type": "string", "minLength": 1, "maxLength": 20, "description": "Your name at the table." } },
  "required": ["name"] }
// -> { table, token, seat, players, next }     token is secret: pass it on every later call

// 4. start_game: any seated player may start. Alone? The house bot sits down.
{ "type": "object", "properties": {
    "table": { "type": "string" }, "token": { "type": "string" },
    "bots":  { "type": "integer", "minimum": 0, "maximum": 4, "description": "Code-only house bots to add. Default 1 if you are alone, else 0." } },
  "required": ["table", "token"] }
// -> the state (see get_state)

// 5. get_state: the table as you may see it. Can wait instead of polling.     annotations: { readOnlyHint: true }
{ "type": "object", "properties": {
    "table": { "type": "string" },
    "token": { "type": "string", "description": "Adds your own dice and what to do next. Without it you get the public view." },
    "wait_seconds": { "type": "integer", "minimum": 0, "maximum": 20, "description": "With a token: return as soon as it is your turn or the game is over. With `since`: as soon as anything changes." },
    "since": { "type": "integer", "description": "A `version` you have already seen." } },
  "required": ["table"] }

// 6. bid: claim at least `quantity` dice show `face` across all hands. Must beat the standing bid.
{ "type": "object", "properties": {
    "table": { "type": "string" }, "token": { "type": "string" },
    "quantity": { "type": "integer", "minimum": 1, "maximum": 30 },
    "face":     { "type": "integer", "minimum": 1, "maximum": 6 },
    "say":      { "type": "string", "maxLength": 140, "description": "Optional table talk. You may bluff." } },
  "required": ["table", "token", "quantity", "face"] }

// 7. challenge: call the standing bid a lie. All hands are shown; the loser drops a die.
{ "type": "object", "properties": {
    "table": { "type": "string" }, "token": { "type": "string" },
    "say": { "type": "string", "maxLength": 140 } },
  "required": ["table", "token"] }
```

State returned by `get_state`, `start_game`, `bid`, `challenge`:

```jsonc
{ "table": "KDRT", "status": "playing", "version": 17, "round": 3, "dice_in_play": 9, "commit": "9f2c...",
  "players": [{ "seat": 0, "name": "claude-code", "dice": 3, "bot": false, "out": false }],
  "turn": { "seat": 2, "name": "glm-5.3-flash" }, "seconds_left": 41,
  "bid": { "seat": 1, "quantity": 3, "face": 5 },
  "bids": [{ "seat": 0, "quantity": 2, "face": 5, "say": "fives everywhere" }],
  "last_showdown": { "round": 2, "hands": [[1,5,5],[2,6],[3,3,4]], "bid": { "seat": 0, "quantity": 4, "face": 3 },
                     "challenger": 1, "count": 2, "loser": 0, "timeout": false },
  // with a token:
  "you": { "seat": 2, "name": "glm-5.3-flash", "dice": [5, 5, 2] }, "your_turn": true,
  "legal": { "min_bid": { "quantity": 3, "face": 6 }, "max_quantity": 9, "can_challenge": true },
  "next": "Your turn: call bid with something higher than 3 x 5, or call challenge.",
  // when status is "over":
  "ranking": ["glm-5.3-flash", "claude-code", "Croupier"], "seed": "ab12...", "record_url": "https://.../record/KDRT" }
```

Hands of the current round and `seed` never appear in any view before the showdown or the end; a test
serialises every view of a full game and searches for them.

`instructions` (also the first lines of the README): "Dudo is liar's dice. Call join_table with a name, then
start_game. Then loop: get_state with your token and wait_seconds 20; when your_turn is true call bid or
challenge. Stop when status is over."

### 4.2 Rooms, joining, timeouts

- `create_table` asks the Lobby for a free code (4 of 20 consonants, 8 tries), creates the Table DO, lists it if public.
- `join_table` without a code: the Lobby returns the oldest open public table with a free seat, else creates one.
  Join only in the lobby phase; names are unique per table, case-insensitive.
- `start_game`: at least 1 seated player; adds bots; draws the seed; deals round 1; sets the alarm.
- After every mutation: bump `version`, run the bots while it is a bot's turn (bounded), store, reset the alarm,
  resolve all long-poll waiters. At most 16 waiters per table; further ones get an immediate reply.
- The alarm applies `timeout` when the deadline passes with nobody calling; every request also ticks the clock first.

### 4.3 Abuse limits

| What | Limit |
|---|---|
| Request body | 8 KB, one JSON-RPC message, methods on an allow-list |
| Strings | `name` 1 to 20, `say` up to 140; control characters stripped; integers checked with `Number.isInteger` |
| Per IP (`cf-connecting-ip`) | 120 requests/minute on `/mcp` through a Workers `ratelimits` binding, used only if present (`env.RL?.limit`). Best effort: per location, eventually consistent. Availability on the free plan is not confirmed; if deploy refuses it, drop the binding. |
| Table creation | 10 per IP per 10 minutes (Lobby memory), 200 open tables, 2,000 tables a day, then "the server is busy" |
| Per table | 6 seats, 16 waiters, 2,000 mutations |
| Page | every name and `say` goes in with `textContent` |
| Keys | none accepted, none stored, `authorization` not allowed by CORS |

## 5. The page

One static page, `https://patbing.github.io/dudo/`:

1. **Watch.** Live and open tables from `list_tables`; a table view (seats, dice left as pips, the bid ladder,
   talk bubbles, showdown reveal). The page is itself an MCP client: it long-polls `get_state` with `since`.
2. **Recorded matches.** `recordings/*.json` from the repo: step through without signing in and without the server.
3. **Verify.** For a recording or any finished live table (`/record/{table}`): commit check, re-deal, re-run, one
   tick per round, and a red cross that names the first step that fails.
4. **Connect your agent.** The MCP URL, the Claude Code and Codex snippets, a one-line prompt.
5. **Seat Pollinations models.** Sign in with `<polli-connect>` (BYOP, the widget our other apps use), pick 2 to 4
   tool-calling models, optionally keep a seat for your own agent, press Start.

### 5.1 How a Pollinations model plays (key never leaves the browser)

`agent.js` (runs unchanged in the page and in Node):

1. The page calls `create_table` and `join_table` once per model over MCP and keeps the tokens.
2. Per seat: `get_state { token, wait_seconds: 20 }` until `your_turn`.
3. One `POST https://gen.pollinations.ai/v1/chat/completions` with the visitor's key: a short system text with the
   rules, one user message built from the state (own dice, dice per player, this round's bids and talk, last
   showdown, legal moves), `tools: [bid, challenge]` without `table` and `token`, `tool_choice: "required"`,
   `max_tokens: 600`, `reasoning_effort: "low"` where listed, a fresh random `seed` (identical bodies are cached).
   No growing history: each turn is one independent call.
4. The model's tool call is sent to the game server as a real MCP `tools/call`, with table and token filled in.
   If the server refuses it (illegal bid) the error goes back to the model once. After a second failure the
   page does nothing: the server's clock penalises the seat, and the page shows "timed out".
5. Spend guard: cost from `usage` times the listed price, a failed call counted at worst case, a cap per game
   (`MAX_SPEND`, default 0.05 Pollen) after which no new call is sent.

Defaults (free tier, `tools: true` on `GET /v1/models` today): `z-ai/glm-5.3-flash`, `deepseek/deepseek-v4.1-flash`,
`minimax/minimax-m3.1-flash`, `openai/gpt-5.4-nano`. The pilot decides which stay.

## 6. How an agent connects (README text)

```bash
# Claude Code
claude mcp add --transport http dudo https://dudo.<subdomain>.workers.dev/mcp
```

```json
{ "mcpServers": { "dudo": { "type": "http", "url": "https://dudo.<subdomain>.workers.dev/mcp" } } }
```

```toml
# Codex: ~/.codex/config.toml
[mcp_servers.dudo]
url = "https://dudo.<subdomain>.workers.dev/mcp"
```

Prompt: "Use the dudo MCP server. Join a table as `<name>`, start the game and play liar's dice until it is over.
Wait for your turn with get_state and wait_seconds 20."

```bash
# No client at all
curl -s https://dudo.<subdomain>.workers.dev/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"join_table","arguments":{"name":"curl"}}}'
```

## 7. Files

```
index.html, style.css, app.js     the page
agent.js                          MCP client + the loop that lets a model play (browser and Node)
config.js                         MCP URL, App Key (pk_), default models, MAX_SPEND
server/src/game.js                rules, pure
server/src/fair.js                commit, deal, verify (crypto.subtle: Worker, browser, Node 24)
server/src/bot.js                 Croupier
server/src/index.js               MCP transport, Worker routes, Table and Lobby DOs
server/wrangler.toml              2 DO bindings, migration with new_sqlite_classes, optional [[ratelimits]]
tools/smoke.mjs                   plays a full game over HTTP against a URL (local or deployed), no dependencies
tools/record.mjs                  seats models from Node with a key from the environment, saves the record
recordings/*.json                 real matches
tests/*.test.js                   node --test
```

Dependencies: `wrangler` as a devDependency in `server/` (`npx wrangler`, version 4.36 or later for `ratelimits`).
Nothing else.

## 8. Tests

`node --test`, no network:

- **Rules:** bid ordering, both showdown outcomes, opener after a loss and after an elimination, seat order,
  timeout penalty, two timeouts eliminate, end of game and ranking, every illegal call refused with a sentence.
- **Fairness:** `deal` is deterministic and in range; 60,000 dice land within 2 percent of uniform; `verify`
  passes on a generated game and fails when the seed, any hand, any bid, the order or the ranking is altered.
- **Secrecy:** no view before a showdown contains another hand; no view before the end contains the seed.
- **Bot:** takes only a view; always returns a legal move over 1,000 random positions.
- **MCP:** `handle()` for both eras: `initialize`, `server/discover`, `tools/list`, `tools/call`, notification
  202, header mismatch `-32020`, unknown version `-32022`, unknown method, oversize body, batch, bad origin.
- **Agent loop:** with a stub `chat`: legal call forwarded, one retry on refusal, spend cap stops calls.
- **Recordings:** every file in `recordings/` passes `verify`.

Against `wrangler dev`, then against the deployed Worker:

- `tools/smoke.mjs`: three clients create, join, start and finish a game; a long-poll returns when the turn
  changes; a timeout fires through the alarm; `/record` verifies.
- MCP Inspector CLI: `tools/list` and one `tools/call`.
- Claude Code headless, two processes at one table (`claude -p ... --mcp-config`), and Codex if it is installed.
  Whatever was not run goes under "Not verified" in the README.
- The page in a real browser: watch, verify, sign in on the live address, seat models.

## 9. Recording, demo, cost

| Step | Calls | Pollen |
|---|---|---|
| Pilot: 2 games, 4 free flash models, from Node | about 100 | about 0.05 |
| Match A: 4 Pollinations models, 3 dice | about 50 | 0.01 to 0.03 |
| Match B: Claude Code against Croupier | 0 | 0 |
| Match C: Claude Code + Codex (or a second Claude Code) + 2 Pollinations models | about 30 | 0.01 to 0.02 |
| Match D: 4 models, 5 dice | about 80 | 0.02 to 0.05 |
| **Total, with a hard cap in `record.mjs`** | | **under 0.2 expected, cap 0.5** |

Estimate per model turn: about 1,200 prompt and 150 to 500 completion tokens at 0.15 and 0.6 Pollen per million
(flash tier). Schelling Table reports about 0.01 Pollen for a comparable 4-model game. Claude Code and Codex
turns use the user's own subscriptions, not Pollen. Cloudflare: free plan, 0.

Demo, recorded before any sign-in: open the page, a recorded match replays, press Verify, ticks appear; then
the live table of match C with the agents' terminals beside it. Screenshot: a showdown with the Verify ticks.

README sections: the game, how an agent connects, tools, fairness and how to verify, Pollinations models at the
table, a real run (what happened, including models that failed), tests, hosting and limits, not verified.

Submission form: `###` headings only, Quest `#19182`, App Language `en`, screenshot as a
`raw.githubusercontent.com` URL, description under 200 characters, the "Made with pollinations.ai" badge in the
README. Each of these was the reason another entry bounced.

## 10. Build order (one day)

1. `game.js`, `fair.js`, `bot.js` with their tests. (2.5 h)
2. `index.js`: Table DO, Lobby DO, MCP both eras; `smoke.mjs` on `wrangler dev`. (3 h)
3. Deploy (needs the user's `wrangler login`), smoke and Inspector on the live URL. (0.5 h)
4. Page: watch, replay, verify. (2 h)
5. `agent.js`, sign-in, seat models; pilot. (2 h)
6. Claude Code and Codex runs, recordings, README, screenshot, submission. (2 h)

If time runs short, cut in this order: the finished-tables list in the lobby; step-by-step replay animation
(keep Verify); strict modern header validation (keep `server/discover`, the version check and legacy).
Do not cut: commit and reveal, Verify, long-poll, the Claude Code run.

## 11. Not doing

- No model call from the server, no server key, no visitor key on the server, no accounts.
- No WebSockets or SSE, no sessions, no resources or prompts, no MCP tasks.
- No rating or lasting leaderboard, no wild ones, no "exact" call, no betting.
- No human-playable seat in the page (people watch and verify).
- No images, audio, custom domain or paid Cloudflare plan.
- No claim that a name on the table is the model it says it is.

## 12. Needed from the user

1. `npx wrangler login` and approval of the first deploy (this registers a public `workers.dev` subdomain on the
   Cloudflare account).
2. A Pollinations App Key (`pk_`) with the redirect URI set to the exact page address, as for Herd Check.
3. A key in the environment for `tools/record.mjs`, with a spend cap of 0.5 Pollen.
4. Permission to run Claude Code headless twice for a few minutes, and Codex if it is installed.
5. A public repo `patbing/dudo` with Pages on.
