# AGENTS.md — Mobu Race

Real-time multiplayer 3D race game: chubby "mobu" characters race around a procedural
cozy-countryside oval track while connected visitors watch as avatars. Three.js client
(vendored, no bundler) + Node/express/ws authoritative server. First visitor is host and
runs a two-step setup (create race → start race). See README.md for the current flow and
PLAN.md for the original brief.

## Commands

- `pnpm install` — pnpm exclusively (no npm/yarn).
- `pnpm start` — serve on http://localhost:3000 (`PORT` env to override).
- `pnpm test` — `tests/ws-test.mjs`: end-to-end WS protocol test (host flow, plan
  validity, leader drama, results). Update it whenever server messages/state change.
- `node tests/plan-check.mjs` — statistical check of race-plan pacing (imports
  `buildPlan` from the server; keep that export intact).
- `node tests/mobu-check.mjs` — headless mobu rig invariants from `ref/MOBU.md` §10
  (grin/head ratios, grounded feet, ~3.75 canonical height, garment shells, pose
  finiteness). Run it after touching `rig.js` / `mobu.js` / `costumes.js`.

## Verification

- After implementing a user-visible change, verify it in the browser with Chrome DevTools MCP. For a full implementation check, always hand off to a background agent pinned to `openai-codex/gpt-5.6-luna`; it must exercise the relevant flow, inspect the rendered scene, and check the console. For a quick check, the primary agent may call Chrome DevTools MCP directly.

## Layout

- `server/index.js` — everything server-side: host role, state machine
  (`idle | ready | countdown | racing | finished`), `buildPlan` (winner pre-decided, pack
  paced off one baseline with surge bumps), start slots (random lateral/behind meters),
  and costume-spec passthrough (validated structurally only — slot ids are client-side).
- `public/js/main.js` — client: WS handling, race scene, cameras, HUD, localStorage.
- `public/js/environment.js` — procedural world; `lanePoint(progress, lateral)` takes
  **meters from the centerline** (lane band is ±4.4; keep racers within ±3.3).
- `public/js/rig.js` — canonical mobu measurements, egg-profile math (`radiusAt(y)`),
  memoised materials. Ported from `ref/MOBU.md` — keep the relationship invariants there
  intact (`HIP_R > HEAD_R`, `LIP_R = 1.1 × HEAD_R`, `DY ≈ 0.60 × R`).
- `public/js/mobu.js` — mobu mesh + pose engine (lathed egg, two-sausage grin), watcher
  avatars, name sprites, `disposeRig`. Racers are built in canonical units (3.75 tall)
  and scaled by `MOBU_SCALE` as ONE unit.
- `public/js/costumes.js` — mix-and-match wardrobe: pants / top / head / face slots,
  each `[itemId, paletteIndex]`; `applyCostume`, `randomCostume`, seed-based outfits.
- `public/js/confetti.js` — winner celebration (dependency-free canvas).
- `public/vendor/three.module.js` — vendored Three.js; clients load plain ES modules from
  the static `public/` root — there is no build step, don't introduce one.

## Architecture rules

- **Server-authoritative sync**: every client animates the same race from the
  server-authored plan (`race_start` keyframes `[t, progress]`, linear interpolation).
  Anything that must look identical across clients (start slots, winner, parking order,
  **costumes**) derives from plan/server data — never from per-client `Math.random()`.
  Costumes are not controllable: every `create` rolls a fresh `costumeSeed` per racer and
  clients derive the outfit via `costumeFromSeed(seed)`; a racer without a seed falls back
  to `costumeSeedFromText(id|name)`, also deterministic across clients. Cosmetic
  randomness is OK only if it converges (e.g. the anti-overlap sidestep in `tick()`).
- `progressAt()` exists duplicated in server, client, and plan-check — keep the
  implementations identical when touching one.
- Server state machine and message types are asserted by `tests/ws-test.mjs`; the winner
  screen persists until the host sends `reset` (allowed in `ready` and `finished` only).
- Racer track position maps plan progress via
  `dispP = -startFrac + p * (1 + startFrac)` so racers start behind the line and cross
  exactly on plan time. Finished racers park past the line in leaderboard order —
  the winner coasts farthest, the last finisher stops right by it (cooldown parade),
  and the winner celebrates (`setCelebrating`) once parked; a
  lateral separation pass keeps mobus from merging.
- `rebuildWorld(timeSec)` recreates the scene (track scale follows race duration);
  racers/watchers must be re-added to the new scene afterwards.

## Client conventions

- UI font is Reddit Sans (Google Fonts link) with system-sans fallback; name sprites use
  the same stack in canvas. Reddit Sans has tall metrics — Chrome gives number inputs a
  ~40px natural height, so paired controls need explicit equal heights.
- localStorage keys (all guarded with try/catch): `mobu-race:setup-draft` (names +
  duration, restored once for a host facing an empty setup) and
  `mobu-race:visitor-name`.
- Cozy game aesthetic: cream panels, chunky borders, gold/amber accents — match existing
  CSS patterns in `public/css/style.css` rather than restyling.
- WS client auto-reconnects after 1.2s; on host disconnect the server promotes the
  earliest visitor. Late joiners sync into whatever stage is current via `welcome`
  payloads (ready/racing/finished all carry enough data to rebuild).
