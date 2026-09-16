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
  0xffb008, 0xe4574c, 0xf472b6, 0xb98cf7, 0x8ab6f9, 0x5fc9c2,
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
  const r = radiusAt(y) + 0.105;
  for (const sx of [-1, 1]) {
    const string_ = tubeBetween(
      new THREE.Vector3(sx * 0.05, y + 0.02, r),
      new THREE.Vector3(sx * 0.17, y - 0.13, r + 0.03),
      0.026, ink);
    g.add(string_);
  }
  g.add(tubeBetween(new THREE.Vector3(0, y, r + 0.01), new THREE.Vector3(0.035, y - 0.19, r + 0.025), 0.025, ink));
  return g;
}

/** A rounded white blob decal with a tick inside, stuck to the shell.
 *  Built in a local frame where +Z faces outward, then glued to the surface. */
function blobDecal(theta, y, tickColor) {
  const g = new THREE.Group();
  const blob = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), sharedMat(0xfffdf2, { roughness: 0.8 }));
  blob.scale.set(0.185, 0.205, 0.025);
  blob.castShadow = true;
  g.add(blob);
  // Two rounded strokes, not a torus/C: the photo has unmistakable check marks.
  const points = [new THREE.Vector3(-0.095, -0.005, 0.029), new THREE.Vector3(-0.025, -0.073, 0.032), new THREE.Vector3(0.095, 0.093, 0.029)];
  const mat = sharedMat(tickColor, { roughness: 0.8 });
  for (let i = 1; i < points.length; i++) g.add(tubeBetween(points[i - 1], points[i], 0.025, mat, 10));
  const capGeo = new THREE.SphereGeometry(0.025, 8, 6);
  for (const point of points) {
    const cap = new THREE.Mesh(capGeo, mat);
    cap.position.copy(point);
    g.add(cap);
  }
  // Project every patch/tick vertex onto the SAME tapered shorts shell. A
  // rigid flat decal at radiusAt(centreY) sinks into the minimum-radius hem.
  for (const mesh of g.children) {
    mesh.updateMatrix();
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrix);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const yy = y + pos.getY(i);
      const v = THREE.MathUtils.clamp((1.25 - yy) / (1.25 - 0.36), 0, 1);
      const shellR = Math.max(0.97 - 0.04 * v, radiusAt(yy) + 0.05);
      const angle = theta + pos.getX(i) / shellR;
      const r = shellR + 0.009 + pos.getZ(i);
      pos.setXYZ(i, r * Math.sin(angle), yy, r * Math.cos(angle));
    }
    geometry.computeVertexNormals();
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
  }
  return g;
}

// Bake rigid same-material decorations together: ten tick patches should not
// cost sixty draw calls per racer. These meshes all move with the same garment.
function mergeGarment(group) {
  group.updateMatrixWorld(true);
  const batches = new Map(), disposable = new Set();
  group.traverse((mesh) => {
    if (!mesh.isMesh) return;
    let batch = batches.get(mesh.material);
    if (!batch) { batch = { positions: [], normals: [], indices: [] }; batches.set(mesh.material, batch); }
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const offset = batch.positions.length / 3;
    batch.positions.push(...geometry.attributes.position.array);
    batch.normals.push(...geometry.attributes.normal.array);
    const index = geometry.index;
    for (let i = 0; i < (index?.count ?? geometry.attributes.position.count); i++) {
      batch.indices.push(offset + (index ? index.getX(i) : i));
    }
    geometry.dispose();
    disposable.add(mesh.geometry);
  });
  for (const geometry of disposable) geometry.dispose();
  group.clear();
  for (const [material, batch] of batches) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
    geometry.setIndex(batch.indices);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

// ---------------------------------------------------------------- pants
function classicShorts(rig, color) {
  const g = new THREE.Group();
  const main = sharedMat(color);
  g.add(shell({
    yTop: 1.25, yBot: 0.36, hem: shortsHem(0.36),
    gap: 0.05, minR: (v) => 0.97 - 0.04 * v, rows: 14, cols: 48, material: main,
  }));
  g.add(shell({
    yTop: 1.27, yBot: 1.15, gap: 0.067,
    rows: 2, cols: 48, material: main,
  }));
  g.add(drawstring(1.10));
  for (let i = 0; i < 10; i++) {
    const th = (i + 0.5) * Math.PI * 2 / 10;
    g.add(blobDecal(th, i % 2 ? 0.87 : 0.64, color));
  }
  return mergeGarment(g);
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

// Details are curved patches, cut from the same egg profile as the garment.
function clothPatch(g, color, yTop, yBot, a0 = 0, a1 = Math.PI * 2, gap = 0.125) {
  g.add(shell({ yTop, yBot, a0, a1, gap, rows: 3, cols: 32,
    material: sharedMat(color, { side: THREE.DoubleSide }) }));
}
function stripedTop(rig, color) {
  const g = tee(rig, color);
  for (const y of [1.12, 1.40, 1.68]) clothPatch(g, 0xfff4e0, y + 0.10, y);
  return g;
}
function overalls(rig, color) {
  const g = tankTop(rig, 0xfff4e0);
  clothPatch(g, color, 1.58, 1.0);
  for (const th of [-0.38, 0.38, Math.PI - 0.38, Math.PI + 0.38]) {
    clothPatch(g, color, 1.98, 1.48, th - 0.075, th + 0.075, 0.13);
  }
  clothPatch(g, shade(color, 0.77), 1.46, 1.20, -0.23, 0.23, 0.15);
  for (const th of [-0.38, 0.38]) {
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 6), sharedMat(0xf9d976));
    button.position.copy(surfacePoint(1.58, th, 0.18)); g.add(button);
  }
  return g;
}
function varsity(rig, color) {
  const g = tee(rig, color);
  // Cream sleeves contrast with the jacket, not a second coincident sleeve.
  for (const arm of [rig.parts.armL, rig.parts.armR]) {
    for (const child of arm.children) if (child.userData.garment === 'top') child.material = sharedMat(0xfff4e0, { side: THREE.DoubleSide });
  }
  clothPatch(g, 0xfff4e0, 1.12, 1.01);
  clothPatch(g, 0xfff4e0, 1.86, 1.12, -0.045, 0.045);
  g.add(blobDecal(0.48, 1.52, color));
  return g;
}
function raceJersey(rig, color) {
  const g = tankTop(rig, color);
  for (const th of [-1.4, 1.4]) clothPatch(g, 0xfff4e0, 2.05, 1.0, th - 0.12, th + 0.12);
  clothPatch(g, 0xfff4e0, 1.64, 1.22, -0.28, 0.28, 0.135);
  clothPatch(g, INK, 1.56, 1.29, -0.045, 0.045, 0.15); // racing number 1
  return g;
}
function chefJacket(rig, color) {
  const g = shirt(rig, 0xfff4e0);
  clothPatch(g, color, 1.13, 0.98);
  for (const th of [-0.24, 0.24]) for (const y of [1.35, 1.62]) {
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.046, 8, 6), sharedMat(INK));
    button.position.copy(surfacePoint(y, th, 0.16)); g.add(button);
  }
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

function brimmedHat(rig, color) {
  const g = new THREE.Group();
  g.add(domeAbove(EYE_CLEAR_Y + 0.05, HEAD_R + 0.07, color));
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 1.02, 0.065, 24), sharedMat(color));
  brim.position.y = EYE_CLEAR_Y + 0.05; g.add(brim);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 8, 24), sharedMat(shade(color, 0.65)));
  band.rotation.x = Math.PI / 2; band.position.y = EYE_CLEAR_Y + 0.12; g.add(band);
  return g;
}
function chefHat(rig, color) {
  const g = new THREE.Group();
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.67, 0.76, 0.30, 24), sharedMat(0xfff4e0));
  band.position.y = 3.28; g.add(band);
  for (const x of [-0.36, 0, 0.36]) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.37, 16, 10), sharedMat(0xfff4e0));
    puff.position.set(x, 3.55 + (x === 0 ? 0.09 : 0), 0); puff.scale.z = 1.5; g.add(puff);
  }
  return g;
}
function crown(rig, color) {
  const g = new THREE.Group();
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.76, 0.20, 24, 1, true), sharedMat(0xf9d976, { side: THREE.DoubleSide }));
  band.position.y = 3.22; g.add(band);
  for (let i = 0; i < 7; i++) {
    const th = i * Math.PI * 2 / 7;
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.34, 4), sharedMat(0xf9d976));
    tip.position.set(Math.sin(th) * 0.65, 3.49, Math.cos(th) * 0.65); g.add(tip);
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), sharedMat(color));
    gem.position.set(Math.sin(th) * 0.76, 3.24, Math.cos(th) * 0.76); g.add(gem);
  }
  return g;
}
function mushroomHat(rig, color) {
  const g = new THREE.Group();
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), sharedMat(color, { side: THREE.DoubleSide }));
  cap.scale.set(1.07, 0.57, 1.07); cap.position.y = 3.16; g.add(cap);
  for (let i = 0; i < 7; i++) {
    const th = i * 2.4, r = i === 0 ? 0 : 0.68;
    const patch = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), sharedMat(0xfff4e0));
    patch.position.set(Math.sin(th) * r, 3.16 + 0.57 * Math.sqrt(1 - (r / 1.07) ** 2), Math.cos(th) * r);
    patch.scale.y = 0.3; g.add(patch);
  }
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
    { id: 'striped', label: 'Breton stripes', build: stripedTop },
    { id: 'overalls', label: 'Pocket overalls', build: overalls },
    { id: 'varsity', label: 'Varsity jacket', build: varsity },
    { id: 'jersey', label: 'Racing jersey', build: raceJersey },
    { id: 'chef', label: 'Chef jacket', build: chefJacket },
  ],
  head: [
    { id: 'none', label: 'Bare', build: null },
    { id: 'cap', label: 'Cap', build: cap, hidesTufts: true },
    { id: 'beanie', label: 'Beanie', build: beanie, hidesTufts: true },
    { id: 'bow', label: 'Bow', build: bow },
    { id: 'headband', label: 'Headband', build: headband },
    { id: 'brimmed', label: 'Adventure hat', build: brimmedHat, hidesTufts: true },
    { id: 'chef', label: 'Chef toque', build: chefHat, hidesTufts: true },
    { id: 'crown', label: 'Party crown', build: crown, hidesTufts: true },
    { id: 'mushroom', label: 'Mushroom cap', build: mushroomHat, hidesTufts: true },
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

export const COSTUME_LOOKS = [
  ['plain', 'overalls', 'brimmed', 'freckles'],
  ['classic', 'jersey', 'headband', 'none'],
  ['pants', 'chef', 'chef', 'blush'],
  ['skirt', 'coat', 'crown', 'blush'],
  ['plain', 'shirt', 'brimmed', 'freckles'],
  ['skirt', 'striped', 'mushroom', 'blush'],
  ['classic', 'varsity', 'cap', 'none'],
  ['plain', 'striped', 'beanie', 'none'],
  ['skirt', 'varsity', 'bow', 'glasses'],
];
/** Coordinated silhouettes with palette variation; occasional mix-and-match
 * keeps the original wardrobe alive without mostly undressed racers. */
export function randomCostume(rng = Math.random) {
  const look = COSTUME_LOOKS[Math.floor(rng() * COSTUME_LOOKS.length)];
  const primary = Math.floor(rng() * 9);
  const secondary = (primary + 4) % 9;
  const coordinated = rng() < 0.85;
  const colors = [secondary, primary, look[2] === 'brimmed' ? 7 : primary, 0];
  return Object.fromEntries(SLOT_KEYS.map((slot, i) => [slot, [
    coordinated ? look[i] : WARDROBE[slot][Math.floor(rng() * WARDROBE[slot].length)].id,
    colors[i],
  ]]));
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
