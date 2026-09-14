// Mobu Race - character & prop builders (Three.js r186 ESM)
import * as THREE from '../vendor/three.module.js';

const DEFAULTS = {
  bodyColor: 0xffc93c,
  lipsColor: 0xff7a1a,
  shortsColor: 0xffd23f,
};

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial(
    Object.assign({ color, roughness: 0.9, metalness: 0.0 }, extra)
  );
}

function setShadow(obj) {
  obj.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
}

// ---------------------------------------------------------------- shorts tex
function makeShortsMaterial(baseColorHex) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const base = '#' + new THREE.Color(baseColorHex).getHexString();
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  // white eggs
  ctx.fillStyle = '#fffdf2';
  const egg = (x, y, s) => {
    ctx.beginPath();
    ctx.ellipse(x, y, s, s * 1.35, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  egg(24, 30, 8);
  egg(78, 20, 7);
  egg(110, 64, 6);
  egg(52, 82, 9);
  egg(14, 96, 6);
  // white bananas (simple crescent arcs)
  ctx.strokeStyle = '#fffdf2';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  const banana = (x, y, r, a0, a1) => {
    ctx.beginPath();
    ctx.arc(x, y, r, a0, a1);
    ctx.stroke();
  };
  banana(96, 40, 14, 0.6, 2.4);
  banana(36, 60, 12, 3.5, 5.3);
  banana(90, 100, 13, 2.8, 4.8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.9,
    metalness: 0.0,
  });
  return m;
}

// ---------------------------------------------------------------- mobu
export function createMobu(opts = {}) {
  const o = Object.assign({}, DEFAULTS, opts);
  const group = new THREE.Group();

  const bodyMat = mat(o.bodyColor);
  const lipsMat = mat(o.lipsColor, { roughness: 0.55 });
  const blackMat = mat(0x1a1a1a, { roughness: 0.6 });
  const shortsMat = makeShortsMaterial(o.shortsColor);
  const footMat = mat(o.bodyColor);

  // --- body + head: one egg-shaped blob
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 20), bodyMat);
  body.scale.set(0.55, 0.72, 0.5);
  body.position.y = 0.95;
  group.add(body);

  // --- ENORMOUS LIPS: big squashed torus grin on lower front of face
  const lips = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.17, 12, 28), lipsMat);
  lips.scale.set(1.0, 0.42, 1.0); // squash vertically -> wide flat grin ring
  lips.rotation.x = Math.PI / 2; // ring opening faces +Z (the viewer)
  lips.position.set(0, 0.62, 0.42);
  group.add(lips);

  // --- eyes: tiny black beads above the lips
  const eyeGeo = new THREE.SphereGeometry(0.045, 10, 8);
  const eyeL = new THREE.Mesh(eyeGeo, blackMat);
  eyeL.position.set(-0.16, 0.98, 0.44);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, blackMat);
  eyeR.position.set(0.16, 0.98, 0.44);
  group.add(eyeR);

  // --- 3 short black hairs on top
  const hairGeo = new THREE.CapsuleGeometry(0.012, 0.14, 3, 6);
  const hairs = [];
  for (let i = -1; i <= 1; i++) {
    const h = new THREE.Mesh(hairGeo, blackMat);
    h.position.set(i * 0.07, 1.62, 0.02);
    h.rotation.z = -i * 0.35;
    h.rotation.x = -0.15;
    group.add(h);
    hairs.push(h);
  }

  // --- stubby arms: small capsules out sideways-down
  const armGeo = new THREE.CapsuleGeometry(0.07, 0.22, 4, 8);
  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.5, 0.95, 0.05);
    const arm = new THREE.Mesh(armGeo, bodyMat);
    arm.position.set(0, -0.16, 0);
    pivot.add(arm);
    pivot.rotation.z = side * 0.9; // out-down rest pose
    group.add(pivot);
    arms.push(pivot);
  }

  // --- shorts: short wide cylinder around hips
  const shorts = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.5, 0.42, 24, 1), shortsMat);
  shorts.position.y = 0.72;
  group.add(shorts);

  // --- thick yellow feet
  const feet = [];
  const footGeo = new THREE.SphereGeometry(0.16, 12, 10);
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.2, 0.16, 0);
    const foot = new THREE.Mesh(footGeo, footMat);
    foot.scale.set(0.85, 0.7, 1.35); // chunky, longer forward
    foot.position.set(0, 0, 0.08);
    pivot.add(foot);
    group.add(pivot);
    feet.push(pivot);
  }

  setShadow(group);

  // ------------------------------------------------------- animation
  // Heading (travel direction) lives on rotation.y; the run/idle cycles only
  // add a wobble on top of it instead of overwriting it. YXZ order keeps the
  // forward lean and body roll in the character's own facing frame.
  group.rotation.order = 'YXZ';
  let heading = 0;
  const BASE_BODY_Y = 0.95;
  const BASE_LIPS_Y = 0.62;
  const BASE_LIPS_SCALE_Y = 0.42;

  function animate(t, speed = 0) {
    const s = Math.min(1, Math.max(0, speed));

    if (s > 0.02) {
      // --- run cycle
      const f = t * 9;
      // hop bounce
      const hop = Math.abs(Math.sin(f)) * 0.09 * s;
      group.position.y = hop;
      // forward lean + wobble/roll
      group.rotation.x = 0.12 * s;
      group.rotation.z = Math.sin(f) * 0.07 * s;
      group.rotation.y = heading + Math.sin(f * 0.5) * 0.05 * s;

      // arms swing up/down alternately
      arms[0].rotation.z = -0.9 + Math.sin(f) * 0.7 * s;
      arms[1].rotation.z = 0.9 - Math.sin(f) * 0.7 * s;

      // feet alternate small kicks
      feet[0].rotation.x = Math.sin(f) * 0.7 * s;
      feet[1].rotation.x = -Math.sin(f) * 0.7 * s;
      feet[0].position.y = 0.16 + Math.max(0, Math.sin(f)) * 0.12 * s;
      feet[1].position.y = 0.16 + Math.max(0, -Math.sin(f)) * 0.12 * s;

      // lips / jowls jiggle
      lips.position.y = BASE_LIPS_Y + Math.abs(Math.sin(f)) * 0.02 * s;
      lips.scale.y = BASE_LIPS_SCALE_Y * (1 + Math.sin(f * 2) * 0.12 * s);
    } else {
      // --- idle: gentle breathing bob + occasional lip flap
      const breathe = Math.sin(t * 2) * 0.02;
      group.position.y = Math.max(0, breathe) * 0.5;
      group.rotation.x = 0;
      group.rotation.z = Math.sin(t * 1.3) * 0.02;
      group.rotation.y = heading + Math.sin(t * 0.9) * 0.04;

      arms[0].rotation.z = -0.9 + Math.sin(t * 2) * 0.06;
      arms[1].rotation.z = 0.9 - Math.sin(t * 2) * 0.06;
      feet[0].rotation.x = 0;
      feet[1].rotation.x = 0;
      feet[0].position.y = 0.16;
      feet[1].position.y = 0.16;

      // occasional lip flap every ~3s for ~0.5s
      const phase = t % 3;
      const flap = phase < 0.5 ? Math.abs(Math.sin(phase * Math.PI / 0.5 * 3)) : 0;
      lips.scale.y = BASE_LIPS_SCALE_Y * (1 - flap * 0.25);
      lips.position.y = BASE_LIPS_Y - flap * 0.02;
    }

    // body squash from breathing always
    body.position.y = BASE_BODY_Y + (group.position.y > 0 ? 0 : 0);
  }

  return { group, animate, setHeading: (h) => { heading = h; } };
}

// ---------------------------------------------------------------- watcher
const WATCHER_PALETTE = [
  0xa8d8b9, 0xf4b896, 0xb8c9f0, 0xf0e3a8, 0xd8b8f0, 0xa8e0e0, 0xf0a8c0, 0xc8e0a8,
];

export function createWatcher(opts = {}) {
  const palette = WATCHER_PALETTE;
  const idx = Math.floor(Math.random() * palette.length);
  const bodyColor = opts.bodyColor !== undefined ? opts.bodyColor : palette[idx];
  const headColor = opts.headColor !== undefined ? opts.headColor : 0xf3d5b5; // cozy skin

  const group = new THREE.Group();
  const bodyMat = mat(bodyColor);

  // round capsule body
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.45, 6, 14), bodyMat);
  body.position.y = 0.75;
  group.add(body);

  // sphere head with simple face hint
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), mat(headColor));
  head.position.y = 1.28;
  group.add(head);

  const faceMat = mat(0x333333, { roughness: 0.6 });
  const eyeGeo = new THREE.SphereGeometry(0.028, 8, 6);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, faceMat);
    eye.position.set(side * 0.08, 1.32, 0.21);
    group.add(eye);
  }
  // little smile
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), faceMat);
  smile.rotation.z = Math.PI;
  smile.position.set(0, 1.24, 0.22);
  group.add(smile);

  // tiny feet
  const footGeo = new THREE.SphereGeometry(0.09, 10, 8);
  for (const side of [-1, 1]) {
    const foot = new THREE.Mesh(footGeo, mat(0x8a6d5a));
    foot.scale.set(1, 0.6, 1.3);
    foot.position.set(side * 0.12, 0.06, 0.03);
    group.add(foot);
  }

  // arms
  const armGeo = new THREE.CapsuleGeometry(0.06, 0.2, 4, 8);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, bodyMat);
    arm.position.set(side * 0.32, 0.85, 0);
    arm.rotation.z = side * 0.5;
    group.add(arm);
  }

  setShadow(group);

  // Heading lives on rotation.y (set via setHeading); animate only sways
  // around it. YXZ keeps the sway/roll in the watcher's facing frame.
  group.rotation.order = 'YXZ';
  let heading = 0;
  const baseY = 0;
  function animate(t) {
    group.position.y = baseY + Math.abs(Math.sin(t * 1.7)) * 0.03;
    group.rotation.z = Math.sin(t * 1.1) * 0.04;
    group.rotation.y = heading + Math.sin(t * 0.6) * 0.1;
  }

  return { group, animate, setHeading: (h) => { heading = h; } };
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
