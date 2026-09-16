import * as THREE from '../vendor/three.module.js';

export const DUCK_OUTFITS = ['sailor', 'pirate', 'raincoat', 'chef', 'wizard', 'bee', 'lifeguard', 'royal'];
const PALETTES = [0xe85b58, 0x579ed9, 0x72cbb1, 0xb08ae0, 0xf69ac0, 0xffc64e];
export function duckCostumeFromSeed(seed) {
  let n = seed >>> 0;
  const random = () => {
    n = (n + 0x6d2b79f5) | 0;
    let t = Math.imul(n ^ n >>> 15, n | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  return { theme: DUCK_OUTFITS[Math.floor(random() * DUCK_OUTFITS.length)], color: PALETTES[Math.floor(random() * PALETTES.length)] };
}

// A continuous, open-neck garment follows the duck's actual ellipsoid with
// generous clearance; no disconnected bib/back plates or coincident surfaces.
export function dressDuck(root, seed) {
  const spec = duckCostumeFromSeed(seed);
  const { theme, color } = spec;
  const cream = 0xfff3db, navy = 0x334d70, gold = 0xffc64e;
  const cloth = theme === 'chef' ? cream : theme === 'bee' || theme === 'raincoat' ? gold : theme === 'pirate' ? navy : color;
  const materials = new Map();
  const material = (c) => {
    if (!materials.has(c)) materials.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide }));
    return materials.get(c);
  };
  function mesh(geo, c, x, y, z, scale) {
    const m = new THREE.Mesh(geo, material(c));
    m.position.set(x, y, z);
    if (scale) m.scale.set(...scale);
    root.add(m);
    return m;
  }
  const ball = (c, x, y, z, sx, sy = sx, sz = sx) => mesh(new THREE.SphereGeometry(1, 16, 10), c, x, y, z, [sx, sy, sz]);
  const cylinder = (rt, rb, h, c, y, z = 0.48) => mesh(new THREE.CylinderGeometry(rt, rb, h, 24), c, 0, y, z);
  function band(y, width, c) {
    const top = Math.acos((y + width / 2 - 0.64) / 0.57);
    const bottom = Math.acos((y - width / 2 - 0.64) / 0.57);
    return mesh(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, top, bottom - top), c, 0, 0.64, 0, [0.807, 0.577, 0.96]);
  }
  const coat = mesh(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0.65, 1.48), cloth, 0, 0.64, 0, [0.80, 0.57, 0.95]);
  coat.name = `duck-outfit-${theme}`;
  band(0.42, 0.075, theme === 'bee' ? navy : cream);
  function buttons(c, double = false) {
    for (const y of [0.62, 0.79]) for (const x of double ? [-0.15, 0.15] : [0]) {
      const z = 0.96 * Math.sqrt(1 - ((y - 0.64) / 0.577) ** 2 - (x / 0.807) ** 2);
      ball(c, x, y, z + 0.008, 0.045, 0.045, 0.025);
    }
  }
  function brim(c, r = 0.44) { cylinder(r, r, 0.055, c, 1.40); }
  function dome(c) {
    mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, 0.9), c, 0, 1.04, 0.48, [0.46, 0.55, 0.44]);
  }
  function bow(c) {
    ball(c, -0.12, 0.96, 0.94, 0.16, 0.10, 0.055);
    ball(c, 0.12, 0.96, 0.94, 0.16, 0.10, 0.055);
    ball(gold, 0, 0.96, 1, 0.055);
  }
  const flutter = [];
  if (theme === 'sailor') {
    band(0.67, 0.09, cream); band(0.87, 0.07, cream);
    brim(navy, 0.35); cylinder(0.31, 0.35, 0.17, cream, 1.50);
    bow(navy);
  } else if (theme === 'pirate') {
    band(0.65, 0.14, 0xe85b58); buttons(gold);
    dome(navy);
    const hat = ball(navy, 0, 1.58, 0.48, 0.62, 0.23, 0.29);
    hat.rotation.z = -0.08;
    ball(cream, 0, 1.62, 0.766, 0.095, 0.10, 0.025);
    for (const x of [-0.032, 0.032]) ball(navy, x, 1.64, 0.79, 0.019);
    bow(0xe85b58);
  } else if (theme === 'raincoat') {
    dome(gold); brim(gold, 0.47); buttons(navy);
    for (const x of [-0.42, 0.42]) ball(cream, x, 0.70, 0.83, 0.12, 0.09, 0.03);
  } else if (theme === 'chef') {
    buttons(navy, true); band(0.48, 0.08, 0xe85b58);
    cylinder(0.30, 0.34, 0.24, cream, 1.52);
    for (const x of [-0.22, 0, 0.22]) ball(cream, x, 1.72 + (x === 0 ? 0.06 : 0), 0.48, 0.24, 0.22, 0.26);
    bow(0xe85b58);
  } else if (theme === 'wizard') {
    brim(cloth, 0.46);
    mesh(new THREE.ConeGeometry(0.34, 0.68, 24), cloth, 0, 1.76, 0.48).rotation.z = -0.12;
    for (const [x, y, z] of [[0, 0.70, 0.97], [-0.58, 0.80, 0.58], [0.58, 0.80, -0.58], [0, 0.80, -0.94]]) {
      const star = ball(gold, x, y, z, 0.07, 0.11, 0.04); star.rotation.z = 0.5;
    }
    ball(gold, -0.04, 1.72, 0.71, 0.065);
  } else if (theme === 'bee') {
    band(0.64, 0.13, navy); band(0.86, 0.11, navy); dome(gold);
    for (const side of [-1, 1]) {
      const antenna = mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.25, 8), navy, side * 0.20, 1.66, 0.48);
      antenna.rotation.z = -side * 0.3;
      ball(navy, side * 0.24, 1.80, 0.48, 0.065);
      const wing = ball(cream, side * 0.55, 1.03, -0.51, 0.28, 0.08, 0.4);
      wing.rotation.z = side * 0.4; flutter.push(wing);
    }
  } else if (theme === 'lifeguard') {
    band(0.72, 0.15, cream); dome(cloth);
    mesh(new THREE.BoxGeometry(0.18, 0.06, 0.04), cloth, 0, 0.72, 0.985);
    mesh(new THREE.BoxGeometry(0.06, 0.18, 0.04), cloth, 0, 0.72, 0.985);
    const ring = mesh(new THREE.TorusGeometry(0.30, 0.075, 8, 24), cream, 0, 0.71, -1.0);
    ring.rotation.x = 0.15;
  } else {
    buttons(gold); bow(cream);
    cylinder(0.32, 0.34, 0.14, gold, 1.46);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      mesh(new THREE.ConeGeometry(0.095, 0.24, 4), gold, Math.sin(a) * 0.29, 1.63, 0.48 + Math.cos(a) * 0.29);
      ball(color, Math.sin(a) * 0.31, 1.48, 0.48 + Math.cos(a) * 0.31, 0.045);
    }
  }
  return { spec, animate(t, effort) { flutter.forEach((w, i) => { w.rotation.z = (i ? 1 : -1) * (0.4 + Math.sin(t * 8) * effort * 0.12); }); } };
}
