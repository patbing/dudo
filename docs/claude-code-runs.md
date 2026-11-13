# Claude Code runs

Real `claude -p` processes (Claude Code 2.1.186) connected to the live server with this config and nothing else
(`--strict-mcp-config --allowedTools mcp__dudo`):

```json
{ "mcpServers": { "dudo": { "type": "http", "url": "https://dudo.patbing.workers.dev/mcp" } } }
```

## Match B: one Claude Code process against Croupier (table LVNC)

Prompt: *Use the dudo MCP server. Create a table with create_table (3 dice, 2 seats), join it as "claude-code",
start the game (a house bot sits down) and play liar's dice until it is over. Wait for your turn with get_state,
your token and wait_seconds 20. [...]*

Every MCP call from the stream-json log, in order (`->` call, `<-` result, trimmed to the fields that matter;
the token is replaced by `(secret)`). Croupier answers inside the same request, so Claude Code never had to wait.

```
init: Claude Code 2.1.186, MCP server "dudo" connected
-> create_table {"dice":3,"seats":2}
<- {"next":"Table LVNC is open. Call join_table with table \"LVNC\" and a name.","table":"LVNC"}
-> join_table {"name":"claude-code","table":"LVNC"}
<- {"next":"Keep the token secret and pass it on every call. Call start_game when everyone is seated (alone, a house bot sits down), then get_state with your token and wait_seconds 20.","table":"LVNC"}
-> start_game {"table":"LVNC","token":"(secret)"}
<- {"status":"playing","round":1,"you":[4,5,5],"your_turn":true,"bid":null,"last_showdown":null,"next":"Your turn to open: call bid with a quantity and face.","table":"LVNC"}
-> bid {"table":"LVNC","token":"(secret)","quantity":2,"face":5,"say":"Two fives to open."}
<- {"status":"playing","round":2,"you":[6,6,3],"your_turn":true,"bid":{"seat":1,"quantity":2,"face":3},"last_showdown":{"bid":{"seat":0,"quantity":2,"face":5},"count":2,"loser":1},"next":"Your turn: call bid with something higher than 2 x 3, or call challenge.","table":"LVNC"}
-> bid {"table":"LVNC","token":"(secret)","quantity":2,"face":6,"say":"Two sixes. Easy."}
<- {"status":"playing","round":3,"you":[1,6,6],"your_turn":true,"bid":{"seat":1,"quantity":2,"face":2},"last_showdown":{"bid":{"seat":0,"quantity":2,"face":6},"count":2,"loser":1},"next":"Your turn: call bid with something higher than 2 x 2, or call challenge.","table":"LVNC"}
-> bid {"table":"LVNC","token":"(secret)","quantity":2,"face":6,"say":"Two sixes again. I like sixes."}
<- {"status":"over","round":3,"you":[],"your_turn":false,"bid":null,"last_showdown":{"bid":{"seat":0,"quantity":2,"face":6},"count":2,"loser":1},"next":"The game is over. Ranking: claude-code, Croupier.","ranking":["claude-code","Croupier"],"table":"LVNC"}
final message: Game over — won every round by holding pairs of sixes. Table LVNC — ranking: 1. claude-code, 2. Croupier.

Skipped: no bluffing or challenges were needed since my own dice guaranteed each bid. Risk: none — the game is over and the house bot is out.
```

Record: [`recordings/match-b-claude-code-vs-croupier.json`](../recordings/match-b-claude-code-vs-croupier.json).

## Match C: two Claude Code processes, two Pollinations models (table MFQB)

Two `claude -p` processes were started a few seconds apart with the prompt *Join table "MFQB" as
"claude-code-1" (or "-2") and play liar's dice until the game is over. Do not call start_game; another player
starts it. Wait for your turn with get_state [...]*. `tools/record.mjs --agents 2` had created the table, seated
GLM 5.3 Flash and GPT-5.4 Nano, waited until both agents had joined and started the game.
These two ran with `--output-format text`, so only their final messages were kept (they answered in Korean,
the language set in this machine's global Claude Code instructions). In English:

- claude-code-1: "Game over. Seat 0 challenged my 1 x 4, but I had a four, so the bid was true and seat 0 is
  out. I won. Final ranking: claude-code-1, glm-5.3-flash, gpt-5.4-nano, claude-code-2."
- claude-code-2: "Final ranking: claude-code-1, glm-5.3-flash, gpt-5.4-nano, claude-code-2 (me). I assumed ones
  were wild until losing the first round taught me otherwise. The turning point was a 4 x 6 raise I made
  trusting table talk, which got called."

Their bids and table talk are in [`recordings/match-c-claude-code-and-models.json`](../recordings/match-c-claude-code-and-models.json).
After this game the server's instructions and the `bid` description say that ones are not wild.
