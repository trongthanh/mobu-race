import http from 'node:http';
import assert from 'node:assert';
import { createGameServer } from '../server/index.js';
import { WebSocket } from 'ws';

const STEP_TIMEOUT = 20000;
const GLOBAL_TIMEOUT = setTimeout(() => {
  console.error('FAIL: global 60s timeout');
  process.exit(1);
}, 60000);

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.messages = [];
    ws.waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const w = ws.waiters.find((x) => x.match(msg));
      if (w) {
        ws.waiters.splice(ws.waiters.indexOf(w), 1);
        w.resolve(msg);
      } else {
        ws.messages.push(msg);
      }
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitFor(ws, match, desc, timeout = STEP_TIMEOUT) {
  const idx = ws.messages.findIndex(match);
  if (idx !== -1) return Promise.resolve(ws.messages.splice(idx, 1)[0]);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const i = ws.waiters.indexOf(w);
      if (i !== -1) ws.waiters.splice(i, 1);
      reject(new Error(`Timeout waiting for ${desc}`));
    }, timeout);
    const w = {
      match,
      resolve: (msg) => {
        clearTimeout(t);
        resolve(msg);
      },
    };
    ws.waiters.push(w);
  });
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

async function main() {
  const port = await getFreePort();
  const httpServer = http.createServer();
  createGameServer(httpServer);
  await new Promise((r) => httpServer.listen(port, '127.0.0.1', r));
  console.log(`STEP 0: server listening on port ${port}`);

  // 1. three clients connect
  const A = await connect(port);
  const welcomeA = await waitFor(A, (m) => m.type === 'welcome', 'welcome A');
  assert.strictEqual(welcomeA.isHost, true, 'A should be host');
  console.log('STEP 1a: A connected, isHost=true OK');

  const B = await connect(port);
  const welcomeB = await waitFor(B, (m) => m.type === 'welcome', 'welcome B');
  assert.strictEqual(welcomeB.isHost, false, 'B should not be host');
  const C = await connect(port);
  const welcomeC = await waitFor(C, (m) => m.type === 'welcome', 'welcome C');
  assert.strictEqual(welcomeC.isHost, false, 'C should not be host');
  console.log('STEP 1b: B and C connected, isHost=false OK');

  // 2. B renames (drain stale users broadcasts from connect first)
  await new Promise((r) => setTimeout(r, 100));
  for (const ws of [A, B, C]) ws.messages.length = 0;
  send(B, { type: 'rename', name: 'Bee' });
  for (const [ws, label] of [[A, 'A'], [B, 'B'], [C, 'C']]) {
    const u = await waitFor(ws, (m) => m.type === 'users' && m.users.some((x) => x.name === 'Bee'), `users on ${label}`);
    const bee = u.users.find((x) => x.id === welcomeB.id);
    assert.ok(bee, 'B in user list');
    assert.strictEqual(bee.name, 'Bee');
  }
  console.log('STEP 2: rename -> users broadcast with new name OK');

  // 3. A setup
  send(A, { type: 'setup', names: ['Alpha', 'Beta', 'Gamma'], timeSec: 20 });
  for (const [ws, label] of [[A, 'A'], [B, 'B'], [C, 'C']]) {
    const s = await waitFor(ws, (m) => m.type === 'setup_updated', `setup_updated on ${label}`);
    assert.deepStrictEqual(s.setup.names, ['Alpha', 'Beta', 'Gamma']);
    assert.strictEqual(s.setup.timeSec, 20);
  }
  console.log('STEP 3: setup -> setup_updated broadcast OK');

  // 3b. A creates the race (step 1 of the two-step flow): racers go on the
  // line at random slots behind the start line, race waits in 'ready'.
  send(A, { type: 'create' });
  const creations = [];
  for (const [ws, label] of [[A, 'A'], [B, 'B'], [C, 'C']]) {
    const rc = await waitFor(ws, (m) => m.type === 'race_created', `race_created on ${label}`);
    creations.push(rc);
  }
  const rc = creations[0];
  assert.strictEqual(rc.timeSec, 20);
  assert.strictEqual(rc.racers.length, 3);
  assert.deepStrictEqual(rc.racers.map((r) => r.lane).sort(), [0, 1, 2]);
  for (const r of rc.racers) {
    assert.strictEqual(r.lane, Number(r.id.slice(1)), 'lane matches rN');
    assert.ok(r.slot, 'racer has a start slot');
    assert.ok(Number.isFinite(r.slot.lateral) && Math.abs(r.slot.lateral) <= 3.3, 'lateral stays on the dirt');
    assert.ok(Number.isFinite(r.slot.behind) && r.slot.behind >= 0.5 && r.slot.behind <= 5, 'starts behind the line');
  }
  console.log('STEP 3b: create -> race_created with slots OK');

  // 4. A start (step 2) -> countdown 3,2,1 then race_start
  send(A, { type: 'start' });
  for (const [ws, label] of [[A, 'A'], [B, 'B'], [C, 'C']]) {
    const c3 = await waitFor(ws, (m) => m.type === 'countdown' && m.seconds === 3, `countdown 3 on ${label}`);
    assert.strictEqual(c3.seconds, 3);
    const c2 = await waitFor(ws, (m) => m.type === 'countdown' && m.seconds === 2, `countdown 2 on ${label}`);
    const c1 = await waitFor(ws, (m) => m.type === 'countdown' && m.seconds === 1, `countdown 1 on ${label}`);
  }
  console.log('STEP 4a: countdown 3,2,1 OK');

  const starts = [];
  for (const [ws, label] of [[A, 'A'], [B, 'B'], [C, 'C']]) {
    const rs = await waitFor(ws, (m) => m.type === 'race_start', `race_start on ${label}`, 15000);
    starts.push(rs);
  }
  const rs = starts[0];
  assert.strictEqual(rs.timeSec, 20);
  assert.strictEqual(rs.racers.length, 3);
  assert.deepStrictEqual(rs.racers.map((r) => r.lane).sort(), [0, 1, 2]);
  for (const r of rs.racers) assert.strictEqual(r.lane, Number(r.id.slice(1)), 'lane matches rN');
  const planIds = Object.keys(rs.plan).sort();
  assert.deepStrictEqual(planIds, ['r0', 'r1', 'r2']);
  assert.ok(typeof rs.winnerId === 'string' && /^r\d+$/.test(rs.winnerId), 'winnerId present in race_start');

  // validate plans: monotonic, exactly one ends [20, 1], others later
  const finishAt20 = [];
  for (const id of planIds) {
    const kf = rs.plan[id];
    assert.ok(Array.isArray(kf) && kf.length >= 2, `plan ${id} has keyframes`);
    for (let i = 1; i < kf.length; i++) {
      assert.ok(kf[i][0] > kf[i - 1][0] || (kf[i][0] === kf[i - 1][0] && kf[i][1] >= kf[i - 1][1]), `plan ${id} monotonic`);
      assert.ok(kf[i][1] >= kf[i - 1][1], `plan ${id} progress non-decreasing`);
    }
    assert.strictEqual(kf[0][1], 0, `plan ${id} starts at 0`);
    const last = kf[kf.length - 1];
    assert.strictEqual(last[1], 1, `plan ${id} ends at progress 1`);
    if (last[0] === 20) finishAt20.push(id);
    else assert.ok(last[0] > 20 && last[0] <= 25, `plan ${id} finishTime ${last[0]} in (20, 25]`);
  }
  assert.strictEqual(finishAt20.length, 1, 'exactly one plan ends at t=20');
  const expectedWinner = finishAt20[0];
  assert.strictEqual(rs.winnerId, expectedWinner, 'race_start winnerId matches plan ending at t=20');
  console.log(`STEP 4b: race_start valid, expected winner ${expectedWinner} OK`);

  // 5. collect leader messages during race
  const leaderIds = new Set();
  const collectLeaders = (ws) => {
    ws.on('message', () => {}); // noop; handled below via polling
  };
  // Instead of intercepting, poll messages queue: leaders that don't match a waiter land in ws.messages
  const finishPromises = starts.map((_, i) =>
    waitFor([A, B, C][i], (m) => m.type === 'race_finish', `race_finish on client ${i}`, 40000)
  );
  // gather leader messages that arrived (they're buffered in ws.messages)
  const pollLeaders = setInterval(() => {
    for (const ws of [A, B, C]) {
      for (let i = ws.messages.length - 1; i >= 0; i--) {
        if (ws.messages[i].type === 'leader') {
          leaderIds.add(ws.messages[i].racerId);
          ws.messages.splice(i, 1);
        }
      }
    }
  }, 50);
  const finishes = await Promise.all(finishPromises);
  clearInterval(pollLeaders);
  // final drain
  for (const ws of [A, B, C]) {
    for (const m of ws.messages) if (m.type === 'leader') leaderIds.add(m.racerId);
  }
  console.log(`STEP 5: race finished, leader changes seen: ${[...leaderIds].join(', ')}`);
  assert.ok(leaderIds.size >= 2, `drama: at least 2 distinct leaders, got ${leaderIds.size}`);

  const f0 = finishes[0];
  assert.strictEqual(f0.winnerId, expectedWinner, 'winnerId matches plan ending at t=20');
  for (const f of finishes) {
    assert.strictEqual(f.winnerId, f0.winnerId, 'all clients see same winnerId');
    // results sorted: finishTime asc (null=Infinity last), progress desc
    for (let i = 1; i < f.results.length; i++) {
      const fa = f.results[i - 1].finishTime ?? Infinity;
      const fb = f.results[i].finishTime ?? Infinity;
      assert.ok(fa <= fb, 'results sorted by finishTime');
      if (fa === fb) assert.ok(f.results[i - 1].progress >= f.results[i].progress, 'progress desc tiebreak');
    }
    assert.strictEqual(f.results[0].id, f0.winnerId, 'winner first in results');
  }
  console.log(`STEP 6: race_finish valid, winner ${f0.winnerId}, results sorted OK`);

  // 6b. winner screen must persist: no auto-reset once the race is over
  await new Promise((r) => setTimeout(r, 800));
  for (const [ws, label] of [[A, 'A'], [B, 'B'], [C, 'C']]) {
    assert.ok(!ws.messages.some((m) => m.type === 'reset'), `no auto-reset on ${label}`);
  }
  console.log('STEP 6b: no auto-reset, winner screen persists OK');

  // 7. host transfer and new quick race
  send(A, { type: 'assign_host', targetId: welcomeB.id });
  for (const [ws, label] of [[A, 'A'], [B, 'B'], [C, 'C']]) {
    const hc = await waitFor(ws, (m) => m.type === 'host_changed', `host_changed on ${label}`);
    assert.strictEqual(hc.hostId, welcomeB.id);
  }
  console.log('STEP 7a: assign_host -> host_changed with hostId=B OK');

  send(B, { type: 'reset' });
  await waitFor(A, (m) => m.type === 'reset', 'reset broadcast', 15000);
  send(B, { type: 'setup', names: ['One', 'Two'], timeSec: 10 });
  await waitFor(A, (m) => m.type === 'setup_updated', 'setup_updated (B as host)');
  send(B, { type: 'create' });
  await waitFor(B, (m) => m.type === 'race_created' && m.timeSec === 10, 'second race_created', 15000);
  send(B, { type: 'start' });
  await waitFor(B, (m) => m.type === 'race_start' && m.timeSec === 10, 'second race_start', 15000);
  console.log('STEP 7b: B (new host) started second race with timeSec=10 OK');
  const fin2 = await waitFor(A, (m) => m.type === 'race_finish', 'second race_finish', 30000);
  assert.ok(fin2.winnerId === 'r0' || fin2.winnerId === 'r1');
  console.log('STEP 7c: second race finished OK');

  // cleanup
  A.close(); B.close(); C.close();
  clearTimeout(GLOBAL_TIMEOUT);
  httpServer.close();
  console.log('PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err && err.stack ? err.stack : err);
  clearTimeout(GLOBAL_TIMEOUT);
  process.exit(1);
});
