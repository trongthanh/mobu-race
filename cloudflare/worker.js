// Cloudflare Worker + Durable Object realtime backend for Mobu Race.

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
    this.broadcast({ type: 'race_start', timeSec, raceType: this.race.raceType, racers, plan, winnerId: this.race.winnerId });

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
      welcome.ready = { timeSec: this.race.timeSec, raceType: this.race.raceType, racers: this.race.racers };
    } else if ((this.gameState === 'racing' || this.gameState === 'finished') && this.race) {
      const lastFinish = Math.max(...this.race.racers.map((racer) => this.race.plan[racer.id].at(-1)[0]));
      welcome.race = {
        timeSec: this.race.timeSec,
        raceType: this.race.raceType,
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
          this.race = { timers: [], racers, timeSec: this.setup.timeSec, raceType: this.setup.raceType };
          this.gameState = 'ready';
          this.broadcast({ type: 'race_created', timeSec: this.race.timeSec, raceType: this.race.raceType, racers });
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
