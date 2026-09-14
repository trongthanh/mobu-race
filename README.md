# Mobu Race 🦆

A real-time multiplayer 3D race game built with Three.js and Node.js (WebSocket). Chubby
giant-lipped "mobu" characters race around a countryside dirt track while visitors watch
as spectators in a cozy, tree-top-view world.

## Run

```bash
npm install
npm start          # serves on http://localhost:3000
```

Open http://localhost:3000 in one tab per participant. Tests:

```bash
npm test           # WebSocket protocol / race-logic integration test
node tests/plan-check.mjs   # statistical check of pack pacing, drama, no stalls
```

## How it works

- **Host** — the first visitor to connect becomes the host (👑). They enter racer names
  (one per line) and pick the race duration from fixed steps (10/20/30/60/90/120s) — the
  duration scales the length of the track. They can hand the host role to any spectator
  ("Make host"); if the host leaves, the earliest-connected visitor is promoted
  automatically.
- **Race** — the server decides the winner randomly, then paces the whole pack off one
  shared baseline so racers run close together, with staggered surge bumps for challengers
  so the lead changes hands mid-race without anyone stopping or "acting". Clients animate
  from the same server-authored plan, so everyone sees the same race.
- **Spectators** — every visitor gets an avatar beside the start line with their screen
  name overhead. Joining mid-race syncs you into the live race.
- **Cameras** — follow the current leader; switch between Chase / Front / High / Orbit
  (drag to orbit, wheel to zoom in Orbit mode).

## Structure

```
server/index.js        Node + express + ws game server (host, race state machine, plans)
public/js/main.js      Client integration: connection, UI, cameras, race rendering
public/js/environment.js  Procedural cozy world (oval track, trees, houses, lights)
public/js/mobu.js      Procedural mobu racers, watcher avatars, name sprites
public/index.html      UI shell (join screen, host panel, HUD, results)
tests/ws-test.mjs      End-to-end protocol test (host flow, plan validity, drama, results)
```
