// Race sounds use local copies of free Mixkit sound effects. See
// public/assets/audio/ATTRIBUTION.md for the asset pages and license.
const SOUND_KEY = 'mobu-race:sound-enabled';
const ASSETS = {
  ambience: '/assets/audio/crowd-ambience.mp3',
  victory: '/assets/audio/crowd-victory.mp3',
  whistle: '/assets/audio/starter-whistle.mp3',
  footsteps: '/assets/audio/dirt-step.mp3',
  splash: '/assets/audio/water-splash.mp3',
};
const POOL_SIZES = { victory: 1, whistle: 1, footsteps: 4, splash: 4 };

function savedEnabled() {
  try { return localStorage.getItem(SOUND_KEY) !== 'false'; } catch { return true; }
}

function rememberEnabled(enabled) {
  try { localStorage.setItem(SOUND_KEY, String(enabled)); } catch { /* private mode */ }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createRaceAudio() {
  const supported = typeof Audio === 'function';
  let enabled = supported && savedEnabled();
  let unlocked = false;
  let phase = 'idle';
  let raceType = 'mobu';
  let nextSurfaceAt = 0;
  let surfaceSide = -1;
  const activeEffects = new Set();
  const nextVoice = { victory: 0, whistle: 0, footsteps: 0, splash: 0 };
  const ambience = supported ? new Audio(ASSETS.ambience) : null;
  const effectPools = {};

  if (ambience) {
    ambience.loop = true;
    ambience.preload = 'auto';
    ambience.volume = 0;
    for (const [name, size] of Object.entries(POOL_SIZES)) {
      effectPools[name] = Array.from({ length: size }, () => {
        const voice = new Audio(ASSETS[name]);
        voice.preload = 'auto';
        voice.addEventListener('ended', () => activeEffects.delete(voice));
        return voice;
      });
    }
  }

  function targetAmbienceVolume() {
    if (!enabled || !unlocked) return 0;
    if (phase === 'ready') return 0.04;
    if (phase === 'counting') return 0.075;
    if (phase === 'racing') return 0.055;
    if (phase === 'finished') return 0.035;
    return 0;
  }

  function syncAmbience() {
    if (!ambience) return;
    const volume = targetAmbienceVolume();
    ambience.volume = volume;
    if (volume) ambience.play().catch(() => {});
    else {
      ambience.pause();
      ambience.currentTime = 0;
    }
  }

  function stopEffects() {
    for (const pool of Object.values(effectPools)) {
      for (const voice of pool) {
        voice.pause();
        voice.currentTime = 0;
      }
    }
    activeEffects.clear();
  }

  function play(name, volume, rate = 1) {
    if (!enabled || !unlocked || !supported) return;
    const pool = effectPools[name];
    if (!pool) return;
    const voice = pool.find((candidate) => candidate.paused || candidate.ended)
      ?? pool[nextVoice[name]++ % pool.length];
    voice.pause();
    voice.currentTime = 0;
    voice.volume = clamp(volume, 0, 1);
    voice.playbackRate = rate;
    activeEffects.add(voice);
    voice.play().catch(() => activeEffects.delete(voice));
  }

  function unlock() {
    if (!enabled || !supported) return;
    // Called only from join/start/toggle gestures. Preloading the fixed pools
    // here keeps the countdown and surface effects immediate without creating
    // fresh HTMLAudioElements on every footstep.
    unlocked = true;
    ambience.load();
    for (const pool of Object.values(effectPools)) {
      for (const voice of pool) voice.load();
    }
    syncAmbience();
  }

  function setEnabled(next) {
    enabled = supported && Boolean(next);
    rememberEnabled(enabled);
    if (!enabled) {
      stopEffects();
      syncAmbience();
      return enabled;
    }
    // The sound-toggle click is also a valid browser media gesture.
    unlock();
    return enabled;
  }

  function setPhase(nextPhase, nextRaceType = raceType) {
    phase = nextPhase;
    raceType = nextRaceType === 'lake' ? 'lake' : 'mobu';
    if (phase !== 'racing' && phase !== 'finished') {
      nextSurfaceAt = 0;
      stopEffects();
    }
    syncAmbience();
  }

  function startRace(nextRaceType, elapsedOffset = 0) {
    setPhase('racing', nextRaceType);
    nextSurfaceAt = 0;
    // A positive offset is supplied only by a welcome snapshot. That visitor
    // joined after the gun, so it must not hear a fresh starter whistle.
    if (elapsedOffset === 0) play('whistle', 0.62);
  }

  function celebrate() {
    play('victory', 0.72);
  }

  function update(racers) {
    if (!enabled || !unlocked || (phase !== 'racing' && phase !== 'finished') || !Array.isArray(racers)) {
      nextSurfaceAt = 0;
      return;
    }
    const moving = racers.filter((racer) => Number(racer.pace) > 0.35);
    if (!moving.length) {
      nextSurfaceAt = 0;
      return;
    }

    const averagePace = moving.reduce((sum, racer) => sum + racer.pace, 0) / moving.length;
    const effort = clamp(averagePace / 7, 0.25, 1.25);
    const now = performance.now() / 1000;
    if (now < nextSurfaceAt) return;

    const pack = clamp(Math.log2(moving.length + 1) / 3.6, 0.25, 1);
    const volume = clamp(0.07 + pack * 0.055 + effort * 0.035, 0.08, 0.16);
    surfaceSide *= -1;
    const rate = clamp(0.85 + effort * 0.23 + surfaceSide * 0.025, 0.82, 1.16);
    play(raceType === 'lake' ? 'splash' : 'footsteps', volume, rate);

    const interval = raceType === 'lake'
      ? clamp(0.45 - effort * 0.13, 0.26, 0.42)
      : clamp(0.36 - effort * 0.12, 0.19, 0.33);
    nextSurfaceAt = now + interval;
  }

  return {
    get enabled() { return enabled; },
    get supported() { return supported; },
    unlock,
    toggle() { return setEnabled(!enabled); },
    setEnabled,
    setPhase,
    startRace,
    celebrate,
    update,
  };
}
