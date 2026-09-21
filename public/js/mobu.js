// Mobu Race - character builders (Three.js r186 ESM)
// Reference: ref/mobu.jpg. Smooth egg body, one sculpted/morphable mouth,
// ink eyes, three soft crown tufts, capsule arms and signature tick shorts.
// Everything is built in canonical units (3.75 tall, feet at y=0) under an
// inner root that is scaled as ONE unit to fit the track's world scale.
import * as THREE from '../vendor/three.module.js';
import {
  MOBU_PALETTE, sharedMat, lathe, profileSlice, radiusAt,
  WAIST_Y, CROWN_Y,
  EYE_Y, EYE_X, EYE_Z, TUFT_Y, TUFT_LEAN,
  LEG_LEN, LEG_X, LEG_R, SHOULDER_Y, SHOULDER_X, ARM_LEN, ARM_R, ARM_OUT_ROT,
} from './rig.js';
import { applyCostume } from './costumes.js';
import { createMouthGeometry } from './mobu-mouth.js';

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

// The separately testable head/body must shade as one continuous egg. Match
// normals at their shared cut using the unsliced profile's tangent.
function eggPiece(y0, y1) {
  const geometry = lathe(profileSlice(y0, y1));
  const pos = geometry.attributes.position, normal = geometry.attributes.normal;
  const slope = (radiusAt(WAIST_Y + 0.01) - radiusAt(WAIST_Y - 0.01)) / 0.02;
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getY(i) - WAIST_Y) > 1e-5) continue;
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    n.set(pos.getX(i) / r, -slope, pos.getZ(i) / r).normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
  }
  return geometry;
}

// ---------------------------------------------------------------- the rig
export function createMobu(opts = {}) {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';

  const root = new THREE.Group(); // canonical 3.75-tall rig, scaled as one unit
  root.scale.setScalar(MOBU_SCALE);
  root.position.y = 0; // outer group owns the ground offset (apply it only once)
  group.add(root);

  const bodyMat = sharedMat(MOBU_PALETTE.bodyBase);
  const lipsMat = sharedMat(0xffffff, { roughness: 0.4, vertexColors: true });
  const inkMat = sharedMat(MOBU_PALETTE.ink, { roughness: 0.6 });

  // --- body + head: ONE profile of revolution, lathed once and cut in two at
  // WAIST_Y. The two halves share a material and never move apart; they exist
  // as two meshes so each keeps an honest bounding box.
  // Lower wear is permanent. Omit the hidden hip skin so it cannot poke
  // through the gap between true trouser legs (the old bucket hid that skin).
  const body = new THREE.Mesh(eggPiece(1.14, WAIST_Y), bodyMat);
  const head = new THREE.Mesh(eggPiece(WAIST_Y, CROWN_Y), bodyMat);

  const upper = new THREE.Group(); // bob / lean / tilt move this as one unit
  upper.add(body, head);

  // --- the grin: a SIBLING of head, never its child (a child's bbox would
  // flow into the head's). Vertices sit at absolute rig heights, so the pose
  // engine only ever TRANSLATES this mesh — never scales it about the origin.
  const lips = new THREE.Mesh(createMouthGeometry(), lipsMat);
  lips.name = 'sculpted-smile';
  upper.add(lips);

  // --- eyes: two ink dots riding the head's surface; the PAIR is positioned
  // at EYE_Y so any future squash flattens them in place, not toward y=0.
  const eyeGeo = new THREE.SphereGeometry(1, 20, 12);
  const eyes = new THREE.Group();
  const happyEyes = new THREE.Group();
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, inkMat);
    eye.scale.set(0.061, 0.067, 0.045);
    eye.position.set(sx * EYE_X, 0, EYE_Z + 0.035);
    eyes.add(eye);
    const arc = new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => {
      const u = i / 4 - 1;
      return new THREE.Vector3(sx * EYE_X + u * 0.075, 0.04 * (1 - u * u), EYE_Z + 0.055);
    }));
    happyEyes.add(new THREE.Mesh(new THREE.TubeGeometry(arc, 16, 0.019, 8, false), inkMat));
  }
  eyes.position.set(0, EYE_Y, 0);
  happyEyes.position.copy(eyes.position);
  happyEyes.visible = false;
  upper.add(eyes, happyEyes);

  // --- tufts: three fat ink lozenges on the crown, LEANING BACK over it
  // (about X), the outer two splayed (about Z). The group pivots at the crown.
  const tufts = new THREE.Group();
  tufts.position.set(0, TUFT_Y, 0);
  const tipGeo = new THREE.SphereGeometry(1, 20, 14);
  for (const [x, z, height, splay] of [[-0.24, -0.04, 0.24, 0.3], [0, -0.1, 0.3, 0], [0.24, -0.04, 0.24, -0.3]]) {
    const tuft = new THREE.Group();
    tuft.position.set(x, 0, z);
    tuft.rotation.order = 'ZXY';
    tuft.rotation.set(TUFT_LEAN, 0, splay);
    const tip = new THREE.Mesh(tipGeo, inkMat);
    tip.scale.set(0.115, height * 0.5 + 0.11, 0.12);
    tip.position.y = height * 0.5;
    tuft.add(tip);
    tufts.add(tuft);
  }
  upper.add(tufts);

  // --- arms: CAPSULES (straight shaft, both ends capped with a same-radius
  // sphere), resting out and slightly down. `hand` pivots at the arm tip for
  // any future held props.
  const arms = [];
  const hands = [];
  const armGeo = new THREE.CapsuleGeometry(ARM_R, ARM_LEN, 8, 20);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * SHOULDER_X, SHOULDER_Y, 0);
    arm.rotation.z = sx * ARM_OUT_ROT;
    const capsule = new THREE.Mesh(armGeo, bodyMat);
    capsule.position.y = -ARM_LEN / 2;
    arm.add(capsule);
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
  // Rounded foot profile with a flat sole; no overlapping shaft/ball seam.
  const footGeo = lathe([
    [0, 0], [LEG_R * 0.72, 0], [LEG_R * 0.94, 0.055],
    [LEG_R, 0.13], [LEG_R, LEG_LEN], [0, LEG_LEN],
  ], 32);
  footGeo.translate(0, -LEG_LEN, 0);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * LEG_X, LEG_LEN, 0);
    const foot = new THREE.Mesh(footGeo, bodyMat);
    foot.scale.z = 1.1;
    foot.position.z = 0.035;
    leg.add(foot);
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
      body, head, lips, eyes, happyEyes, tufts,
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
  let smile = 0;

  function setSmile(value) {
    smile = Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
    lips.morphTargetInfluences[0] = smile;
  }

  function animate(t, speed = 0, motion = {}) {
    const s = Math.min(1, Math.max(0, speed));
    const cheering = celebrating && s <= 0.02;
    const expression = cheering ? 0.9 + 0.1 * Math.sin(t * 7) ** 2 : smile;
    lips.morphTargetInfluences[0] = expression;
    // Squash about the eye pair's own pivot: never slide eyes down the face.
    const blinkPhase = ((t % 4.6) + 4.6) % 4.6;
    const blink = blinkPhase > 4.42 ? Math.sin((blinkPhase - 4.42) / 0.18 * Math.PI) : 0;
    eyes.scale.y = (1 - 0.3 * expression) * (1 - 0.94 * blink);
    eyes.visible = expression < 0.75;
    happyEyes.visible = !eyes.visible;
    // Reset contact offsets so switching run/idle/celebration cannot leave a
    // foot behind. Distance drives phase: slowing down slows the actual gait.
    for (const leg of legs) { leg.position.y = LEG_LEN; leg.position.z = 0; }
    for (const arm of arms) arm.rotation.x = 0;

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
      const f = (motion.distance ?? t * 1.8) * 5 + (motion.phase || 0);
      group.position.y = GROUND_Y;
      // Torso absorbs the landing while the stance foot stays on the dirt.
      upper.position.y = 0.025 + (1 - Math.cos(f * 2)) * 0.035 * s;
      upper.rotation.x = 0.08 * s + THREE.MathUtils.clamp((motion.acceleration || 0) * 0.008, -0.045, 0.07);
      upper.rotation.z = Math.sin(f) * 0.035 * s - (motion.turn || 0);
      group.rotation.y = heading;
      arms[0].rotation.z = -ARM_OUT_ROT + Math.sin(f) * 0.22 * s;
      arms[1].rotation.z = ARM_OUT_ROT - Math.sin(f) * 0.22 * s;
      arms[0].rotation.x = -Math.sin(f) * 0.55 * s;
      arms[1].rotation.x = Math.sin(f) * 0.55 * s;
      for (let i = 0; i < legs.length; i++) {
        const cycle = (((f / (Math.PI * 2) + i * 0.5) % 1) + 1) % 1;
        const stance = 0.6;
        const travel = (Math.PI * 2 / 5) * stance / MOBU_SCALE;
        const recovery = Math.max(0, (cycle - stance) / (1 - stance));
        const ease = recovery * recovery * (3 - 2 * recovery);
        legs[i].position.z = cycle < stance ? travel * (0.5 - cycle / stance) : travel * (-0.5 + ease);
        legs[i].position.y = LEG_LEN + Math.sin(recovery * Math.PI) * 0.24 * s;
        legs[i].rotation.x = 0; // rotating a foot around the hip drove its sole below ground
      }

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

  return { group, animate, setSmile, setHeading: (h) => { heading = h; }, setCostume, setCelebrating: (on) => { celebrating = !!on; }, rig };
}

/** Free a removed rig's GPU buffers. Materials cached in rig.js are shared
 *  across the whole cast and are skipped (`userData.shared`). Shared
 *  spectator fake-shadow geometry is skipped for the same reason. */
export function disposeRig(rootObj) {
  rootObj.traverse((o) => {
    if (o.isMesh || o.isSprite) {
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.map) m.map.dispose();
        if (!m.userData?.shared) m.dispose();
      }
    }
  });
}

// Keep the public character-builder API stable; spectator meshes are separate
// from the canonical mobu rig and its measurement invariants.
export { createWatcher } from './visitors.js';

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
