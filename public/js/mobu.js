// Mobu Race - character builders (Three.js r186 ESM)
// The mobu rig is a faithful port of ref/MOBU.md: one lathed egg (no neck),
// the two-sausage grin with round corner bulbs, ink eyes, three tufts leaning
// BACK over the crown, capsule arms, stubby legs and the shell shorts.
// Everything is built in canonical units (3.75 tall, feet at y=0) under an
// inner root that is scaled as ONE unit to fit the track's world scale.
import * as THREE from '../vendor/three.module.js';
import {
  MOBU_PALETTE, sharedMat, lathe, profileSlice, radiusAt,
  BODY_BOTTOM, BODY_UP, BODY_DOWN, HIP_R, WAIST_Y, HEAD_Y, HEAD_R, CROWN_Y,
  LIP_Y, LIP_R, LIP_THETA, LIP_UP_DY, LIP_UP_R, LIP_LOW_DY, LIP_LOW_R,
  LIP_END_R, LIP_CURL, LIP_FUSE,
  EYE_Y, EYE_X, EYE_Z, TUFT_Y, TUFT_LEAN,
  LEG_LEN, LEG_X, LEG_R, SHOULDER_Y, SHOULDER_X, ARM_LEN, ARM_R, ARM_OUT_ROT,
} from './rig.js';
import { applyCostume } from './costumes.js';

// World-scale factor: the canonical rig is 3.75 tall, the track was built
// around a ~1.8-unit mobu (lane width 1.1). Scale the whole rig, never parts.
export const MOBU_SCALE = 0.5;
// lanePoint() returns y = 0.05; rig feet are built at local y = 0.
const GROUND_Y = 0.05;
// Name sprites hang above the tufts, in the outer (unscaled) group's frame.
export const MOBU_SPRITE_Y = 2.1;

function setShadow(obj) {
  obj.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
}

// ---------------------------------------------------------------- the grin
const LIP_COLS = 26; // sweep columns per tube, tip to tip
const LIP_SEG = 14;  // samples round the tube's circumference
const LIP_CAPS = 4;  // rings closing each hemispherical end

/** How far along the smile we are: 0 at the centre, 1 at the corner, as the
 *  square of the corner's X — a parabola in the plane the camera sees. */
function sway(u) {
  const s = Math.sin(u * LIP_THETA) / Math.sin(LIP_THETA);
  return s * s;
}

/** The centre line of one lip at sweep position u ∈ [-1,1], offset dy from the crease. */
function lipCentre(u, dy, out) {
  const th = u * LIP_THETA;
  const s = sway(u);
  return out.set(
    LIP_R * Math.sin(th),
    LIP_Y + LIP_CURL * s + dy * (1 - LIP_FUSE * s),
    LIP_R * Math.cos(th),
  );
}

/** One lip tube swept tip to tip, closed at both ends with a hemisphere.
 *  Both tubes run to the same LIP_END_R, so the two caps read as ONE round,
 *  thick bulb at each corner — two sausages joined, not two pipe ends. */
function lipTube(dy, r0, pos, idx) {
  const c = new THREE.Vector3(), t = new THREE.Vector3();
  const ahead = new THREE.Vector3(), behind = new THREE.Vector3();
  const capC = new THREE.Vector3(), p = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const rings = [];

  const frameAt = (u) => {
    lipCentre(u, dy, c);
    lipCentre(Math.min(1, u + 0.01), dy, ahead);
    lipCentre(Math.max(-1, u - 0.01), dy, behind);
    t.copy(ahead).sub(behind).normalize();
  };

  // The first basis vector is the OUTWARD radial direction squared up against
  // the tangent, so consecutive rings share an orientation and the tube cannot
  // twist along the sweep (a free-floating frame shows as a spiral crease).
  const ring = (centre, tan, r) => {
    e1.set(centre.x, 0, centre.z).normalize();
    e1.addScaledVector(tan, -e1.dot(tan)).normalize();
    e2.crossVectors(tan, e1);
    rings.push(pos.length / 3);
    for (let j = 0; j < LIP_SEG; j++) {
      const a = (j / LIP_SEG) * Math.PI * 2;
      p.copy(centre).addScaledVector(e1, r * Math.cos(a)).addScaledVector(e2, r * Math.sin(a));
      pos.push(p.x, p.y, p.z);
    }
  };

  const radiusAtU = (u) => r0 + (LIP_END_R - r0) * sway(u);

  // ---- the corner at -θ: apex first, then rings opening out to full radius
  frameAt(-1);
  const apexA = pos.length / 3;
  p.copy(c).addScaledVector(t, -LIP_END_R);
  pos.push(p.x, p.y, p.z);
  for (let k = LIP_CAPS; k >= 1; k--) {
    const al = (k / (LIP_CAPS + 1)) * (Math.PI / 2);
    capC.copy(c).addScaledVector(t, -LIP_END_R * Math.sin(al));
    ring(capC, t, LIP_END_R * Math.cos(al));
  }

  // ---- the sweep (column 0 IS the -θ cap's base ring, at α=0)
  for (let i = 0; i < LIP_COLS; i++) {
    const u = -1 + (2 * i) / (LIP_COLS - 1);
    frameAt(u);
    ring(c, t, radiusAtU(u));
  }

  // ---- the corner at +θ
  frameAt(1);
  for (let k = 1; k <= LIP_CAPS; k++) {
    const al = (k / (LIP_CAPS + 1)) * (Math.PI / 2);
    capC.copy(c).addScaledVector(t, LIP_END_R * Math.sin(al));
    ring(capC, t, LIP_END_R * Math.cos(al));
  }
  const apexB = pos.length / 3;
  p.copy(c).addScaledVector(t, LIP_END_R);
  pos.push(p.x, p.y, p.z);

  // Stitch. Ring vertices run about (e1 → e2), rings advance along +t, and
  // (e1, e2, t) is right-handed, so ∂angle × ∂t points OUT of the tube.
  const before = idx.length;
  for (let r = 0; r < rings.length - 1; r++) {
    for (let j = 0; j < LIP_SEG; j++) {
      const j2 = (j + 1) % LIP_SEG;
      const a = rings[r] + j, b = rings[r] + j2;
      const d = rings[r + 1] + j, e = rings[r + 1] + j2;
      idx.push(a, b, d, b, e, d);
    }
  }
  const last = rings[rings.length - 1];
  for (let j = 0; j < LIP_SEG; j++) {
    const j2 = (j + 1) % LIP_SEG;
    idx.push(rings[0] + j2, rings[0] + j, apexA); // near apex fans backward…
    idx.push(last + j, last + j2, apexB);         // …far apex forward
  }
  return idx.length - before;
}

/** The grin: upper lip, then lower, as one geometry with two material groups. */
function sausageLips() {
  const pos = [], idx = [];
  const upper = lipTube(LIP_UP_DY, LIP_UP_R, pos, idx);
  const lower = lipTube(-LIP_LOW_DY, LIP_LOW_R, pos, idx);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.addGroup(0, upper, 0);        // material 0: `lips`
  geo.addGroup(upper, lower, 1);    // material 1: `lipsShade`
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------- the rig
export function createMobu(opts = {}) {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';

  const root = new THREE.Group(); // canonical 3.75-tall rig, scaled as one unit
  root.scale.setScalar(MOBU_SCALE);
  root.position.y = GROUND_Y;
  group.add(root);

  const bodyMat = sharedMat(MOBU_PALETTE.bodyBase);
  const lipsMat = sharedMat(MOBU_PALETTE.lips, { roughness: 0.55 });
  const lipsShadeMat = sharedMat(MOBU_PALETTE.lipsShade, { roughness: 0.55 });
  const inkMat = sharedMat(MOBU_PALETTE.ink, { roughness: 0.6 });

  // --- body + head: ONE profile of revolution, lathed once and cut in two at
  // WAIST_Y. The two halves share a material and never move apart; they exist
  // as two meshes so each keeps an honest bounding box.
  const body = new THREE.Mesh(lathe(profileSlice(BODY_BOTTOM, WAIST_Y)), bodyMat);
  const head = new THREE.Mesh(lathe(profileSlice(WAIST_Y, CROWN_Y)), bodyMat);

  const upper = new THREE.Group(); // bob / lean / tilt move this as one unit
  upper.add(body, head);

  // --- the grin: a SIBLING of head, never its child (a child's bbox would
  // flow into the head's). Vertices sit at absolute rig heights, so the pose
  // engine only ever TRANSLATES this mesh — never scales it about the origin.
  const lips = new THREE.Mesh(sausageLips(), [lipsMat, lipsShadeMat]);
  upper.add(lips);

  // --- eyes: two ink dots riding the head's surface; the PAIR is positioned
  // at EYE_Y so any future squash flattens them in place, not toward y=0.
  const eyeGeo = new THREE.SphereGeometry(1, 8, 6);
  const eyes = new THREE.Group();
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, inkMat);
    eye.scale.set(0.085, 0.1, 0.085);
    eye.position.set(sx * EYE_X, 0, EYE_Z);
    eyes.add(eye);
  }
  eyes.position.set(0, EYE_Y, 0);
  upper.add(eyes);

  // --- tufts: three fat ink lozenges on the crown, LEANING BACK over it
  // (about X), the outer two splayed (about Z). The group pivots at the crown.
  const tufts = new THREE.Group();
  tufts.position.set(0, TUFT_Y, 0);
  const tipGeo = new THREE.SphereGeometry(1, 8, 6);
  for (const [x, z, height, splay] of [[-0.24, -0.04, 0.24, 0.3], [0, -0.1, 0.3, 0], [0.24, -0.04, 0.24, -0.3]]) {
    const tuft = new THREE.Group();
    tuft.position.set(x, 0, z);
    tuft.rotation.order = 'ZXY';
    tuft.rotation.set(TUFT_LEAN, 0, splay);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, height, 6), inkMat);
    stem.position.y = height / 2;
    const tip = new THREE.Mesh(tipGeo, inkMat);
    tip.scale.set(0.15, 0.16, 0.15);
    tip.position.y = height;
    tuft.add(stem, tip);
    tufts.add(tuft);
  }
  upper.add(tufts);

  // --- arms: CAPSULES (straight shaft, both ends capped with a same-radius
  // sphere), resting out and slightly down. `hand` pivots at the arm tip for
  // any future held props.
  const arms = [];
  const hands = [];
  const armShaftGeo = new THREE.CylinderGeometry(ARM_R, ARM_R, ARM_LEN, 10);
  const armCapGeo = new THREE.SphereGeometry(ARM_R, 10, 8);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * SHOULDER_X, SHOULDER_Y, 0);
    arm.rotation.z = sx * ARM_OUT_ROT;
    const shaft = new THREE.Mesh(armShaftGeo, bodyMat);
    shaft.position.y = -ARM_LEN / 2;
    const capTop = new THREE.Mesh(armCapGeo, bodyMat);
    const capEnd = new THREE.Mesh(armCapGeo, bodyMat);
    capEnd.position.y = -ARM_LEN;
    arm.add(shaft, capTop, capEnd);
    const hand = new THREE.Group();
    hand.position.set(0, -ARM_LEN, 0);
    arm.add(hand);
    upper.add(arm);
    arms.push(arm);
    hands.push(hand);
  }

  root.add(upper);

  // --- legs: pivots at hip height, SIBLINGS of upper — a torso bob must not
  // lift the feet off the ground. Body-coloured; only the (unmodelled) sole
  // is dark in the reference, and no camera sees it.
  const legs = [];
  const legShaftGeo = new THREE.CylinderGeometry(LEG_R, LEG_R, LEG_LEN, 8);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * LEG_X, LEG_LEN, 0);
    const shaft = new THREE.Mesh(legShaftGeo, bodyMat);
    shaft.position.y = -LEG_LEN / 2;
    const foot = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), bodyMat);
    foot.scale.set(LEG_R, LEG_R * 0.78, LEG_R * 1.1);
    // centred so the rounded bottom just REACHES y=0 and never goes below it
    foot.position.set(0, -LEG_LEN + LEG_R * 0.78, 0.05);
    leg.add(shaft, foot);
    root.add(leg);
    legs.push(leg);
  }

  // --- garment pivots: empty groups AT THE RIG ORIGIN under `upper`, so
  // builders work in absolute rig-local Y and call radiusAt(y) directly, and
  // clothes travel with the torso through every pose.
  const attach = {};
  for (const name of ['hips', 'waist', 'chest', 'neck', 'back', 'head', 'face']) {
    attach[name] = new THREE.Group();
    upper.add(attach[name]);
  }

  setShadow(group);

  const rig = {
    root, upper, attach,
    parts: {
      body, head, lips, eyes, tufts,
      armL: arms[0], armR: arms[1], handL: hands[0], handR: hands[1],
      legL: legs[0], legR: legs[1],
    },
    radiusAt,
  };

  // ------------------------------------------------------- costume
  function setCostume(spec) {
    applyCostume(rig, spec);
  }
  setCostume(null); // the default: bare amber mobu in his classic shorts

  // ------------------------------------------------------- animation
  // Heading (travel direction) lives on the OUTER group's rotation.y; the
  // run/idle cycles only add a wobble on top. Lean/roll go on `upper`, so
  // they play in the character's own facing frame.
  let heading = 0;
  let celebrating = false;

  function animate(t, speed = 0) {
    const s = Math.min(1, Math.max(0, speed));

    if (celebrating && s <= 0.02) {
      // --- celebrate: victory hops in place, both arms punched overhead and
      // waving out of phase, tufts bouncing. Takes over from the idle pose
      // only once the mobu has actually stopped (speed ~ 0), so a racer
      // coasts to their spot first and then starts celebrating.
      const f = t * 7;
      group.position.y = GROUND_Y + Math.abs(Math.sin(f)) * 0.26;
      upper.position.y = 0;
      upper.rotation.x = -0.08; // a proud little lean back
      upper.rotation.z = Math.sin(f) * 0.06;
      group.rotation.y = heading + Math.sin(f * 0.5) * 0.22;

      // Arms wave in a wide V — the base angle is picked so the hands clear
      // the egg's silhouette and stay below the (huge) grin, otherwise the
      // raised arms vanish behind the head from almost every camera angle.
      arms[0].rotation.z = -(3 * Math.PI / 4) + Math.sin(f) * 0.3;
      arms[1].rotation.z = (3 * Math.PI / 4) - Math.sin(f * 1.3 + 0.8) * 0.3;
      legs[0].rotation.x = 0;
      legs[1].rotation.x = 0;

      lips.position.y = Math.abs(Math.sin(f)) * 0.04;
      tufts.rotation.x = Math.sin(f + 0.9) * 0.12;
    } else if (s > 0.02) {
      // --- run cycle: a bouncy waddle
      const f = t * 9;
      group.position.y = GROUND_Y + Math.abs(Math.sin(f)) * 0.12 * s; // hop
      upper.position.y = 0;
      upper.rotation.x = 0.14 * s; // forward lean
      upper.rotation.z = Math.sin(f) * 0.08 * s; // roll
      group.rotation.y = heading + Math.sin(f * 0.5) * 0.06 * s;

      arms[0].rotation.z = -ARM_OUT_ROT + Math.sin(f) * 0.6 * s;
      arms[1].rotation.z = ARM_OUT_ROT - Math.sin(f) * 0.6 * s;

      legs[0].rotation.x = Math.sin(f) * 0.65 * s;
      legs[1].rotation.x = -Math.sin(f) * 0.65 * s;

      // jowls bounce; translate ONLY — the grin's vertices are at absolute
      // heights, so scaling it about the rig origin would slide it into his
      // hips.
      lips.position.y = Math.abs(Math.sin(f)) * 0.035 * s;
      tufts.rotation.x = Math.sin(f + 1.2) * 0.09 * s;
    } else {
      // --- idle: gentle breathing bob + occasional grin dip
      group.position.y = GROUND_Y;
      upper.position.y = Math.sin(t * 2) * 0.025;
      upper.rotation.x = 0;
      upper.rotation.z = Math.sin(t * 1.3) * 0.025;
      group.rotation.y = heading + Math.sin(t * 0.9) * 0.05;

      arms[0].rotation.z = -ARM_OUT_ROT - Math.sin(t * 2) * 0.05;
      arms[1].rotation.z = ARM_OUT_ROT + Math.sin(t * 2) * 0.05;
      legs[0].rotation.x = 0;
      legs[1].rotation.x = 0;

      const phase = t % 3;
      const flap = phase < 0.5 ? Math.sin((phase / 0.5) * Math.PI) : 0;
      lips.position.y = -flap * 0.05;
      tufts.rotation.x = Math.sin(t * 0.7 + 1) * 0.04;
    }
  }

  return { group, animate, setHeading: (h) => { heading = h; }, setCostume, setCelebrating: (on) => { celebrating = !!on; }, rig };
}

/** Free a removed rig's GPU buffers. Materials cached in rig.js are shared
 *  across the whole cast and are skipped (`userData.shared`). */
export function disposeRig(rootObj) {
  rootObj.traverse((o) => {
    if (o.isMesh || o.isSprite) {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.map) m.map.dispose();
        if (!m.userData?.shared) m.dispose();
      }
    }
  });
}

// ---------------------------------------------------------------- watcher
// Spectators styled after ref/cozy-3d-game-people.png: chunky little humans
// with a big round head, a bowl of hair (or a hat) on top, a compact body,
// stubby arms and legs, ink-dot eyes and a tiny smile. The whole look is
// derived from a SEED — main.js hashes the visitor's id — so every client
// renders the identical crowd (per-client Math.random() would desync it).
const SKIN_TONES = [0xf6d7b0, 0xeab68b, 0xd69a66, 0xb87a4d, 0x8a5a3a];
const HAIR_COLORS = [0x3f2a1d, 0x241d1a, 0x6b4a2f, 0xc99548, 0x8a3f2a, 0x9a9a9a, 0x2c4a73];
const SHIRT_COLORS = [0xe4574c, 0xf5731f, 0xf9d976, 0x9bd45f, 0x5fc9c2, 0x8ab6f9, 0xb98cf7, 0xf4a8c0, 0xfff4e0, 0x495867];
const PANTS_COLORS = [0x4a6fa5, 0x6a4a36, 0x495867, 0x8a7a5a, 0x3e5a44, 0x7a4a5a];
const HAT_COLORS = [0xd9534f, 0x4a90d9, 0x6aab5a, 0xf9d976, 0x495867];

function watcherRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWatcher(opts = {}) {
  const rng = watcherRng(opts.seed ?? Math.floor(Math.random() * 0xffffffff));
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const skinMat = mat(pick(SKIN_TONES));
  const shirtMat = mat(pick(SHIRT_COLORS));
  const pantsMat = mat(pick(PANTS_COLORS));
  const hairC = pick(HAIR_COLORS);
  const look = rng();       // bowl hair / ponytail / hat
  const skirt = rng() < 0.28;
  const blush = rng() < 0.45;
  const legsMat = skirt ? skinMat : pantsMat; // bare legs under a skirt

  const group = new THREE.Group();

  // legs + little shoes
  const legGeo = new THREE.CylinderGeometry(0.062, 0.07, 0.42, 8);
  const shoeGeo = new THREE.SphereGeometry(0.075, 8, 7);
  const shoeMat = mat(0x4a3a2c);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, legsMat);
    leg.position.set(side * 0.095, 0.24, 0);
    group.add(leg);
    const shoe = new THREE.Mesh(shoeGeo, shoeMat);
    shoe.scale.set(1, 0.6, 1.45);
    shoe.position.set(side * 0.095, 0.05, 0.035);
    group.add(shoe);
  }

  if (skirt) {
    const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.27, 0.26, 12), shirtMat);
    sk.position.y = 0.55;
    group.add(sk);
  }

  // compact torso
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.185, 0.36, 6, 14), shirtMat);
  torso.position.y = 0.82;
  group.add(torso);

  // arms: pivots at the shoulders so they can hang, sway — or wave
  const arms = [];
  const sleeveGeo = new THREE.CapsuleGeometry(0.055, 0.28, 4, 10);
  const handGeo = new THREE.SphereGeometry(0.062, 8, 7);
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.235, 1.06, 0);
    const sleeve = new THREE.Mesh(sleeveGeo, shirtMat);
    sleeve.position.y = -0.18;
    const hand = new THREE.Mesh(handGeo, skinMat);
    hand.position.y = -0.36;
    arm.add(sleeve, hand);
    group.add(arm);
    arms.push(arm);
  }

  // neck + big round head
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.09, 8), skinMat);
  neck.position.y = 1.2;
  group.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.205, 18, 14), skinMat);
  head.position.y = 1.415;
  group.add(head);

  // hair (bowl cut, optionally with a ponytail) or a brimmed hat
  if (look < 0.62) {
    const hairMat = mat(hairC);
    // a cap slightly larger than the head, tipped a touch over the brow
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.225, 16, 12, 0, Math.PI * 2, 0, 1.95), hairMat);
    bowl.position.set(0, 1.43, -0.01);
    bowl.rotation.x = 0.14;
    group.add(bowl);
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), hairMat);
    back.position.set(0, 1.36, -0.1);
    back.scale.set(1, 0.95, 0.9);
    group.add(back);
    if (look < 0.2) {
      const tie = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), hairMat);
      tie.position.set(0, 1.34, -0.24);
      group.add(tie);
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.2, 4, 8), hairMat);
      tail.position.set(0, 1.19, -0.27);
      group.add(tail);
    }
  } else {
    const hatMat = mat(pick(HAT_COLORS));
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.265, 0.275, 0.045, 16), hatMat);
    brim.position.y = 1.53;
    group.add(brim);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), hatMat);
    dome.position.y = 1.53;
    dome.scale.set(1, 0.8, 1);
    group.add(dome);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.215, 0.05, 16), mat(0xfff4e0));
    band.position.y = 1.5;
    group.add(band);
  }

  // face: ink-dot eyes, tiny smile, optional blush
  const faceMat = mat(0x333333, { roughness: 0.6 });
  const eyeGeo = new THREE.SphereGeometry(0.022, 8, 6);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, faceMat);
    eye.position.set(side * 0.068, 1.445, 0.192);
    group.add(eye);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.009, 6, 12, Math.PI), faceMat);
  smile.rotation.z = Math.PI;
  smile.position.set(0, 1.385, 0.19);
  group.add(smile);
  if (blush) {
    const blushMat = mat(0xf2a3a3, { roughness: 0.8 });
    for (const side of [-1, 1]) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), blushMat);
      dot.scale.set(1, 0.55, 0.35);
      dot.position.set(side * 0.12, 1.395, 0.158);
      group.add(dot);
    }
  }

  setShadow(group);

  // Heading lives on rotation.y (set via setHeading); animate only sways
  // around it. YXZ keeps the sway/roll in the watcher's facing frame.
  // `excite` (0..1) turns the idle sway into a cheer: arms punched up,
  // waving out of phase, bouncing to a faster beat.
  group.rotation.order = 'YXZ';
  let heading = 0;
  function animate(t, excite = 0) {
    const e = Math.min(1, Math.max(0, excite));
    group.position.y = Math.abs(Math.sin(t * (1.7 + e * 3.2))) * (0.025 + e * 0.055);
    group.rotation.z = Math.sin(t * 1.1) * (0.04 + e * 0.02);
    group.rotation.y = heading + Math.sin(t * 0.6) * (0.1 + e * 0.06);
    const wave = Math.sin(t * (5.2 + e * 2.5));
    arms[0].rotation.z = -(0.3 + e * 2.35) + wave * 0.3 * e;
    arms[1].rotation.z = (0.3 + e * 2.35) + wave * 0.3 * e;
  }

  return { group, animate, setHeading: (h) => { heading = h; } };
}

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial(
    Object.assign({ color, roughness: 0.9, metalness: 0.0 }, extra)
  );
}

// ---------------------------------------------------------------- name sprite
export function makeNameSprite(text, opts = {}) {
  const height = opts.height || 0.35;
  const fontSize = opts.fontSize || 48;
  const bg = opts.background || 'rgba(50, 35, 20, 0.65)';
  const fg = opts.color || '#fffdf5';
  const padding = opts.padding !== undefined ? opts.padding : 18;

  const pad = Math.ceil(fontSize * 0.5);
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `800 ${fontSize}px 'Reddit Sans', 'Trebuchet MS', sans-serif`;
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const textW = Math.ceil(metrics.width);

  c.width = Math.max(64, _pow2ish(textW + pad * 2));
  c.height = Math.max(32, _pow2ish(fontSize + pad * 2));

  const ctx2 = c.getContext('2d');
  ctx2.font = font;
  // rounded rect bg
  const r = c.height * 0.35;
  const w = c.width;
  const h = c.height;
  ctx2.fillStyle = bg;
  ctx2.beginPath();
  ctx2.moveTo(r, 0);
  ctx2.arcTo(w, 0, w, h, r);
  ctx2.arcTo(w, h, 0, h, r);
  ctx2.arcTo(0, h, 0, 0, r);
  ctx2.arcTo(0, 0, w, 0, r);
  ctx2.closePath();
  ctx2.fill();

  ctx2.fillStyle = fg;
  ctx2.textAlign = 'center';
  ctx2.textBaseline = 'middle';
  ctx2.fillText(text, w / 2, h / 2 + fontSize * 0.05);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  const spriteMat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(spriteMat);
  const scale = height / h;
  sprite.scale.set(w * scale, height, 1);
  sprite.center.set(0.5, 0);
  return sprite;
}

function _pow2ish(n) {
  // nearest power of two, but don't shrink below n
  let p = 32;
  while (p < n) p *= 2;
  return p;
}
