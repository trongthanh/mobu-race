import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- helpers ----------
function screenName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (!name) return null;
  if (name.length > 20) return { error: 'name_too_long' };
  return { name };
}

function sameName(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}

// Host can only pick from these race durations; the track ring scales with it.
const TIME_STEPS = [10, 20, 30, 60, 90, 120];
const RACE_TYPES = new Set(['mobu', 'lake']);

function snapTimeStep(v, dflt = 30) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return TIME_STEPS.reduce((best, s) =>
    Math.abs(s - n) < Math.abs(best - n) ? s : best);
}

function sanitizeSetup(payload) {
  const namesRaw = Array.isArray(payload?.names) ? payload.names : [];
  const manualNames = [];
  for (const n of namesRaw) {
    if (typeof n !== 'string') continue;
    const s = n.trim().slice(0, 20);
    if (s) manualNames.push(s);
    if (manualNames.length >= 12) break;
  }
  const timeSec = snapTimeStep(payload?.timeSec, 30);
  const raceType = RACE_TYPES.has(payload?.raceType) ? payload.raceType : 'mobu';
  return { manualNames, syncVisitors: Boolean(payload?.syncVisitors), timeSec, raceType };
}

// Linear interpolation of plan keyframes [[t, progress], ...] at time t.
function progressAt(plan, t) {
  if (!plan || plan.length === 0) return 0;
  if (t <= plan[0][0]) return plan[0][1];
  for (let i = 1; i < plan.length; i++) {
    if (t <= plan[i][0]) {
      const [t0, p0] = plan[i - 1];
      const [t1, p1] = plan[i];
      const span = t1 - t0;
      if (span <= 0) return p1;
      return p0 + ((p1 - p0) * (t - t0)) / span;
    }
  }
  return plan[plan.length - 1][1];
}

// smoothstep 0..1, clamped
function smoothstep(x) {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

// Build race plan with pack pacing: the winner is decided up front, then every
// racer is paced off the SAME baseline so the pack runs close together and
// temporary leads read as real racing, not standing around waiting to be passed.
//
//   progress_i(t) = t / finishT_i + offset_i(t / timeSec)
//
// - finishT: winner crosses exactly at timeSec; the closest rival trails by
//   0.8%..1.2%, the rest by 1.2%..3%, so finishers cross at full speed one
//   after another but every racer stays close enough to contend for the lead.
// - offset: a small smooth wobble (±0.3%) plus 1-3 scheduled "surge bumps" for
//   EVERY racer, centered at staggered moments so the lead swaps frequently
//   and even the last-seeded runner can briefly lead. Bumps are snapped onto
//   keyframe samples so a surge is always fully visible.
// - Offsets fade in at the start (the pack leaves the line together) and are
//   zero before the finish (the sprint settles the final order).
export function buildPlan(names, timeSec) {
  const n = names.length;
  const winnerIdx = Math.floor(Math.random() * n);

  // Shuffle all non-winner indices so gap tiers are assigned at random,
  // not by order-of-appearance (which always puts the same names behind).
  const others = [];
  for (let i = 0; i < n; i++) if (i !== winnerIdx) others.push(i);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }

  // Tighter gaps so even the last racer can catch up with a surge.
  // Tiers: first third (close challengers), second third (mid pack),
  // last third (tail) — but all within ~3% of the winner so any surge
  // that peaks at ~3.5% can briefly take the lead.
  const finishTimes = new Array(n).fill(0);
  finishTimes[winnerIdx] = timeSec;
  others.forEach((idx, k) => {
    const frac = k / others.length; // 0..1 across the non-winner field
    const gap = frac < 1 / 3
      ? 0.008 + Math.random() * 0.005   // closest third: 0.8%..1.3%
      : frac < 2 / 3
      ? 0.013 + Math.random() * 0.007   // middle third: 1.3%..2.0%
      : 0.020 + Math.random() * 0.010;  // tail third: 2.0%..3.0%
    finishTimes[idx] = timeSec * (1 + gap);
  });

  // Keyframe sampling: shared fixed times, interpolated linearly client-side.
  // Dense enough that even the winner's final sprint stays visible.
  const K = Math.min(64, Math.max(12, Math.round(timeSec / 1.5)));

  // ---- Surge bumps for EVERY racer ----
  // Each racer gets 1-2 bumps (tail racers always get 2 so they have a
  // realistic chance to appear up front). Bumps are staggered in time so
  // lead changes cascade rather than clump. Amplitude always exceeds the
  // worst baseline gap (3%) plus wobble (0.3%), so every surge is visible.
  const mkBump = (center) => {
    const width = Math.min(0.30, Math.max(0.26, (5 + Math.random() * 3) / timeSec));
    const amp = 0.035 + Math.random() * 0.010;
    return { center, width, amp };
  };
  const bumps = new Map(); // racerIdx -> [{center, width, amp}]
  // Assign bump slots spread across the race: each racer gets a primary
  // slot and possibly a secondary. The winner gets a late bump too (to
  // be on top before the dip-sprint).
  for (let i = 0; i < n; i++) {
    const list = [];
    // Primary slot: spread evenly across 0.12..0.78
    const slot = 0.12 + (0.66 * (i + 0.5)) / n;
    const b1 = mkBump(slot);
    b1.center = Math.min(b1.center, 0.86 - b1.width / 2);
    list.push(b1);
    // Secondary bump: tail racers (including some front-runners) get a
    // second surge later in the race for extra drama. The winner also gets
    // one so they're fighting back before the dip.
    const needsSecond = i === winnerIdx || i >= n - Math.ceil(n / 3) || i % 2 === 0;
    if (needsSecond) {
      const b2 = mkBump(slot + 0.20 + Math.random() * 0.10);
      const minC = slot + (b1.width + b2.width) / 2 + 0.04 + 1 / K;
      const maxC = 0.86 - b2.width / 2;
      if (minC <= maxC) {
        b2.center = Math.min(Math.max(b2.center, minC), maxC);
        list.push(b2);
      }
    }
    bumps.set(i, list);
  }

  // Snap bump peaks onto sampled keyframes so a surge is never missed.
  for (const list of bumps.values()) {
    for (const b of list) {
      b.center = Math.min(Math.round(b.center * K) / K, 0.86 - b.width);
    }
  }

  // ---- Final drama ----
  // The winner eases back into the pack over the last stretch (never leading
  // late), then sprints off the dip to retake the lead right before the line.
  // Depth exceeds the worst gap (3%) plus faded wobble, so the winner is
  // genuinely behind late; ramp widths scale with race duration so short
  // races still have room for the dip while long races get more drama.
  const dipEps = Math.min(0.07, Math.max(0.01, 0.7 / timeSec));
  const dipTOut = Math.min(0.25, Math.max(2.5 / timeSec, 0.07));
  const dipTIn = Math.min(0.35, Math.max(5.0 / timeSec, 0.155));
  const dipEnd = 1 - dipEps;
  const dipStart = dipEnd - dipTOut - dipTIn;
  const dipDepth = 0.035 + Math.random() * 0.008;

  // Per-racer background wobble, fixed for the whole race.
  const wobble = new Map(); // racerIdx -> {amp, w, phase}
  for (let i = 0; i < n; i++) {
    wobble.set(i, {
      amp: 0.0015 + Math.random() * 0.0020,
      w: 0.6 + Math.random() * 1.0,
      phase: Math.random() * Math.PI * 2,
    });
  }

  function offsetAt(i, f) {
    let o = 0;
    const bl = bumps.get(i);
    if (bl) {
      for (const b of bl) {
        const x = (f - b.center) / b.width;
        if (Math.abs(x) <= 0.5) o += b.amp * Math.cos(Math.PI * x) ** 2;
      }
    }
    if (i === winnerIdx && f > dipStart && f < dipEnd) {
      o -= dipDepth * smoothstep((f - dipStart) / dipTIn) * smoothstep((dipEnd - f) / dipTOut);
    }
    const wb = wobble.get(i);
    const env = smoothstep(f / 0.08) * smoothstep((1 - f) / 0.1);
    o += wb.amp * Math.sin(2 * Math.PI * (wb.w * f + wb.phase)) * env;
    return o;
  }

  const plan = {};
  for (let i = 0; i < n; i++) {
    const finishT = finishTimes[i];
    const rate = timeSec / finishT; // winner: 1, others: slightly < 1
    const kfs = [];
    let prev = 0;
    for (let k = 0; k <= K; k++) {
      const f = k / K;
      // offset(f=1) is exactly 0, so the winner lands on 1.0 at timeSec and
      // the others on 1-gap; no special-casing needed.
      let p = f * rate + offsetAt(i, f);
      p = Math.max(p, prev); // defensively monotonic
      prev = p;
      kfs.push([Number((f * timeSec).toFixed(3)), Number(p.toFixed(4))]);
    }
    if (i !== winnerIdx) {
      // Constant-pace run-in from just behind the line (t=timeSec) to their
      // own finish: same speed as the race, so nobody slows to a crawl.
      kfs.push([Number(finishT.toFixed(3)), 1]);
    }
    plan['r' + i] = kfs;
  }

  return { plan, winnerIdx };
}

// Random starting spots just behind the start line. With big fields, spreading
// racers across lanes would push them off the dirt, so everyone gets a random
// spot inside the lane band (±3.3 of the 4.4 half-band) instead of a lane slot.
function randomSlots(count) {
  const slots = [];
  let minDist = 1.7;
  for (let i = 0; i < count; i++) {
    let slot = null;
    for (let tries = 0; tries < 80; tries++) {
      if (tries === 40) minDist = 1.0; // relax spacing for big fields
      const cand = {
        lateral: (Math.random() * 2 - 1) * 3.3,
        behind: 0.5 + Math.random() * 4.5,
      };
      slot = cand;
      const ok = slots.every((s) =>
        Math.hypot(s.lateral - cand.lateral, (s.behind - cand.behind) * 1.3) >= minDist);
      if (ok) break;
    }
    slots.push(slot);
  }
  return slots;
}

// ---------- server factory ----------
export function createGameServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });

  // ---- game state ----
  const users = new Map(); // ws -> user {id, name, isHost, joinedAt, index}
  let state = 'idle'; // idle | ready | countdown | racing | finished
  let setup = { manualNames: [], syncVisitors: false, timeSec: 30, raceType: 'mobu' };
  let race = null; // {timers, racers+slots, timeSec, plan, winnerId, startAt, leaderId, leaderTimer, lastResults}

  const send = (ws, obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };
  const broadcast = (obj) => {
    const data = JSON.stringify(obj);
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  };
  const userList = () =>
    [...users.values()]
      .sort((a, b) => a.index - b.index)
      .map((u) => ({ id: u.id, name: u.name, isHost: u.isHost }));

  const hostUser = () => [...users.values()].find((u) => u.isHost) || null;

  // Visitor names are server-derived so every client gets the same roster and
  // a reconnect, rename, or host transfer cannot leave stale racer names behind.
  function setupSnapshot() {
    const syncedNames = setup.syncVisitors
      ? [...users.values()].filter((u) => !u.isHost).sort((a, b) => a.index - b.index).map((u) => u.name)
      : [];
    const names = syncedNames.concat(setup.manualNames).slice(0, 12);
    return {
      names,
      manualNames: setup.manualNames,
      syncedNames: syncedNames.slice(0, 12),
      syncVisitors: setup.syncVisitors,
      timeSec: setup.timeSec,
      raceType: setup.raceType,
    };
  }

  function broadcastSetup() {
    broadcast({ type: 'setup_updated', setup: setupSnapshot() });
  }

  function promoteHost() {
    if (hostUser()) return;
    const next = [...users.values()].sort((a, b) => a.index - b.index)[0];
    if (!next) return;
    next.isHost = true;
    broadcast({ type: 'host_changed', hostId: next.id, users: userList() });
    if (setup.syncVisitors) broadcastSetup();
  }

  function broadcastUsers() {
    broadcast({ type: 'users', users: userList() });
    if (setup.syncVisitors) broadcastSetup();
  }

  function clearRaceTimers() {
    if (!race) return;
    for (const t of race.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    race.timers = [];
  }

  function startCountdown() {
    state = 'countdown';
    race = race || { timers: [] };
    race.timers = [];
    let s = 3;
    broadcast({ type: 'countdown', seconds: s });
    const tick = () => {
      s -= 1;
      if (s >= 1) {
        broadcast({ type: 'countdown', seconds: s });
        race.timers.push(setTimeout(tick, 1000));
      } else {
        startRace();
      }
    };
    race.timers.push(setTimeout(tick, 1000));
  }

  function startRace() {
    const racers = race.racers;
    const timeSec = race.timeSec;
    const { plan, winnerIdx } = buildPlan(racers.map((r) => r.name), timeSec);
    state = 'racing';
    race.plan = plan;
    race.winnerId = 'r' + winnerIdx;
    race.startAt = Date.now();
    race.leaderId = null;
    race.finished = false;

    broadcast({ type: 'race_start', timeSec, raceType: race.raceType, racers, plan, winnerId: race.winnerId });

    // leader tick every 500ms
    const leaderTimer = setInterval(() => {
      if (state !== 'racing' || !race || race.finished) return;
      const elapsed = (Date.now() - race.startAt) / 1000;
      let best = null;
      let bestP = -1;
      for (const r of race.racers) {
        const p = progressAt(race.plan[r.id], elapsed);
        if (p > bestP) {
          bestP = p;
          best = r.id;
        }
      }
      if (best && best !== race.leaderId) {
        race.leaderId = best;
        broadcast({ type: 'leader', racerId: best });
      }
    }, 500);
    race.leaderTimer = leaderTimer;

    // Results once everyone is in: with pack pacing the field finishes within
    // ~2% of the winner, so this is a short beat after the winner crosses.
    const lastFinish = Math.max(...race.racers.map((r) => race.plan[r.id][race.plan[r.id].length - 1][0]));
    race.timers.push(setTimeout(finishRace, lastFinish * 1000 + 600));
  }

  function finishRace() {
    if (!race || race.finished) return;
    race.finished = true;
    if (race.leaderTimer) clearInterval(race.leaderTimer);
    state = 'finished';
    const elapsed = (Date.now() - race.startAt) / 1000;
    const results = race.racers.map((r) => {
      const p = progressAt(race.plan[r.id], elapsed);
      const ft = race.plan[r.id][race.plan[r.id].length - 1][0];
      const finished = elapsed >= ft;
      return {
        id: r.id,
        name: r.name,
        finishTime: finished ? ft : null,
        progress: Number(p.toFixed(4)),
      };
    });
    results.sort((a, b) => {
      const fa = a.finishTime === null ? Infinity : a.finishTime;
      const fb = b.finishTime === null ? Infinity : b.finishTime;
      if (fa !== fb) return fa - fb;
      return b.progress - a.progress;
    });
    broadcast({ type: 'race_finish', results, winnerId: race.winnerId });
    race.lastResults = results;
    // Stay on the winner screen until the host clicks "Back to paddock".
  }

  function resetToIdle() {
    clearRaceTimers();
    if (race && race.leaderTimer) clearInterval(race.leaderTimer);
    race = null;
    state = 'idle';
    broadcast({ type: 'reset', setup: setupSnapshot() });
  }

  // ---- connection handling ----
  let nextIndex = 0;

  wss.on('connection', (ws) => {
    const user = {
      id: crypto.randomUUID(),
      name: 'Watcher#' + String(nextIndex + 1).padStart(2, '0'),
      isHost: users.size === 0,
      index: nextIndex++,
    };
    users.set(ws, user);

    const welcome = {
      type: 'welcome',
      id: user.id,
      isHost: user.isHost,
      users: userList(),
      state,
      setup: setupSnapshot(),
    };
    // Late joiners catch up to whatever stage the race is at.
    if (state === 'ready' && race) {
      welcome.ready = { timeSec: race.timeSec, raceType: race.raceType, racers: race.racers };
    } else if ((state === 'racing' || state === 'finished') && race) {
      const elapsed = state === 'finished'
        ? Math.max(...race.racers.map((r) => race.plan[r.id][race.plan[r.id].length - 1][0])) + 5
        : (Date.now() - race.startAt) / 1000;
      welcome.race = {
        timeSec: race.timeSec,
        raceType: race.raceType,
        racers: race.racers,
        plan: race.plan,
        elapsed,
        winnerId: race.winnerId,
      };
      if (state === 'finished') {
        welcome.results = race.lastResults;
        welcome.winnerId = race.winnerId;
      }
    }
    send(ws, welcome);
    broadcastUsers();

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // invalid JSON: ignore
      }
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'ping':
          send(ws, { type: 'pong' });
          return;
        case 'hello':
          if (!user.joined) {
            user.joined = true;
            const result = screenName(msg.name);
            if (result?.error) send(ws, { type: 'error', code: result.error, message: 'Screen names can be at most 20 characters.' });
            else if (result?.name && [...users.values()].some((u) => u !== user && sameName(u.name, result.name))) {
              send(ws, { type: 'error', code: 'name_taken', message: 'That screen name is already in use.' });
            } else if (result?.name) user.name = result.name;
            if (user.isHost && state === 'idle' && RACE_TYPES.has(msg.raceType)) {
              setup = { ...setup, raceType: msg.raceType };
              broadcastSetup();
            }
            broadcastUsers();
          }
          return;
        case 'rename': {
          const result = screenName(msg.name);
          if (result?.error) send(ws, { type: 'error', code: result.error, message: 'Screen names can be at most 20 characters.' });
          else if (!result?.name) send(ws, { type: 'error', code: 'invalid_name', message: 'Enter a screen name.' });
          else if ([...users.values()].some((u) => u !== user && sameName(u.name, result.name))) {
            send(ws, { type: 'error', code: 'name_taken', message: 'That screen name is already in use.' });
          } else {
            user.name = result.name;
            broadcastUsers();
          }
          return;
        }
        case 'setup': {
          if (!user.isHost || state !== 'idle') return;
          setup = sanitizeSetup(msg);
          broadcastSetup();
          return;
        }
        case 'create': {
          // Step 1 of the setup: lock the field and put the racers on the line.
          const roster = setupSnapshot().names;
          if (!user.isHost || state !== 'idle' || roster.length < 2) return;
          const slots = randomSlots(roster.length);
          // Costumes are not controllable: every create rolls a fresh random
          // seed per racer and clients derive the outfit from it, so all
          // clients see the same (re)shuffled wardrobe.
          const racers = roster.map((name, i) => ({
            id: 'r' + i,
            name,
            lane: i,
            slot: slots[i],
            costumeSeed: Math.floor(Math.random() * 0x100000000),
          }));
          clearRaceTimers();
          race = { timers: [], racers, timeSec: setup.timeSec, raceType: setup.raceType };
          state = 'ready';
          broadcast({ type: 'race_created', timeSec: race.timeSec, raceType: race.raceType, racers });
          return;
        }
        case 'start': {
          // Step 2: countdown, then the pack runs.
          if (!user.isHost || state !== 'ready') return;
          startCountdown();
          return;
        }
        case 'reset': {
          // Back to setup from the line, or back to the paddock after a race.
          if (!user.isHost || (state !== 'ready' && state !== 'finished')) return;
          resetToIdle();
          return;
        }
        case 'assign_host': {
          if (!user.isHost) return;
          for (const [w, u] of users) {
            if (u.id === msg.targetId) {
              for (const o of users.values()) o.isHost = false;
              u.isHost = true;
              broadcast({ type: 'host_changed', hostId: u.id, users: userList() });
              if (setup.syncVisitors) broadcastSetup();
              return;
            }
          }
          return;
        }
        default:
          return; // unknown types ignored
      }
    });

    ws.on('close', () => {
      const wasHost = user.isHost;
      users.delete(ws);
      if (wasHost) promoteHost();
      else broadcastUsers();
      if (users.size === 0 && state !== 'idle') {
        // nobody left: abort race immediately
        clearRaceTimers();
        if (race && race.leaderTimer) clearInterval(race.leaderTimer);
        race = null;
        state = 'idle';
      }
    });
  });

  return { wss, state: () => state, users };
}

// ---------- auto-start ----------
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const app = express();
  app.use(express.static(path.resolve(__dirname, '../public')));
  const httpServer = http.createServer(app);
  createGameServer(httpServer);
  const port = process.env.PORT || 3000;
  httpServer.listen(port, () => {
    console.log(`Mobu Race server listening on http://localhost:${port}`);
  });
}
