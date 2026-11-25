# Orbital Chess

A daily, crowd-played chess game for Reddit, built with [Devvit Web](https://developers.reddit.com/docs).

There's **one game per day**. It starts from the final position of a well-known opening (the Najdorf, the Ruy Lopez, the King's Indian, …). Players are handed positions from the game and each makes one move. The same position can be handed to several people. When they play different moves, the game branches, so by the end of the day it has grown into a tree of lines.

## Rules

- You can play as many positions per day as you like, but **never two on the same path**. A position is only offered to you if none of your earlier moves that day is above it or below it in the tree.
- Two players who make the same move from the same position share one branch.
- A position stays open until 3 moves have been played from it. Fresh positions (where nobody has moved yet) are offered most often, deeper ones a bit more. Already-played positions are offered too, so the tree keeps branching.
- Reloading returns the same position for 15 minutes, so you can't reroll until you get an easy one. **Skip** gives you another position on purpose.
- The tree stays hidden while the day runs. During the day you only see your own moves.

### Scoring (at midnight UTC)

1. Every line (leaf of the tree) gets a result. Lines that ended by checkmate, stalemate, insufficient material, threefold repetition or the 50-move rule keep that result. Lines still running at midnight are **decided on material**: a side 3 or more points ahead (P=1, N=B=3, R=5, Q=9) wins, otherwise it's a draw. The rule is `adjudicate()` in `src/server/core/game.ts`.
2. Results are added up the tree. Each move shows the combined results of every line below it (white wins / draws / black wins) and the **win rate for the side that played it**.
3. Your score for a move is that branch win rate. Your overall win rate is the average over all your scored moves. The leaderboard needs at least 5 scored moves.

Once a day is over, **Days → View tree** opens an explorer for it. You can walk the whole tree, see every move with its player count and branch win rate, and jump straight to your own moves (marked "your move", with "leads to your move" on the branches above them).

## Project layout

```
src/shared/api.ts           shared types + tree helpers (node ids encode the path: "r.e2e4.c7c5")
src/shared/openings.ts      opening list + which opening is used on which day
src/server/core/game.ts     daily tree: serving positions, path rule, moves, closing/scoring a day, stats
src/server/core/bots.ts     fake players (random legal moves), demo-data seeder, simulation, reset
src/server/core/store.ts    the Redis subset we use + an in-memory version for tests/local mode
src/server/routes/api.ts    Hono routes (/api/*), independent of Devvit
src/server/routes/scheduler.ts  00:01 UTC job that closes and scores the previous day
src/client/game.tsx         expanded view: Play / Days (tree explorer) / Leaderboard / Test data
src/client/splash.tsx       inline feed view (kept light, so no chess.js)
tools/local/                run the whole app in a normal browser, no Reddit needed
```

Days are closed by the scheduled job in `devvit.json`. As a backup, any API request also closes days that have already ended, and closing the same day twice does nothing.

## Running it

```bash
npm install

# 1) Locally, without Reddit. The data is in memory and already seeded.
npm run dev:local          # http://localhost:5173/game.html  (add ?user=bob to switch user)

# 2) On Reddit, on your own test subreddit
npm run login
npm run dev                # devvit playtest

npm run test:unit
npm run test:types && npm run lint
```

## Fake data for testing

As a moderator you can use these actions, from the subreddit's `…` menu or from the **Test data** tab in the app:

| Action | What it does |
| --- | --- |
| Seed demo data | Fake players play 4 past days plus part of today, then the past days are closed and scored. Some of the moves are made in your name, so you have a history, a win rate and a rank. |
| Simulate bot moves | Fake players make moves on today's tree. |
| Advance to next day | Moves the subreddit's game clock forward one day. Today closes, its tree is revealed and a new opening starts. This lets you test the midnight reveal without waiting. |
| Reset all data | Deletes every day, move and stat (and resets the clock). |

Fake players don't use any engine: they pick a random legal move, with a slight preference for captures.
