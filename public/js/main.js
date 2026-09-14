import * as THREE from '../vendor/three.module.js';
import { createWorld } from './environment.js';
import { createMobu, createWatcher, makeNameSprite, disposeRig, MOBU_SPRITE_Y } from './mobu.js';
import { costumeFromSeed, costumeSeedFromText } from './costumes.js';
import { createConfetti } from './confetti.js';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const el = {
  join: $('join'), nameInput: $('nameInput'), joinBtn: $('joinBtn'),
  hud: $('hud'), roleBadge: $('roleBadge'),
  userList: $('userList'), userPanel: $('userPanel'),
  setupPanel: $('setupPanel'), namesInput: $('namesInput'), timeInput: $('timeInput'), createBtn: $('createBtn'),
  quickCount: $('quickCount'), quickGenBtn: $('quickGenBtn'),
  readyPanel: $('readyPanel'), readyInfo: $('readyInfo'), startBtn: $('startBtn'), cancelBtn: $('cancelBtn'),
  readyWaiting: $('readyWaiting'), readyWaitingInfo: $('readyWaitingInfo'),
  waitingPanel: $('waitingPanel'), setupInfo: $('setupInfo'),
  camPanel: $('camPanel'),
  raceHud: $('raceHud'), timer: $('timer'), lbList: $('lbList'), leaderboard: $('leaderboard'),
  countdown: $('countdown'),
  congrats: $('congrats'), congratsName: $('congratsName'), confettiCanvas: $('confetti'),
  backBtn: $('backBtn'), resultWaiting: $('resultWaiting'),
};
const camBtns = [...document.querySelectorAll('.cam-btn')];
const confetti = createConfetti(el.confettiCanvas);

// ---------- Three.js setup ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// Style must be applied BEFORE setSize: setSize writes explicit style
// width/height, and without them a fixed+inset canvas falls back to its
// intrinsic (device-pixel) size, rendering oversized on HiDPI screens.
renderer.domElement.style.cssText = 'position:fixed;inset:0;z-index:0;display:block;';
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

// Track length follows the race time set by the host (rebuilt on race create).
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
  for (const [id, w] of state.watchers) {
    disposeRig(w.group);
    state.watchers.delete(id);
  }
  renderWatchers();
}

// Near plane 0.5 keeps depth precision good across the foggy valley (the
// far plane must reach the terrain rim, well past the fog wall).
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 1400);

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
  raceState: 'idle', // idle | ready | counting | racing | finished
  racers: [],        // {id,name,lane,slot, lateral, startFrac, mobu refs, progress, finished}
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

function websocketUrl() {
  const configured = window.MOBU_RACE_WS_URL;
  if (typeof configured === 'string' && configured) return configured;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

function connect(name) {
  if (name !== undefined) helloName = name;
  ws = new WebSocket(websocketUrl());
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
      state.raceState = msg.state === 'countdown' ? 'counting' : msg.state;
      state.setup = msg.setup;
      refreshSetupUI();
      refreshUserList();
      renderWatchers();
      if (msg.state === 'ready' && msg.ready) {
        onRaceCreated(msg.ready);
      } else if ((msg.state === 'racing' || msg.state === 'finished') && msg.race) {
        // Late joiner catching up to a live race (or an awaiting winner screen).
        startRace(msg.race, msg.race.elapsed);
        if (msg.state === 'finished') {
          showCongrats({ results: msg.results || [], winnerId: msg.winnerId });
        }
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
    case 'race_created':
      onRaceCreated(msg);
      break;
    case 'countdown':
      state.raceState = 'counting';
      refreshSetupUI();
      showCountdown(msg.seconds);
      break;
    case 'race_start':
      startRace(msg);
      break;
    case 'leader': {
      // Once the winner has crossed the line the camera and board stay locked
      // on them — ignore the server's late leader swaps.
      const win = state.winnerId ? state.racers.find((r) => r.id === state.winnerId) : null;
      if (win && win.finished) break;
      state.leaderId = msg.racerId;
      updateLeaderboard();
      break;
    }
    case 'race_finish':
      showCongrats(msg);
      break;
    case 'reset':
      state.raceState = 'idle';
      state.setup = msg.setup;
      el.congrats.classList.add('hidden');
      confetti.stop();
      clearRaceScene();
      rebuildWorld(state.setup.timeSec);
      refreshSetupUI();
      break;
    default:
      break;
  }
}

// ---------- UI wiring ----------
el.joinBtn.addEventListener('click', join);
el.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

// ---------- visitor name (localStorage) ----------
const NAME_KEY = 'mobu-race:visitor-name';

function loadVisitorName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}

function saveVisitorName(name) {
  try {
    if (name) localStorage.setItem(NAME_KEY, name);
    else localStorage.removeItem(NAME_KEY);
  } catch { /* private mode */ }
}

// Remember the name from the last visit and offer it pre-filled.
el.nameInput.value = loadVisitorName();

function join() {
  const name = el.nameInput.value.trim();
  saveVisitorName(name);
  el.join.classList.add('hidden');
  el.hud.classList.remove('hidden');
  connect(name || undefined);
}

el.namesInput.addEventListener('input', sendSetup);
el.timeInput.addEventListener('input', sendSetup);
el.createBtn.addEventListener('click', () => {
  sendSetupNow(); // flush the latest field contents (also persists the draft)
  send({ type: 'create' });
});
el.quickGenBtn.addEventListener('click', () => {
  const n = Math.max(2, Math.min(12, Math.round(Number(el.quickCount.value)) || 0));
  el.quickCount.value = n;
  el.namesInput.value = Array.from({ length: n }, (_, i) => String(i + 1).padStart(3, '0')).join('\n');
  sendSetupNow();
});
el.startBtn.addEventListener('click', () => send({ type: 'start' }));
el.cancelBtn.addEventListener('click', () => send({ type: 'reset' }));
el.backBtn.addEventListener('click', () => send({ type: 'reset' }));

// ---------- setup draft (localStorage) ----------
const DRAFT_KEY = 'mobu-race:setup-draft';
const TIME_STEPS = [10, 20, 30, 60, 90, 120];

function loadDraft() {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!raw || !Array.isArray(raw.names)) return { names: [], timeSec: 60 };
    const names = raw.names
      .filter((n) => typeof n === 'string' && n.trim())
      .map((n) => n.trim().slice(0, 20))
      .slice(0, 12);
    const timeSec = TIME_STEPS.includes(Number(raw.timeSec)) ? Number(raw.timeSec) : 60;
    return { names, timeSec };
  } catch {
    return { names: [], timeSec: 60 };
  }
}

function saveDraft(names, timeSec) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ names, timeSec })); } catch { /* private mode */ }
}

const draft = loadDraft();
let draftSeeded = false;

function sendSetupNow(names = null, timeSec = null) {
  const n = names ?? el.namesInput.value.split('\n').map((s) => s.trim()).filter(Boolean);
  const t = timeSec ?? (Number(el.timeInput.value) || 60);
  saveDraft(n, t);
  send({ type: 'setup', names: n, timeSec: t });
}

let setupTimer = null;
function sendSetup() {
  clearTimeout(setupTimer);
  setupTimer = setTimeout(() => sendSetupNow(), 250);
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
  const phase = state.raceState; // idle | ready | counting | racing | finished
  const raceOn = phase === 'counting' || phase === 'racing' || phase === 'finished';
  // Keep the screen clear while a race is on: the panels belong to the paddock
  // and to the "on the line" moment between create and start.
  el.userPanel.classList.toggle('hidden', raceOn);
  el.setupPanel.classList.toggle('hidden', !state.isHost || phase !== 'idle');
  el.readyPanel.classList.toggle('hidden', !state.isHost || phase !== 'ready');
  el.readyWaiting.classList.toggle('hidden', state.isHost || phase !== 'ready');
  el.waitingPanel.classList.toggle('hidden', state.isHost || phase !== 'idle');
  el.backBtn.classList.toggle('hidden', !state.isHost || phase !== 'finished');
  el.resultWaiting.classList.toggle('hidden', state.isHost || phase !== 'finished');
  // Recover the saved draft once, when a host faces an empty race — after
  // that, clearing the field stays cleared for the session.
  if (
    state.isHost && !draftSeeded && state.raceState === 'idle' &&
    !state.setup.names.length && draft.names.length
  ) {
    draftSeeded = true;
    state.setup = { names: draft.names.slice(), timeSec: draft.timeSec };
    sendSetupNow(state.setup.names, state.setup.timeSec);
  }
  if (state.isHost && phase === 'idle' && document.activeElement !== el.namesInput) {
    el.namesInput.value = state.setup.names.join('\n');
    el.timeInput.value = state.setup.timeSec;
  }
  const n = state.setup.names.length;
  const plural = n === 1 ? '' : 's';
  el.setupInfo.textContent = `${n} racer${plural} signed up · ${state.setup.timeSec}s race`;
  el.readyInfo.textContent = `${n} racer${plural} on the line · ${state.setup.timeSec}s track`;
  el.readyWaitingInfo.textContent = `${n} racer${plural} on the line — waiting for the host to start…`;
  el.createBtn.disabled = n < 2;
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
      disposeRig(w.group);
      state.watchers.delete(id);
    }
  }
  state.users.forEach((u, i) => {
    if (state.watchers.has(u.id)) return;
    // The avatar's outfit is hashed from the visitor's id+name so every
    // client renders the identical crowd (never per-client Math.random()).
    const w = createWatcher({ seed: costumeSeedFromText(u.id + '|' + u.name) });
    const sprite = makeNameSprite(u.name + (u.isHost ? ' 👑' : ''), { height: 0.5 });
    sprite.position.y = 2.0;
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
// Racer bodies stay the reference amber; outfits are what tell them apart.

// Anti-overlap: mobus sidestep sideways when they crowd each other, and
// finishers park past the line in leaderboard order (a cooldown parade):
// the winner coasts the farthest down the straight, the last finisher stops
// right by the line.
const SEP_LONG = 1.4;  // minimum gap along the track (m)
const SEP_LAT = 1.1;   // minimum gap sideways (m)
const BAND_MAX = 3.3;  // lateral limit that keeps racers on the dirt
const sepPushes = [];

// Step 1 of the setup: the ring is rebuilt for the chosen duration and the
// racers appear standing at their random spots behind the start line.
function onRaceCreated(msg) {
  state.raceState = 'ready';
  state.plan = null;
  state.winnerId = null;
  state.leaderId = null;
  el.congrats.classList.add('hidden');
  confetti.stop();
  buildRaceScene(msg);
  refreshSetupUI();
}

function buildRaceScene(msg) {
  clearRaceScene();
  rebuildWorld(msg.timeSec);
  camFocusInit = false; // re-aim the camera at the new pack without gliding
  state.timeSec = msg.timeSec;
  for (const r of msg.racers) {
    const mobu = createMobu();
    // Outfits are not controllable: the server rolls a fresh seed per racer
    // at every create, and clients derive the identical outfit from it. The
    // text-hash fallback keeps racers without a seed consistent too.
    const seed = Number.isFinite(r.costumeSeed)
      ? r.costumeSeed >>> 0
      : costumeSeedFromText(r.id + '|' + r.name);
    mobu.setCostume(costumeFromSeed(seed));
    const { group, animate } = mobu;
    const sprite = makeNameSprite(r.name, { height: 0.45 });
    sprite.position.y = MOBU_SPRITE_Y;
    group.add(sprite);
    const lateral = Math.max(-3.3, Math.min(3.3, r.slot ? r.slot.lateral : 0));
    const startFrac = startFraction(r.slot ? r.slot.behind : 1);
    const pos = world.lanePoint(-startFrac, lateral);
    group.position.copy(pos);
    mobu.setHeading(facingAt(-startFrac, lateral));
    scene.add(group);
    state.racers.push({
      ...r, group, animate, setHeading: mobu.setHeading,
      setCelebrating: mobu.setCelebrating,
      lateral, startFrac,
      sepLat: lateral,
      coastMeters: 1, coastDur: 2.4, coastFrac: 0,
      progress: 0, finished: false, finishElapsed: null,
    });
  }
}

// Plan progress 0 is the start line; racers begin `behind` meters before it.
function startFraction(behindMeters) {
  return Math.min(0.04, behindMeters / world.track.length);
}

function startRace(msg, elapsedOffset = 0) {
  // Clients that saw race_created already have the pack on the line; late
  // joiners build the whole scene here.
  if (!state.racers.length) buildRaceScene(msg);
  state.raceState = 'racing';
  state.plan = msg.plan;
  state.winnerId = msg.winnerId ?? null;
  state.leaderId = msg.racers?.[0]?.id ?? null;
  state.raceStartAt = performance.now() - elapsedOffset * 1000;
  for (const r of state.racers) {
    const p0 = Math.min(progressAt(msg.plan[r.id], elapsedOffset), 1);
    r.progress = p0;
    r.finished = p0 >= 1;
    r.finishElapsed = r.finished ? msg.plan[r.id][msg.plan[r.id].length - 1][0] : null;
  }
  // Park spots past the line in leaderboard order: the winner coasts the
  // farthest down the straight, each next finisher stops a step closer to the
  // line, so the parked field reads front-to-back just like the results board
  // instead of merging into one blob.
  const byFinish = state.racers.slice().sort((a, b) =>
    msg.plan[a.id][msg.plan[a.id].length - 1][0] - msg.plan[b.id][msg.plan[b.id].length - 1][0]);
  const lastIdx = byFinish.length - 1;
  byFinish.forEach((r, idx) => {
    r.coastMeters = 1 + 1.5 * (lastIdx - idx);
    // The coast starts at the racer's own cross-line pace (their plan's last
    // segment) and decays linearly to zero on the park spot: sprint through
    // the line, then bleed speed all the way to the stop with no pop. With
    // coastDur = 2·distance/pace the ease-out below starts at exactly `pace`.
    const kfs = msg.plan[r.id];
    const [t1, p1] = kfs[kfs.length - 1];
    const [t0, p0] = kfs[kfs.length - 2];
    const pace = Math.max(0.5,
      ((p1 - p0) / Math.max(0.001, t1 - t0)) * (1 + r.startFrac) * world.track.length);
    r.coastDur = Math.min(8, (2 * r.coastMeters) / pace);
    r.coastFrac = r.coastMeters / world.track.length;
  });
  // A winner already past the line (late joiner opening a finished race)
  // starts mid-celebration; live, tick() flips it when they cross.
  for (const r of state.racers) {
    r.setCelebrating(r.finished && state.winnerId != null && r.id === state.winnerId);
  }
  el.congrats.classList.add('hidden');
  confetti.stop();
  el.raceHud.classList.remove('hidden');
  el.leaderboard.classList.remove('hidden');
  el.countdown.classList.add('hidden');
  lbNextRefresh = 0;
  refreshSetupUI();
  updateLeaderboard();
}

function clearRaceScene() {
  for (const r of state.racers) {
    scene.remove(r.group);
    disposeRig(r.group);
  }
  state.racers = [];
  state.plan = null;
  state.leaderId = null;
  state.winnerId = null;
  lbRows.clear();
  el.lbList.innerHTML = '';
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

function facingAt(progress, lateral = 0) {
  // Tangent of this racer's line a moment ahead, so racers face along the track.
  const ahead = world.lanePoint(progress + 0.004, lateral);
  const here = world.lanePoint(progress, lateral);
  return Math.atan2(ahead.x - here.x, ahead.z - here.z);
}

// Leaderboard rows are keyed by racer id and kept across updates, so an order
// change can animate: each row slides from its old slot to the new one (FLIP:
// measure old tops, re-order, tween the inverted delta back to zero).
const lbRows = new Map(); // racerId -> <li>
let lbNextRefresh = 0;    // race-elapsed second for the next periodic refresh

// A finisher's arrival time straight from the plan — the exact value the
// server ranks the final results by.
function planFinishTime(r) {
  const kf = state.plan && state.plan[r.id];
  return kf && kf.length ? kf[kf.length - 1][0] : (r.finishElapsed ?? Infinity);
}

function updateLeaderboard(finalResults = null) {
  let rows;
  if (finalResults && finalResults.length) {
    // Final standings from the server: the leaderboard doubles as the results
    // board once the race is over.
    rows = finalResults.map((res) => ({ ...res, finished: res.finishTime != null }));
  } else {
    // Finishers lock into arrival order while the still-running field keeps
    // ranking by live progress. (progress clamps at 1, so a plain sort leaves
    // the finished pack tied in array order — rescrambling every time someone
    // crosses — and then jumps to the server's order when race_finish lands.)
    rows = state.racers.slice().sort((a, b) => {
      const fa = a.finished ? planFinishTime(a) : Infinity;
      const fb = b.finished ? planFinishTime(b) : Infinity;
      if (fa !== fb) return fa - fb;
      return b.progress - a.progress;
    });
  }

  // FIRST: where every row sits right now (rect includes any in-flight slide,
  // so an update that interrupts one re-anchors it without a jump).
  const before = new Map();
  for (const li of el.lbList.children) {
    before.set(li.dataset.id, li.getBoundingClientRect().top);
  }

  // THEN: rewrite the board in the new order. appendChild moves existing rows,
  // so :first-child styling follows the gold spot automatically.
  el.lbList.innerHTML = '';
  rows.forEach((r, i) => {
    let li = lbRows.get(r.id);
    if (!li) {
      li = document.createElement('li');
      li.dataset.id = r.id;
      lbRows.set(r.id, li);
    }
    const finishT = r.finishTime ?? (r.finished ? planFinishTime(r) : null);
    const time = finishT == null ? '' : ` — ${finishT.toFixed(2)}s`;
    const marks =
      (r.finished ? ' 🏁' : '') +
      (r.id === state.leaderId && state.raceState === 'racing' ? ' 🏃' : '');
    li.textContent = `${i + 1}. ${r.name}${time}${marks}`;
    el.lbList.appendChild(li);
  });
  for (const [id, li] of lbRows) {
    if (!li.isConnected) lbRows.delete(id);
  }

  // INVERT + PLAY: start each moved row at its old offset and let it ease in.
  for (const li of el.lbList.children) {
    const prevTop = before.get(li.dataset.id);
    if (prevTop === undefined) continue;
    const delta = prevTop - li.getBoundingClientRect().top;
    if (Math.abs(delta) < 1) continue;
    li.style.transition = 'none';
    li.style.transform = `translateY(${delta}px)`;
    li.getBoundingClientRect(); // flush so the slide starts from the old spot
    li.style.transition = 'transform 0.45s cubic-bezier(0.2, 0.8, 0.3, 1.08)';
    li.style.transform = '';
  }
}

function showCountdown(seconds) {
  if (typeof seconds !== 'number') return;
  el.countdown.classList.remove('hidden');
  el.countdown.textContent = seconds > 0 ? seconds : 'GO!';
  if (seconds === 0) {
    setTimeout(() => el.countdown.classList.add('hidden'), 800);
  }
}

function showCongrats(msg) {
  state.raceState = 'finished';
  state.winnerId = msg.winnerId;
  state.leaderId = msg.winnerId; // lock the camera onto the winner
  const winner = (msg.results || []).find((r) => r.id === msg.winnerId);
  el.congratsName.textContent = winner ? `${winner.name} wins! 🏆` : '??? wins! 🏆';
  el.congrats.classList.remove('hidden');
  confetti.start();
  el.timer.textContent = `${Number(state.timeSec).toFixed(2)}s`;
  el.countdown.classList.add('hidden');
  updateLeaderboard(msg.results && msg.results.length ? msg.results : null);
  refreshSetupUI();
}

// ---------- Camera ----------
let camMode = 'orbit'; // the scene opens with the free orbit view
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
let camHeading = Math.PI;

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

// The leader's direction of travel, stripped of the wobble that animate()
// adds on top of group.rotation.y — chasing the animated angle made the
// chase camera swing with every step (and swing hard during the winner's
// celebration hops). Before the race starts racers have no dispP yet, so
// fall back to their spot on the line.
function stableLeaderHeading(leader) {
  return leader.dispP !== undefined
    ? facingAt(leader.dispP, leader.sepLat)
    : facingAt(-leader.startFrac, leader.lateral);
}

function updateCamera(dt) {
  const leader = state.racers.find((r) => r.id === state.leaderId) || state.racers[0];
  const leaderPos = leader ? leader.group.position : _v.set(0, 0, world.track.b);
  // Ease the focus point toward the leader (~0.3s to settle after a swap).
  if (!camFocusInit) {
    camFocus.copy(leaderPos);
    if (leader) camHeading = stableLeaderHeading(leader);
    camFocusInit = true;
  }
  camFocus.lerp(leaderPos, 1 - Math.exp(-3.5 * dt));
  if (leader) camHeading = lerpAngle(camHeading, stableLeaderHeading(leader), 1 - Math.exp(-4 * dt));
  const t = camFocus;

  let az, el, dist;
  if (camMode === 'chase') {
    // Behind the leader relative to its heading.
    az = camHeading + Math.PI + dragAz;
    el = 0.5 + dragEl;
    dist = 10.3 * zoom;
  } else if (camMode === 'front') {
    // Place camera on the track ahead of the leader, looking back along the
    // track so the finish line stripe and banner run horizontally across the
    // view with the racers visible beyond.
    el = 0.42 + dragEl;
    dist = 11 * zoom;
    let aheadP = 0.03;
    if (leader) {
      const racing = state.raceState === 'racing' || state.raceState === 'finished';
      if (racing && leader.progress !== undefined) {
        aheadP = Math.min(0.97, leader.progress + 0.03);
      } else if (leader.startFrac !== undefined) {
        // Ready state: racers are at -startFrac, place camera past the line.
        aheadP = Math.max(0.01, -leader.startFrac + 0.03);
      }
    }
    const aheadPos = world.lanePoint(aheadP, 0);
    const height = Math.max(1.5, Math.sin(el) * dist);
    camera.position.set(aheadPos.x, height, aheadPos.z);
    camera.lookAt(t.x, 1.2, t.z);
    return;
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
const timer = new THREE.Timer();
timer.connect(document);
timer.reset();

function tick(timestamp) {
  requestAnimationFrame(tick);
  timer.update(timestamp);
  const dt = timer.getDelta();
  const now = timer.getElapsed();

  // Watchers: idle sway on a normal day, arms-up cheering once a race is on
  const cheering =
    state.raceState === 'counting' || state.raceState === 'racing' || state.raceState === 'finished' ? 1 : 0;
  for (const w of state.watchers.values()) w.animate(now, cheering);

  // World life: windmill blades, drifting mist and clouds
  if (world.animate) world.animate(now);

  // Racers
  if ((state.raceState === 'racing' || state.raceState === 'finished') && state.plan) {
    const elapsed = (performance.now() - state.raceStartAt) / 1000;
    let leaderId = null, leaderP = -1;
    for (const r of state.racers) {
      const p = Math.min(progressAt(state.plan[r.id], elapsed), 1);
      r.progress = p;
      if (p >= 1 && !r.finished) {
        r.finished = true;
        r.finishElapsed = elapsed;
        // The winner's celebration waits for the gate inside animate(): they
        // coast to their spot first, then start hopping once stopped.
        if (r.id === state.winnerId) r.setCelebrating(true);
      }
      // Plan progress -> track progress: everyone starts behind the line and
      // stretches into the lap, so each racer crosses exactly on plan time.
      let dispP = -r.startFrac + p * (1 + r.startFrac);
      let speed = 1;
      if (r.finished) {
        // Quadratic ease-out over the park distance: speed starts AT the
        // racer's cross-line pace (coastDur was sized for that) and bleeds
        // linearly to zero exactly on the park spot. The waddle animation
        // tracks the same ratio, so legs slow with the body.
        const k = Math.min(1, (elapsed - r.finishElapsed) / r.coastDur);
        dispP = 1 + r.coastFrac * (1 - (1 - k) * (1 - k));
        speed = Math.max(0, 1 - k);
      }
      r.dispP = dispP;
      const pos = world.lanePoint(dispP, r.sepLat);
      r.group.position.set(pos.x, pos.y, pos.z);
      r.setHeading(facingAt(dispP, r.sepLat));
      r.animate(now, speed);
      if (p < 1 && p > leaderP) { leaderP = p; leaderId = r.id; }
    }
    // Anti-overlap: nudge crowd-mates apart sideways, then let everyone
    // relax back toward their own line once the way is clear.
    const n = state.racers.length;
    const trackLen = world.track.length;
    sepPushes.length = n;
    sepPushes.fill(0);
    for (let i = 0; i < n; i++) {
      const a = state.racers[i];
      for (let j = i + 1; j < n; j++) {
        const b = state.racers[j];
        const dz = (a.dispP - b.dispP) * trackLen;
        if (dz > SEP_LONG || dz < -SEP_LONG) continue;
        const dLat = a.sepLat - b.sepLat;
        const overlap = SEP_LAT - Math.abs(dLat);
        if (overlap <= 0) continue;
        const s = dLat > 0 ? 1 : dLat < 0 ? -1 : i < j ? 1 : -1;
        sepPushes[i] += s * overlap * 0.5;
        sepPushes[j] -= s * overlap * 0.5;
      }
    }
    for (let i = 0; i < n; i++) {
      const r = state.racers[i];
      const relax = (r.lateral - r.sepLat) * (1 - Math.exp(-0.8 * dt));
      r.sepLat = Math.max(-BAND_MAX, Math.min(BAND_MAX,
        r.sepLat + relax + sepPushes[i] * Math.min(1, dt * 6)));
      const pos = world.lanePoint(r.dispP, r.sepLat);
      r.group.position.set(pos.x, pos.y, pos.z);
      r.setHeading(facingAt(r.dispP, r.sepLat));
    }
    // The moment the winner crosses the line, the camera (and the board) lock
    // onto them for good — no more lead swaps after the finish.
    const win = state.winnerId ? state.racers.find((r) => r.id === state.winnerId) : null;
    if (win && win.finished) leaderId = state.winnerId;
    if (leaderId && leaderId !== state.leaderId) {
      state.leaderId = leaderId;
      updateLeaderboard();
    }
    if (state.raceState === 'racing') {
      el.timer.textContent = `${Math.min(elapsed, state.timeSec).toFixed(2)}s`;
      // Steady 2x-per-second refresh so order-change slides (0.45s) get to play.
      if (elapsed >= lbNextRefresh) {
        lbNextRefresh = Math.max(lbNextRefresh + 0.5, elapsed);
        updateLeaderboard();
      }
    }
  } else {
    // Paddock / on the line: spawned racers idle in place behind the start line.
    for (const r of state.racers) r.animate(now, 0);
    el.timer.textContent = '0.00';
  }

  updateCamera(dt);
  renderer.render(scene, camera);
}

// If the page loads when a race is already running (late joiner), welcome.state
// tells us; the next race_start/reset will resync. Mark ready and go.
refreshSetupUI();
tick();
