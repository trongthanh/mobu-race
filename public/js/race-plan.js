// Race plan and grid generation shared by the online server and offline client.

function smoothstep(x) {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

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
      ? 0.012 + Math.random() * 0.013
      : 0.025 + Math.random() * 0.035;
    finishTimes[idx] = timeSec * (1 + gap);
  });
  const K = Math.min(64, Math.max(12, Math.round(timeSec / 1.5)));

  const mkBump = (center) => ({
    center,
    width: Math.min(0.3, Math.max(0.28, (5 + Math.random() * 3) / timeSec)),
    amp: 0.032 + Math.random() * 0.008,
  });
  const bumps = new Map();
  for (let k = 0; k < challengerCount; k++) {
    const list = [];
    const slot = 0.16 + (0.62 * (k + 0.5)) / challengerCount;
    const b1 = mkBump(slot);
    b1.center = Math.min(b1.center, 0.86 - b1.width / 2);
    list.push(b1);
    if (k % 2 === 0 || challengerCount === 1) {
      const b2 = mkBump(slot + 0.26 + Math.random() * 0.08);
      const minC = slot + (b1.width + b2.width) / 2 + 0.04 + 1 / K;
      const maxC = 0.86 - b2.width / 2;
      if (minC <= maxC) {
        b2.center = Math.min(Math.max(b2.center, minC), maxC);
        list.push(b2);
      }
    }
    bumps.set(others[k], list);
  }
  for (const list of bumps.values()) {
    for (const b of list) b.center = Math.min(Math.round(b.center * K) / K, 0.86 - b.width);
  }

  const dipEps = Math.min(0.07, Math.max(0.01, 0.7 / timeSec));
  const dipTOut = Math.min(0.2, Math.max(2.2 / timeSec, 0.07));
  const dipTIn = Math.min(0.3, Math.max(4.5 / timeSec, 0.155));
  const dipEnd = 1 - dipEps;
  const dipStart = dipEnd - dipTOut - dipTIn;
  const dipDepth = 0.03 + Math.random() * 0.006;
  const wobble = new Map();
  for (let i = 0; i < n; i++) {
    wobble.set(i, {
      amp: 0.002 + Math.random() * 0.003,
      w: 0.8 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
    });
  }

  function offsetAt(i, f) {
    let o = 0;
    for (const b of bumps.get(i) || []) {
      const x = (f - b.center) / b.width;
      if (Math.abs(x) <= 0.5) o += b.amp * Math.cos(Math.PI * x) ** 2;
    }
    if (i === winnerIdx && f > dipStart && f < dipEnd) {
      o -= dipDepth * smoothstep((f - dipStart) / dipTIn) * smoothstep((dipEnd - f) / dipTOut);
    }
    const wb = wobble.get(i);
    const env = smoothstep(f / 0.08) * smoothstep((1 - f) / 0.1);
    return o + wb.amp * Math.sin(2 * Math.PI * (wb.w * f + wb.phase)) * env;
  }

  const plan = {};
  for (let i = 0; i < n; i++) {
    const finishT = finishTimes[i];
    const rate = timeSec / finishT;
    const kfs = [];
    let prev = 0;
    for (let k = 0; k <= K; k++) {
      const f = k / K;
      const p = Math.max(f * rate + offsetAt(i, f), prev);
      prev = p;
      kfs.push([Number((f * timeSec).toFixed(3)), Number(p.toFixed(4))]);
    }
    if (i !== winnerIdx) kfs.push([Number(finishT.toFixed(3)), 1]);
    plan[`r${i}`] = kfs;
  }
  return { plan, winnerIdx };
}

export function randomSlots(count) {
  const slots = [];
  let minDist = 1.7;
  for (let i = 0; i < count; i++) {
    let slot = null;
    for (let tries = 0; tries < 80; tries++) {
      if (tries === 40) minDist = 1.0;
      const cand = {
        lateral: (Math.random() * 2 - 1) * 3.3,
        behind: 0.5 + Math.random() * 4.5,
      };
      slot = cand;
      if (slots.every((s) => Math.hypot(s.lateral - cand.lateral, (s.behind - cand.behind) * 1.3) >= minDist)) break;
    }
    slots.push(slot);
  }
  return slots;
}
