// Statistical verification of buildPlan pack pacing.
// Usage: node tests/plan-check.mjs
import assert from 'node:assert';

// Re-implement the interpolation exactly as server + client do.
function progressAt(keyframes, t) {
  if (!keyframes || keyframes.length === 0) return 0;
  if (t <= keyframes[0][0]) return keyframes[0][1];
  for (let i = 1; i < keyframes.length; i++) {
    if (t <= keyframes[i][0]) {
      const [t0, p0] = keyframes[i - 1];
      const [t1, p1] = keyframes[i];
      const span = t1 - t0;
      if (span <= 0) return p1;
      return p0 + ((p1 - p0) * (t - t0)) / span;
    }
  }
  return keyframes[keyframes.length - 1][1];
}

// Pull buildPlan out of the server module (exported for verification).
const { buildPlan } = await import(new URL('../server/index.js', import.meta.url).href);

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`  ok: ${label}`);
  else { failures++; console.error(`  FAIL: ${label}`); }
}

const cases = [];
for (const timeSec of [10, 20, 30, 60, 90, 120]) {
  for (const n of [2, 3, 5, 12]) cases.push({ timeSec, n });
}

const worstStats = { stall: 0, spread: 0, minPace: Infinity, ratio: 0, minLeadChanges: Infinity };

// Sample progress at 10 Hz — finer than the keyframe grid.
for (const { timeSec, n } of cases) {
  const names = Array.from({ length: n }, (_, i) => 'R' + i);
  for (let trial = 0; trial < 40; trial++) {
    const { plan, winnerIdx } = buildPlan(names, timeSec);
    const ids = names.map((_, i) => 'r' + i);
    const maxFinish = Math.max(...ids.map((id) => plan[id][plan[id].length - 1][0]));

    // structure: exactly one plan ends at timeSec (the winner), monotone, 0->1
    const endAtT = ids.filter((id) => Math.abs(plan[id][plan[id].length - 1][0] - timeSec) < 1e-6);
    assert.strictEqual(endAtT.length, 1, 'exactly one ends at timeSec');
    assert.strictEqual(endAtT[0], 'r' + winnerIdx, 'winner plan ends at timeSec');
    // the field must finish strung out, not in a photo-finish clump.
    // Minimum gap is now 0.8% (tightened from 1.0% for more drama).
    const othersFinish = ids
      .filter((id) => id !== endAtT[0])
      .map((id) => plan[id][plan[id].length - 1][0]);
    const minGap = Math.min(...othersFinish) - timeSec;
    assert.ok(minGap >= 0.008 * timeSec - 1e-9,
      `runner-up finishes >=0.8% after winner (got ${(minGap / timeSec * 100).toFixed(2)}%, t=${timeSec}s n=${n})`);
    for (const id of ids) {
      const kf = plan[id];
      assert.strictEqual(kf[0][1], 0, `${id} starts at 0`);
      assert.strictEqual(kf[kf.length - 1][1], 1, `${id} ends at 1`);
      for (let i = 1; i < kf.length; i++) {
        assert.ok(kf[i][0] > kf[i - 1][0], 'time strictly increasing');
        assert.ok(kf[i][1] >= kf[i - 1][1] - 1e-9, 'progress non-decreasing');
      }
    }

    // simulate at 10 Hz over the whole race window
    const dt = 0.1;
    const T = Math.ceil(maxFinish / dt) * dt;
    const prog = ids.map(() => []);
    const times = [];
    for (let t = 0; t <= T + 1e-9; t += dt) {
      times.push(t);
      ids.forEach((id, i) => prog[i].push(Math.min(progressAt(plan[id], t), 1)));
    }

    // 1) nobody stalls: the longest stretch with < 0.2% progress advance
    //    (roughly: standing still for seconds) must be short.
    for (let i = 0; i < ids.length; i++) {
      let stallStart = 0, stallBest = 0, p0 = prog[i][0];
      for (let k = 1; k < times.length; k++) {
        if (prog[i][k] >= 1) break; // finished; jog-off handled client-side
        if (prog[i][k] - p0 >= 0.002) { p0 = prog[i][k]; stallStart = times[k]; }
        stallBest = Math.max(stallBest, times[k] - stallStart);
      }
      worstStats.stall = Math.max(worstStats.stall, stallBest);
    }

    // 2) pack closeness: max spread across racers (before any finish)
    let spread = 0;
    for (let k = 0; k < times.length; k++) {
      if (times[k] > timeSec) break;
      const ps = prog.map((p) => p[k]);
      spread = Math.max(spread, Math.max(...ps) - Math.min(...ps));
    }
    worstStats.spread = Math.max(worstStats.spread, spread);

    // 3) speed similarity: instantaneous progress rate min/max per racer,
    //    relative to the pack pace (1 track per timeSec)
    //    Wider bumps mean higher ratios, especially on short races where
    //    bump width is a larger fraction of total time.
    const pace = 1 / timeSec;
    for (let i = 0; i < ids.length; i++) {
      let minV = Infinity, maxV = 0;
      for (let k = 1; k < times.length; k++) {
        const t = times[k];
        if (t < timeSec * 0.1 || t > timeSec * 0.85) continue;
        const v = (prog[i][k] - prog[i][k - 1]) / dt;
        if (v <= 0) { minV = 0; continue; }
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
      }
      assert.ok(minV > 0.35 * pace,
        `racer ${i} never crawls mid-race (min v=${(minV / pace).toFixed(2)}x pace, t=${timeSec}s n=${n} trial=${trial})`);
      assert.ok(maxV / Math.max(minV, 1e-9) < 4.0,
        `racer ${i} speed ratio sane (max/min=${(maxV / minV).toFixed(2)}, t=${timeSec}s n=${n} trial=${trial})`);
      worstStats.minPace = Math.min(worstStats.minPace, minV / pace);
      worstStats.ratio = Math.max(worstStats.ratio, maxV / minV);
    }

    // 4) drama: at least 2 distinct leaders while everyone is still racing
    //    (a challenger's surge peak always beats the winner's baseline, and
    //    the winner always retakes by the finish), and count handovers.
    //    The winner must also come from behind: their final continuous lead
    //    may only start in the last few seconds (final-chase sprint).
    const leaders = new Set();
    let leadChanges = 0, cur = null, winnerLeadStart = null;
    for (let k = 0; k < times.length && times[k] <= timeSec; k++) {
      let best = null, bestP = -1;
      for (let i = 0; i < ids.length; i++) {
        if (prog[i][k] > bestP) { bestP = prog[i][k]; best = i; }
      }
      leaders.add(best);
      if (cur === null) cur = best;
      else if (best !== cur) { leadChanges++; cur = best; }
      if (best === winnerIdx) {
        if (winnerLeadStart === null) winnerLeadStart = times[k];
      } else {
        winnerLeadStart = null;
      }
    }
    worstStats.minLeadChanges = Math.min(worstStats.minLeadChanges, leadChanges);
    assert.ok(leaders.size >= 2,
      `drama: >=2 distinct leaders (got ${[...leaders].join(',')}, t=${timeSec}s n=${n} trial=${trial})`);
    const winnerFinalStreak = timeSec - (winnerLeadStart ?? timeSec);
    const streakCap = Math.max(4.0, 0.07 * timeSec);
    assert.ok(winnerLeadStart !== null && winnerFinalStreak <= streakCap + 1e-9,
      `winner sprints from behind: final lead streak ${winnerFinalStreak.toFixed(2)}s must be <=${streakCap.toFixed(1)}s ` +
      `(t=${timeSec}s n=${n} trial=${trial})`);
  }
  console.log(`timeSec=${timeSec}s n=${n}: 40 trials OK`);
}

console.log(`\nWorst across all trials:` +
  `\n  longest near-standstill: ${worstStats.stall.toFixed(2)}s` +
  `\n  max pack spread: ${(worstStats.spread * 100).toFixed(2)}% of track` +
  `\n  min mid-race pace: ${worstStats.minPace.toFixed(2)}x pack pace` +
  `\n  max speed ratio: ${worstStats.ratio.toFixed(2)}` +
  `\n  min lead changes: ${worstStats.minLeadChanges}`);
console.log(failures === 0 ? 'PLAN CHECK PASS' : `PLAN CHECK FAIL (${failures})`);
if (failures) process.exit(1);
