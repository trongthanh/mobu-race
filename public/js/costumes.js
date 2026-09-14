// Mobu wardrobe — mix-and-match costumes built as SHELLS on the rig surface.
// Rules carried over from ref/MOBU.md §9:
//   - a garment is a shell on the body's own surface: at every angle θ and
//     height y its radius is radiusAt(y) + gap, so it follows the egg;
//   - nothing may cross LIP_FLOOR across the grin's angular span;
//   - no high edge (collar) may come forward of the mobu's sides.
// A costume spec is plain JSON, one [itemId, paletteIndex] pair per slot:
//   { pants: ['classic', 0], top: ['none', 0], head: ['none', 0], face: ['none', 0] }
import * as THREE from '../vendor/three.module.js';
import {
  sharedMat, radiusAt, surfacePoint, tubeBetween,
  HEAD_Y, HEAD_R, EYE_X, EYE_Y, LEG_X, MOBU_PALETTE,
  LIP_Y, LIP_THETA, LIP_CURL, LIP_LOW_DY, LIP_FUSE,
} from './rig.js';

export const SLOT_KEYS = ['pants', 'top', 'head', 'face'];

// Slot 0 is the signature shorts orange from the reference product shot.
export const CLOTH_COLORS = [
  0xf5731f, 0xe4574c, 0xf472b6, 0xb98cf7, 0x8ab6f9, 0x5fc9c2,
  0x9bd45f, 0xf9d976, 0xf7a81c, 0xfff4e0, 0x8a5a33, 0x495867,
];

export const DEFAULT_COSTUME = {
  pants: ['classic', 0],
  top: ['none', 0],
  head: ['none', 0],
  face: ['none', 0],
};

function shade(hex, f) {
  return new THREE.Color(hex).multiplyScalar(f).getHex();
}

// ---------------------------------------------------------------- shells
/**
 * A garment shell wrapped over the egg: rows from yTop down to yBot, columns
 * from a0 to a1 (θ, 0 = front +Z). top(θ) lowers the top edge locally
 * (necklines), hem(θ) raises the bottom edge (crotch notch), flare widens the
 * radius toward the hem, minR keeps a wide hem clear of the legs. Vertices
 * outside the edges clamp onto them.
 */
function shell({
  yTop, yBot, top = null, hem = null, a0 = 0, a1 = Math.PI * 2,
  gap = 0.05, rows = 9, cols = 26, minR = 0, flare = 0, material = null,
}) {
  const hemAt = hem || (() => yBot);
  const topAt = top || (() => yTop);
  // minR may be a number or a function of the row (0 = top, 1 = hem); the
  // tapered form keeps the shorts hugging the egg instead of reading as a box
  // while still clearing the legs at the hem.
  const minRAt = typeof minR === 'function' ? minR : () => minR;
  const pos = [];
  const idx = [];
  for (let i = 0; i <= rows; i++) {
    const v = i / rows; // 0 at the top, 1 at the hem
    const y = yTop + (yBot - yTop) * v;
    for (let j = 0; j <= cols; j++) {
      const th = a0 + (a1 - a0) * (j / cols);
      const yc = Math.max(Math.min(y, topAt(th)), hemAt(th));
      const r = Math.max(minRAt(v), radiusAt(yc) + gap + flare * v);
      pos.push(r * Math.sin(th), yc, r * Math.cos(th));
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j, b = a + 1, c = a + cols + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  return mesh;
}

const FRONT = 0; // θ of the mobu's nose

/** The classic shorts' hem, with a small crotch notch at the front centre. */
const shortsHem = (yBot) => (th) =>
  yBot + 0.12 * Math.max(0, Math.cos(th - FRONT)) ** 6;

function drawstring(y) {
  const g = new THREE.Group();
  const ink = sharedMat(MOBU_PALETTE.ink, { roughness: 0.6 });
  const r = radiusAt(y) + 0.06;
  for (const sx of [-1, 1]) {
    const string_ = tubeBetween(
      new THREE.Vector3(sx * 0.05, y + 0.02, r),
      new THREE.Vector3(sx * 0.17, y - 0.13, r + 0.03),
      0.022, ink);
    g.add(string_);
  }
  return g;
}

/** A rounded white blob decal with a tick inside, stuck to the shell.
 *  Built in a local frame where +Z faces outward, then glued to the surface. */
function blobDecal(theta, y, tickColor) {
  const g = new THREE.Group();
  const blob = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), sharedMat(0xfffdf2, { roughness: 0.8 }));
  blob.scale.set(0.17, 0.14, 0.05);
  blob.castShadow = true;
  g.add(blob);
  // one open arc reads as the reference's check-mark squiggle
  const tick = new THREE.Mesh(
    new THREE.TorusGeometry(0.062, 0.018, 5, 10, 4.3),
    sharedMat(tickColor, { roughness: 0.8 }));
  tick.position.z = 0.045;
  tick.rotation.z = 0.8;
  tick.castShadow = true;
  g.add(tick);
  const p = surfacePoint(y, theta, 0.075);
  g.position.copy(p);
  g.lookAt(p.x * 2, p.y * 2, p.z * 2);
  return g;
}

// ---------------------------------------------------------------- pants
function classicShorts(rig, color) {
  const g = new THREE.Group();
  const main = sharedMat(color);
  const cuffMat = sharedMat(shade(color, 0.72));
  g.add(shell({
    yTop: 1.25, yBot: 0.36, hem: shortsHem(0.36),
    gap: 0.05, minR: (v) => 0.97 - 0.04 * v, rows: 10, cols: 26, material: main,
  }));
  g.add(shell({
    yTop: 0.46, yBot: 0.36, hem: shortsHem(0.36),
    gap: 0.055, minR: (v) => 0.97 - 0.04 * v, rows: 2, cols: 26, material: cuffMat,
  }));
  g.add(drawstring(1.19));
  for (const th of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
    g.add(blobDecal(th, 0.86, color));
  }
  return g;
}

function plainShorts(rig, color) {
  const g = new THREE.Group();
  g.add(shell({
    yTop: 1.25, yBot: 0.36, hem: shortsHem(0.36),
    gap: 0.05, minR: (v) => 0.97 - 0.04 * v, rows: 10, cols: 26, material: sharedMat(color),
  }));
  g.add(shell({
    yTop: 0.46, yBot: 0.36, hem: shortsHem(0.36),
    gap: 0.055, minR: (v) => 0.97 - 0.04 * v, rows: 2, cols: 26, material: sharedMat(shade(color, 0.72)),
  }));
  g.add(drawstring(1.19));
  return g;
}

function longPants(rig, color) {
  const g = new THREE.Group();
  g.add(shell({
    yTop: 1.25, yBot: 0.62,
    gap: 0.05, minR: (v) => 0.97 - 0.03 * v, rows: 8, cols: 26, material: sharedMat(color),
  }));
  const cuffMat = sharedMat(shade(color, 0.72));
  for (const sx of [-1, 1]) {
    // leg tubes wrap the LEG (x = ±LEG_X, r 0.38), not the egg — flagged so
    // the shell check measures them against the limb instead
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.47, 0.32, 12), sharedMat(color));
    leg.position.set(sx * LEG_X, 0.46, 0);
    leg.userData.limbWrap = LEG_X * sx;
    leg.castShadow = true;
    g.add(leg);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.455, 0.455, 0.07, 12), cuffMat);
    cuff.position.set(sx * LEG_X, 0.33, 0);
    cuff.userData.limbWrap = LEG_X * sx;
    cuff.castShadow = true;
    g.add(cuff);
  }
  return g;
}

function skirt(rig, color) {
  const g = new THREE.Group();
  g.add(shell({
    yTop: 1.25, yBot: 0.52, gap: 0.06, flare: 0.3,
    rows: 8, cols: 26, material: sharedMat(color),
  }));
  g.add(shell({
    yTop: 1.25, yBot: 1.15, gap: 0.065,
    rows: 2, cols: 26, material: sharedMat(shade(color, 0.72)),
  }));
  return g;
}

// ---------------------------------------------------------------- tops
const TANK_GAP = 0.095; // tops ride OUTSIDE the pants layer so they never z-fight

/** Top edge that tucks up BEHIND the grin: within the lip's ±66° sweep the
 *  edge rides just under the lower lip tube's centre line, so the lip's front
 *  bulk hides it (the garment's shell radius stays inside the tube's depth).
 *  Past the sweep it eases down behind the corner bulbs to the garment's full
 *  height over the shoulders and back. */
const LIP_SIN = Math.sin(LIP_THETA);
function lipNeckline(fullY) {
  return (th) => {
    const d = Math.abs(Math.atan2(Math.sin(th), Math.cos(th))); // |angle| from the front
    if (d >= 1.8) return fullY; // well behind the corner bulbs
    const u = Math.min(1, d / LIP_THETA);
    const s = (Math.sin(u * LIP_THETA) / LIP_SIN) ** 2;
    const tuck = LIP_Y + LIP_CURL * s - LIP_LOW_DY * (1 - LIP_FUSE * s) - 0.04;
    if (d <= LIP_THETA) return tuck;
    const t = Math.min(1, (d - LIP_THETA) / 0.65);
    const e = t * t * (3 - 2 * t);
    return tuck + (fullY - tuck) * e;
  };
}

function tankTop(rig, color) {
  const g = new THREE.Group();
  const mat = sharedMat(color, { side: THREE.DoubleSide });
  // sleeveless trunk covering, front edge tucked behind the lip
  g.add(shell({
    yTop: 2.2, yBot: 1.0, top: lipNeckline(2.2),
    gap: TANK_GAP, rows: 14, cols: 30, material: mat,
  }));
  return g;
}

/** A short sleeve tube around the arm's upper end. Parented to the ARM
 *  itself so it swings with every arm pose. */
function addSleeve(rig, color, length = 0.3, rTop = 0.385, rBot = 0.42) {
  const sleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, length, 10),
    sharedMat(color, { side: THREE.DoubleSide }));
  sleeve.position.y = -(0.01 + length / 2); // arm-local: over the shoulder cap
  sleeve.castShadow = true;
  sleeve.userData.garment = 'top';
  for (const arm of [rig.parts.armL, rig.parts.armR]) arm.add(sleeve.clone());
}

function tee(rig, color) {
  const g = new THREE.Group();
  const mat = sharedMat(color, { side: THREE.DoubleSide });
  g.add(shell({
    yTop: 2.16, yBot: 0.98, top: lipNeckline(2.16),
    gap: TANK_GAP, rows: 14, cols: 30, material: mat,
  }));
  addSleeve(rig, color); // parented to the arms, not to this group
  return g;
}

const INK = MOBU_PALETTE.ink;

function shirt(rig, color) {
  const g = new THREE.Group();
  const mat = sharedMat(color, { side: THREE.DoubleSide });
  g.add(shell({
    yTop: 2.2, yBot: 0.94, top: lipNeckline(2.2),
    gap: TANK_GAP, rows: 14, cols: 30, material: mat,
  }));
  // collar band behind the shoulders only (never forward of the sides)
  g.add(shell({
    yTop: 2.36, yBot: 2.2, a0: Math.PI - 1.15, a1: Math.PI + 1.15,
    gap: 0.12, rows: 2, cols: 10,
    material: sharedMat(shade(color, 0.72), { side: THREE.DoubleSide }),
  }));
  addSleeve(rig, color);
  // three buttons down the chest, clear of the grin's overhang
  const ink = sharedMat(INK, { roughness: 0.6 });
  for (const y of [1.5, 1.28, 1.06]) {
    const btn = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), ink);
    btn.position.copy(surfacePoint(y, 0, 0.16));
    btn.castShadow = true;
    g.add(btn);
  }
  return g;
}

function coat(rig, color) {
  const g = new THREE.Group();
  const mat = sharedMat(color, { side: THREE.DoubleSide });
  // open at the front: the shell skips a ±0.55 rad chest wedge so the pants
  // show through, then flares down past the shorts like a long coat. The
  // panel edges rise to the lip height like tall lapels.
  g.add(shell({
    yTop: 2.14, yBot: 0.5, top: lipNeckline(2.14),
    a0: 0.55, a1: Math.PI * 2 - 0.55,
    gap: 0.13, rows: 12, cols: 30, flare: 0.18, material: mat,
  }));
  addSleeve(rig, color, 0.44, 0.385, 0.4); // long sleeves
  return g;
}

// ---------------------------------------------------------------- head
// Hats perch on the CROWN, clear of the eyes: the eye dots top out at
// EYE_Y + 0.1, so every rim/band sits at ~3.1 and hugs the narrower skull
// above them.
const EYE_CLEAR_Y = EYE_Y + 0.12;

/** Skullcap dome whose rim sits at rimY (just above the eyes). */
function domeAbove(rimY, radius, color) {
  const dome_ = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 16, 8, 0, Math.PI * 2, 0, Math.acos((rimY - HEAD_Y) / radius)),
    sharedMat(color));
  dome_.position.y = HEAD_Y;
  dome_.castShadow = true;
  return dome_;
}

function cap(rig, color) {
  const g = new THREE.Group();
  g.add(domeAbove(EYE_CLEAR_Y, HEAD_R + 0.06, color));
  // a long visor hovering over the eye tops, reaching well past the dome
  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.68, 0.055, 12, 1, false, -0.95, 1.9),
    sharedMat(shade(color, 0.85)));
  brim.position.set(0, EYE_CLEAR_Y + 0.01, 0.45);
  brim.rotation.x = -0.1;
  brim.castShadow = true;
  g.add(brim);
  const button = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), sharedMat(shade(color, 0.85)));
  button.position.set(0, HEAD_Y + HEAD_R + 0.06, 0);
  g.add(button);
  return g;
}

function beanie(rig, color) {
  const g = new THREE.Group();
  const R = HEAD_R + 0.08;
  const rimY = EYE_CLEAR_Y + 0.02;
  g.add(domeAbove(rimY, R, color));
  // rolled band hugging the dome's rim radius at that height
  const rimR = R * Math.sin(Math.acos((rimY - HEAD_Y) / R));
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(rimR, 0.075, 8, 20),
    sharedMat(shade(color, 0.72)));
  band.rotation.x = Math.PI / 2;
  band.position.y = rimY;
  band.castShadow = true;
  g.add(band);
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), sharedMat(0xfffdf2, { roughness: 0.8 }));
  pom.position.set(0, HEAD_Y + R + 0.1, -0.05);
  pom.castShadow = true;
  g.add(pom);
  return g;
}

function bow(rig, color) {
  const g = new THREE.Group();
  const mat = sharedMat(color);
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat);
  knot.position.set(0, 3.22, -0.5);
  knot.castShadow = true;
  g.add(knot);
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
    wing.scale.set(0.24, 0.14, 0.1);
    wing.position.set(sx * 0.23, 3.25, -0.52);
    wing.rotation.y = sx * -0.5;
    wing.castShadow = true;
    g.add(wing);
  }
  return g;
}

function headband(rig, color) {
  const g = new THREE.Group();
  // a slim ring hugging the skull just above the eye dots
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.05, 8, 22), sharedMat(color));
  band.rotation.x = Math.PI / 2;
  band.rotation.z = 0.1;
  band.position.y = EYE_CLEAR_Y + 0.09;
  band.castShadow = true;
  g.add(band);
  return g;
}

// ---------------------------------------------------------------- face
/** Point on the head SPHERE (not the egg) at height y, angle θ, pushed out by off. */
function headPoint(y, theta, off = 0) {
  const dy = y - HEAD_Y;
  const r = Math.sqrt(Math.max(0, HEAD_R * HEAD_R - dy * dy)) + off;
  return new THREE.Vector3(r * Math.sin(theta), y, r * Math.cos(theta));
}

function glasses(rig, color) {
  const g = new THREE.Group();
  const ink = sharedMat(MOBU_PALETTE.ink, { roughness: 0.6 });
  for (const sx of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.032, 6, 14), ink);
    ring.position.set(sx * EYE_X, EYE_Y, 0.76);
    ring.castShadow = true;
    g.add(ring);
    const temple = tubeBetween(
      new THREE.Vector3(sx * (EYE_X + 0.15), EYE_Y, 0.72),
      new THREE.Vector3(sx * 0.68, EYE_Y - 0.02, 0.36),
      0.025, ink);
    g.add(temple);
  }
  g.add(tubeBetween(
    new THREE.Vector3(-EYE_X + 0.13, EYE_Y + 0.03, 0.78),
    new THREE.Vector3(EYE_X - 0.13, EYE_Y + 0.03, 0.78),
    0.025, ink));
  return g;
}

function freckles(rig, color) {
  const g = new THREE.Group();
  const ink = sharedMat(MOBU_PALETTE.ink, { roughness: 0.6 });
  const spots = [[0.4, 2.86], [0.55, 2.82], [0.33, 2.79]];
  for (const sx of [-1, 1]) {
    for (const [th, y] of spots) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.026, 6, 5), ink);
      dot.position.copy(headPoint(y, sx * th, 0.005));
      g.add(dot);
    }
  }
  return g;
}

function blush(rig, color) {
  const g = new THREE.Group();
  const mat = sharedMat(0xf2909f, { roughness: 0.8 });
  for (const sx of [-1, 1]) {
    const patch = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
    patch.scale.set(0.11, 0.07, 0.045);
    const p = headPoint(2.82, sx * 0.58, 0.01);
    patch.position.copy(p);
    patch.lookAt(p.clone().multiplyScalar(2));
    g.add(patch);
  }
  return g;
}

// ---------------------------------------------------------------- catalog
export const WARDROBE = {
  pants: [
    { id: 'classic', label: 'Classic shorts', build: classicShorts },
    { id: 'plain', label: 'Plain shorts', build: plainShorts },
    { id: 'pants', label: 'Long pants', build: longPants },
    { id: 'skirt', label: 'Skirt', build: skirt },
  ],
  top: [
    { id: 'none', label: 'Nothing', build: null },
    { id: 'shirt', label: 'Shirt', build: shirt },
    { id: 'tee', label: 'T-shirt', build: tee },
    { id: 'tank', label: 'Trunk top', build: tankTop },
    { id: 'coat', label: 'Long coat', build: coat },
  ],
  head: [
    { id: 'none', label: 'Bare', build: null },
    { id: 'cap', label: 'Cap', build: cap, hidesTufts: true },
    { id: 'beanie', label: 'Beanie', build: beanie, hidesTufts: true },
    { id: 'bow', label: 'Bow', build: bow },
    { id: 'headband', label: 'Headband', build: headband },
  ],
  face: [
    { id: 'none', label: 'Plain', build: null },
    { id: 'glasses', label: 'Glasses', build: glasses },
    { id: 'freckles', label: 'Freckles', build: freckles },
    { id: 'blush', label: 'Blush', build: blush },
  ],
};

export function itemOf(slot, id) {
  return WARDROBE[slot].find((w) => w.id === id) || WARDROBE[slot][0];
}

export function colorOf(slot, spec) {
  const ci = (spec && Array.isArray(spec[slot]) ? Number(spec[slot][1]) : 0) || 0;
  return CLOTH_COLORS[((ci % CLOTH_COLORS.length) + CLOTH_COLORS.length) % CLOTH_COLORS.length];
}

// ---------------------------------------------------------------- spec utils
export function normalizeCostume(raw) {
  const out = {};
  for (const slot of SLOT_KEYS) {
    const v = raw && typeof raw === 'object' ? raw[slot] : null;
    const id = Array.isArray(v) && typeof v[0] === 'string' ? v[0] : DEFAULT_COSTUME[slot][0];
    const safeId = WARDROBE[slot].some((w) => w.id === id) ? id : DEFAULT_COSTUME[slot][0];
    const ci = Number(Array.isArray(v) ? v[1] : NaN);
    const safeCi = Number.isFinite(ci) ? Math.trunc(ci) : DEFAULT_COSTUME[slot][1];
    out[slot] = [safeId, ((safeCi % CLOTH_COLORS.length) + CLOTH_COLORS.length) % CLOTH_COLORS.length];
  }
  return out;
}

function pickWeighted(rng, weights) {
  let sum = 0;
  for (const w of weights) sum += w[1];
  let roll = rng() * sum;
  for (const [value, w] of weights) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return weights[weights.length - 1][0];
}

/** A random outfit. Bare slots are common — most mobus wear just shorts. */
export function randomCostume(rng = Math.random) {
  return {
    pants: [pickWeighted(rng, [['classic', 5], ['plain', 2], ['pants', 2.2], ['skirt', 1.6]]), Math.floor(rng() * CLOTH_COLORS.length)],
    top: [pickWeighted(rng, [['none', 3], ['shirt', 2], ['tee', 2.2], ['tank', 2], ['coat', 1.8]]), Math.floor(rng() * CLOTH_COLORS.length)],
    head: [pickWeighted(rng, [['none', 4.6], ['cap', 1.9], ['beanie', 1.5], ['bow', 1], ['headband', 1]]), Math.floor(rng() * CLOTH_COLORS.length)],
    face: [pickWeighted(rng, [['none', 5], ['glasses', 1.7], ['freckles', 1.2], ['blush', 1.2]]), 0],
  };
}

/** Deterministic PRNG (mulberry32) — the fallback when a racer arrives
 *  without costume data, so every client derives the SAME outfit. */
export function costumeFromSeed(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return randomCostume(rng);
}

export function costumeSeedFromText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- applying
function clearGarments(pivot, slot) {
  for (const child of pivot.children.slice()) {
    if (child.userData?.garment !== slot) continue;
    pivot.remove(child);
    child.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
  }
}

/** Build the outfit described by spec onto the rig. Safe to call repeatedly. */
export function applyCostume(rig, rawSpec) {
  const spec = normalizeCostume(rawSpec);
  let headHidesTufts = false;
  for (const slot of SLOT_KEYS) {
    const pivot =
      slot === 'pants' ? rig.attach.hips :
      slot === 'top' ? rig.attach.chest :
      slot === 'head' ? rig.attach.head : rig.attach.face;
    clearGarments(pivot, slot);
    // tee sleeves are parented to the arms so they swing with them — sweep
    // those too when the top slot changes
    if (slot === 'top') {
      clearGarments(rig.parts.armL, slot);
      clearGarments(rig.parts.armR, slot);
    }
    const [id, ci] = spec[slot];
    const item = itemOf(slot, id);
    // Glasses' rings would poke through a hat's dome (they reach past it by
    // design, to stay visible around the eyes) — skip them under such a hat.
    const hidden = slot === 'face' && headHidesTufts && item.id === 'glasses';
    if (item.build && !hidden) {
      const garment = item.build(rig, CLOTH_COLORS[ci]);
      garment.userData.garment = slot;
      pivot.add(garment);
    }
    if (slot === 'head') {
      headHidesTufts = !!item.hidesTufts;
      rig.parts.tufts.visible = !item.hidesTufts;
    }
  }
}
