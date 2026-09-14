// Mobu Race — cozy farm-village world (track + scenery)
// Self-contained: only THREE import.

import * as THREE from '../vendor/three.module.js';

// ---------- deterministic PRNG ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKY = 0x9fd8f5;
const FOG = 0xcdeaf7;

function stdMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.9, metalness: 0.0 }, opts));
}

// ellipse param: progress 0..1 -> point at south (+Z), moving toward +X
function ellipsePos(a, b, t, out = new THREE.Vector3()) {
  // south point (0, +b); travel +X means going clockwise when viewed from above (+Y down at -Z... pick param)
  // param angle from PI/2 decreasing? Use: x = a*sin(2PI t), z = b*cos(2PI t)
  const ang = t * Math.PI * 2;
  return out.set(a * Math.sin(ang), 0, b * Math.cos(ang));
}

export function createWorld(opts = {}) {
  const trackScale = opts.trackScale || 1;
  const a = 26 * trackScale;
  const b = 15 * trackScale;
  const lanes = 8;
  const laneWidth = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(FOG, a * 3.5, a * 9);

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0xfff3d6, 0x6a8f3c, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d9, 1.6);
  sun.position.set(a * 1.2, 40, -b);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const span = a * 3.2;
  sun.shadow.camera.left = -span;
  sun.shadow.camera.right = span;
  sun.shadow.camera.top = span;
  sun.shadow.camera.bottom = -span;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = a * 6;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  const group = new THREE.Group();
  scene.add(group);

  // ---------- grass ----------
  const grass = new THREE.Mesh(
    new THREE.CircleGeometry(a * 3, 64),
    stdMat(0x6abe30)
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  group.add(grass);

  // lighter grass patches
  const patchMat = stdMat(0x7ecb45);
  const patchGeo = new THREE.CircleGeometry(1, 16);
  for (let i = 0; i < 14; i++) {
    const p = new THREE.Mesh(patchGeo, patchMat);
    const ang = (i / 14) * Math.PI * 2 + 0.7;
    const r = a * (1.1 + 0.5 * ((i * 37) % 10) / 10);
    p.position.set(Math.cos(ang) * r, 0.005, Math.sin(ang) * r * 0.7);
    p.scale.setScalar(3 + (i % 4) * 1.5);
    p.rotation.x = -Math.PI / 2;
    p.receiveShadow = true;
    group.add(p);
  }

  // ---------- arc-length lookup for the track centerline ----------
  const N = 256;
  // Base centerline is shifted outward so that lane 0 (innermost) sits exactly
  // on the reference ellipse (a, b): lanePoint(0, 0) == (0, y, +b).
  const baseShift = (lanes / 2 - 1) * laneWidth; // 3.3 for 8 lanes
  const aC = a + baseShift;
  const bC = b + baseShift;
  const samples = [];
  let totalLen = 0;
  const tmpV = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    ellipsePos(aC, bC, t, tmpV);
    if (i > 0) {
      const prev = samples[i - 1];
      totalLen += tmpV.distanceTo(prev.p);
    }
    samples.push({ p: tmpV.clone(), s: totalLen });
  }
  const length = totalLen;

  // binary search arc length -> parameter t
  function tFromS(s) {
    let lo = 0, hi = N;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].s < s) lo = mid + 1; else hi = mid;
    }
    const i0 = Math.max(0, lo - 1);
    const s0 = samples[i0].s, s1 = samples[i0 + 1].s;
    const f = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    return (i0 + f) / N;
  }

  // lateral: meters offset from the track centerline (positive = outward).
  // The lane band spans ±(lanes*laneWidth/2) = ±4.4, so anything within ±3.3
  // stays safely on the dirt no matter how many racers there are.
  function lanePoint(progress, lateral = 0) {
    const p = ((progress % 1) + 1) % 1;
    const t = tFromS(p * length);
    const pos = ellipsePos(aC, bC, t, new THREE.Vector3());
    // local outward normal of ellipse at param angle
    const ang = t * Math.PI * 2;
    const nx = bC * Math.sin(ang), nz = aC * Math.cos(ang);
    const nl = Math.hypot(nx, nz) || 1;
    pos.x += (nx / nl) * lateral;
    pos.z += (nz / nl) * lateral;
    pos.y = 0.05;
    return pos;
  }

  // ---------- track visuals ----------
  const bandHalf = lanes * laneWidth / 2; // 4.4
  const innerA = aC - bandHalf - 0.6;
  const innerB = bC - bandHalf - 0.6;
  const outerA = aC + bandHalf + 0.6;
  const outerB = bC + bandHalf + 0.6;

  function ellipseShape(rx, rz, segs = 96) {
    const s = new THREE.Shape();
    for (let i = 0; i <= segs; i++) {
      const ang = (i / segs) * Math.PI * 2;
      const x = rx * Math.sin(ang), y = rz * Math.cos(ang);
      if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
    return s;
  }

  const dirtShape = ellipseShape(outerA, outerB);
  const hole = new THREE.Path();
  for (let i = 0; i <= 96; i++) {
    const ang = (i / 96) * Math.PI * 2;
    const x = innerA * Math.sin(ang), y = innerB * Math.cos(ang);
    if (i === 0) hole.moveTo(x, y); else hole.lineTo(x, y);
  }
  dirtShape.holes.push(hole);
  const dirt = new THREE.Mesh(new THREE.ShapeGeometry(dirtShape, 48), stdMat(0xd9b380));
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.y = 0.02;
  dirt.receiveShadow = true;
  group.add(dirt);

  // darker tan edges (thin rings just outside/inside)
  function edgeRing(rA, rB, width, y) {
    const sh = ellipseShape(rA + width, rB + width);
    const h = new THREE.Path();
    for (let i = 0; i <= 96; i++) {
      const ang = (i / 96) * Math.PI * 2;
      const x = rA * Math.sin(ang), yy = rB * Math.cos(ang);
      if (i === 0) h.moveTo(x, yy); else h.lineTo(x, yy);
    }
    sh.holes.push(h);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh, 48), stdMat(0xb8925f));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    group.add(m);
  }
  edgeRing(outerA, outerB, 0.7, 0.03);
  edgeRing(innerA - 0.7, innerB - 0.7, 0.7, 0.03);

  // white start/finish stripe ACROSS all lanes at progress 0 (south side).
  // Travel at progress 0 runs along X, so the stripe is thin along X and spans
  // the lane band along Z.
  const stripeW = lanes * laneWidth + 0.8;
  const stripeZ = b + (lanes - 1) * laneWidth / 2; // center of lane band at progress 0
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, stripeW),
    stdMat(0xffffff, { roughness: 0.7 })
  );
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(0, 0.04, stripeZ);
  stripe.receiveShadow = true;
  group.add(stripe);

  // checker squares: two columns along travel (X) x one row per lane (Z)
  const sqMat1 = stdMat(0x333333);
  const sqGeo = new THREE.PlaneGeometry(0.4, 0.4);
  for (let i = 0; i < lanes; i++) {
    for (let j = 0; j < 2; j++) {
      if ((i + j) % 2 === 0) continue; // alternate over the white stripe
      const sq = new THREE.Mesh(sqGeo, sqMat1);
      sq.rotation.x = -Math.PI / 2;
      sq.position.set((j - 0.5) * 0.4, 0.045, b + i * laneWidth);
      group.add(sq);
    }
  }

  // start banner: two poles + fabric, spanning the track across the lanes
  const poleMat = stdMat(0x8a5a33);
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.14, 4, 8);
  const halfW = stripeW / 2 + 0.3;
  for (const sz of [-halfW, halfW]) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(-0.25, 2, stripeZ + sz);
    pole.castShadow = true;
    group.add(pole);
  }
  const fabric = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 1.2, halfW * 2 + 0.4),
    stdMat(0xe4574c)
  );
  fabric.position.set(-0.25, 3.6, stripeZ);
  fabric.castShadow = true;
  group.add(fabric);
  const fabricBand = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.3, halfW * 2 + 0.4),
    stdMat(0xfff4e0)
  );
  fabricBand.position.set(-0.19, 3.6, stripeZ);
  group.add(fabricBand);

  // ---------- scenery ----------
  const rand = mulberry32(42);

  function pineTree(s) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.25 * s, 0.9 * s, 7), stdMat(0x7a4b2a));
    trunk.position.y = 0.45 * s;
    g.add(trunk);
    const coneMat = stdMat(0x2e7d32);
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry((1.3 - i * 0.32) * s, 1.2 * s, 8), coneMat);
      cone.position.y = (1.2 + i * 0.75) * s;
      cone.castShadow = true;
      g.add(cone);
    }
    trunk.castShadow = true;
    return g;
  }

  function blobTree(s) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 0.3 * s, 1.1 * s, 7), stdMat(0x8a5a33));
    trunk.position.y = 0.55 * s;
    trunk.castShadow = true;
    g.add(trunk);
    const blobMat = stdMat(rand() > 0.5 ? 0x43a047 : 0x66bb4a);
    const blobGeo = new THREE.IcosahedronGeometry(1.1 * s, 1);
    for (let i = 0; i < 3; i++) {
      const blob = new THREE.Mesh(blobGeo, blobMat);
      blob.position.set((rand() - 0.5) * 0.9 * s, (1.6 + rand() * 0.5) * s, (rand() - 0.5) * 0.9 * s);
      blob.scale.set(1, 0.85, 1);
      blob.castShadow = true;
      g.add(blob);
    }
    return g;
  }

  function house(x, z, rotY, roofColor, scale = 1) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.6 * scale, 2.2 * scale, 3 * scale), stdMat(0xfff1d6));
    body.position.y = 1.1 * scale;
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1 * scale, 1.7 * scale, 4), stdMat(roofColor));
    roof.position.y = 2.95 * scale;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    g.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.7 * scale, 1.2 * scale, 0.1), stdMat(0x8a5a33));
    door.position.set(0, 0.6 * scale, 1.52 * scale);
    g.add(door);
    for (const wx of [-1.1, 1.1]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.6 * scale, 0.6 * scale, 0.08), stdMat(0x9adcf5));
      win.position.set(wx * scale, 1.3 * scale, 1.52 * scale);
      g.add(win);
    }
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    group.add(g);
  }

  function flowerPatch(x, z) {
    const g = new THREE.Group();
    const colors = [0xff6f91, 0xffd54f, 0xba68c8, 0xff8a65];
    const stemGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.3, 5);
    const headGeo = new THREE.SphereGeometry(0.14, 8, 6);
    const n = 6 + Math.floor(rand() * 6);
    for (let i = 0; i < n; i++) {
      const fx = (rand() - 0.5) * 2.2, fz = (rand() - 0.5) * 2.2;
      const stem = new THREE.Mesh(stemGeo, stdMat(0x4c9a2a));
      stem.position.set(fx, 0.15, fz);
      g.add(stem);
      const head = new THREE.Mesh(headGeo, stdMat(colors[Math.floor(rand() * colors.length)]));
      head.position.set(fx, 0.34, fz);
      head.castShadow = true;
      g.add(head);
    }
    g.position.set(x, 0, z);
    group.add(g);
  }

  function rock(x, z, s) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), stdMat(0x9e9e9e, { roughness: 1 }));
    r.position.set(x, s * 0.5, z);
    r.rotation.set(rand(), rand(), rand());
    r.castShadow = true;
    group.add(r);
  }

  function fenceArc(cx, cz, ang0, ang1, radius, steps) {
    const postGeo = new THREE.BoxGeometry(0.14, 1.0, 0.14);
    const railGeo = new THREE.BoxGeometry(1, 0.12, 0.06);
    const mat = stdMat(0xb98a5a);
    let prev = null;
    for (let i = 0; i <= steps; i++) {
      const ang = ang0 + (ang1 - ang0) * (i / steps);
      const x = cx + Math.cos(ang) * radius;
      const z = cz + Math.sin(ang) * radius;
      const post = new THREE.Mesh(postGeo, mat);
      post.position.set(x, 0.5, z);
      post.castShadow = true;
      group.add(post);
      if (prev) {
        const mid = new THREE.Vector3((x + prev.x) / 2, 0, (z + prev.z) / 2);
        const d = Math.hypot(x - prev.x, z - prev.z);
        for (const h of [0.4, 0.8]) {
          const rail = new THREE.Mesh(railGeo, mat);
          rail.scale.x = d;
          rail.position.set(mid.x, h, mid.z);
          rail.rotation.y = -Math.atan2(z - prev.z, x - prev.x);
          rail.castShadow = true;
          group.add(rail);
        }
      }
      prev = { x, z };
    }
  }

  // --- tree ring outside the track ---
  const treeRingR = outerB + 4;
  for (let i = 0; i < 34; i++) {
    const ang = (i / 34) * Math.PI * 2 + rand() * 0.12;
    const rr = treeRingR + 2 + rand() * (a * 1.1);
    const x = Math.cos(ang) * rr * 1.4;
    const z = Math.sin(ang) * rr;
    const s = 0.9 + rand() * 1.1;
    const tree = rand() < 0.55 ? pineTree(s) : blobTree(s);
    tree.position.set(x, 0, z);
    tree.rotation.y = rand() * Math.PI * 2;
    group.add(tree);
  }

  // --- houses outside the track ---
  house(-a * 1.5, -b * 1.6, 0.5, 0xd32f2f, 1.2);   // red roof
  house(a * 1.6, -b * 1.2, -0.8, 0x1976d2, 1.0);   // blue roof
  house(a * 1.4, b * 1.8, 2.4, 0xf57c00, 1.1);     // orange roof
  house(-a * 1.7, b * 1.5, -0.4, 0x1976d2, 0.9);   // blue roof

  // --- fence arcs near the track ---
  fenceArc(0, 0, -0.35, 0.45, outerA + 3.5, 7);
  fenceArc(0, 0, Math.PI - 0.4, Math.PI + 0.4, outerA + 3.5, 7);

  // --- flower patches & rocks ---
  for (let i = 0; i < 12; i++) {
    const ang = rand() * Math.PI * 2;
    const rr = outerA + 4 + rand() * a * 1.4;
    flowerPatch(Math.cos(ang) * rr * 1.3, Math.sin(ang) * rr * 0.75);
  }
  for (let i = 0; i < 10; i++) {
    const ang = rand() * Math.PI * 2;
    const rr = outerA + 3 + rand() * a * 1.5;
    rock(Math.cos(ang) * rr * 1.35, Math.sin(ang) * rr * 0.75, 0.3 + rand() * 0.7);
  }
  // a few rocks inside the infield
  for (let i = 0; i < 3; i++) {
    const ang = rand() * Math.PI * 2;
    rock(Math.cos(ang) * innerA * 0.4, Math.sin(ang) * innerB * 0.4, 0.35 + rand() * 0.4);
  }
  // infield tree
  const midTree = blobTree(1.3);
  midTree.position.set(0, 0, 0);
  group.add(midTree);
  flowerPatch(2.5, 1.5);
  flowerPatch(-2.5, -1.5);

  // --- clouds ---
  const cloudMat = stdMat(0xffffff, { roughness: 1, flatShading: false });
  const cloudGeo = new THREE.SphereGeometry(1, 10, 8);
  for (let i = 0; i < 7; i++) {
    const c = new THREE.Group();
    const puffs = 3 + Math.floor(rand() * 3);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      puff.position.set((rand() - 0.5) * 6, (rand() - 0.5) * 1, (rand() - 0.5) * 3);
      puff.scale.set(1.6 + rand(), 0.9 + rand() * 0.4, 1.2 + rand() * 0.6);
      c.add(puff);
    }
    const ang = (i / 7) * Math.PI * 2;
    c.position.set(Math.cos(ang) * a * 1.6, 24 + rand() * 4, Math.sin(ang) * b * 2.2);
    group.add(c);
  }

  const track = { a, b, laneWidth, lanes, length, outerZ: outerB + 0.7 };

  return { scene, group, track, lanePoint };
}
