// Cloudflare Worker + Durable Object realtime backend for Mobu Race.

function sanitizeName(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  const s = raw.trim().slice(0, 20);
  return s || fallback;
}

// Host can only pick from these race durations; the track ring scales with it.
const TIME_STEPS = [10, 20, 30, 60, 90, 120];

function snapTimeStep(v, dflt = 60) {
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
  const timeSec = snapTimeStep(payload?.timeSec, 60);
  return { names, timeSec };
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

export class RaceRoom {
  constructor(ctx) {
    this.ctx = ctx;
    this.users = new Map();
    this.gameState = 'idle';
    this.setup = { names: [], timeSec: 60 };
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
    this.broadcast({ type: 'race_start', timeSec, racers, plan, winnerId: this.race.winnerId });

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
      return aTime === bTime ? b.progress - a.progress : aTime - bTime;
    });
    this.race.lastResults = results;
    this.broadcast({ type: 'race_finish', results, winnerId: this.race.winnerId });
  }

  resetToIdle() {
    this.clearRaceTimers();
    this.race = null;
    this.gameState = 'idle';
    this.broadcast({ type: 'reset', setup: { names: this.setup.names, timeSec: this.setup.timeSec } });
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
      setup: { names: this.setup.names, timeSec: this.setup.timeSec },
    };
    if (this.gameState === 'ready' && this.race) {
      welcome.ready = { timeSec: this.race.timeSec, racers: this.race.racers };
    } else if ((this.gameState === 'racing' || this.gameState === 'finished') && this.race) {
      const lastFinish = Math.max(...this.race.racers.map((racer) => this.race.plan[racer.id].at(-1)[0]));
      welcome.race = {
        timeSec: this.race.timeSec,
        racers: this.race.racers,
        plan: this.race.plan,
        elapsed: this.gameState === 'finished' ? lastFinish + 5 : (Date.now() - this.race.startAt) / 1000,
        winnerId: this.race.winnerId,
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
          this.broadcast({ type: 'setup_updated', setup: { names: this.setup.names, timeSec: this.setup.timeSec } });
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
          this.race = { timers: [], racers, timeSec: this.setup.timeSec };
          this.gameState = 'ready';
          this.broadcast({ type: 'race_created', timeSec: this.race.timeSec, racers });
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
