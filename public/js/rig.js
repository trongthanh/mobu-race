// Mobu rig — canonical measurements, the egg profile and shared materials.
// Ported from ref/MOBU.md: every number below is in canonical rig units with
// feet at y = 0 and the whole character 3.75 units to the tuft tips. The
// builder in mobu.js scales the assembled rig as ONE unit; never rescale parts.
import * as THREE from '../vendor/three.module.js';

// ---------------------------------------------------------------- palette
export const MOBU_PALETTE = {
  ink: 0x231f20,       // eyes, tufts — never #000000
  bodyLight: 0xffc24a, // declared for completeness; the key light does this
  bodyBase: 0xffbb08,  // the whole body, head, arms and legs
  bodyShade: 0xe08a00,
  lips: 0xff7908,      // one orange vinyl surface; lighting shapes the lower lip
  lipsShade: 0xc13d05, // warm occlusion tint inside the smile crease
  white: 0xffffff,
};

// Smooth toy-vinyl materials, shared across the cast. Include all supported
// options in the key: the vertex-coloured mouth must not tint other orange parts.
const matCache = new Map();

export function sharedMat(hex, opts = {}) {
  const side = opts.side ?? THREE.FrontSide;
  const roughness = opts.roughness ?? 0.48;
  const vertexColors = opts.vertexColors ?? false;
  const key = `${hex}|${side}|${roughness}|${vertexColors}`;
  if (!matCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({
      color: hex, roughness, metalness: 0, vertexColors, side,
    });
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return matCache.get(key);
}

// ---------------------------------------------------------------- the egg
export const MOBU_HEIGHT = 3.75; // including tufts

export const CROWN_Y = 3.46;   // top of the skull; the tufts stand above it
export const BODY_BOTTOM = 0.23; // the foot hollow, where the egg closes between the legs
export const BODY_C = 1.18;    // body ellipsoid centre…
export const BODY_DOWN = 0.95; // …semi-height below it (closes at 0.23)
export const BODY_UP = 1.38;   // …and above it (closes at 2.56, INSIDE the head sphere)
export const BLEND = 0.3;      // smooth-max blend width — how soft the shoulder is
export const WAIST_Y = 2.03;   // where the body mesh hands over to the head mesh
export const HEAD_Y = 2.59;    // head sphere centre
export const HEAD_R = 0.87;    // …and radius
export const HIP_R = 1.02;     // the widest turn — WIDER THAN THE HEAD
export const CHEST_Y = 1.55;
export const CHEST_R = 1.0;

// ---------------------------------------------------------------- limbs
export const LEG_LEN = 0.44;
export const LEG_X = 0.5;
export const LEG_R = 0.38;
export const SHOULDER_Y = 1.86;
export const SHOULDER_X = 0.76;
export const ARM_LEN = 0.52;
export const ARM_R = 0.31;
export const ARM_OUT_ROT = 1.25; // rad from straight down: arms rest out, ~18° below horizontal

// ---------------------------------------------------------------- the grin
// Section half-heights = DY + R; both halves round into END_R at the cheeks.
// The old tube-offset ratio is retained for garment neckline compatibility;
// the actual closed, grooved surface now lives in mobu-mouth.js.
export const LIP_Y = 2.21;       // the crease line's height at the centre
export const LIP_SCALE = 0.91;   // whole sculpt, anchored at the face attachment
export const LIP_R = HEAD_R * 1.1; // unscaled width reference for construction
export const LIP_THETA = 1.15;   // ±66°: reference angular span
export const LIP_UP_DY = 0.14;   // equal 0.38 half-heights around the crease
export const LIP_UP_R = 0.24;
export const LIP_LOW_DY = 0.14;
export const LIP_LOW_R = 0.24;
export const LIP_END_R = 0.40;   // 0.80-diameter ends: subtly fuller than the middle
export const LIP_CURL = 0.45;    // how far the corners ride up
export const LIP_FUSE = 0.7;     // how far the two tubes converge into one bulb at the corner

export const LIP_FLOOR = LIP_Y - LIP_LOW_DY - LIP_LOW_R; // centre lip's lowest point
export const LIP_CEIL = LIP_Y + LIP_CURL + LIP_END_R;    // 2.97 — highest, at the CORNERS

// ---------------------------------------------------------------- face
export const EYE_Y = 2.85;
export const EYE_X = 0.22;
export const EYE_Z = 0.77;
export const TUFT_Y = 3.32;     // tuft pivot (the crown) — sway rotates HERE
export const TUFT_LEAN = -0.42; // rad about X: they lean BACK, not sideways

// ------------------------------------------------------------ profile math
/** An ellipsoid's radius at height y: 0 outside it, so it can be unioned. */
export function ellipsoid(y, centre, down, radius, up = down) {
  const t = (y - centre) / (y < centre ? down : up);
  return t <= -1 || t >= 1 ? 0 : radius * Math.sqrt(1 - t * t);
}

/** Smooth maximum: the union that rounds its own join. */
export function smax(a, b, k) {
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (a - b)) / k));
  return b + ((a - b) * h + k * h * (1 - h));
}

export function eggRadius(y) {
  const bodyR = ellipsoid(y, BODY_C, BODY_DOWN, HIP_R, BODY_UP);
  const headR = ellipsoid(y, HEAD_Y, HEAD_R, HEAD_R);
  // Blend ONLY where both solids are present: smax(0, 0, k) is k/4, not 0,
  // which at the crown leaves a flat plateau instead of a closed skull.
  if (bodyR <= 0 || headR <= 0) return Math.max(bodyR, headR);
  return smax(bodyR, headR, BLEND);
}

// Rows are COSINE-SPACED, so they bunch at the foot hollow and the crown where
// the curve turns hardest and thin out down the straight of the flank.
export const PROFILE_ROWS = 48;
export const BODY_PROFILE = Array.from({ length: PROFILE_ROWS }, (_, i) => {
  const t = i / (PROFILE_ROWS - 1);
  const y = BODY_BOTTOM + (CROWN_Y - BODY_BOTTOM) * (0.5 - 0.5 * Math.cos(Math.PI * t));
  return [eggRadius(y), y];
});

/** The silhouette half-width at height y — cut every garment from THIS. */
export function radiusAt(y) {
  if (y <= BODY_PROFILE[0][1] || y >= BODY_PROFILE[BODY_PROFILE.length - 1][1]) return 0;
  for (let i = 1; i < BODY_PROFILE.length; i++) {
    const [r1, y1] = BODY_PROFILE[i];
    if (y <= y1) {
      const [r0, y0] = BODY_PROFILE[i - 1];
      const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
      return r0 + (r1 - r0) * t;
    }
  }
  return 0;
}

/** The profile between two heights, with the cut ends interpolated onto it. */
export function profileSlice(y0, y1) {
  const out = [[radiusAt(y0) || 1e-4, y0]];
  for (const [r, y] of BODY_PROFILE) if (y > y0 && y < y1) out.push([r, y]);
  out.push([radiusAt(y1) || 1e-4, y1]);
  return out;
}

export function lathe(profile, segments = 48) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), segments);
}

// ---------------------------------------------------------------- helpers
/** A thin cylinder spanning p1 → p2 (drawstrings, temples, bridges). */
export function tubeBetween(p1, p2, r, material, segs = 6) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, segs), material);
  mesh.position.copy(p1).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), len > 1e-6 ? dir.clone().normalize() : new THREE.Vector3(0, 1, 0));
  return mesh;
}

/** The point on the egg surface at height y and angle θ, pushed out by `off`. */
export function surfacePoint(y, theta, off = 0, out = new THREE.Vector3()) {
  const r = radiusAt(y) + off;
  return out.set(r * Math.sin(theta), y, r * Math.cos(theta));
}
