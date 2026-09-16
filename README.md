# Mobu Race 🦆

A real-time multiplayer 3D race game built with Three.js and Node.js (WebSocket). Chubby
giant-lipped "mobu" characters race around a countryside dirt track while visitors watch
as spectators in a cozy, tree-top-view world.

## Run

```bash
pnpm install
pnpm start          # serves on http://localhost:3000
```

Inspect the reference-based character at http://localhost:3000/mobu-lab.html: turntable,
smile slider, running and celebration poses, plus a seeded outfit preview.

Open http://localhost:3000 in one tab per participant. Or, on the welcome card, choose **Play offline in this tab** to host and run a complete private race with no WebSocket connection. Tests:

```bash
pnpm test           # WebSocket protocol / race-logic integration test
node tests/plan-check.mjs   # statistical check of pack pacing, drama, no stalls
node tests/mobu-check.mjs   # headless mobu rig invariants (MOBU.md §10)
node tests/surface-check.mjs # waves, buoyancy, duck wardrobe, foot contact, trail pools
node tests/visitor-check.mjs # seeded visitor looks, planted feet, poses, mesh budget
```

## Cloudflare Pages deployment

Yes—use **Cloudflare Pages for the static Three.js client** and the included
**Cloudflare Worker + Durable Object for the authoritative WebSocket room**. Pages alone
cannot run this project's Express/`ws` server or share live room state between visitors.

1. Authenticate, then choose a globally unique Worker name in
   `cloudflare/wrangler.jsonc` and a Pages project name (the `mobu-race` default in
   `package.json` is overridable with `CLOUDFLARE_PAGES_PROJECT`).
   ```bash
   pnpm exec wrangler login
   pnpm run deploy:worker
   ```
2. Copy the Worker URL printed by Wrangler (for example,
   `https://mobu-race-realtime.<account>.workers.dev`) and deploy the static site with it:
   ```bash
   MOBU_RACE_WS_URL=https://mobu-race-realtime.<account>.workers.dev/ws pnpm run deploy:pages
   ```
   The build converts `https` to `wss` and writes the endpoint into the generated
   `dist/config.js`; do not commit `dist/`.
3. For a Git-connected Pages project, set the Pages build command to
   `pnpm run build:pages`, build output directory to `dist`, and add
   `MOBU_RACE_WS_URL` as a Pages build variable. Deploy the Worker first.

The client retains same-origin WebSockets for `pnpm start`; `public/config.js` is its local
fallback. The production build replaces it with the Worker endpoint.

## How it works

- **Offline mode** — the welcome card can start a private, standalone race in the current tab. The browser generates the same paced race plan, countdown, grid, costumes, results and celebration locally; it never opens a WebSocket or admits spectators.
- **Host** — the first visitor to connect becomes the host (👑). They can hand the host role
  to any spectator ("Make host"); if the host leaves, the earliest-connected visitor is
  promoted automatically.
- **Choose the spectacle** — on the welcome card, pick **Lake Duck Derby** or the original
  **Countryside Mobu Dash** before joining. The host's choice is room-authoritative: late
  joiners rebuild the same course and cast.
- **Two-step setup** — step 1: the host types racer names (one per line) and picks the race
  duration (10/20/30/60/90/120s — the duration scales the track ring), then hits "Create
  race": the ring is rebuilt and the racers appear standing at random spots just behind the
  start line. Step 2: the host hits "Start race" for the 3-2-1 countdown, and they're off.
  A quick generator fills the field with numbered racers (001, 002, …) in one click, and
  the last setup draft is kept in localStorage and recovered the next time the host joins.
- **Costumes** — ducks wear fitted, continuous garments in eight themes: sailor, pirate,
  raincoat, chef, wizard, bee, lifeguard and royal, with coordinated hats, stripes,
  buttons and accessories. Mobus get nine coordinated looks (farmer, athlete, chef,
  royal, explorer, mushroom, varsity, winter stripes and party), plus occasional
  mix-and-match outfits. New overalls, jerseys, striped tees and varsity/chef jackets
  follow the egg profile; sleeves move with the arms and necklines preserve the grin.
  Outfits are not controllable: every
  "Create race" reshuffles them, seeded by the server so all clients render the same
  wardrobe. The mobu mesh and wardrobe live in `public/js/rig.js` / `public/js/mobu.js` /
  `public/js/costumes.js` (spec: `ref/MOBU.md`).
- **Race** — the server decides the winner randomly, then paces the whole pack off one
  shared baseline so racers run close together, with staggered surge bumps for challengers
  so the lead changes hands mid-race without anyone stopping or "acting". Clients animate
  from the same server-authored plan, so everyone sees the same race.
- **Surface motion** — a tessellated lake and duck buoyancy share the same analytic
  waves and normals; ducks paddle alternating webbed feet, roll gently on the water,
  lean into turns and leave expanding world-space wakes. On dirt, strides follow
  distance travelled, stance feet stay grounded, torsos absorb landings and pooled
  dust puffs fade behind the racers. Sidesteps are damped rather than snapping.
  These are lightweight visual physics, not a fluid/rigid-body simulation: the
  authoritative plan still controls positions and finish order exactly.
- **Finish** — the camera locks onto the winner the moment they cross the line; a big
  congratulations banner with confetti takes over while the leaderboard shows the final
  standings. The winner screen stays up until the host clicks "Back to paddock".
- **Spectators** — every visitor gets a soft, chibi avatar beside the start line with
  their screen name overhead. Six hairstyles and four outfits are seed-derived, with
  skin-tone variety, optional glasses/freckles, expressive eyes and small blinks.
  Articulated elbows and weight shifts make cheering lively without floating feet.
  Joining mid-race syncs you into the live race.
- **Cameras** — follow the current leader; switch between Chase / Front / High / Orbit
  (drag to orbit, wheel to zoom in Orbit mode).

UI text is set in [Reddit Sans](https://fonts.google.com/specimen/Reddit+Sans) (Google
Fonts), falling back to the system sans-serif stack.

## Structure

```
server/index.js        Node + express + ws game server (host, race state machine, plans)
public/js/main.js      Client integration: online/offline control, UI, cameras, race rendering
public/js/race-plan.js Shared offline race-plan and start-grid generator
public/js/environment.js  Procedural cozy world (oval track, trees, houses, lights)
public/js/surface.js   Shared wave sampler, tessellated lake, bounded wake/dust pools
public/js/duck.js      Buoyant duck rig and swim/celebration poses
public/js/duck-costumes.js  Eight seeded, fitted duck costume themes
public/js/rig.js       Mobu rig spec: canonical measurements, egg profile, materials
public/js/mobu.js      Smooth Mobu rig + expressive pose engine, name sprites, visitor API
public/js/mobu-mouth.js Closed sculpted lips with a smile position/normal morph target
public/mobu-lab.html   Model studio: turntable, smile, poses and outfit inspection
public/js/visitors.js  Soft chibi spectators, seeded appearance, articulated cheering
public/js/costumes.js  Mix-and-match wardrobe (pants/top/head/face) + randomizer
public/js/confetti.js  Winner celebration confetti (canvas, dependency-free)
public/index.html      UI shell (join screen, host panel, HUD, celebration)
tests/ws-test.mjs      End-to-end protocol test (host flow, plan validity, drama, results)
tests/mobu-check.mjs   Headless mobu rig invariants (grin/head ratios, grounding, shells)
```
