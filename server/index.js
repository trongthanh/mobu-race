import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- helpers ----------
function sanitizeName(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  const s = raw.trim().slice(0, 20);
  return s || fallback;
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
  const names = [];
  for (const n of namesRaw) {
    if (typeof n !== 'string') continue;
    const s = n.trim().slice(0, 20);
    if (s) names.push(s);
    if (names.length >= 12) break;
  }
  const timeSec = snapTimeStep(payload?.timeSec, 30);
  const raceType = RACE_TYPES.has(payload?.raceType) ? payload.raceType : 'mobu';
  return { names, timeSec, raceType };
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
// - finishT: winner crosses exactly at timeSec; challengers trail by 0.2%..0.5%,
//   the rest by 0.6%..2%, so finishers cross at full speed one after another.
// - offset: a small smooth wobble (±0.5%) plus 1-2 scheduled "surge bumps" for
//   up to 3 challengers, centered at staggered mid-race moments so the lead
//   changes hands several times. Bumps are snapped onto keyframe samples so a
//   surge is always fully visible.
// - Offsets fade in at the start (the pack leaves the line together) and are
//   zero before the finish (the sprint settles the final order).
export function buildPlan(names, timeSec) {
  const n = names.length;
  const winnerIdx = Math.floor(Math.random() * n);

  const others = [];
  for (let i = 0; i < n; i++) if (i !== winnerIdx) others.push(i);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }

  const challengerCount = Math.min(3, others.length);
  const finishTimes = new Array(n).fill(0);
  finishTimes[winnerIdx] = timeSec;
  others.forEach((idx, k) => {
    const gap = k < challengerCount
      ? 0.012 + Math.random() * 0.013 // challengers: 1.2%..2.5% behind
      : 0.025 + Math.random() * 0.035; // rest: 2.5%..6% behind
    finishTimes[idx] = timeSec * (1 + gap);
  });

  // Keyframe sampling: shared fixed times, interpolated linearly client-side.
  // Dense enough that even the winner's final sprint stays visible.
  const K = Math.min(64, Math.max(12, Math.round(timeSec / 1.5)));

  // Surge bumps: challenger k surges around its own staggered slot, so lead
  // handoffs happen one at a time; some challengers get a second, later bump.
  // All bumps end before the final stretch (f=0.86). Peaks always beat the
  // worst-case baseline gap (2.5%·slot) plus wobble (1%), so every surge
  // takes the lead; width keeps the bump edges from braking below ~0.5x pace.
  const mkBump = (center) => {
    const width = Math.min(0.3, Math.max(0.28, (5 + Math.random() * 3) / timeSec));
    const amp = 0.032 + Math.random() * 0.008;
    return { center, width, amp };
  };
  const bumps = new Map(); // racerIdx -> [{center, width, amp}]
  for (let k = 0; k < challengerCount; k++) {
    const list = [];
    const slot = 0.16 + (0.62 * (k + 0.5)) / challengerCount; // ~0.2 .. 0.72
    const b1 = mkBump(slot);
    b1.center = Math.min(b1.center, 0.86 - b1.width / 2);
    list.push(b1);
    if (k % 2 === 0 || challengerCount === 1) {
      const b2 = mkBump(slot + 0.26 + Math.random() * 0.08);
      // keep it only if it fits between bump 1 and the final sprint without
      // overlapping it (stacked bumps would spike the pace)
      const minC = slot + (b1.width + b2.width) / 2 + 0.04 + 1 / K;
      const maxC = 0.86 - b2.width / 2;
      if (minC <= maxC) {
        b2.center = Math.min(Math.max(b2.center, minC), maxC);
        list.push(b2);
      }
    }
    bumps.set(others[k], list);
  }

  // Snap bump peaks onto sampled keyframes so a surge is never missed.
  for (const list of bumps.values()) {
    for (const b of list) {
      b.center = Math.min(Math.round(b.center * K) / K, 0.86 - b.width);
    }
  }

  // Final drama: the winner eases back into the pack over the last few
  // seconds (never leading late), then sprints off the dip to retake the
  // lead right before the line. Depth always exceeds the worst challenger
  // gap (2.5%) plus faded wobble, so the winner is genuinely behind late;
  // ramp widths cap the entry at ~0.65x pace and the exit at ~1.8x sprint.
  const dipEps = Math.min(0.07, Math.max(0.01, 0.7 / timeSec)); // cruise to the line after the sprint
  const dipTOut = Math.min(0.2, Math.max(2.2 / timeSec, 0.07)); // sprint ramp
  const dipTIn = Math.min(0.3, Math.max(4.5 / timeSec, 0.155)); // settle-in ramp
  const dipEnd = 1 - dipEps;
  const dipStart = dipEnd - dipTOut - dipTIn;
  const dipDepth = 0.03 + Math.random() * 0.006;

  // Per-racer background wobble, fixed for the whole race.
  const wobble = new Map(); // racerIdx -> {amp, w, phase}
  for (let i = 0; i < n; i++) {
    wobble.set(i, {
      amp: 0.002 + Math.random() * 0.003,
      w: 0.8 + Math.random() * 0.8,
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
      // settle back, then sprint off the sharp exit ramp
      o -= dipDepth * smoothstep((f - dipStart) / dipTIn) * smoothstep((dipEnd - f) / dipTOut);
    }
    // wobble faded in at the start and out before the finish
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
  let setup = { names: [], timeSec: 30, raceType: 'mobu' };
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

  function promoteHost() {
    if (hostUser()) return;
    const next = [...users.values()].sort((a, b) => a.index - b.index)[0];
    if (!next) return;
    next.isHost = true;
    broadcast({ type: 'host_changed', hostId: next.id, users: userList() });
  }

  function broadcastUsers() {
    broadcast({ type: 'users', users: userList() });
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
    broadcast({ type: 'reset', setup: { names: setup.names, timeSec: setup.timeSec, raceType: setup.raceType } });
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
      setup: { names: setup.names, timeSec: setup.timeSec, raceType: setup.raceType },
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
            user.name = sanitizeName(msg.name, user.name);
            if (user.isHost && state === 'idle' && RACE_TYPES.has(msg.raceType)) {
              setup = { ...setup, raceType: msg.raceType };
              broadcast({ type: 'setup_updated', setup: { names: setup.names, timeSec: setup.timeSec, raceType: setup.raceType } });
            }
            broadcastUsers();
          }
          return;
        case 'rename':
          user.name = sanitizeName(msg.name, user.name);
          broadcastUsers();
          return;
        case 'setup': {
          if (!user.isHost || state !== 'idle') return;
          setup = sanitizeSetup(msg);
          broadcast({ type: 'setup_updated', setup: { names: setup.names, timeSec: setup.timeSec, raceType: setup.raceType } });
          return;
        }
        case 'create': {
          // Step 1 of the setup: lock the field and put the racers on the line.
          if (!user.isHost || state !== 'idle' || setup.names.length < 2) return;
          const slots = randomSlots(setup.names.length);
          // Costumes are not controllable: every create rolls a fresh random
          // seed per racer and clients derive the outfit from it, so all
          // clients see the same (re)shuffled wardrobe.
          const racers = setup.names.map((name, i) => ({
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
