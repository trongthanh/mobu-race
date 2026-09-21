import * as THREE from '../vendor/three.module.js';
import { createWorld } from './environment.js';
import { createMobu, createWatcher, makeNameSprite, disposeRig, MOBU_SPRITE_Y } from './mobu.js';
import { createDuck } from './duck.js';
import { createSurfaceTrail } from './surface.js';
import { costumeFromSeed, costumeSeedFromText } from './costumes.js';
import { createConfetti } from './confetti.js';
import { createRaceAudio } from './audio.js';
import { buildPlan, maxRacersForTime, randomSlots } from './race-plan.js';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const isLiveRace = location.pathname === '/live' || location.pathname === '/live/';
document.body.classList.toggle('live-race', isLiveRace);
const raceTypeInputs = [...document.querySelectorAll('input[name="raceType"]')];
const el = {
  join: $('join'), nameInput: $('nameInput'), joinBtn: $('joinBtn'),
  hud: $('hud'), topbar: $('topbar'), roleBadge: $('roleBadge'),
  userList: $('userList'), spectatorsPanel: $('spectatorsPanel'), userPanel: $('userPanel'), raceControlTitle: $('raceControlTitle'),
  setupPanel: $('setupPanel'), namesInput: $('namesInput'), nameCount: $('nameCount'), syncVisitorsControl: $('syncVisitorsControl'), syncVisitors: $('syncVisitors'), syncedNames: $('syncedNames'), syncedNameList: $('syncedNameList'), timeInput: $('timeInput'), createBtn: $('createBtn'),
  quickCount: $('quickCount'), quickGenBtn: $('quickGenBtn'),
  readyPanel: $('readyPanel'), readyInfo: $('readyInfo'), startBtn: $('startBtn'), cancelBtn: $('cancelBtn'),
  readyWaiting: $('readyWaiting'), readyWaitingInfo: $('readyWaitingInfo'),
  waitingPanel: $('waitingPanel'), setupInfo: $('setupInfo'), waitingRacers: $('waitingRacers'), waitingRacerList: $('waitingRacerList'),
  camPanel: $('camPanel'), soundBtn: $('soundBtn'),
  raceHud: $('raceHud'), timer: $('timer'), lbList: $('lbList'), lbExitLayer: $('lbExitLayer'), leaderboard: $('leaderboard'),
  countdown: $('countdown'),
  congrats: $('congrats'), congratsName: $('congratsName'), confettiCanvas: $('confetti'),
  backBtn: $('backBtn'), resultWaiting: $('resultWaiting'),
};
const camBtns = [...document.querySelectorAll('.cam-btn')];
const confetti = createConfetti(el.confettiCanvas);
const SIMPLE_SHADOW_RACER_COUNT = 20;
const MOBU_SHADOW_WORLD_Y = 0.056; // track surface is y=0.05
const simpleShadowMaterial = new THREE.MeshBasicMaterial({
  color: 0x353535, transparent: true, opacity: 0.42, depthWrite: false,
  side: THREE.DoubleSide, toneMapped: false,
});
simpleShadowMaterial.userData.shared = true;
const raceAudio = createRaceAudio();
refreshSoundButton();

// The camera controls can wrap or grow when fonts load. Reserve their actual
// height on every viewport, not just narrow screens, so the sidebar never overlaps.
const panelResizeObserver = new ResizeObserver(() => {
  const cameraHeight = el.camPanel.getBoundingClientRect().height;
  if (cameraHeight > 0) {
    el.userPanel.style.setProperty('--camera-panel-height', `${cameraHeight}px`);
    document.documentElement.style.setProperty('--camera-panel-height', `${cameraHeight}px`);
  }
  const topbarHeight = el.topbar.getBoundingClientRect().height;
  if (topbarHeight > 0) el.spectatorsPanel.style.setProperty('--topbar-height', `${topbarHeight}px`);
});
panelResizeObserver.observe(el.camPanel);
panelResizeObserver.observe(el.topbar);

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
let world = createWorld({ trackScale: scaleForTime(30), raceType: 'mobu' });
let scene = world.scene;

function rebuildWorld(timeSec, raceType = state.setup.raceType) {
  const oldScene = scene;
  scene = null;
  const next = createWorld({ trackScale: scaleForTime(timeSec), raceType });
  world = next;
  scene = next.scene;
  // Racers/watchers were parented to the old scene — recreate them.
  for (const r of state.racers) scene.add(r.group);
  for (const [id, w] of state.watchers) {
    disposeRig(w.group);
    state.watchers.delete(id);
  }
  renderWatchers();
  disposeRig(oldScene);
  oldScene.traverse((o) => { if (o.isLight && o.shadow) o.shadow.dispose(); });
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
  offline: false,
  users: [],
  hostId: null,
  setup: { names: [], manualNames: [], syncedNames: [], syncVisitors: false, timeSec: 30, raceType: 'mobu' },
  raceState: 'idle', // idle | ready | counting | racing | finished
  racers: [],        // {id,name,lane,slot, lateral, startFrac, mobu refs, progress, finished}
  plan: null,
  timeSec: 0,
  raceStartAt: 0,    // local clock ms (set on race_start)
  leaderId: null,
  winnerId: null,
  congratsShown: false,
  // Ready-state close cameras share the centred racer in the front row.
  cameraTargets: { frontId: null, chaseId: null },
  watchers: new Map(), // userId -> {group, animate, sprite, spot}
};

// ---------- WebSocket ----------
let ws = null;
let wsOpen = false;
let helloName = null;
let pendingRaceType = 'mobu';

function websocketUrl() {
  const configured = window.MOBU_RACE_WS_URL;
  if (typeof configured === 'string' && configured) return configured;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

function connect(name, raceType) {
  if (name !== undefined) helloName = name;
  if (raceType !== undefined) pendingRaceType = raceType;
  ws = new WebSocket(websocketUrl());
  ws.addEventListener('open', () => {
    wsOpen = true;
    if (helloName !== null) send({ type: 'hello', name: helloName, raceType: pendingRaceType });
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handle(msg);
  });
  ws.addEventListener('close', () => {
    wsOpen = false;
    if (isLiveRace) setTimeout(connect, 1200);
  });
}

function send(obj) {
  if (state.offline) {
    runOfflineCommand(obj);
  } else if (wsOpen && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function handle(msg) {
  switch (msg.type) {
    case 'welcome': {
      state.myId = msg.id;
      state.isHost = msg.isHost;
      state.hostId = (msg.users.find((u) => u.isHost) || {}).id || null;
      state.users = msg.users;
      state.raceState = msg.state === 'countdown' ? 'counting' : msg.state;
      state.setup = msg.setup;
      raceAudio.setPhase(state.raceState, state.setup.raceType);
      rebuildWorld(state.setup.timeSec, state.setup.raceType);
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
    case 'setup_updated': {
      const raceTypeChanged = state.setup.raceType !== msg.setup.raceType;
      state.setup = msg.setup;
      if (raceTypeChanged && state.raceState === 'idle' && !state.racers.length) {
        rebuildWorld(state.setup.timeSec, state.setup.raceType);
      }
      refreshSetupUI();
      break;
    }
    case 'race_created':
      onRaceCreated(msg);
      break;
    case 'countdown':
      state.raceState = 'counting';
      raceAudio.setPhase('counting', state.setup.raceType);
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
    case 'error':
      console.warn(`Server rejected request (${msg.code || 'error'}): ${msg.message || 'Unknown error'}`);
      if (msg.code === 'name_taken' || msg.code === 'name_too_long') {
        el.roleBadge.textContent = `⚠️ ${msg.message || 'Screen name rejected'}`;
      }
      break;
    case 'reset':
      state.raceState = 'idle';
      state.setup = msg.setup;
      state.congratsShown = false;
      el.congrats.classList.add('hidden');
      confetti.stop();
      raceAudio.setPhase('idle', state.setup.raceType);
      clearRaceScene();
      rebuildWorld(state.setup.timeSec);
      refreshSetupUI();
      break;
    default:
      break;
  }
}

// ---------- Offline race controller ----------
// Offline mode feeds the same client message handlers as a WebSocket server, but
// keeps the complete race state, countdown and result timer in this tab only.
const offlineTimers = new Set();
let offlineRace = null;

function setOfflineTimer(fn, delay) {
  const id = setTimeout(() => {
    offlineTimers.delete(id);
    fn();
  }, delay);
  offlineTimers.add(id);
  return id;
}

function clearOfflineTimers() {
  for (const id of offlineTimers) clearTimeout(id);
  offlineTimers.clear();
}

const TIME_STEPS = [10, 20, 30, 60, 90, 120];

function snapTimeStep(value, fallback = 30) {
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds)) return fallback;
  return TIME_STEPS.reduce((best, step) =>
    Math.abs(seconds - step) < Math.abs(seconds - best) ? step : best);
}

function normalizeRacerNames(rawNames, timeSec) {
  const limit = maxRacersForTime(timeSec);
  const names = [];
  for (const name of Array.isArray(rawNames) ? rawNames : []) {
    if (typeof name !== 'string') continue;
    const trimmed = name.trim().slice(0, 20);
    if (trimmed) names.push(trimmed);
    if (names.length >= limit) break;
  }
  return names;
}

function inputRacerNames() {
  return el.namesInput.value.split('\n');
}

function refreshNameCount(names = normalizeRacerNames(inputRacerNames(), snapTimeStep(el.timeInput.value))) {
  const timeSec = snapTimeStep(el.timeInput.value);
  el.nameCount.textContent = `${names.length} / ${maxRacersForTime(timeSec)} racers`;
}

function syncQuickCountLimit(timeSec) {
  const limit = maxRacersForTime(timeSec);
  el.quickCount.max = String(limit);
  const current = Math.round(Number(el.quickCount.value)) || 2;
  el.quickCount.value = String(Math.max(2, Math.min(limit, current)));
}

function offlineSetup(msg) {
  const timeSec = snapTimeStep(msg.timeSec, 30);
  const names = normalizeRacerNames(msg.names, timeSec);
  const raceType = msg.raceType === 'lake' ? 'lake' : 'mobu';
  return { names, timeSec, raceType };
}

function runOfflineCommand(msg) {
  if (!state.offline) return;
  switch (msg.type) {
    case 'setup': {
      if (state.raceState !== 'idle') return;
      const setup = offlineSetup(msg);
      handle({ type: 'setup_updated', setup });
      return;
    }
    case 'create': {
      if (state.raceState !== 'idle' || state.setup.names.length < 2) return;
      const slots = randomSlots(state.setup.names.length);
      const racers = state.setup.names.map((name, i) => ({
        id: `r${i}`,
        name,
        lane: i,
        slot: slots[i],
        costumeSeed: Math.floor(Math.random() * 0x100000000),
      }));
      offlineRace = {
        racers, timeSec: state.setup.timeSec, raceType: state.setup.raceType,
        finishParking: racers.length <= SIMPLE_SHADOW_RACER_COUNT ? 'lanes' : 'grid',
        plan: null, winnerId: null,
      };
      handle({ type: 'race_created', timeSec: offlineRace.timeSec, raceType: offlineRace.raceType, racers });
      return;
    }
    case 'start': {
      if (state.raceState !== 'ready' || !offlineRace) return;
      handle({ type: 'countdown', seconds: 3 });
      setOfflineTimer(() => handle({ type: 'countdown', seconds: 2 }), 1000);
      setOfflineTimer(() => handle({ type: 'countdown', seconds: 1 }), 2000);
      setOfflineTimer(startOfflineRace, 3000);
      return;
    }
    case 'reset': {
      if (state.raceState !== 'ready' && state.raceState !== 'finished') return;
      clearOfflineTimers();
      offlineRace = null;
      handle({ type: 'reset', setup: { ...state.setup, names: state.setup.names.slice() } });
      return;
    }
    default:
      return;
  }
}

function startOfflineRace() {
  if (!offlineRace || state.raceState !== 'counting') return;
  const { plan, winnerIdx } = buildPlan(offlineRace.racers.map((r) => r.name), offlineRace.timeSec);
  offlineRace.plan = plan;
  offlineRace.winnerId = `r${winnerIdx}`;
  handle({
    type: 'race_start',
    timeSec: offlineRace.timeSec,
    raceType: offlineRace.raceType,
    racers: offlineRace.racers,
    plan,
    winnerId: offlineRace.winnerId,
    finishParking: offlineRace.finishParking,
  });
  const lastFinish = Math.max(...offlineRace.racers.map((r) => plan[r.id][plan[r.id].length - 1][0]));
  setOfflineTimer(finishOfflineRace, lastFinish * 1000 + 600);
}

function finishOfflineRace() {
  if (!offlineRace || state.raceState !== 'racing') return;
  const results = offlineRace.racers.map((r) => ({
    id: r.id,
    name: r.name,
    finishTime: offlineRace.plan[r.id][offlineRace.plan[r.id].length - 1][0],
    progress: 1,
  })).sort((a, b) => a.finishTime - b.finishTime || String(a.id).localeCompare(String(b.id)));
  handle({ type: 'race_finish', results, winnerId: offlineRace.winnerId });
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

function selectedRaceType() {
  return raceTypeInputs.find((input) => input.checked)?.value === 'lake' ? 'lake' : 'mobu';
}

function join() {
  // The join gesture unlocks Web Audio before any countdown or remote event.
  raceAudio.unlock();
  const name = el.nameInput.value.trim();
  saveVisitorName(name);
  if (!isLiveRace) {
    playOffline();
    return;
  }
  el.join.classList.add('hidden');
  el.hud.classList.remove('hidden');
  connect(name || undefined, selectedRaceType());
}

function playOffline() {
  const name = 'Race host';
  state.offline = true;
  el.join.classList.add('hidden');
  el.hud.classList.remove('hidden');
  handle({
    type: 'welcome',
    id: 'offline-host',
    isHost: true,
    users: [{ id: 'offline-host', name, isHost: true }],
    state: 'idle',
    setup: { names: [], timeSec: 30, raceType: selectedRaceType() },
  });
}

el.namesInput.addEventListener('input', () => {
  refreshNameCount();
  sendSetup();
});
el.syncVisitors.addEventListener('change', () => sendSetupNow());
el.timeInput.addEventListener('input', () => {
  const timeSec = snapTimeStep(el.timeInput.value);
  const names = normalizeRacerNames(inputRacerNames(), timeSec);
  el.timeInput.value = String(timeSec);
  // Reducing duration immediately drops excess entries, so a hidden longer
  // roster cannot reappear if the host later raises the duration again.
  el.namesInput.value = names.join('\n');
  syncQuickCountLimit(timeSec);
  refreshNameCount(names);
  sendSetupNow(names, timeSec);
});
el.createBtn.addEventListener('click', () => {
  sendSetupNow(); // flush the latest field contents (also persists the draft)
  send({ type: 'create' });
});
el.quickGenBtn.addEventListener('click', () => {
  const timeSec = snapTimeStep(el.timeInput.value);
  const limit = maxRacersForTime(timeSec);
  const n = Math.max(2, Math.min(limit, Math.round(Number(el.quickCount.value)) || 0));
  el.quickCount.value = n;
  const names = Array.from({ length: n }, (_, i) => String(i + 1).padStart(3, '0'));
  el.namesInput.value = names.join('\n');
  refreshNameCount(names);
  sendSetupNow(names, timeSec);
});
el.startBtn.addEventListener('click', () => {
  raceAudio.unlock();
  send({ type: 'start' });
});
el.cancelBtn.addEventListener('click', () => send({ type: 'reset' }));
el.backBtn.addEventListener('click', () => send({ type: 'reset' }));
el.soundBtn.addEventListener('click', () => {
  raceAudio.toggle();
  refreshSoundButton();
});

function refreshSoundButton() {
  if (!raceAudio.supported) {
    el.soundBtn.textContent = '🔇 Unavailable';
    el.soundBtn.title = 'This browser does not support Web Audio';
    el.soundBtn.disabled = true;
    el.soundBtn.setAttribute('aria-pressed', 'false');
    return;
  }
  el.soundBtn.textContent = raceAudio.enabled ? '🔊 Sound' : '🔇 Sound';
  el.soundBtn.title = raceAudio.enabled ? 'Mute race sounds' : 'Turn on race sounds';
  el.soundBtn.setAttribute('aria-pressed', String(raceAudio.enabled));
}

// ---------- setup draft (localStorage) ----------
const DRAFT_KEY = 'mobu-race:setup-draft';

function loadDraft() {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!raw || !Array.isArray(raw.names)) return { names: [], timeSec: 30, syncVisitors: false };
    const timeSec = snapTimeStep(raw.timeSec, 30);
    const names = normalizeRacerNames(raw.names, timeSec);
    return { names, timeSec, syncVisitors: Boolean(raw.syncVisitors) };
  } catch {
    return { names: [], timeSec: 30, syncVisitors: false };
  }
}

function saveDraft(names, timeSec, syncVisitors) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ names, timeSec, syncVisitors })); } catch { /* private mode */ }
}

const draft = loadDraft();
let draftSeeded = false;

function sendSetupNow(names = null, timeSec = null, syncVisitors = null) {
  const t = snapTimeStep(timeSec ?? el.timeInput.value, 30);
  const n = normalizeRacerNames(names ?? inputRacerNames(), t);
  const sync = syncVisitors ?? el.syncVisitors.checked;
  saveDraft(n, t, sync);
  refreshNameCount(n);
  send({ type: 'setup', names: n, syncVisitors: sync, timeSec: t, raceType: state.setup.raceType });
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
  // Offline races have no host/spectator role to announce.
  el.topbar.classList.toggle('hidden', state.offline);
  el.roleBadge.textContent = state.isHost
    ? '👑 You are the Host'
    : `Watching: ${myName()}`;
  const phase = state.raceState; // idle | ready | counting | racing | finished
  const raceOn = phase === 'counting' || phase === 'racing' || phase === 'finished';
  // Keep the screen clear while a race is on: the panels belong to the paddock
  // and to the "on the line" moment between create and start.
  el.userPanel.classList.toggle('hidden', raceOn);
  // This matches the previous paddock-only spectator list and leaves the
  // leaderboard unobstructed once countdown/racing begins.
  el.spectatorsPanel.classList.toggle('hidden', raceOn || state.offline);
  el.raceControlTitle.classList.toggle('hidden', !state.isHost || raceOn);
  el.setupPanel.classList.toggle('hidden', !state.isHost || phase !== 'idle');
  el.syncVisitorsControl.classList.toggle('hidden', state.offline);
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
    state.setup = {
      names: draft.names.slice(),
      manualNames: draft.names.slice(),
      syncedNames: [],
      syncVisitors: draft.syncVisitors,
      timeSec: draft.timeSec,
      raceType: state.setup.raceType,
    };
    sendSetupNow(draft.names, draft.timeSec, draft.syncVisitors);
  }
  if (state.isHost && phase === 'idle') {
    const manualNames = state.setup.manualNames || state.setup.names;
    if (document.activeElement !== el.namesInput) el.namesInput.value = manualNames.join('\n');
    el.syncVisitors.checked = Boolean(state.setup.syncVisitors);
    el.timeInput.value = state.setup.timeSec;
    syncQuickCountLimit(state.setup.timeSec);
    el.syncedNames.classList.toggle('hidden', !state.setup.syncVisitors);
    el.syncedNameList.innerHTML = '';
    for (const name of state.setup.syncedNames || []) {
      const li = document.createElement('li');
      li.textContent = name;
      el.syncedNameList.appendChild(li);
    }
  }
  const n = state.setup.names.length;
  refreshNameCount(state.setup.names);
  const plural = n === 1 ? '' : 's';
  const course = state.setup.raceType === 'lake' ? '🦆 Lake Duck Derby' : '🏁 Countryside Mobu Dash';
  el.setupInfo.textContent = `${n} racer${plural} signed up · ${state.setup.timeSec}s · ${course}`;
  el.waitingRacers.classList.toggle('hidden', n === 0);
  el.waitingRacerList.innerHTML = '';
  const syncedCount = (state.setup.syncedNames || []).length;
  for (const [index, name] of state.setup.names.entries()) {
    const li = document.createElement('li');
    li.textContent = index < syncedCount ? `${name} 👤` : name;
    el.waitingRacerList.appendChild(li);
  }
  el.readyInfo.textContent = `${n} racer${plural} on the line · ${state.setup.timeSec}s · ${course}`;
  el.readyWaitingInfo.textContent = `${n} racer${plural} on the line · ${state.setup.timeSec}s — ${course} is ready…`;
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
  // The welcome payload can precede hello's screen-name update. Rebuild an
  // avatar when its identity changes so its label, crown, and name-seeded outfit
  // stay current on every client; leave unchanged avatars alone.
  const usersById = new Map(state.users.map((u) => [u.id, u]));
  for (const [id, w] of state.watchers) {
    const user = usersById.get(id);
    if (!user || w.name !== user.name || w.isHost !== user.isHost) {
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
    state.watchers.set(u.id, { ...w, sprite, name: u.name, isHost: u.isHost });
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
// racers appear standing at their grid spots behind the start line.
function onRaceCreated(msg) {
  state.raceState = 'ready';
  raceAudio.setPhase('ready', msg.raceType ?? state.setup.raceType);
  state.plan = null;
  state.winnerId = null;
  state.leaderId = null;
  state.congratsShown = false;
  el.congrats.classList.add('hidden');
  confetti.stop();
  buildRaceScene(msg);
  el.raceHud.classList.remove('hidden');
  el.leaderboard.classList.add('hidden');
  el.timer.textContent = `${state.timeSec.toFixed(2)}s`;
  refreshSetupUI();
}

function makeSimpleGroundShadow(group, raceType) {
  // Per-racer geometry is intentionally disposable with the character rig;
  // the shared transparent material keeps a large field inexpensive.
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 20), simpleShadowMaterial);
  shadow.name = 'simple-ground-shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = 1;
  shadow.castShadow = false;
  shadow.receiveShadow = false;
  // Duck groups are scaled as a whole, so compensate to keep the water shadow
  // close to the same visible footprint as a Mobu's dirt shadow.
  shadow.scale.set(raceType === 'lake' ? 1.35 : 0.9, raceType === 'lake' ? 0.72 : 0.45, 1);
  // Ducks scale their outer group, so convert the desired 0.332m lift from
  // the group's origin (waterline + 0.012m) into local coordinates.
  shadow.position.y = raceType === 'lake' ? 0.332 / group.scale.y : MOBU_SHADOW_WORLD_Y - group.position.y;
  group.add(shadow);
  return shadow;
}

function syncSimpleGroundShadow(racer) {
  if (!racer.simpleShadow) return;
  // Mobus hop above the raised dirt track, but their shadow stays just above
  // its y=0.05 surface. Ducks place their outer group 0.32m below waterline,
  // so account for scale to put the ellipse 0.012m above the waves.
  racer.simpleShadow.position.y = racer.raceType === 'lake'
    ? 0.332 / racer.group.scale.y
    : MOBU_SHADOW_WORLD_Y - racer.group.position.y;
}

function buildRaceScene(msg) {
  clearRaceScene();
  const raceType = msg.raceType ?? state.setup.raceType;
  const useSimpleShadows = msg.racers.length >= SIMPLE_SHADOW_RACER_COUNT;
  state.setup.raceType = raceType;
  state.setup.timeSec = msg.timeSec;
  rebuildWorld(msg.timeSec, raceType);
  camFocusInit = false;
  camFocusTargetId = null; // re-aim the camera at the new pack without gliding
  state.timeSec = msg.timeSec;
  for (const r of msg.racers) {
    // Every racer gets one server seed. On land it chooses a mobu wardrobe;
    // on the lake it picks a duck colour plus a tiny regatta costume.
    const seed = Number.isFinite(r.costumeSeed)
      ? r.costumeSeed >>> 0
      : costumeSeedFromText(r.id + '|' + r.name);
    const character = raceType === 'lake' ? createDuck({ seed }) : createMobu();
    if (raceType !== 'lake') character.setCostume(costumeFromSeed(seed));
    const { group, animate } = character;
    if (useSimpleShadows) {
      group.traverse((o) => {
        if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; }
      });
    }
    const sprite = makeNameSprite(r.name, { height: 0.45 });
    sprite.position.y = raceType === 'lake' ? 2.3 : MOBU_SPRITE_Y + 0.25;
    group.add(sprite);
    const lateral = Math.max(-3.3, Math.min(3.3, r.slot ? r.slot.lateral : 0));
    const startFrac = startFraction(r.slot ? r.slot.behind : 1);
    const pos = world.lanePoint(-startFrac, lateral);
    group.position.copy(pos);
    character.setHeading(facingAt(-startFrac, lateral));
    scene.add(group);
    state.racers.push({
      ...r, group, animate, setHeading: character.setHeading,
      setCelebrating: character.setCelebrating,
      lateral, startFrac, raceType,
      simpleShadow: useSimpleShadows ? makeSimpleGroundShadow(group, raceType) : null,
      sepLat: lateral, lateralVelocity: 0,
      phase: (seed >>> 0) / 4294967296 * Math.PI * 2,
      trail: createSurfaceTrail(scene, raceType === 'lake', seed),
      coastMeters: 1, coastDur: 2.4, coastFrac: 0,
      progress: 0, finished: false, finishElapsed: null,
    });
  }

  // The first five slots form the front row. Pick its central racer rather
  // than relying on roster order, which made ready-state close cameras feel
  // random and occasionally frame a banner pole.
  const byBehind = state.racers.slice().sort((a, b) => {
    const aBehind = Number.isFinite(a.slot?.behind) ? a.slot.behind : 1;
    const bBehind = Number.isFinite(b.slot?.behind) ? b.slot.behind : 1;
    return aBehind - bBehind || Math.abs(a.lateral) - Math.abs(b.lateral) ||
      String(a.id).localeCompare(String(b.id));
  });
  const frontRow = byBehind.slice(0, Math.min(5, byBehind.length));
  const frontMiddle = frontRow.slice().sort((a, b) =>
    Math.abs(a.lateral) - Math.abs(b.lateral) ||
    (a.slot?.behind ?? 1) - (b.slot?.behind ?? 1) ||
    String(a.id).localeCompare(String(b.id)))[0];
  state.cameraTargets = {
    frontId: frontMiddle?.id ?? null,
    chaseId: frontMiddle?.id ?? null,
  };
}

// Plan progress 0 is the start line; racers begin `behind` meters before it.
function startFraction(behindMeters) {
  // A 100-racer grid can extend ~31m behind the stripe; preserve that depth
  // instead of compressing it into the old 4%-of-a-lap staging segment.
  return Math.min(0.22, behindMeters / world.track.length);
}

function startRace(msg, elapsedOffset = 0) {
  // Clients that saw race_created already have the pack on the line; late
  // joiners build the whole scene here.
  if (!state.racers.length) buildRaceScene(msg);
  state.raceState = 'racing';
  state.plan = msg.plan;
  state.winnerId = msg.winnerId ?? null;
  state.congratsShown = false;
  state.leaderId = msg.racers?.[0]?.id ?? null;
  state.raceStartAt = performance.now() - elapsedOffset * 1000;
  raceAudio.startRace(state.setup.raceType, elapsedOffset);
  for (const r of state.racers) {
    const p0 = Math.min(progressAt(msg.plan[r.id], elapsedOffset), 1);
    r.progress = p0;
    r.finished = p0 >= 1;
    r.finishElapsed = r.finished ? msg.plan[r.id][msg.plan[r.id].length - 1][0] : null;
    r.finishLateral = r.finished ? r.sepLat : null;
  }
  // Park finishers in a four-wide results grid rather than capping their
  // forward distance. A cap made every racer below rank 12 share the winner's
  // line in larger fields. The winner remains in the front-most, centre slot;
  // each lower row parks closer to the finish stripe.
  const byFinish = state.racers.slice().sort((a, b) =>
    msg.plan[a.id][msg.plan[a.id].length - 1][0] - msg.plan[b.id][msg.plan[b.id].length - 1][0]
      || String(a.id).localeCompare(String(b.id)));
  const resultsCount = Math.max(0, byFinish.length - 1);
  // Small fields preserve their own lanes. As the field grows, add columns
  // only when needed while keeping enough lateral and forward clearance for
  // the Mobu silhouette.
  // Live races receive this choice from the authoritative server/Worker.
  // The fallback keeps older peers and offline races aligned with the same
  // 20-racer threshold as the simple-shadow presentation.
  const preserveFinishLanes = msg.finishParking
    ? msg.finishParking === 'lanes'
    : byFinish.length <= SIMPLE_SHADOW_RACER_COUNT;
  const parkingLayout = preserveFinishLanes
    ? { columns: 1, columnGap: 0, rowGap: 3.1 }
    : resultsCount <= 17
    ? { columns: 2, columnGap: 4.8, rowGap: 2.8 }
    : resultsCount <= 49
    ? { columns: 3, columnGap: 3, rowGap: 2.5 }
    : { columns: 4, columnGap: 2, rowGap: 2.15 };
  const { columns: parkColumns, columnGap, rowGap } = parkingLayout;
  const lastResultsRow = Math.floor(Math.max(0, resultsCount - 1) / parkColumns);
  const firstResultsRowMeters = 1 + rowGap * lastResultsRow;
  byFinish.forEach((r, idx) => {
    // A small race never reshuffles after the stripe: every racer preserves
    // the lane they crossed in, including the winner.
    r.lockFinishLane = preserveFinishLanes;
    if (idx === 0) {
      // The winner gets a dedicated lead spot on their own finish lane, so
      // they can celebrate clearly in front of the pack.
      r.parkLateral = r.lateral;
      // Lead by one clear parking row, not an exaggerated parade distance.
      r.coastMeters = firstResultsRowMeters + rowGap;
    } else {
      const resultsIndex = idx - 1;
      const row = Math.floor(resultsIndex / parkColumns);
      const col = resultsIndex % parkColumns;
      const racersInRow = Math.min(parkColumns, resultsCount - row * parkColumns);
      // Small fields retain each racer's existing lane after the stripe.
      // Larger fields centre partial results rows to use the available width.
      r.parkLateral = preserveFinishLanes
        ? r.lateral
        : (col - (racersInRow - 1) / 2) * columnGap;
      r.coastMeters = 1 + rowGap * (lastResultsRow - row);
    }
    // The coast starts at the racer's own cross-line pace (their plan's last
    // segment) and decays linearly to zero on the park spot: sprint through
    // the line, then bleed speed all the way to the stop with no pop. With
    // coastDur = 2·distance/pace the ease-out below starts at exactly `pace`.
    const kfs = msg.plan[r.id];
    const [t1, p1] = kfs[kfs.length - 1];
    const [t0, p0] = kfs[kfs.length - 2];
    const pace = Math.max(0.5,
      ((p1 - p0) / Math.max(0.001, t1 - t0)) * (1 + r.startFrac) * world.track.length);
    r.coastDur = Math.min(10, (2 * r.coastMeters) / pace);
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
    r.trail.dispose();
    disposeRig(r.group);
  }
  state.racers = [];
  state.plan = null;
  state.leaderId = null;
  state.winnerId = null;
  state.cameraTargets = { frontId: null, chaseId: null };
  clearLeaderboardRows();
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

// Keep rendering/layout work bounded even for a 100-racer field. The board
// owns only its twelve visible rows; incoming/outgoing rows briefly animate in
// a separate overlay and never participate in the FLIP pass.
const LEADERBOARD_LIMIT = 12;
const lbRows = new Map(); // active or exiting racerId -> <li>
const lbExitTimers = new Map();
let lbNextRefresh = 0;    // race-elapsed second for the next periodic refresh

function clearLeaderboardRows() {
  for (const timer of lbExitTimers.values()) clearTimeout(timer);
  lbExitTimers.clear();
  lbRows.clear();
  el.lbList.replaceChildren();
  el.lbExitLayer.replaceChildren();
}

function restoreBoardRow(li) {
  const timer = lbExitTimers.get(li.dataset.id);
  if (timer) clearTimeout(timer);
  lbExitTimers.delete(li.dataset.id);
  li.classList.remove('lb-exit', 'lb-exiting');
  li.style.position = '';
  li.style.top = '';
  li.style.left = '';
  li.style.width = '';
  li.style.opacity = '';
  li.style.transform = '';
  li.style.transition = '';
}

function retireBoardRow(li) {
  const id = li.dataset.id;
  const boardRect = el.leaderboard.getBoundingClientRect();
  const rect = li.getBoundingClientRect();
  li.classList.remove('lb-enter');
  li.classList.add('lb-exit');
  li.style.position = 'absolute';
  li.style.top = `${rect.top - boardRect.top}px`;
  li.style.left = `${rect.left - boardRect.left}px`;
  li.style.width = `${rect.width}px`;
  li.style.transition = 'opacity 180ms ease, transform 180ms ease';
  el.lbExitLayer.appendChild(li);
  requestAnimationFrame(() => li.classList.add('lb-exiting'));
  lbExitTimers.set(id, setTimeout(() => {
    if (li.parentNode === el.lbExitLayer) li.remove();
    lbExitTimers.delete(id);
    if (lbRows.get(id) === li) lbRows.delete(id);
  }, 220));
}

// A finisher's arrival time straight from the plan — the exact value the
// server ranks the final results by.
function planFinishTime(r) {
  const kf = state.plan && state.plan[r.id];
  return kf && kf.length ? kf[kf.length - 1][0] : (r.finishElapsed ?? Infinity);
}

function updateLeaderboard(finalResults = null) {
  let standings;
  if (finalResults && finalResults.length) {
    standings = finalResults.map((res) => ({ ...res, finished: res.finishTime != null }));
  } else {
    standings = state.racers.slice().sort((a, b) => {
      const fa = a.finished ? planFinishTime(a) : Infinity;
      const fb = b.finished ? planFinishTime(b) : Infinity;
      if (fa !== fb) return fa - fb;
      if (b.progress !== a.progress) return b.progress - a.progress;
      return String(a.id).localeCompare(String(b.id));
    });
  }
  const rows = standings.slice(0, LEADERBOARD_LIMIT);
  const nextIds = new Set(rows.map((r) => r.id));

  // Only current board rows are measured and FLIP-animated. Rows falling out
  // retire in the overlay, while new top-12 entrants fade in without forcing
  // layout work for the rest of the field.
  const activeRows = [...el.lbList.children];
  const before = new Map(activeRows.map((li) => [li.dataset.id, li.getBoundingClientRect().top]));
  for (const li of activeRows) if (!nextIds.has(li.dataset.id)) retireBoardRow(li);

  const fragment = document.createDocumentFragment();
  const entering = [];
  rows.forEach((r, rank) => {
    let li = lbRows.get(r.id);
    const isNew = !li || li.parentNode === el.lbExitLayer;
    if (!li) {
      li = document.createElement('li');
      li.dataset.id = r.id;
      lbRows.set(r.id, li);
    } else {
      restoreBoardRow(li);
    }
    const finishT = r.finishTime ?? (r.finished ? planFinishTime(r) : null);
    const won = r.finished && r.id === state.winnerId;
    const time = finishT == null || won ? '' : ` −${Math.max(0, finishT - state.timeSec).toFixed(2)}s`;
    const marks = won ? ' 🥇' :
      (!r.finished && r.id === state.leaderId && state.raceState === 'racing' ? ' 🏃' : '');
    li.textContent = `${rank + 1}. ${r.name}${time}${marks}`;
    li.title = won ? 'Winner' : finishT == null ? '' :
      `${Math.max(0, finishT - state.timeSec).toFixed(2)} seconds behind the winner`;
    if (isNew) entering.push(li);
    fragment.appendChild(li);
  });
  el.lbList.appendChild(fragment);

  for (const li of el.lbList.children) {
    const prevTop = before.get(li.dataset.id);
    if (prevTop === undefined) continue;
    const delta = prevTop - li.getBoundingClientRect().top;
    if (Math.abs(delta) < 1) continue;
    li.style.transition = 'none';
    li.style.transform = `translateY(${delta}px)`;
    li.getBoundingClientRect();
    li.style.transition = 'transform 0.45s cubic-bezier(0.2, 0.8, 0.3, 1.08)';
    li.style.transform = '';
  }
  for (const li of entering) {
    li.classList.add('lb-enter');
    requestAnimationFrame(() => li.classList.remove('lb-enter'));
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
  const firstShow = !state.congratsShown;
  state.raceState = 'finished';
  state.winnerId = msg.winnerId ?? state.winnerId;
  state.leaderId = state.winnerId; // lock the camera onto the winner
  const winner = (msg.results || []).find((r) => r.id === state.winnerId)
    || state.racers.find((r) => r.id === state.winnerId);
  if (firstShow) {
    state.congratsShown = true;
    raceAudio.setPhase('finished', state.setup.raceType);
    raceAudio.celebrate();
    el.congratsName.textContent = winner ? winner.name : 'Unknown winner';
    el.congrats.classList.remove('hidden');
    confetti.start();
    el.timer.textContent = '0.00s';
    el.countdown.classList.add('hidden');
  }
  // The early local trigger keeps the live board; the later server result
  // replaces it with the authoritative final order once every racer finishes.
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
const camFocusOffset = new THREE.Vector3();
let camFocusInit = false;
let camFocusTargetId = null;
let camHeading = Math.PI;
let camHeadingOffset = 0;

function setCamMode(mode) {
  camMode = mode;
  dragAz = 0;
  dragEl = 0;
  zoom = 1;
  // A deliberate mode change frames the selected target immediately;
  // racer-to-racer changes within that mode still use the damped path below.
  camFocusInit = false;
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

function angleDelta(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
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
  // Only the initial race-setup screen presents the finish-line composition.
  // Once racers are on the line, restore the ready-grid and live-race views.
  const setupView = state.raceState === 'idle';
  const gridView = state.raceState === 'ready' || state.raceState === 'counting';
  const gridTargetId = camMode === 'front'
    ? state.cameraTargets.frontId
    : camMode === 'chase' ? state.cameraTargets.chaseId : null;
  const focus = gridView && gridTargetId
    ? state.racers.find((r) => r.id === gridTargetId) || leader
    : leader;
  const finishCenter = world.lanePoint(0, 0);
  const focusPos = setupView
    ? finishCenter
    : focus ? focus.group.position : finishCenter;
  const lookY = setupView ? 1.55 : 1.2;
  // Ease the focus point toward the selected target (~0.3s to settle after a swap).
  const heading = setupView ? facingAt(0, 0) : focus ? stableLeaderHeading(focus) : camHeading;
  const focusTargetId = setupView ? 'setup' : focus?.id ?? null;
  if (!camFocusInit) {
    camFocus.copy(focusPos);
    camFocusOffset.set(0, 0, 0);
    camHeading = heading;
    camHeadingOffset = 0;
    camFocusTargetId = focusTargetId;
    camFocusInit = true;
  } else if (focusTargetId !== camFocusTargetId) {
    // Preserve the current view at the instant a leader changes, then decay
    // only that handoff offset. Once acquired, the camera moves at the new
    // racer's exact speed and keeps its intended Chase/Front distance.
    camFocusOffset.copy(camFocus).sub(focusPos);
    camHeadingOffset = angleDelta(camHeading, heading);
    camFocusTargetId = focusTargetId;
  }
  const handoffDecay = Math.exp(-3.1 * dt);
  camFocusOffset.multiplyScalar(handoffDecay);
  camFocus.copy(focusPos).add(camFocusOffset);
  camHeadingOffset *= handoffDecay;
  camHeading = heading + camHeadingOffset;
  const t = camFocus;

  function placeCamera(desired, lookAtY = lookY) {
    camera.position.copy(desired);
    camera.lookAt(t.x, lookAtY, t.z);
  }

  let az, el, dist;
  if (setupView && (camMode === 'chase' || camMode === 'front')) {
    // Use the track tangent explicitly at the line. This keeps both close-up
    // cameras square to the banner instead of drifting into a side-on pole
    // view as the selected grid racer changes lanes.
    const beforeLine = world.lanePoint(-0.003, 0);
    const afterLine = world.lanePoint(0.003, 0);
    const tx = afterLine.x - beforeLine.x;
    const tz = afterLine.z - beforeLine.z;
    const tangentLen = Math.hypot(tx, tz) || 1;
    const tangentX = tx / tangentLen;
    const tangentZ = tz / tangentLen;
    const setupDist = 14;
    const direction = camMode === 'chase' ? -1 : 1;
    const setupX = finishCenter.x + tangentX * setupDist * direction;
    const setupZ = finishCenter.z + tangentZ * setupDist * direction;
    const setupHeight = camMode === 'chase' ? 4.8 : 4.6;
    camera.position.set(setupX, setupHeight, setupZ);
    camera.lookAt(finishCenter.x, 1.7, finishCenter.z);
    return;
  }
  if (camMode === 'chase') {
    // Behind the leader relative to its heading.
    az = camHeading + Math.PI + dragAz;
    el = 0.5 + dragEl;
    dist = 10.3 * zoom;
  } else if (camMode === 'front') {
    // In front of the leader, looking back along the stable track tangent.
    // It shares the handoff-smoothed focus below, so its distance remains
    // fixed while following a racer and only pans during a leader change.
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

  placeCamera(new THREE.Vector3(
    t.x + Math.sin(az) * Math.cos(el) * dist,
    Math.max(1.5, Math.sin(el) * dist),
    t.z + Math.cos(az) * Math.cos(el) * dist,
  ));
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
  const racing = (state.raceState === 'racing' || state.raceState === 'finished') && state.plan;
  const surfaceTime = racing ? (performance.now() - state.raceStartAt) / 1000 : now;
  if (world.animate) world.animate(surfaceTime);

  // Racers
  if ((state.raceState === 'racing' || state.raceState === 'finished') && state.plan) {
    const elapsed = surfaceTime;
    let leaderId = null, leaderP = -1;
    for (const r of state.racers) {
      const p = Math.min(progressAt(state.plan[r.id], elapsed), 1);
      r.progress = p;
      if (p >= 1 && !r.finished) {
        r.finished = true;
        r.finishElapsed = planFinishTime(r);
        r.finishLateral = r.sepLat;
        // The winner's celebration waits for the gate inside animate(): they
        // coast to their spot first, then start hopping once stopped.
        if (r.id === state.winnerId) r.setCelebrating(true);
      }
      // Plan progress -> track progress: everyone starts behind the line and
      // stretches into the lap, so each racer crosses exactly on plan time.
      let dispP = -r.startFrac + p * (1 + r.startFrac);
      // Derivative drives stroke/stride effort, not race position. The plan's
      // exact linear interpolation and finish time remain untouched.
      const kfs = state.plan[r.id];
      const paceAt = (t) => (progressAt(kfs, t + 0.06) - progressAt(kfs, t - 0.06)) / 0.12
        * (1 + r.startFrac) * world.track.length;
      let pace = Math.max(0, paceAt(elapsed));
      const acceleration = (paceAt(elapsed + 0.08) - paceAt(elapsed - 0.08)) / 0.16;
      if (r.finished) {
        // Quadratic ease-out over the park distance: speed starts AT the
        // racer's cross-line pace (coastDur was sized for that) and bleeds
        // linearly to zero exactly on the park spot. The waddle animation
        // tracks the same ratio, so legs slow with the body.
        const k = Math.min(1, (elapsed - r.finishElapsed) / r.coastDur);
        dispP = 1 + r.coastFrac * (1 - (1 - k) * (1 - k));
        pace = 2 * r.coastMeters / r.coastDur * Math.max(0, 1 - k);
      }
      r.dispP = dispP;
      r.pace = pace;
      r.motion = { distance: (dispP + r.startFrac) * world.track.length, acceleration, phase: r.phase };
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
      const step = Math.min(dt, 0.05);
      // A small field's finishers hold their crossing lane once across the
      // stripe. This opts them out of the generic anti-overlap sidestep so
      // they do not drift into a results queue.
      if (r.finished && r.lockFinishLane) {
        r.sepLat = Number.isFinite(r.finishLateral) ? r.finishLateral : r.lateral;
        r.lateralVelocity = 0;
      } else {
        // Separation is part of the shared race presentation, not a duck-vs-mobu
        // rule. Both skins use the same lateral response and track boundaries.
        const targetLateral = r.finished && Number.isFinite(r.parkLateral) ? r.parkLateral : r.lateral;
        const desiredVelocity = THREE.MathUtils.clamp((targetLateral - r.sepLat) * 0.6 + sepPushes[i] * 4, -1.2, 1.2);
        r.lateralVelocity += (desiredVelocity - r.lateralVelocity) * (1 - Math.exp(-7 * step));
        r.sepLat = THREE.MathUtils.clamp(r.sepLat + r.lateralVelocity * step, -BAND_MAX, BAND_MAX);
      }
      const pos = world.lanePoint(r.dispP, r.sepLat);
      r.group.position.set(pos.x, pos.y, pos.z);
      const heading = facingAt(r.dispP, r.sepLat);
      const ahead = facingAt(r.dispP + 0.002, r.sepLat);
      const bend = Math.atan2(Math.sin(ahead - heading), Math.cos(ahead - heading)) / (world.track.length * 0.002);
      r.motion.turn = THREE.MathUtils.clamp(bend * r.pace * r.pace / 9.81, -0.24, 0.24);
      // Face the actual sidestep as well as the forward tangent.
      r.setHeading(heading + Math.atan2(r.lateralVelocity, Math.max(1, r.pace)) * 0.65);
      // Pose LAST: the old separation pass erased buoyancy and running bounce.
      r.animate(surfaceTime, r.pace / 7, r.motion);
      syncSimpleGroundShadow(r);
      r.trail.update(surfaceTime, pos, heading, r.pace, r.motion.distance * 5 + r.phase);
    }
    // The moment the winner crosses the line, the camera (and the board) lock
    // onto them for good — no more lead swaps after the finish.
    const win = state.winnerId ? state.racers.find((r) => r.id === state.winnerId) : null;
    if (win && win.finished) {
      leaderId = state.winnerId;
      // The client knows the server-selected winner and the shared plan, so
      // celebrate on the exact crossing frame instead of waiting for the
      // server's race_finish message after the rest of the field arrives.
      if (!state.congratsShown) showCongrats({ winnerId: state.winnerId });
    }
    if (leaderId && leaderId !== state.leaderId) {
      state.leaderId = leaderId;
      updateLeaderboard();
    }
    if (state.raceState === 'racing') {
      el.timer.textContent = `${Math.max(0, state.timeSec - elapsed).toFixed(2)}s`;
      // Steady 2x-per-second refresh so order-change slides (0.45s) get to play.
      if (elapsed >= lbNextRefresh) {
        lbNextRefresh = Math.max(lbNextRefresh + 0.5, elapsed);
        updateLeaderboard();
      }
    }
  } else {
    // Paddock / on the line: spawned racers idle in place behind the start line.
    for (const r of state.racers) {
      r.animate(now, 0);
      syncSimpleGroundShadow(r);
    }
    el.timer.textContent = `${state.timeSec.toFixed(2)}s`;
  }

  raceAudio.update(state.racers);
  updateCamera(dt);
  renderer.render(scene, camera);
}

// If the page loads when a race is already running (late joiner), welcome.state
// tells us; the next race_start/reset will resync. Mark ready and go.
refreshSetupUI();
tick();
