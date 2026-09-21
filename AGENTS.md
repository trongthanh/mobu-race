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

## Cloudflare deployment

Production is Git-connected on Cloudflare: both the Pages site and the Worker/Durable
Object are built and deployed automatically after a push. Keep the two projects aligned:

- Pages runs `pnpm run build:pages` from the repository root and publishes `dist/`.
  `MOBU_RACE_WS_URL` is a Pages build variable pointing at the Worker `/ws` endpoint.
- Workers deploy with `pnpm exec wrangler deploy --config cloudflare/wrangler.jsonc`.
  The Worker entrypoint is `cloudflare/worker.js`; its Durable Object binding and
  migrations live in `cloudflare/wrangler.jsonc`.

Do not add a separate CI deployment workflow or commit `dist/`. The `deploy:pages` and
`deploy:worker` package scripts are manual fallbacks; normal production deployment is a
Cloudflare build triggered by Git.

## Verification

- After implementing a substantial user-visible change, verify it in the browser with Chrome DevTools MCP. For a full implementation check, always hand off to a background agent pinned to `openai-codex/gpt-5.6-luna`; it must exercise the relevant flow, inspect the rendered scene, and check the console. For small, targeted changes (for example, a generator button's label, layout, or click action), do not start browser verification automatically: ask the user for confirmation first. Once confirmed, the primary agent should use Chrome DevTools MCP directly; do not delegate these quick checks.

## Layout

- `src/game-logic.js` — **pure shared game logic**: state machine (`idle | ready |
  countdown | racing | finished`), `buildPlan` / `randomSlots` re-exports, message
  handling (`ping/hello/rename/setup/create/start/reset/assign_host`), name validation,
  `progressAt`, `sanitizeSetup`, `syncVisitors` logic. No platform dependencies —
  communicates through a thin adapter object passed at construction.
- `server/index.js` — Node.js adapter: express + ws wiring around `createGameLogic`.
  Maintains the `createGameServer` export for tests. Also hosts the static file server
  and auto-start (`pnpm start`) entrypoint.
- `cloudflare/worker.js` — Cloudflare adapter: `RaceRoom` Durable Object + `WebSocketPair`
  wiring around `createGameLogic`. Entrypoint routes `/ws` to the DO.
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
  the static `public/` root. There is no bundler: Cloudflare Pages runs the lightweight
  `build:pages` step only to copy `public/` and generate the Worker endpoint config.

## Architecture rules

- **Server-authoritative sync**: every client animates the same race from the
  server-authored plan (`race_start` keyframes `[t, progress]`, linear interpolation).
  Anything that must look identical across clients (start slots, winner, parking order,
  **costumes**) derives from plan/server data — never from per-client `Math.random()`.
  Costumes are not controllable: every `create` rolls a fresh `costumeSeed` per racer and
  clients derive the outfit via `costumeFromSeed(seed)`; a racer without a seed falls back
  to `costumeSeedFromText(id|name)`, also deterministic across clients. Cosmetic
  randomness is OK only if it converges (e.g. the anti-overlap sidestep in `tick()`).
- `progressAt()` lives in `src/game-logic.js` (canonical), duplicated in `public/js/main.js`
  (client) and `tests/plan-check.mjs` — keep the three implementations identical when
  touching one.
- **Game-logic changes go in `src/game-logic.js` only**. The adapter files
  (`server/index.js`, `cloudflare/worker.js`) are just wiring — rarely need changes.
  When adding a new message type: add the handler case in `game-logic.js`, add the client
  handling in `main.js`, add the assertion in `ws-test.mjs`.
- The adapter interface (`send`, `broadcast`, `schedule`, `clearSchedule`,
  `scheduleInterval`, `clearScheduleInterval`, `now`, `uuid`) is defined at the top of
  `src/game-logic.js`. If you need a new platform capability, add it to both adapters.
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
