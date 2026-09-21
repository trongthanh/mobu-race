// Shared game-logic state machine, extracted from the Node.js and Cloudflare
// Worker servers.  This module is pure logic — it never touches a WebSocket,
// HTTP server, or platform API directly.  Instead it calls back into a thin
// adapter interface passed at construction time:
//
//   Adapter {
//     send(peer, msg)       – send one JSON-serialisable object
//     broadcast(msg)        – send to every connected peer
//     schedule(fn, ms)      – setTimeout equivalent, returns a timer id
//     clearSchedule(id)     – clearTimeout equivalent
//     scheduleInterval(fn, ms) – setInterval equivalent, returns a timer id
//     clearScheduleInterval(id)
//     now()                 – Date.now() equivalent
//     uuid()                – returns a fresh unique string
//   }
//
// The caller owns the adapter and is responsible for calling connect() /
// disconnect() / handleMessage() as peers arrive and send data.
// ---------------------------------------------------------------------------
// Exports: createGameLogic,  progressAt
// (buildPlan / maxRacersForTime / randomSlots are re-exported from race-plan)

import { buildPlan, maxRacersForTime, randomSlots } from '../public/js/race-plan.js';

export { buildPlan, maxRacersForTime, randomSlots };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sameName(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}

/** Host can only pick from these race durations; the track ring scales with it. */
const TIME_STEPS = [10, 20, 30, 60, 90, 120];
const RACE_TYPES = new Set(['mobu', 'lake']);
/** Keep live finish presentation aligned with the client shadow/LOD threshold. */
const SIMPLE_SHADOW_RACER_COUNT = 20;

function snapTimeStep(v, dflt = 30) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return TIME_STEPS.reduce((best, s) =>
    Math.abs(s - n) < Math.abs(best - n) ? s : best);
}

function screenName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (!name) return null;
  if (name.length > 20) return { error: 'name_too_long' };
  return { name };
}

// ---------------------------------------------------------------------------
// Linear interpolation of plan keyframes [[t, progress], …] at time t.
// Duplicated in client (main.js), server (game-logic.js), and plan-check.
// Keep the three implementations identical when touching one.
// ---------------------------------------------------------------------------

export function progressAt(plan, t) {
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

// ---------------------------------------------------------------------------
// Game logic factory
// ---------------------------------------------------------------------------

/**
 * Create a pure game-logic controller.
 *
 * @param {object} adapter  – platform adapter (see interface above)
 * @returns {object} { connect, disconnect, handleMessage, getState }
 */
export function createGameLogic(adapter) {
  // ---- game state ----
  const users = new Map(); // peer -> { id, name, isHost, joinedAt, index }
  let state = 'idle';       // idle | ready | countdown | racing | finished
  let setup = { manualNames: [], syncVisitors: false, timeSec: 30, raceType: 'mobu' };
  let race = null;          // { timers, racers, timeSec, raceType, plan, winnerId,
                             //   startAt, leaderId, leaderTimer, lastResults, finishParking }
  let nextIndex = 0;

  // ---- internal helpers ----

  const userList = () =>
    [...users.values()]
      .sort((a, b) => a.index - b.index)
      .map((u) => ({ id: u.id, name: u.name, isHost: u.isHost }));

  const hostUser = () => [...users.values()].find((u) => u.isHost) || null;

  function setupSnapshot() {
    const limit = maxRacersForTime(setup.timeSec);
    const syncedNames = setup.syncVisitors
      ? [...users.values()].filter((u) => !u.isHost)
          .sort((a, b) => a.index - b.index)
          .map((u) => u.name)
          .slice(0, limit)
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
    adapter.broadcast({ type: 'setup_updated', setup: setupSnapshot() });
  }

  function promoteHost() {
    if (hostUser()) return;
    const next = [...users.values()].sort((a, b) => a.index - b.index)[0];
    if (!next) return;
    next.isHost = true;
    adapter.broadcast({ type: 'host_changed', hostId: next.id, users: userList() });
    if (setup.syncVisitors) broadcastSetup();
  }

  function broadcastUsers() {
    adapter.broadcast({ type: 'users', users: userList() });
    if (setup.syncVisitors) broadcastSetup();
  }

  function clearRaceTimers() {
    if (!race) return;
    for (const t of race.timers) {
      adapter.clearSchedule(t);
    }
    if (race.leaderTimer) adapter.clearScheduleInterval(race.leaderTimer);
    race.timers = [];
  }

  function startCountdown() {
    state = 'countdown';
    race = race || { timers: [] };
    race.timers = [];
    let s = 3;
    adapter.broadcast({ type: 'countdown', seconds: s });
    const tick = () => {
      s -= 1;
      if (s >= 1) {
        adapter.broadcast({ type: 'countdown', seconds: s });
        race.timers.push(adapter.schedule(tick, 1000));
      } else {
        startRace();
      }
    };
    race.timers.push(adapter.schedule(tick, 1000));
  }

  function startRace() {
    const racers = race.racers;
    const timeSec = race.timeSec;
    const { plan, winnerIdx } = buildPlan(racers.map((r) => r.name), timeSec);
    state = 'racing';
    race.plan = plan;
    race.winnerId = 'r' + winnerIdx;
    race.startAt = adapter.now();
    race.leaderId = null;
    race.finished = false;

    adapter.broadcast({
      type: 'race_start',
      timeSec,
      raceType: race.raceType,
      racers,
      plan,
      winnerId: race.winnerId,
      finishParking: race.finishParking,
    });

    // leader tick every 500ms
    const leaderTimer = adapter.scheduleInterval(() => {
      if (state !== 'racing' || !race || race.finished) return;
      const elapsed = (adapter.now() - race.startAt) / 1000;
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
        adapter.broadcast({ type: 'leader', racerId: best });
      }
    }, 500);
    race.leaderTimer = leaderTimer;

    // Results once everyone is in: with pack pacing the field finishes within
    // ~2% of the winner, so this is a short beat after the winner crosses.
    const lastFinish = Math.max(
      ...race.racers.map((r) => race.plan[r.id][race.plan[r.id].length - 1][0]),
    );
    race.timers.push(adapter.schedule(finishRace, lastFinish * 1000 + 600));
  }

  function finishRace() {
    if (!race || race.finished) return;
    race.finished = true;
    if (race.leaderTimer) adapter.clearScheduleInterval(race.leaderTimer);
    state = 'finished';
    const elapsed = (adapter.now() - race.startAt) / 1000;
    const results = race.racers
      .map((r) => {
        const p = progressAt(race.plan[r.id], elapsed);
        const ft = race.plan[r.id][race.plan[r.id].length - 1][0];
        const finished = elapsed >= ft;
        return {
          id: r.id,
          name: r.name,
          finishTime: finished ? ft : null,
          progress: Number(p.toFixed(4)),
        };
      })
      .sort((a, b) => {
        const fa = a.finishTime === null ? Infinity : a.finishTime;
        const fb = b.finishTime === null ? Infinity : b.finishTime;
        if (fa !== fb) return fa - fb;
        if (b.progress !== a.progress) return b.progress - a.progress;
        return String(a.id).localeCompare(String(b.id));
      });
    adapter.broadcast({ type: 'race_finish', results, winnerId: race.winnerId });
    race.lastResults = results;
  }

  function resetToIdle() {
    clearRaceTimers();
    if (race && race.leaderTimer) adapter.clearScheduleInterval(race.leaderTimer);
    race = null;
    state = 'idle';
    adapter.broadcast({ type: 'reset', setup: setupSnapshot() });
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

  // ---- public interface ----

  function connect(peer) {
    const user = {
      id: adapter.uuid(),
      name: 'Watcher#' + String(nextIndex + 1).padStart(2, '0'),
      isHost: users.size === 0,
      index: nextIndex++,
    };
    users.set(peer, user);

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
      welcome.ready = {
        timeSec: race.timeSec,
        raceType: race.raceType,
        racers: race.racers,
        finishParking: race.finishParking,
      };
    } else if ((state === 'racing' || state === 'finished') && race) {
      const elapsed =
        state === 'finished'
          ? Math.max(
              ...race.racers.map((r) => race.plan[r.id][race.plan[r.id].length - 1][0]),
            ) + 5
          : (adapter.now() - race.startAt) / 1000;
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
    adapter.send(peer, welcome);
    broadcastUsers();
  }

  function disconnect(peer) {
    const user = users.get(peer);
    if (!user) return;
    const wasHost = user.isHost;
    users.delete(peer);
    if (wasHost) promoteHost();
    else broadcastUsers();
    if (users.size === 0 && state !== 'idle') {
      clearRaceTimers();
      if (race && race.leaderTimer) adapter.clearScheduleInterval(race.leaderTimer);
      race = null;
      state = 'idle';
    }
  }

  function handleMessage(peer, msg) {
    if (!msg || typeof msg.type !== 'string') return;
    const user = users.get(peer);
    if (!user) return;

    switch (msg.type) {
      case 'ping':
        adapter.send(peer, { type: 'pong' });
        return;
      case 'hello':
        if (!user.joined) {
          user.joined = true;
          const result = screenName(msg.name);
          if (result?.error) {
            adapter.send(peer, {
              type: 'error',
              code: result.error,
              message: 'Screen names can be at most 20 characters.',
            });
          } else if (
            result?.name &&
            [...users.values()].some(
              (u) => u !== user && sameName(u.name, result.name),
            )
          ) {
            adapter.send(peer, {
              type: 'error',
              code: 'name_taken',
              message: 'That screen name is already in use.',
            });
          } else if (result?.name) {
            user.name = result.name;
          }
          if (user.isHost && state === 'idle' && RACE_TYPES.has(msg.raceType)) {
            setup = { ...setup, raceType: msg.raceType };
            broadcastSetup();
          }
          broadcastUsers();
        }
        return;
      case 'rename': {
        const result = screenName(msg.name);
        if (result?.error) {
          adapter.send(peer, {
            type: 'error',
            code: result.error,
            message: 'Screen names can be at most 20 characters.',
          });
        } else if (!result?.name) {
          adapter.send(peer, {
            type: 'error',
            code: 'invalid_name',
            message: 'Enter a screen name.',
          });
        } else if (
          [...users.values()].some(
            (u) => u !== user && sameName(u.name, result.name),
          )
        ) {
          adapter.send(peer, {
            type: 'error',
            code: 'name_taken',
            message: 'That screen name is already in use.',
          });
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
        const roster = setupSnapshot().names;
        if (!user.isHost || state !== 'idle' || roster.length < 2) return;
        const slots = randomSlots(roster.length);
        const racers = roster.map((name, i) => ({
          id: 'r' + i,
          name,
          lane: i,
          slot: slots[i],
          costumeSeed: Math.floor(Math.random() * 0x100000000),
        }));
        clearRaceTimers();
        race = {
          timers: [],
          racers,
          timeSec: setup.timeSec,
          raceType: setup.raceType,
          finishParking:
            racers.length <= SIMPLE_SHADOW_RACER_COUNT ? 'lanes' : 'grid',
        };
        state = 'ready';
        adapter.broadcast({
          type: 'race_created',
          timeSec: race.timeSec,
          raceType: race.raceType,
          racers,
          finishParking: race.finishParking,
        });
        return;
      }
      case 'start': {
        if (!user.isHost || state !== 'ready') return;
        startCountdown();
        return;
      }
      case 'reset': {
        if (!user.isHost || (state !== 'ready' && state !== 'finished')) return;
        resetToIdle();
        return;
      }
      case 'assign_host': {
        if (!user.isHost) return;
        for (const [w, u] of users) {
          u.isHost = u.id === msg.targetId;
        }
        adapter.broadcast({
          type: 'host_changed',
          hostId: msg.targetId,
          users: userList(),
        });
        if (setup.syncVisitors) broadcastSetup();
        return;
      }
      default:
        return; // unknown types ignored
    }
  }

  function getState() {
    return { state, users, setup, race };
  }

  return { connect, disconnect, handleMessage, getState };
}
