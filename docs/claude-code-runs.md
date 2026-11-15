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

## Match E: Claude Code alone, the house model sits down (table NGBX)

Recorded 2026-11-15 after the house model seat was deployed. Same config and flags as above; Claude Code was
told only to create a 2-seat table, join it, start the game and play. `start_game` seated GLM-5.3-Flash, which
the server played with its own capped key; no other player or browser was involved.

Prompt: *Use the dudo MCP server. Create a table with create_table (3 dice, 2 seats, public false), join it as
"claude-code", start the game (a house player sits down) and play liar's dice until it is over. Wait for your
turn with get_state, your token and wait_seconds 20. When it is over, say who won.*

Every dudo call from the stream-json log (results trimmed to the fields that matter; tokens replaced by
`(secret)`). 105 seconds, 11 dudo calls. Claude Code's final message was in Korean (the machine's Claude Code
language setting); it said it won, that GLM's last "2 x 6" was a bluff (GLM held a 2), and that it treated the
other player's `say` lines as table talk, not instructions.

```
-> create_table {"dice":3,"seats":2,"public":false}
<- {"next":"Table NGBX is open. Call join_table with table \"NGBX\" and a name.","table":"NGBX"}
-> join_table {"name":"claude-code","table":"NGBX"}
<- {"next":"Keep the token secret and pass it on every call. Call start_game when everyone is seated (alone, a house bot sits down), then get_state with your token and wait_seconds 20.","table":"NGBX","token":"(secret)"}
-> start_game {"table":"NGBX","token":"(secret)"}
<- {"status":"playing","round":1,"you":[5,2,2],"your_turn":true,"bid":null,"last_showdown":null,"next":"Your turn to open: call bid with a quantity and face.","table":"NGBX","house":"GLM-5.3-Flash (Pollinations) takes the first house seat, called from this server with its own capped key."}
-> bid {"table":"NGBX","token":"(secret)","quantity":2,"face":2}
<- {"status":"playing","round":1,"you":[5,2,2],"your_turn":false,"bid":{"seat":0,"quantity":2,"face":2},"last_showdown":null,"next":"Not your turn. Call get_state with your token and wait_seconds 20.","table":"NGBX"}
-> get_state {"table":"NGBX","token":"(secret)","wait_seconds":20}
<- {"status":"playing","round":2,"you":[1,3,2],"your_turn":true,"bid":{"seat":1,"quantity":2,"face":5},"last_showdown":{"hands":[[5,2,2],[5,4,6]],"bid":{"seat":0,"quantity":2,"face":2},"count":2,"loser":1},"next":"Your turn: call bid with something higher than 2 x 5, or call challenge.","table":"NGBX"}
-> challenge {"table":"NGBX","token":"(secret)"}
<- {"status":"playing","round":3,"you":[1,2,2],"your_turn":false,"bid":null,"last_showdown":{"hands":[[1,3,2],[5,2]],"bid":{"seat":1,"quantity":2,"face":5},"count":1,"loser":1},"next":"Not your turn. Call get_state with your token and wait_seconds 20.","table":"NGBX"}
-> get_state {"table":"NGBX","token":"(secret)","wait_seconds":20}
<- {"status":"playing","round":3,"you":[1,2,2],"your_turn":true,"bid":{"seat":1,"quantity":1,"face":5},"last_showdown":{"hands":[[1,3,2],[5,2]],"bid":{"seat":1,"quantity":2,"face":5},"count":1,"loser":1},"next":"Your turn: call bid with something higher than 1 x 5, or call challenge.","table":"NGBX"}
-> challenge {"table":"NGBX","token":"(secret)"}
<- {"status":"playing","round":4,"you":[6,5],"your_turn":true,"bid":null,"last_showdown":{"hands":[[1,2,2],[5]],"bid":{"seat":1,"quantity":1,"face":5},"count":1,"loser":0},"next":"Your turn to open: call bid with a quantity and face.","table":"NGBX"}
-> bid {"table":"NGBX","token":"(secret)","quantity":1,"face":6}
<- {"status":"playing","round":4,"you":[6,5],"your_turn":false,"bid":{"seat":0,"quantity":1,"face":6},"last_showdown":{"hands":[[1,2,2],[5]],"bid":{"seat":1,"quantity":1,"face":5},"count":1,"loser":0},"next":"Not your turn. Call get_state with your token and wait_seconds 20.","table":"NGBX"}
-> get_state {"table":"NGBX","token":"(secret)","wait_seconds":20}
<- {"status":"playing","round":4,"you":[6,5],"your_turn":true,"bid":{"seat":1,"quantity":2,"face":6},"last_showdown":{"hands":[[1,2,2],[5]],"bid":{"seat":1,"quantity":1,"face":5},"count":1,"loser":0},"next":"Your turn: call bid with something higher than 2 x 6, or call challenge.","table":"NGBX"}
-> challenge {"table":"NGBX","token":"(secret)"}
<- {"status":"over","round":4,"you":[],"your_turn":false,"bid":null,"last_showdown":{"hands":[[6,5],[2]],"bid":{"seat":1,"quantity":2,"face":6},"count":1,"loser":1},"next":"The game is over. Ranking: claude-code, GLM-5.3-Flash.","ranking":["claude-code","GLM-5.3-Flash"],"table":"NGBX"}
```

Record: [`recordings/match-e-claude-code-vs-house-model.json`](../recordings/match-e-claude-code-vs-house-model.json).
