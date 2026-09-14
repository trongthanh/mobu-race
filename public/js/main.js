import * as THREE from '../vendor/three.module.js';
import { createWorld } from './environment.js';
import { createMobu, createWatcher, makeNameSprite } from './mobu.js';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const el = {
  join: $('join'), nameInput: $('nameInput'), joinBtn: $('joinBtn'),
  hud: $('hud'), roleBadge: $('roleBadge'),
  userList: $('userList'), userPanel: $('userPanel'), setupPanel: $('setupPanel'), waitingPanel: $('waitingPanel'),
  namesInput: $('namesInput'), timeInput: $('timeInput'), startBtn: $('startBtn'),
  setupInfo: $('setupInfo'),
  camPanel: $('camPanel'),
  raceHud: $('raceHud'), timer: $('timer'), lbList: $('lbList'), leaderboard: $('leaderboard'),
  countdown: $('countdown'), results: $('results'),
  winnerTitle: $('winnerTitle'), resultList: $('resultList'),
  backBtn: $('backBtn'), resultWaiting: $('resultWaiting'),
};
const camBtns = [...document.querySelectorAll('.cam-btn')];

// ---------- Three.js setup ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// Style must be applied BEFORE setSize: setSize writes explicit style
// width/height, and without them a fixed+inset canvas falls back to its
// intrinsic (device-pixel) size, rendering oversized on HiDPI screens.
renderer.domElement.style.cssText = 'position:fixed;inset:0;z-index:0;display:block;';
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

// Track length follows the race time set by the host (rebuilt on race_start).
function scaleForTime(timeSec) {
  return Math.min(2.6, Math.max(0.6, 0.55 + timeSec / 60));
}
let world = createWorld({ trackScale: scaleForTime(60) });
let scene = world.scene;

function rebuildWorld(timeSec) {
  scene = null;
  const next = createWorld({ trackScale: scaleForTime(timeSec) });
  world = next;
  scene = next.scene;
  // Racers/watchers were parented to the old scene — recreate them.
  for (const r of state.racers) scene.add(r.group);
  for (const [id] of state.watchers) state.watchers.delete(id);
  renderWatchers();
}

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 600);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Connection / game state ----------
const state = {
  myId: null,
  isHost: false,
  users: [],
  hostId: null,
  setup: { names: [], timeSec: 60 },
  raceState: 'idle', // idle | counting | racing | finished
  racers: [],        // {id,name,lane, mobu, sprite, progress, finishTime}
  plan: null,
  timeSec: 0,
  raceStartAt: 0,    // local clock ms (set on race_start)
  leaderId: null,
  winnerId: null,
  watchers: new Map(), // userId -> {group, animate, sprite, spot}
};

// ---------- WebSocket ----------
let ws = null;
let wsOpen = false;
let helloName = null;

function connect(name) {
  if (name !== undefined) helloName = name;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.addEventListener('open', () => {
    wsOpen = true;
    if (helloName !== null) send({ type: 'hello', name: helloName });
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handle(msg);
  });
  ws.addEventListener('close', () => {
    wsOpen = false;
    setTimeout(connect, 1200);
  });
}

function send(obj) {
  if (wsOpen && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function handle(msg) {
  switch (msg.type) {
    case 'welcome': {
      state.myId = msg.id;
      state.isHost = msg.isHost;
      state.users = msg.users;
      state.raceState = msg.state;
      state.setup = msg.setup;
      refreshSetupUI();
      refreshUserList();
      renderWatchers();
      // Late joiner catching up to a live race.
      if (msg.state === 'racing' && msg.race) {
        startRace(msg.race, msg.race.elapsed);
      }
      break;
    }
    case 'users':
      state.users = msg.users;
      state.hostId = (msg.users.find((u) => u.isHost) || {}).id;
      refreshUserList();
      refreshSetupUI();
      renderWatchers();
      break;
    case 'host_changed':
      state.users = msg.users;
      state.hostId = msg.hostId;
      state.isHost = msg.hostId === state.myId;
      refreshUserList();
      refreshSetupUI();
      renderWatchers();
      break;
    case 'setup_updated':
      state.setup = msg.setup;
      refreshSetupUI();
      break;
    case 'countdown':
      state.raceState = 'counting';
      refreshSetupUI();
      showCountdown(msg.seconds);
      break;
    case 'race_start':
      startRace(msg);
      break;
    case 'leader':
      state.leaderId = msg.racerId;
      updateLeaderboard();
      break;
    case 'race_finish':
      showResults(msg);
      break;
    case 'reset':
      state.raceState = 'idle';
      state.setup = msg.setup;
      clearRaceScene();
      refreshSetupUI();
      el.results.classList.add('hidden');
      el.raceHud.classList.add('hidden');
      break;
    default:
      break;
  }
}

// ---------- UI wiring ----------
el.joinBtn.addEventListener('click', join);
el.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

function join() {
  const name = el.nameInput.value.trim() || undefined;
  el.join.classList.add('hidden');
  el.hud.classList.remove('hidden');
  connect(name);
}

el.namesInput.addEventListener('input', sendSetup);
el.timeInput.addEventListener('input', sendSetup);
el.startBtn.addEventListener('click', () => send({ type: 'start' }));
el.backBtn.addEventListener('click', () => send({ type: 'reset' }));

let setupTimer = null;
function sendSetup() {
  clearTimeout(setupTimer);
  setupTimer = setTimeout(() => {
    const names = el.namesInput.value.split('\n').map((s) => s.trim()).filter(Boolean);
    send({ type: 'setup', names, timeSec: Number(el.timeInput.value) || 60 });
  }, 250);
}

document.querySelectorAll('#userList').forEach((ul) => {
  ul.addEventListener('click', (e) => {
    const btn = e.target.closest('.make-host');
    if (btn) send({ type: 'assign_host', targetId: btn.dataset.id });
  });
});

camBtns.forEach((b) => b.addEventListener('click', () => setCamMode(b.dataset.cam)));

function refreshSetupUI() {
  el.roleBadge.textContent = state.isHost
    ? '👑 You are the Host'
    : `Watching: ${myName()}`;
  // Keep the screen clear while a race is on: spectators/setup panel only
  // belongs to the paddock.
  const raceOn = state.raceState !== 'idle';
  el.userPanel.classList.toggle('hidden', raceOn);
  el.setupPanel.classList.toggle('hidden', !state.isHost || raceOn);
  el.waitingPanel.classList.toggle('hidden', state.isHost || raceOn);
  el.backBtn.classList.toggle('hidden', !state.isHost);
  el.resultWaiting.classList.toggle('hidden', state.isHost);
  if (state.isHost && document.activeElement !== el.namesInput) {
    el.namesInput.value = state.setup.names.join('\n');
    el.timeInput.value = state.setup.timeSec;
  }
  el.setupInfo.textContent = `${state.setup.names.length} racer${state.setup.names.length === 1 ? '' : 's'} signed up · ${state.setup.timeSec}s race`;
  el.startBtn.disabled = state.setup.names.length < 2 || state.raceState !== 'idle';
}

function myName() {
  const me = state.users.find((u) => u.id === state.myId);
  return me ? me.name : '';
}

function refreshUserList() {
  el.userList.innerHTML = '';
  for (const u of state.users) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = (u.isHost ? '👑 ' : '') + u.name + (u.id === state.myId ? ' (you)' : '');
    li.appendChild(label);
    if (state.isHost && u.id !== state.myId) {
      const btn = document.createElement('button');
      btn.className = 'make-host';
      btn.dataset.id = u.id;
      btn.textContent = 'Make host';
      li.appendChild(btn);
    }
    el.userList.appendChild(li);
  }
}

// ---------- Watcher avatars ----------
function renderWatchers() {
  // Keep existing avatars, add new ones, remove gone ones.
  const ids = new Set(state.users.map((u) => u.id));
  for (const [id, w] of state.watchers) {
    if (!ids.has(id)) {
      scene.remove(w.group);
      state.watchers.delete(id);
    }
  }
  state.users.forEach((u, i) => {
    if (state.watchers.has(u.id)) return;
    const w = createWatcher({});
    const sprite = makeNameSprite(u.name + (u.isHost ? ' 👑' : ''), { height: 0.5 });
    sprite.position.y = 2.1;
    w.group.add(sprite);
    scene.add(w.group);
    state.watchers.set(u.id, { ...w, sprite });
  });
  // Re-seat everyone so indices stay packed.
  state.users.forEach((u, i) => {
    const w = state.watchers.get(u.id);
    if (w) placeWatcher(w, i, state.users.length);
  });
}

function placeWatcher(w, index, total) {
  const t = world.track;
  // Grandstand rows on the grass just outside the start/finish straight
  // (beyond the outer rim of the track).
  const perRow = 8;
  const row = Math.floor(index / perRow);
  const col = index % perRow;
  const x = (col - (Math.min(total, perRow) - 1) / 2) * 2.2 + ((row % 2) * 1.1);
  const z = t.outerZ + 1.5 + row * 2.4;
  w.group.position.set(x, 0, z);
  w.setHeading(Math.PI); // face the track (toward -Z)
}

// ---------- Race rendering ----------
function startRace(msg, elapsedOffset = 0) {
  clearRaceScene();
  rebuildWorld(msg.timeSec);
  camFocusInit = false; // re-aim the camera at the new race without gliding
  state.raceState = 'racing';
  state.timeSec = msg.timeSec;
  state.plan = msg.plan;
  state.leaderId = msg.racers[0]?.id ?? null;
  state.raceStartAt = performance.now() - elapsedOffset * 1000;

  const totalLanes = Math.max(msg.racers.length, 1);
  const RACER_COLORS = [0xffc93c, 0xff8c42, 0x7fd8be, 0xf472b6, 0x8ab6f9, 0xb98cf7, 0xff6b6b, 0x9bd45f, 0xf9d976, 0x5fc9c2, 0xe0a3ff, 0xa0a8b0];
  let ri = 0;
  for (const r of msg.racers) {
    const mobu = createMobu({ bodyColor: RACER_COLORS[ri % RACER_COLORS.length], shortsColor: RACER_COLORS[ri % RACER_COLORS.length] });
    const { group, animate } = mobu;
    ri++;
    const sprite = makeNameSprite(r.name, { height: 0.45 });
    sprite.position.y = 2.4;
    group.add(sprite);
    // Late joiners may arrive when this racer has already finished; seed the
    // finish state from the plan so they don't replay the finish jog.
    const p0 = Math.min(progressAt(msg.plan[r.id], elapsedOffset), 1);
    const finishT = msg.plan[r.id][msg.plan[r.id].length - 1][0];
    const laneP = world.lanePoint(p0, r.lane, totalLanes);
    group.position.copy(laneP);
    mobu.setHeading(facingAt(p0, r.lane, totalLanes));
    scene.add(group);
    state.racers.push({
      ...r, group, animate, setHeading: mobu.setHeading,
      progress: p0,
      finished: p0 >= 1,
      finishElapsed: p0 >= 1 ? finishT : null,
      finishTime: null,
    });
  }

  el.raceHud.classList.remove('hidden');
  el.leaderboard.classList.remove('hidden');
  el.results.classList.add('hidden');
  el.countdown.classList.add('hidden');
  refreshSetupUI();
  updateLeaderboard();
}

function clearRaceScene() {
  for (const r of state.racers) scene.remove(r.group);
  state.racers = [];
  state.plan = null;
  state.leaderId = null;
  state.winnerId = null;
  el.raceHud.classList.add('hidden');
  el.countdown.classList.add('hidden');
}

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

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

function facingAt(progress, lane = 4, totalLanes = 8) {
  // Tangent of this racer's lane a moment ahead, so racers face along the track.
  const ahead = world.lanePoint(Math.min(progress + 0.004, 1), lane, totalLanes);
  const here = world.lanePoint(progress, lane, totalLanes);
  return Math.atan2(ahead.x - here.x, ahead.z - here.z);
}

function updateLeaderboard() {
  const rows = state.racers
    .slice()
    .sort((a, b) => b.progress - a.progress);
  el.lbList.innerHTML = '';
  rows.forEach((r, i) => {
    const li = document.createElement('li');
    li.textContent = `${i + 1}. ${r.name}${r.id === state.leaderId ? ' 🏃' : ''}${r.finished ? ' 🏁' : ''}`;
    if (i === 0) li.classList.add('first');
    el.lbList.appendChild(li);
  });
}

function showCountdown(seconds) {
  if (typeof seconds !== 'number') return;
  el.countdown.classList.remove('hidden');
  el.countdown.textContent = seconds > 0 ? seconds : 'GO!';
  if (seconds === 0) {
    setTimeout(() => el.countdown.classList.add('hidden'), 800);
  }
}

function showResults(msg) {
  state.raceState = 'finished';
  state.winnerId = msg.winnerId;
  const winner = msg.results.find((r) => r.id === msg.winnerId);
  el.winnerTitle.textContent = `🏆 ${winner ? winner.name : '???'} wins!`;
  el.resultList.innerHTML = '';
  msg.results.forEach((r, i) => {
    const li = document.createElement('li');
    const t = r.finishTime == null ? '—' : `${r.finishTime.toFixed(2)}s`;
    li.textContent = `${i + 1}. ${r.name} — ${t}`;
    if (r.id === msg.winnerId) li.classList.add('first');
    el.resultList.appendChild(li);
  });
  el.results.classList.remove('hidden');
  // The leaderboard ranks by live progress and no longer matches the final
  // placings — the results panel replaces it.
  el.leaderboard.classList.add('hidden');
  el.countdown.classList.add('hidden');
}

// ---------- Camera ----------
let camMode = 'chase';
let orbitAzimuth = Math.PI * 0.75;
let orbitElevation = 0.55;
let orbitDistance = 30;
let dragAz = 0; // user drag offset (non-orbit modes)
let dragEl = 0;
let zoom = 1; // wheel zoom (non-orbit modes)
let dragging = false;
let lastPointer = null;

// Smoothed follow state so the camera glides when the lead changes hands
// instead of snapping to the new leader.
const camFocus = new THREE.Vector3();
let camFocusInit = false;
let camHeading = 0;

function setCamMode(mode) {
  camMode = mode;
  dragAz = 0;
  dragEl = 0;
  zoom = 1;
  camBtns.forEach((b) => b.classList.toggle('active', b.dataset.cam === mode));
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastPointer = { x: e.clientX, y: e.clientY };
});
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastPointer.x;
  const dy = e.clientY - lastPointer.y;
  lastPointer = { x: e.clientX, y: e.clientY };
  if (camMode === 'orbit') {
    orbitAzimuth -= dx * 0.006;
    orbitElevation = Math.min(1.35, Math.max(0.1, orbitElevation + dy * 0.004));
  } else {
    dragAz -= dx * 0.006;
    dragEl = Math.min(1.2, Math.max(-1.2, dragEl + dy * 0.004));
  }
});
renderer.domElement.addEventListener('wheel', (e) => {
  if (camMode === 'orbit') {
    orbitDistance = Math.min(120, Math.max(8, orbitDistance + e.deltaY * 0.03));
  } else {
    zoom = Math.min(3, Math.max(0.4, zoom + e.deltaY * 0.0015));
  }
}, { passive: true });

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function updateCamera(dt) {
  const leader = state.racers.find((r) => r.id === state.leaderId) || state.racers[0];
  const leaderPos = leader ? leader.group.position : _v.set(0, 0, world.track.b);
  // Ease the focus point toward the leader (~0.3s to settle after a swap).
  if (!camFocusInit) {
    camFocus.copy(leaderPos);
    camFocusInit = true;
  }
  camFocus.lerp(leaderPos, 1 - Math.exp(-3.5 * dt));
  if (leader) camHeading = lerpAngle(camHeading, leader.group.rotation.y, 1 - Math.exp(-4 * dt));
  const t = camFocus;

  let az, el, dist;
  if (camMode === 'chase') {
    // Behind the leader relative to its heading.
    az = camHeading + Math.PI + dragAz;
    el = 0.5 + dragEl;
    dist = 10.3 * zoom;
  } else if (camMode === 'front') {
    az = camHeading + dragAz;
    el = 0.42 + dragEl;
    dist = 11 * zoom;
  } else if (camMode === 'high') {
    // Cozy top-down-ish view over the leader.
    az = dragAz;
    el = 0.95 + dragEl;
    dist = 31.6 * zoom;
  } else {
    // orbit: free angle around the leader.
    az = orbitAzimuth;
    el = orbitElevation;
    dist = orbitDistance;
  }
  el = Math.min(1.45, Math.max(0.08, el));

  camera.position.set(
    t.x + Math.sin(az) * Math.cos(el) * dist,
    Math.max(1.5, Math.sin(el) * dist),
    t.z + Math.cos(az) * Math.cos(el) * dist,
  );
  camera.lookAt(t.x, 1.2, t.z);
}

// ---------- Main loop ----------
const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  const dt = clock.getDelta();
  const now = clock.elapsedTime;

  // Watchers idle animation
  for (const w of state.watchers.values()) w.animate(now);

  // Racers
  if ((state.raceState === 'racing' || state.raceState === 'finished') && state.plan) {
    const elapsed = (performance.now() - state.raceStartAt) / 1000;
    const totalLanes = state.racers.length;
    let leaderId = null, leaderP = -1;
    for (const r of state.racers) {
      const p = Math.min(progressAt(state.plan[r.id], elapsed), 1);
      r.progress = p;
      if (p >= 1 && !r.finished) {
        r.finished = true;
        r.finishElapsed = elapsed;
      }
      // Finished racers jog on past the line, coasting to a stop just beyond
      // it, instead of freezing on the finish stripe.
      let dispP = p;
      let speed = 1;
      if (r.finished) {
        const k = Math.min(1, (elapsed - r.finishElapsed) / 2.4);
        dispP = 1 + 0.03 * (1 - (1 - k) * (1 - k));
        speed = k < 1 ? Math.max(0.3, 1 - k) : 0;
      }
      const pos = world.lanePoint(dispP, r.lane, totalLanes);
      r.group.position.set(pos.x, pos.y, pos.z);
      r.setHeading(facingAt(p, r.lane, totalLanes));
      r.animate(now, speed);
      if (p < 1 && p > leaderP) { leaderP = p; leaderId = r.id; }
    }
    if (leaderId && leaderId !== state.leaderId) {
      state.leaderId = leaderId;
      updateLeaderboard();
    }
    if (state.raceState === 'racing') {
      el.timer.textContent = `${Math.min(elapsed, state.timeSec).toFixed(2)}s`;
      if (Math.floor(elapsed * 2) % 2 === 0) updateLeaderboard(); // 2x per second refresh
    }
  } else {
    // Paddock: idle mobus are removed; watchers animate only.
    el.timer.textContent = '0.00';
  }

  updateCamera(dt);
  renderer.render(scene, camera);
}

// If the page loads when a race is already running (late joiner), welcome.state
// tells us; the next race_start/reset will resync. Mark ready and go.
refreshSetupUI();
tick();
