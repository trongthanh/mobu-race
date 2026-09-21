// Cloudflare Worker + Durable Object realtime backend for Mobu Race.
import { buildPlan, maxRacersForTime, randomSlots } from '../public/js/race-plan.js';

// The worker and local server intentionally share the same plan/grid module;
// race type is presentation-only and never changes authoritative mechanics.
export { buildPlan, maxRacersForTime, randomSlots };

function sanitizeName(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  const s = raw.trim().slice(0, 20);
  return s || fallback;
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
  const names = [];
  for (const n of namesRaw) {
    if (typeof n !== 'string') continue;
    const s = n.trim().slice(0, 20);
    if (s) names.push(s);
    if (names.length >= limit) break;
  }
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



// ---------- server factory ----------

export class RaceRoom {
  constructor(ctx) {
    this.ctx = ctx;
    this.users = new Map();
    this.gameState = 'idle';
    this.setup = { names: [], timeSec: 30, raceType: 'mobu' };
    this.race = null;
    this.nextIndex = 0;
  }

  send(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const ws of this.users.keys()) if (ws.readyState === 1) ws.send(data);
  }

  userList() {
    return [...this.users.values()]
      .sort((a, b) => a.index - b.index)
      .map(({ id, name, isHost }) => ({ id, name, isHost }));
  }

  hostUser() {
    return [...this.users.values()].find((user) => user.isHost) || null;
  }

  promoteHost() {
    if (this.hostUser()) return;
    const next = [...this.users.values()].sort((a, b) => a.index - b.index)[0];
    if (!next) return;
    next.isHost = true;
    this.broadcast({ type: 'host_changed', hostId: next.id, users: this.userList() });
  }

  broadcastUsers() {
    this.broadcast({ type: 'users', users: this.userList() });
  }

  clearRaceTimers() {
    if (!this.race) return;
    for (const timer of this.race.timers || []) clearTimeout(timer);
    if (this.race.leaderTimer) clearInterval(this.race.leaderTimer);
    this.race.timers = [];
  }

  startCountdown() {
    this.gameState = 'countdown';
    this.race = this.race || { timers: [] };
    this.race.timers = [];
    let seconds = 3;
    this.broadcast({ type: 'countdown', seconds });
    const tick = () => {
      seconds -= 1;
      if (seconds >= 1) {
        this.broadcast({ type: 'countdown', seconds });
        this.race.timers.push(setTimeout(tick, 1000));
      } else {
        this.startRace();
      }
    };
    this.race.timers.push(setTimeout(tick, 1000));
  }

  startRace() {
    const { racers, timeSec } = this.race;
    const { plan, winnerIdx } = buildPlan(racers.map((racer) => racer.name), timeSec);
    this.gameState = 'racing';
    Object.assign(this.race, {
      plan,
      winnerId: `r${winnerIdx}`,
      startAt: Date.now(),
      leaderId: null,
      finished: false,
    });
    this.broadcast({ type: 'race_start', timeSec, raceType: this.race.raceType, racers, plan, winnerId: this.race.winnerId, finishParking: this.race.finishParking });

    this.race.leaderTimer = setInterval(() => {
      if (this.gameState !== 'racing' || !this.race || this.race.finished) return;
      const elapsed = (Date.now() - this.race.startAt) / 1000;
      let best = null;
      let bestProgress = -1;
      for (const racer of this.race.racers) {
        const progress = progressAt(this.race.plan[racer.id], elapsed);
        if (progress > bestProgress) {
          bestProgress = progress;
          best = racer.id;
        }
      }
      if (best && best !== this.race.leaderId) {
        this.race.leaderId = best;
        this.broadcast({ type: 'leader', racerId: best });
      }
    }, 500);

    const lastFinish = Math.max(...racers.map((racer) => plan[racer.id].at(-1)[0]));
    this.race.timers.push(setTimeout(() => this.finishRace(), lastFinish * 1000 + 600));
  }

  finishRace() {
    if (!this.race || this.race.finished) return;
    this.race.finished = true;
    if (this.race.leaderTimer) clearInterval(this.race.leaderTimer);
    this.gameState = 'finished';
    const elapsed = (Date.now() - this.race.startAt) / 1000;
    const results = this.race.racers.map((racer) => {
      const progress = progressAt(this.race.plan[racer.id], elapsed);
      const finishTime = this.race.plan[racer.id].at(-1)[0];
      return {
        id: racer.id,
        name: racer.name,
        finishTime: elapsed >= finishTime ? finishTime : null,
        progress: Number(progress.toFixed(4)),
      };
    }).sort((a, b) => {
      const aTime = a.finishTime ?? Infinity;
      const bTime = b.finishTime ?? Infinity;
      if (aTime !== bTime) return aTime - bTime;
      if (b.progress !== a.progress) return b.progress - a.progress;
      return String(a.id).localeCompare(String(b.id));
    });
    this.race.lastResults = results;
    this.broadcast({ type: 'race_finish', results, winnerId: this.race.winnerId });
  }

  resetToIdle() {
    this.clearRaceTimers();
    this.race = null;
    this.gameState = 'idle';
    this.broadcast({ type: 'reset', setup: { names: this.setup.names, timeSec: this.setup.timeSec, raceType: this.setup.raceType } });
  }

  async fetch(request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket endpoint; connect with Upgrade: websocket.', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.connect(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  connect(ws) {
    ws.accept();
    const user = {
      id: crypto.randomUUID(),
      name: `Watcher#${String(this.nextIndex + 1).padStart(2, '0')}`,
      isHost: this.users.size === 0,
      index: this.nextIndex++,
    };
    this.users.set(ws, user);

    const welcome = {
      type: 'welcome',
      id: user.id,
      isHost: user.isHost,
      users: this.userList(),
      state: this.gameState,
      setup: { names: this.setup.names, timeSec: this.setup.timeSec, raceType: this.setup.raceType },
    };
    if (this.gameState === 'ready' && this.race) {
      welcome.ready = { timeSec: this.race.timeSec, raceType: this.race.raceType, racers: this.race.racers, finishParking: this.race.finishParking };
    } else if ((this.gameState === 'racing' || this.gameState === 'finished') && this.race) {
      const lastFinish = Math.max(...this.race.racers.map((racer) => this.race.plan[racer.id].at(-1)[0]));
      welcome.race = {
        timeSec: this.race.timeSec,
        raceType: this.race.raceType,
        racers: this.race.racers,
        plan: this.race.plan,
        elapsed: this.gameState === 'finished' ? lastFinish + 5 : (Date.now() - this.race.startAt) / 1000,
        winnerId: this.race.winnerId,
        finishParking: this.race.finishParking,
      };
      if (this.gameState === 'finished') {
        welcome.results = this.race.lastResults;
        welcome.winnerId = this.race.winnerId;
      }
    }
    this.send(ws, welcome);
    this.broadcastUsers();

    ws.addEventListener('message', (event) => this.handleMessage(ws, event.data));
    ws.addEventListener('close', () => this.disconnect(ws));
    ws.addEventListener('error', () => this.disconnect(ws));
  }

  handleMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    const user = this.users.get(ws);
    if (!user) return;

    switch (msg.type) {
      case 'ping':
        this.send(ws, { type: 'pong' });
        break;
      case 'hello':
        if (!user.joined) {
          user.joined = true;
          user.name = sanitizeName(msg.name, user.name);
          if (user.isHost && this.gameState === 'idle' && RACE_TYPES.has(msg.raceType)) {
            this.setup = { ...this.setup, raceType: msg.raceType };
            this.broadcast({ type: 'setup_updated', setup: { names: this.setup.names, timeSec: this.setup.timeSec, raceType: this.setup.raceType } });
          }
          this.broadcastUsers();
        }
        break;
      case 'rename':
        user.name = sanitizeName(msg.name, user.name);
        this.broadcastUsers();
        break;
      case 'setup':
        if (user.isHost && this.gameState === 'idle') {
          this.setup = sanitizeSetup(msg);
          this.broadcast({ type: 'setup_updated', setup: { names: this.setup.names, timeSec: this.setup.timeSec, raceType: this.setup.raceType } });
        }
        break;
      case 'create':
        if (user.isHost && this.gameState === 'idle' && this.setup.names.length >= 2) {
          const slots = randomSlots(this.setup.names.length);
          const racers = this.setup.names.map((name, index) => ({
            id: `r${index}`,
            name,
            lane: index,
            slot: slots[index],
            costumeSeed: Math.floor(Math.random() * 0x100000000),
          }));
          this.clearRaceTimers();
          // Keep live clients in the same finish presentation mode: smaller
          // fields preserve finish lanes, while large fields use parking rows.
          this.race = {
            timers: [], racers, timeSec: this.setup.timeSec, raceType: this.setup.raceType,
            finishParking: racers.length <= SIMPLE_SHADOW_RACER_COUNT ? 'lanes' : 'grid',
          };
          this.gameState = 'ready';
          this.broadcast({ type: 'race_created', timeSec: this.race.timeSec, raceType: this.race.raceType, racers, finishParking: this.race.finishParking });
        }
        break;
      case 'start':
        if (user.isHost && this.gameState === 'ready') this.startCountdown();
        break;
      case 'reset':
        if (user.isHost && (this.gameState === 'ready' || this.gameState === 'finished')) this.resetToIdle();
        break;
      case 'assign_host':
        if (user.isHost) {
          for (const candidate of this.users.values()) candidate.isHost = candidate.id === msg.targetId;
          if (this.hostUser()) this.broadcast({ type: 'host_changed', hostId: msg.targetId, users: this.userList() });
        }
        break;
      default:
        break;
    }
  }

  disconnect(ws) {
    const user = this.users.get(ws);
    if (!user) return;
    this.users.delete(ws);
    if (user.isHost) this.promoteHost();
    else this.broadcastUsers();
    if (this.users.size === 0 && this.gameState !== 'idle') {
      this.clearRaceTimers();
      this.race = null;
      this.gameState = 'idle';
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') return new Response('Mobu Race realtime worker. Connect to /ws.', { status: 200 });
    const id = env.RACE_ROOM.idFromName('main');
    return env.RACE_ROOM.get(id).fetch(request);
  },
};
