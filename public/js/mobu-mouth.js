// One closed, grooved vinyl mouth — not two intersecting tubes or a duck bill.
// Cross-sections have a plump upper/lower lobe and a shallow front-only crease.
// At each cheek they become ONE circular section with a hemispherical end.
import * as THREE from '../vendor/three.module.js';
import {
  MOBU_PALETTE, LIP_Y, LIP_SCALE, LIP_R, LIP_THETA, LIP_CURL,
  LIP_UP_DY, LIP_UP_R, LIP_LOW_DY, LIP_LOW_R, LIP_END_R,
} from './rig.js';

const COLS = 32, SIDES = 48, CAPS = 6;

/** World-space height of the annotated separator curve (before end fade). */
export function separatorY(u, smile = 0) {
  const curl = LIP_CURL + 0.12 * smile;
  return LIP_Y + 0.035 + (curl + 0.13) * u * u;
}

function sculpt(smile) {
  const positions = [], colors = [], indices = [], rings = [];
  const c = new THREE.Vector3(), t = new THREE.Vector3();
  const front = new THREE.Vector3(), up = new THREE.Vector3(), p = new THREE.Vector3();
  // Anchor near the head surface: resizing reduces the visible sculpt while
  // retaining the small amount of rear overlap that attaches it to the face.
  const anchor = new THREE.Vector3(0, LIP_Y, 0.78);
  const orange = new THREE.Color(MOBU_PALETTE.lips);
  const crease = new THREE.Color(MOBU_PALETTE.lipsShade);
  const tint = new THREE.Color();
  // Larger cheek bulbs, without widening the whole mouth. The centre section
  // stays slimmer than their diameter, even at maximum smile.
  const halfWidth = (LIP_R * Math.sin(LIP_THETA) - 0.08) * (1 + 0.025 * smile);
  const curl = LIP_CURL + 0.12 * smile;

  function frame(u) {
    // The separator is a smooth smile arc: quiet around the centre and a
    // little steeper at the cheeks, as in the reference. Both lobes are built
    // at the same distance around this curve, so neither reads as thinner.
    const u2 = u * u;
    const arc = u2 * (0.7 + 0.3 * u2);
    const arcSlope = u * (1.4 + 1.2 * u2);
    // Less wrap than the old collar ring: keep the entire grin on the FRONT
    // of the cheeks, with a soft attachment rather than ear-like corner lobes.
    c.set(halfWidth * u, LIP_Y + curl * arc, 0.99 - 0.25 * u2);
    t.set(halfWidth, curl * arcSlope, -0.5 * u).normalize();
    front.set(-t.z, 0, t.x).normalize();
    up.crossVectors(front, t).normalize();
  }

  function ring(u, capAngle = 0, capSign = 0) {
    frame(u);
    const sweepY = c.y;
    const cap = capSign !== 0;
    const scale = cap ? Math.cos(capAngle) : 1;
    if (cap) c.addScaledVector(t, capSign * LIP_END_R * Math.sin(capAngle));
    const blend = u * u;
    // Keep the accepted outer outline symmetric around the sweep center. The
    // visible separator is independently lifted into the annotated quadratic
    // U-curve, compensating for the front projection so both lobes READ equally.
    const middleHalf = LIP_UP_DY + LIP_UP_R + 0.012 * smile;
    const halfHeight = THREE.MathUtils.lerp(middleHalf, LIP_END_R, blend);
    const top = halfHeight;
    const bottom = halfHeight;
    const depth = THREE.MathUtils.lerp(0.30, LIP_END_R, blend);
    const grooveWeight = cap ? 0 : (1 - u ** 8) ** 2;
    // Convert the exact annotated world-space curve to this sweep frame's local
    // up axis. (At the cheeks that axis tilts, so a raw Y offset is inaccurate.)
    const projectedLift = (separatorY(u, smile) - sweepY) / Math.max(0.5, up.y);
    const creaseY = projectedLift * scale;
    const creaseAngle = Math.asin(THREE.MathUtils.clamp(
      creaseY / Math.max(0.001, halfHeight * scale), -0.9, 0.9,
    ));
    rings.push(positions.length / 3);
    for (let j = 0; j < SIDES; j++) {
      const raw = j / SIDES * Math.PI * 2;
      // Concentrate vertices around the raised separator while preserving the
      // same top/bottom envelope. The crease vertex itself is raw angle zero.
      const baseAngle = Math.atan2(Math.sin(raw) * 0.55, Math.cos(raw));
      // Reparameterise only the front half of the same ellipse. raw=0 lands
      // exactly on the raised separator; sides/back and the silhouette do not
      // move, so there is no wedge or folded transition into the cheek bulbs.
      const a = baseAngle + creaseAngle * Math.max(0, Math.cos(baseAngle));
      const sin = Math.sin(a), cos = Math.cos(a);
      const y = sin * (sin >= 0 ? top : bottom) * scale;
      const facing = Math.max(0, cos);
      const fromCrease = y - creaseY;
      const groove = 0.065 * Math.exp(-((fromCrease / 0.035) ** 2)) * grooveWeight * facing;
      const z = depth * cos * scale - groove;
      p.copy(c).addScaledVector(up, y).addScaledVector(front, z);
      p.sub(anchor).multiplyScalar(LIP_SCALE).add(anchor);
      positions.push(p.x, p.y, p.z);
      // Warm contact shadow only at the bottom of the actual geometric crease.
      // Both lobes otherwise share the same pigment (no painted-on lower half).
      const shadow = 0.68 * Math.exp(-((fromCrease / 0.009) ** 2)) * grooveWeight * facing ** 8;
      tint.copy(orange).lerp(crease, shadow);
      colors.push(tint.r, tint.g, tint.b);
    }
  }

  frame(-1);
  p.copy(c).addScaledVector(t, -LIP_END_R);
  p.sub(anchor).multiplyScalar(LIP_SCALE).add(anchor);
  positions.push(p.x, p.y, p.z);
  colors.push(orange.r, orange.g, orange.b);
  for (let k = CAPS; k >= 1; k--) ring(-1, k / (CAPS + 1) * Math.PI / 2, -1);
  for (let i = 0; i <= COLS; i++) ring(-1 + 2 * i / COLS);
  for (let k = 1; k <= CAPS; k++) ring(1, k / (CAPS + 1) * Math.PI / 2, 1);
  frame(1);
  p.copy(c).addScaledVector(t, LIP_END_R);
  p.sub(anchor).multiplyScalar(LIP_SCALE).add(anchor);
  const end = positions.length / 3;
  positions.push(p.x, p.y, p.z);
  colors.push(orange.r, orange.g, orange.b);

  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < SIDES; j++) {
      const a = rings[i] + j, b = rings[i] + (j + 1) % SIDES;
      const d = rings[i + 1] + j, e = rings[i + 1] + (j + 1) % SIDES;
      indices.push(a, d, b, b, d, e);
    }
  }
  for (let j = 0; j < SIDES; j++) {
    const next = (j + 1) % SIDES;
    indices.push(0, rings[0] + j, rings[0] + next);
    const last = rings.at(-1);
    indices.push(end, last + next, last + j);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createMouthGeometry() {
  const geometry = sculpt(0);
  const smile = sculpt(1);
  geometry.morphAttributes.position = [smile.attributes.position];
  geometry.morphAttributes.normal = [smile.attributes.normal];
  geometry.morphAttributes.position[0].name = 'smile';
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  // Attributes above are ordinary CPU buffers, retained by the base geometry.
  smile.dispose();
  return geometry;
}
