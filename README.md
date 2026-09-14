# Mobu Race 🦆

A real-time multiplayer 3D race game built with Three.js and Node.js (WebSocket). Chubby
giant-lipped "mobu" characters race around a countryside dirt track while visitors watch
as spectators in a cozy, tree-top-view world.

## Run

```bash
pnpm install
pnpm start          # serves on http://localhost:3000
```

Open http://localhost:3000 in one tab per participant. Tests:

```bash
pnpm test           # WebSocket protocol / race-logic integration test
node tests/plan-check.mjs   # statistical check of pack pacing, drama, no stalls
```

## How it works

- **Host** — the first visitor to connect becomes the host (👑). They can hand the host role
  to any spectator ("Make host"); if the host leaves, the earliest-connected visitor is
  promoted automatically.
- **Two-step setup** — step 1: the host types racer names (one per line) and picks the race
  duration (10/20/30/60/90/120s — the duration scales the track ring), then hits "Create
  race": the ring is rebuilt and the racers appear standing at random spots just behind the
  start line. Step 2: the host hits "Start race" for the 3-2-1 countdown, and they're off.
  A quick generator fills the field with numbered racers (001, 002, …) in one click, and
  the last setup draft is kept in localStorage and recovered the next time the host joins.
- **Race** — the server decides the winner randomly, then paces the whole pack off one
  shared baseline so racers run close together, with staggered surge bumps for challengers
  so the lead changes hands mid-race without anyone stopping or "acting". Clients animate
  from the same server-authored plan, so everyone sees the same race.
- **Finish** — the camera locks onto the winner the moment they cross the line; a big
  congratulations banner with confetti takes over while the leaderboard shows the final
  standings. The winner screen stays up until the host clicks "Back to paddock".
- **Spectators** — every visitor gets an avatar beside the start line with their screen
  name overhead. Joining mid-race syncs you into the live race.
- **Cameras** — follow the current leader; switch between Chase / Front / High / Orbit
  (drag to orbit, wheel to zoom in Orbit mode).

UI text is set in [Reddit Sans](https://fonts.google.com/specimen/Reddit+Sans) (Google
Fonts), falling back to the system sans-serif stack.

## Structure

```
server/index.js        Node + express + ws game server (host, race state machine, plans)
public/js/main.js      Client integration: connection, UI, cameras, race rendering
public/js/environment.js  Procedural cozy world (oval track, trees, houses, lights)
public/js/mobu.js      Procedural mobu racers, watcher avatars, name sprites
public/js/confetti.js  Winner celebration confetti (canvas, dependency-free)
public/index.html      UI shell (join screen, host panel, HUD, celebration)
tests/ws-test.mjs      End-to-end protocol test (host flow, plan validity, drama, results)
```
