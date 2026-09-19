// Race plan and grid generation shared by the online server, Cloudflare worker,
// and offline client. Race type is intentionally absent: Mobu and Duck races
// must use the same authoritative mechanics and differ only in presentation.

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
  // realistic chance to appear up front). Bumps are staggered in time so a
  // lead-change cascade reads as racing rather than a single scripted pass.
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

// Put a small front row close to the start line, then spread the rest behind
// it. With big fields, spreading racers across lanes would push them off the
// dirt, so everyone stays inside the lane band (±3.3 of the 4.4 half-band)
// instead of getting a fixed lane slot.
export function randomSlots(count) {
  const slots = [];
  const frontCount = Math.min(5, count);
  const frontBehind = 0.75;
  // A paced front row uses the available lane band instead of clustering by
  // chance in the middle. Shuffle the positions so roster order is not also
  // the visual left-to-right order.
  const frontHalf = Math.min(3.1, 0.85 * Math.max(0, frontCount - 1));
  const frontLaterals = Array.from({ length: frontCount }, (_, i) =>
    frontCount === 1 ? 0 : -frontHalf + (2 * frontHalf * i) / (frontCount - 1));
  for (let i = frontLaterals.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [frontLaterals[i], frontLaterals[j]] = [frontLaterals[j], frontLaterals[i]];
  }

  let minDist = 1.7;
  for (let i = 0; i < count; i++) {
    let slot = null;
    for (let tries = 0; tries < 80; tries++) {
      if (tries === 40) minDist = 1.0; // relax spacing for big fields
      const isFrontRow = i < frontCount;
      const cand = {
        lateral: isFrontRow
          ? frontLaterals[i]
          : (Math.random() * 2 - 1) * 3.3,
        // Keep the first five in a compact line by the stripe. The remaining
        // racers retain the old random feel while staying visibly behind it.
        behind: isFrontRow
          ? frontBehind
          : 1.8 + Math.random() * 3.2,
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
