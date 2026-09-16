// Soft, chibi spectators. Appearance and gesture timing are seeded; no assets,
// canvas textures or per-frame allocations. Feet stay planted while the upper
// body breathes, looks around and cheers through articulated elbows.
import * as THREE from '../vendor/three.module.js';

const SKIN = [0xffdab9, 0xeebc93, 0xd79a6e, 0xb97b55, 0x86543e];
const HAIR = [0x392b2a, 0x664232, 0xc78a45, 0x934c38, 0xbbb5ac, 0x35465d];
const CLOTH = [0xe77470, 0x77b9b0, 0x7d9dce, 0xc098d4, 0xe7ae55, 0x91b46e];
const BOTTOM = [0x485b79, 0x6a625d, 0x667b64, 0x83667d];
export const VISITOR_HAIR = ['swept', 'bob', 'curls', 'bun', 'cap', 'beanie'];
export const VISITOR_OUTFITS = ['sweater', 'overalls', 'cardigan', 'dress'];

function randomFromSeed(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ a >>> 15, a | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function visitorStyleFromSeed(seed) {
  const random = randomFromSeed(seed);
  const pick = (arr) => arr[Math.floor(random() * arr.length)];
  return {
    skin: pick(SKIN), hair: pick(HAIR), cloth: pick(CLOTH), bottom: pick(BOTTOM),
    hairstyle: pick(VISITOR_HAIR), outfit: pick(VISITOR_OUTFITS),
    freckles: random() < 0.35, glasses: random() < 0.23,
    phase: random() * Math.PI * 2, gesture: Math.floor(random() * 3),
  };
}

export function createWatcher({ seed = 1 } = {}) {
  const style = visitorStyleFromSeed(seed);
  const group = new THREE.Group();
  group.name = 'visitor';
  group.userData.style = style;
  group.rotation.order = 'YXZ';
  const materials = new Map();
  const material = (color, roughness = 0.82) => {
    const key = `${color}:${roughness}`;
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness }));
    return materials.get(key);
  };
  const skin = material(style.skin, 0.66), hair = material(style.hair);
  const cloth = material(style.cloth), pants = material(style.bottom);
  const cream = material(0xfff5e4), ink = material(0x352c32, 0.5);
  const darkCloth = material(new THREE.Color(style.cloth).multiplyScalar(0.77).getHex());
  const sphere = new THREE.SphereGeometry(1, 16, 12);
  function ellipsoid(parent, name, mat, x, y, z, sx, sy, sz) {
    const mesh = new THREE.Mesh(sphere, mat);
    mesh.name = name;
    mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
    parent.add(mesh); return mesh;
  }
  function capsule(parent, mat, radius, length, x, y, z) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, 12), mat);
    mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  function tube(parent, mat, points, radius = 0.012) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, radius, 6, false), mat);
    parent.add(mesh); return mesh;
  }

  // Broad rounded trainers and short trouser legs replace the pin-thin dowels.
  const shoes = [];
  for (const side of [-1, 1]) {
    const x = side * 0.135;
    capsule(group, style.outfit === 'dress' ? skin : pants, 0.095, 0.25, x, 0.31, 0);
    ellipsoid(group, 'shoe-sole', cream, x, 0.034, 0.053, 0.115, 0.034, 0.18);
    shoes.push(ellipsoid(group, 'shoe', darkCloth, x, 0.084, 0.045, 0.112, 0.061, 0.168));
    for (const z of [0.09, 0.14]) capsule(group, cream, 0.013, 0.065, x, 0.129, z).rotation.z = Math.PI / 2;
  }
  ellipsoid(group, 'hips', pants, 0, 0.49, 0, 0.245, 0.15, 0.165);

  // All clothing and the head share a waist pivot; animation doesn't rock the
  // entire character about the soles, the old wooden-doll silhouette.
  const upper = new THREE.Group(); upper.position.y = 0.62; group.add(upper);
  const profile = [[0.01, -0.15], [0.20, -0.15], [0.265, -0.10], [0.285, 0.04],
    [0.278, 0.22], [0.25, 0.38], [0.20, 0.46], [0.10, 0.48], [0.01, 0.48]];
  const torso = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r,y]) => new THREE.Vector2(r,y)), 24), cloth);
  torso.name = 'soft-torso'; torso.scale.z = 0.73; upper.add(torso);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.025, 8, 20), cream);
  collar.rotation.x = Math.PI / 2; collar.position.y = 0.47; upper.add(collar);
  capsule(upper, skin, 0.082, 0.09, 0, 0.53, 0);

  if (style.outfit === 'dress') {
    const skirt = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.32, -0.26), new THREE.Vector2(0.33, -0.23),
      new THREE.Vector2(0.27, -0.08), new THREE.Vector2(0.245, 0.07),
    ], 24), cloth);
    skirt.name = 'dress-skirt'; skirt.scale.z = 0.8; upper.add(skirt);
    ellipsoid(upper, 'belt-knot', cream, 0, 0.065, 0.211, 0.04, 0.04, 0.025);
    for (const side of [-1, 1]) ellipsoid(upper, 'belt-bow', cream, side * 0.053, 0.065, 0.208, 0.06, 0.035, 0.023);
  } else if (style.outfit === 'overalls') {
    ellipsoid(upper, 'overall-bib', pants, 0, 0.04, 0.172, 0.205, 0.205, 0.055);
    for (const side of [-1, 1]) {
      tube(upper, pants, [[side * 0.14, 0.12, 0.21], [side * 0.16, 0.34, 0.155], [side * 0.13, 0.46, 0.06]], 0.033);
      ellipsoid(upper, 'strap-button', cream, side * 0.145, 0.21, 0.215, 0.022, 0.022, 0.012);
    }
    ellipsoid(upper, 'bib-pocket', cloth, 0, 0.06, 0.225, 0.078, 0.054, 0.013);
  } else if (style.outfit === 'cardigan') {
    tube(upper, cream, [[0, -0.08, 0.204], [0, 0.22, 0.210], [0, 0.38, 0.18]], 0.017);
    for (const y of [0, 0.12, 0.24]) ellipsoid(upper, 'cardigan-button', darkCloth, 0.033, y, 0.218, 0.015, 0.015, 0.012);
    for (const side of [-1, 1]) ellipsoid(upper, 'cardigan-pocket', darkCloth, side * 0.16, 0, 0.174, 0.065, 0.045, 0.015);
  } else {
    // Embroidered flower patch rather than a flat, featureless shirt.
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      ellipsoid(upper, 'flower-petal', cream, -0.10 + Math.sin(a) * 0.034, 0.25 + Math.cos(a) * 0.034, 0.197, 0.024, 0.025, 0.012);
    }
    ellipsoid(upper, 'flower-center', material(0xf0c960), -0.10, 0.25, 0.212, 0.024, 0.024, 0.012);
  }

  const arms = [], elbows = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(side * 0.235, 0.39, 0); upper.add(shoulder);
    capsule(shoulder, cloth, 0.091, 0.16, 0, -0.095, 0);
    const elbow = new THREE.Group(); elbow.position.y = -0.23; shoulder.add(elbow);
    capsule(elbow, cloth, 0.08, 0.10, 0, -0.045, 0);
    capsule(elbow, cream, 0.082, 0.016, 0, -0.125, 0);
    ellipsoid(elbow, 'mitten-hand', skin, 0, -0.208, 0.014, 0.078, 0.089, 0.068);
    ellipsoid(elbow, 'thumb', skin, -side * 0.063, -0.186, 0.035, 0.032, 0.048, 0.031);
    arms.push(shoulder); elbows.push(elbow);
  }

  const head = new THREE.Group(); head.position.set(0, 0.78, 0.006); upper.add(head);
  ellipsoid(head, 'head', skin, 0, 0, 0, 0.31, 0.345, 0.29);
  for (const side of [-1, 1]) {
    ellipsoid(head, 'ear', skin, side * 0.30, -0.015, 0, 0.062, 0.088, 0.055);
    ellipsoid(head, 'ear-inner', material(new THREE.Color(style.skin).multiplyScalar(0.86).getHex()), side * 0.327, -0.015, 0.037, 0.025, 0.046, 0.015);
  }
  ellipsoid(head, 'nose', skin, 0, -0.022, 0.29, 0.041, 0.043, 0.045);
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(side * 0.105, 0.055, 0.265); head.add(eye);
    ellipsoid(eye, 'eye-white', cream, 0, 0, 0, 0.047, 0.056, 0.025);
    ellipsoid(eye, 'pupil', ink, -side * 0.004, -0.002, 0.023, 0.023, 0.034, 0.012);
    ellipsoid(eye, 'eye-glint', cream, -0.008, 0.014, 0.035, 0.008, 0.010, 0.004);
    eyes.push(eye);
    tube(head, hair, [[side * 0.064, 0.143, 0.263], [side * 0.10, 0.158, 0.260], [side * 0.145, 0.146, 0.244]], 0.013);
    const blush = new THREE.Color(style.skin).lerp(new THREE.Color(0xe98b88), 0.43).getHex();
    const cheek = ellipsoid(head, 'cheek', material(blush), side * 0.18, -0.068, 0.231, 0.048, 0.027, 0.012);
    cheek.rotation.y = side * 0.5;
    if (style.freckles) for (let i = 0; i < 3; i++) {
      ellipsoid(head, 'freckle', material(0x97634d), side * (0.151 + i * 0.020), -0.043 - (i % 2) * 0.018, 0.250 - i * 0.012, 0.007, 0.007, 0.005);
    }
  }
  tube(head, ink, [[-0.055, -0.103, 0.266], [-0.028, -0.126, 0.270], [0.028, -0.126, 0.270], [0.055, -0.103, 0.266]], 0.011);
  if (style.glasses) {
    for (const side of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.011, 6, 20), ink);
      lens.position.set(side * 0.105, 0.055, 0.301); head.add(lens);
      tube(head, ink, [[side * 0.17, 0.06, 0.30], [side * 0.27, 0.07, 0.12], [side * 0.31, 0.045, 0.02]], 0.009);
    }
    tube(head, ink, [[-0.039, 0.06, 0.30], [0, 0.075, 0.31], [0.039, 0.06, 0.30]], 0.01);
  }

  // Fitted scalp with a high forehead and lower nape, rather than an entire
  // intersecting sphere that conceals the face. Feathered locks soften its edge.
  const scalp = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = scalp.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), theta = Math.atan2(x, z);
    const row = Math.acos(THREE.MathUtils.clamp(pos.getY(i), -1, 1)) / (Math.PI / 2);
    const edge = 1.43 - 0.43 * Math.cos(theta); // front clears eyes, back covers nape
    const p = row * edge;
    pos.setXYZ(i, Math.sin(theta) * Math.sin(p) * 0.325, Math.cos(p) * 0.36, Math.cos(theta) * Math.sin(p) * 0.305);
  }
  scalp.computeVertexNormals();
  const scalpMesh = new THREE.Mesh(scalp, hair); head.add(scalpMesh);
  const hairType = style.hairstyle;
  if (hairType === 'curls') {
    for (let i = 0; i < 11; i++) {
      const a = i * Math.PI * 2 / 11;
      ellipsoid(head, 'curl', hair, Math.sin(a) * 0.24, 0.24 + Math.cos(a) * 0.022, Math.cos(a) * 0.20, 0.105, 0.10, 0.10);
    }
    for (const x of [-0.10, 0.06]) ellipsoid(head, 'crown-curl', hair, x, 0.35, -0.01, 0.14, 0.095, 0.13);
  } else if (hairType === 'bob' || hairType === 'bun') {
    for (const side of [-1, 1]) {
      ellipsoid(head, 'side-lock', hair, side * 0.267, 0.005, -0.055, 0.085, hairType === 'bob' ? 0.25 : 0.16, 0.17);
    }
    if (hairType === 'bun') {
      ellipsoid(head, 'hair-tie', darkCloth, 0, 0.21, -0.28, 0.14, 0.12, 0.065);
      ellipsoid(head, 'bun', hair, 0, 0.23, -0.35, 0.16, 0.16, 0.14);
    }
  }
  if (hairType === 'cap' || hairType === 'beanie') {
    const hat = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, 1.10), cloth);
    hat.scale.set(0.34, 0.395, 0.33); head.add(hat);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.035, 8, 24), darkCloth);
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.18; head.add(rim);
    if (hairType === 'cap') {
      ellipsoid(head, 'cap-visor', cloth, 0, 0.18, 0.26, 0.25, 0.024, 0.18);
    } else {
      ellipsoid(head, 'pom-pom', cream, 0.025, 0.43, -0.02, 0.083, 0.08, 0.083);
    }
  } else if (hairType !== 'curls') {
    for (let i = 0; i < 3; i++) {
      const lock = ellipsoid(head, 'swept-fringe', hair, -0.14 + i * 0.10, 0.245 + i * 0.023, 0.205, 0.12, 0.065, 0.093);
      lock.rotation.z = -0.35;
    }
  }
  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  let heading = 0;
  function animate(t, excite = 0) {
    const e = THREE.MathUtils.clamp(excite, 0, 1), phase = style.phase;
    const wave = Math.sin(t * 5.4 + phase);
    group.rotation.y = heading;
    // Weight shift above the hips leaves both soles planted at y=0.
    upper.position.x = Math.sin(t * 1.15 + phase) * (0.012 + e * 0.012);
    upper.position.y = 0.62 + Math.sin(t * 2.1 + phase) * 0.006 + e * (1 + wave) * 0.013;
    upper.rotation.z = Math.sin(t * 1.15 + phase) * (0.022 + e * 0.02);
    head.rotation.y = Math.sin(t * 0.7 + phase) * 0.11;
    head.rotation.z = Math.sin(t * 1.2 + phase + 1) * 0.035;
    head.rotation.x = -e * 0.06 + Math.sin(t * 2 + phase) * 0.018;
    for (let i = 0; i < arms.length; i++) {
      const side = i ? 1 : -1;
      const singleWave = style.gesture === 1 && i === 0;
      const lift = e * (singleWave ? 0.45 : 2.1);
      arms[i].rotation.z = side * (0.20 + lift + Math.sin(t * 2 + phase + i) * (0.035 + e * 0.09));
      arms[i].rotation.x = -0.10 - e * (0.10 + Math.sin(t * 3 + phase + i) * 0.1);
      elbows[i].rotation.x = -0.18 - e * (0.4 + Math.sin(t * 5.4 + phase + i * 0.9) * 0.25);
      elbows[i].rotation.z = side * e * Math.sin(t * 5.4 + phase + i) * 0.16;
    }
    // Short seeded blinks, not synchronized across the whole grandstand.
    const blinkPhase = ((t + phase) % 4.7 + 4.7) % 4.7;
    const blink = blinkPhase < 0.15 ? 1 - Math.sin(blinkPhase / 0.15 * Math.PI) * 0.93 : 1;
    for (const eye of eyes) eye.scale.y = blink;
  }
  animate(0, 0);
  return { group, animate, setHeading: h => { heading = h; }, rig: { upper, head, arms, elbows, eyes, shoes } };
}
