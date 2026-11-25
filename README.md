# Orbital Chess

A Reddit game built with [Devvit Web](https://developers.reddit.com/docs). It's chess, but you get exactly **one move per game**. Then the board goes to the next player. Play as many boards as you like and try to get the highest win rate.

## Rules

- When you open the game you're given a board that's waiting for a move. You play whichever side is to move.
- You can move only once in any game. After you move, the board goes to someone else.
- Your win rate only changes when a game you played in **ends**. Until then the move counts as "waiting".
  - Win rate = wins ÷ finished games. Draws count as a finished game that isn't a win.
- A game ends by checkmate, stalemate, insufficient material, threefold repetition, the 50-move rule, or after 200 plies (a draw).
- **My moves** lists every game you played in. You can open any of them to replay it, jump to your move, analyze the position on Lichess or copy the PGN.
- **Leaderboard** ranks players by win rate. You need at least 5 finished games to appear on it.

### Fairness
- A board is reserved for you for 3 minutes, and reloading gives you the **same** board. You can't reroll until you get a position you like.
- You can **Skip** a board on purpose. This hands you a different one.
- The boards that have waited longest are handed out first, so every game keeps moving.
- Each ply is claimed atomically (`HSETNX`), so two players can never both make the same move number.

## Project layout

```
src/shared/api.ts           request/response types shared by client and server
src/server/core/game.ts     game logic: matchmaking, move validation (chess.js), game end, stats, leaderboard
src/server/core/bots.ts     fake players: a tiny 1-ply engine, demo-data seeder, bot simulation, reset
src/server/core/store.ts    the Redis subset we use + an in-memory implementation for tests/local mode
src/server/routes/api.ts    Hono routes (/api/*), independent of Devvit
src/server/index.ts         Devvit wiring (redis, reddit user, moderator check)
src/client/game.tsx         expanded view: Play / My moves / Leaderboard / Test data
src/client/splash.tsx       inline feed view (kept light, so no chess.js)
tools/local/                run the whole app in a normal browser, no Reddit needed
```

## Running it

```bash
npm install

# 1) Locally, without Reddit. The data is in memory and already seeded.
npm run dev:local          # http://localhost:5173/game.html  (add ?user=bob to switch user)

# 2) On Reddit, on your own test subreddit
npm run login
npm run dev                # devvit playtest

npm run test:unit          # game-logic tests
npm run test:types && npm run lint
```

## Fake data for testing

As a moderator you can use these actions, from the subreddit's `…` menu or from the **Test data** tab in the app:

| Action | What it does |
| --- | --- |
| Seed demo data | Creates 24 fake games with about 240 fake players. You're added to about two thirds of them, so *My moves*, your win rate and the leaderboard fill up straight away. |
| Simulate bot moves | Fake players move on open boards (boards a human has reserved are skipped). Use it to watch your waiting games finish and your win rate change. |
| Reset all data | Deletes every game and every stat. |

In local mode the store is seeded automatically for the user `you`.

## Chess engines

Moves are validated by **[chess.js](https://github.com/jhlywa/chess.js)** (BSD-2), on both the server and the client. It isn't an engine.

There are free engine options:

1. **Lichess (already wired in).** *Analyze on Lichess* opens the position you're looking at in Lichess's free Stockfish analysis board. *Copy PGN* copies the whole game for import at lichess.org/paste. Devvit shows a confirmation before it opens an external link.
2. **Stockfish in the browser:** the [`stockfish`](https://www.npmjs.com/package/stockfish) npm package (Stockfish compiled to WebAssembly). It runs on the player's device at no cost. The "lite single-threaded" build is about 7 MB, so load it only in the expanded view (never in the splash). Note that Stockfish is **GPL-3.0**: if you ship it in the app bundle, the app has to be distributed under GPL terms too.
3. **Lichess cloud-eval API** (`GET https://lichess.org/api/cloud-eval?fen=…`): free precomputed evaluations for common positions. Calling it from the Devvit server means adding `lichess.org` to the HTTP allow-list in `devvit.json`, and Reddit has to approve that domain.
4. **A homemade engine:** `src/server/core/bots.ts` already has a tiny one-ply evaluator for the fake players. A small alpha-beta search on top of chess.js would give stronger bots, still MIT/BSD and with no dependency.

Some ways an engine could be used: a "move quality" score next to each entry in *My moves* (best, good, inaccuracy, blunder), an eval bar in the replay viewer, or bots that keep quiet boards moving.
