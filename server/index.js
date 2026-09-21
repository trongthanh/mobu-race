import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer } from 'ws';
import { buildPlan, maxRacersForTime, randomSlots } from '../public/js/race-plan.js';

// Keep the server export stable for tests and downstream callers while sharing
// the exact plan/grid implementation with the browser and Cloudflare worker.
export { buildPlan, maxRacersForTime, randomSlots };

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
// Keep live finish presentation aligned with the client shadow/LOD threshold.
const SIMPLE_SHADOW_RACER_COUNT = 20;

function snapTimeStep(v, dflt = 30) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return TIME_STEPS.reduce((best, s) =>
    Math.abs(s - n) < Math.abs(best - n) ? s : best);
}

function sanitizeSetup(payload) {
  const timeSec = snapTimeStep(payload?.timeSec, 30);
  const limit = maxRacersForTime(timeSec);
  const namesRaw = Array.isArray(payload?.names) ? payload.names : [];
  const manualNames = [];
  for (const n of namesRaw) {
    if (typeof n !== 'string') continue;
    const s = n.trim().slice(0, 20);
    if (s) manualNames.push(s);
    if (manualNames.length >= limit) break;
  }
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
    const limit = maxRacersForTime(setup.timeSec);
    const syncedNames = setup.syncVisitors
      ? [...users.values()].filter((u) => !u.isHost).sort((a, b) => a.index - b.index).map((u) => u.name).slice(0, limit)
      : [];
    const names = syncedNames.concat(setup.manualNames).slice(0, limit);
    return {
      names,
      manualNames: setup.manualNames.slice(0, limit),
      syncedNames,
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

    broadcast({ type: 'race_start', timeSec, raceType: race.raceType, racers, plan, winnerId: race.winnerId, finishParking: race.finishParking });

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
      if (b.progress !== a.progress) return b.progress - a.progress;
      return String(a.id).localeCompare(String(b.id));
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
      welcome.ready = { timeSec: race.timeSec, raceType: race.raceType, racers: race.racers, finishParking: race.finishParking };
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
        finishParking: race.finishParking,
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
          // The finish formation is server-authored so every live client
          // preserves lanes for a small field and uses the same grid otherwise.
          race = {
            timers: [], racers, timeSec: setup.timeSec, raceType: setup.raceType,
            finishParking: racers.length <= SIMPLE_SHADOW_RACER_COUNT ? 'lanes' : 'grid',
          };
          state = 'ready';
          broadcast({ type: 'race_created', timeSec: race.timeSec, raceType: race.raceType, racers, finishParking: race.finishParking });
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
  const publicDir = path.resolve(__dirname, '../public');
  app.use(express.static(publicDir));
  // The solo game is the default route; /live intentionally serves the same
  // client shell, which switches to its WebSocket-only experience by path.
  app.get(['/live', '/live/'], (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  const httpServer = http.createServer(app);
  createGameServer(httpServer);
  const port = Number(process.env.PORT) || 3000;
  // Bind beyond loopback so the dev server is reachable over Tailscale.
  // Override HOST when a more restrictive interface is preferred.
  const host = process.env.HOST || '0.0.0.0';
  httpServer.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`Mobu Race server listening on http://${displayHost}:${port}`);
  });
}
