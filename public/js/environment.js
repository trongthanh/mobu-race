// Mobu Race — cozy foggy-valley world (track + scenery)
// Self-contained: only THREE import.
//
// The race runs on the floor of a broad, shallow valley: the land stays flat
// across the track apron, then rolls up GENTLY on all sides — open downs,
// never peaks — until the haze swallows it. A dirt road wanders off north
// into the fog, a pond sits in the infield, and the valley is dressed with
// trees, bushes, farm animals, hay bales and a windmill.

import * as THREE from '../vendor/three.module.js';
import { waterAt, createLakeGeometry } from './surface.js';

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

// Soft cream-blue haze: the sky melts into the fog right at the horizon.
const SKY_ZENITH = 0x74b9e3;
const FOG = 0xdcead8;

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

// Soft radial blob for the drifting mist banks.
function mistTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.32)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld(opts = {}) {
  const isLake = opts.raceType === 'lake';
  const trackScale = opts.trackScale || 1;
  const a = 26 * trackScale;
  const b = 15 * trackScale;
  const lanes = 8;
  const laneWidth = 1.1;

  const scene = new THREE.Scene();
  const fogFar = a * 6.2 + 150;
  scene.background = new THREE.Color(FOG);
  scene.fog = new THREE.Fog(FOG, a * 1.4, fogFar);

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(0xfff3d6, 0x7c9a4d, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d9, 1.5);
  sun.position.set(a * 1.2, 42, -b);
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
  scene.add(new THREE.AmbientLight(0xffffff, 0.22));

  // ---------- valley terrain ----------
  // Height field shared by the terrain mesh AND scenery placement: flat
  // (y = 0) across an elliptical apron around the track, then a smooth
  // low-rise climb with rolling noise. No hills tower — the walls top out
  // around 10-13 units a couple of hundred meters out, then the fog takes over.
  const M = 16 + a * 0.15;            // flat apron width around the track
  const flatA = a + M, flatB = b + M; // apron edge: e = hypot(x/flatA, z/flatB) == 1
  const RISE = 5.8 + a * 0.04;        // how far the valley walls climb
  const SLOPE_W = 1.15;               // climb width, in normalized e units

  function valleyNoise(x, z) {
    return (
      Math.sin(x * 0.043 + 1.7) * Math.cos(z * 0.037 - 0.6) +
      0.55 * Math.sin(x * 0.012 - z * 0.017 + 3.4) +
      0.3 * Math.sin((x + z) * 0.021 + 1.2)
    );
  }

  function groundHeight(x, z) {
    const e = Math.hypot(x / flatA, z / flatB);
    if (e <= 1) return 0;
    const t = Math.min(1, (e - 1) / SLOPE_W);
    const rise = t * t * (3 - 2 * t); // smoothstep 0..1 across the climb
    const far = Math.min(1, Math.max(0, (e - 1 - SLOPE_W) * 1.4));
    return rise * (RISE + valleyNoise(x, z) * 1.0) + far * (1.0 + valleyNoise(x * 1.7, z * 1.7) * 0.5);
  }

  // Radial terrain disc: dense rings around the flat->slope transition,
  // coarser far out where only fog-colored silhouette remains.
  const maxR = fogFar * 1.18;
  const RINGS = 110, SEGS = 96;
  {
    const pos = [], col = [], idx = [];
    const cGrassA = new THREE.Color(0x66b13b);
    const cGrassB = new THREE.Color(0x8ccd55);
    const cSage = new THREE.Color(0xa8bf68); // drier tint up the slopes
    const tmpC = new THREE.Color();
    for (let i = 0; i <= RINGS; i++) {
      const t = i / RINGS;
      const r = maxR * Math.pow(t, 1.35);
      for (let j = 0; j <= SEGS; j++) {
        const ang = (j / SEGS) * Math.PI * 2;
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
        const y = groundHeight(x, z);
        pos.push(x, y, z);
        const n = valleyNoise(x * 0.6 + 40, z * 0.6 - 20);
        tmpC.copy(cGrassA).lerp(cGrassB, THREE.MathUtils.clamp(0.5 + n * 0.35, 0, 1));
        tmpC.lerp(cSage, Math.min(1, y / RISE) * 0.45);
        // per-vertex dither so the big far triangles don't band
        const d = (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
        tmpC.offsetHSL(0, 0, d * 0.012);
        col.push(tmpC.r, tmpC.g, tmpC.b);
      }
    }
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < SEGS; j++) {
        const p0 = i * (SEGS + 1) + j, p1 = p0 + 1, p2 = p0 + SEGS + 1, p3 = p2 + 1;
        idx.push(p0, p1, p2, p1, p3, p2); // up-facing winding
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 0,
    }));
    terrain.receiveShadow = true;
    scene.add(terrain);
  }

  // ---------- sky dome ----------
  // A gradient dome (horizon == fog color) so the hazy distance blends
  // seamlessly into the sky — that's what sells the open-world depth.
  {
    const geo = new THREE.SphereGeometry(1, 32, 18);
    const posAttr = geo.attributes.position;
    const col = [];
    const horizon = new THREE.Color(FOG);
    const zenith = new THREE.Color(SKY_ZENITH);
    const tmpC = new THREE.Color();
    for (let i = 0; i < posAttr.count; i++) {
      const t = THREE.MathUtils.clamp((posAttr.getY(i) + 0.06) / 0.85, 0, 1);
      tmpC.copy(horizon).lerp(zenith, t * t * (3 - 2 * t));
      col.push(tmpC.r, tmpC.g, tmpC.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
    }));
    sky.scale.setScalar(maxR * 1.05);
    sky.renderOrder = -10;
    scene.add(sky);
  }

  const group = new THREE.Group();
  scene.add(group);

  // ---------- animated props (driven by the returned animate()) ----------
  const spinners = []; // windmill blade hubs
  const mists = [];    // drifting fog banks
  const clouds = [];   // lazy cloud puffs
  const waterGlints = []; // subtle moving reflections on the derby pond
  let waterSurface = null;
  const floaters = [];

  // lighter grass patches on the apron
  const patchMat = stdMat(0x7ecb45);
  const patchGeo = new THREE.CircleGeometry(1, 16);
  for (let i = 0; i < 14; i++) {
    const p = new THREE.Mesh(patchGeo, patchMat);
    const ang = (i / 14) * Math.PI * 2 + 0.7;
    const r = a * (1.1 + 0.5 * ((i * 37) % 10) / 10);
    p.position.set(Math.cos(ang) * r, 0.012, Math.sin(ang) * r * 0.7);
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
  const outerZ = outerB + 0.7;

  function ellipseShape(rx, rz, segs = 96) {
    const s = new THREE.Shape();
    for (let i = 0; i <= segs; i++) {
      const ang = (i / segs) * Math.PI * 2;
      const x = rx * Math.sin(ang), y = rz * Math.cos(ang);
      if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
    return s;
  }

  // The lake derby inhabits the exact same valley: only this oval dirt lane
  // turns into water, so every farm, hill, spectator stand and camera view
  // remains familiar.
  const courseShape = ellipseShape(outerA, outerB);
  const hole = new THREE.Path();
  for (let i = 0; i <= 96; i++) {
    const ang = (i / 96) * Math.PI * 2;
    const x = innerA * Math.sin(ang), y = innerB * Math.cos(ang);
    if (i === 0) hole.moveTo(x, y); else hole.lineTo(x, y);
  }
  // The duck pond fills both the lane and its infield; the land course keeps
  // the familiar grassy centre by punching the inner ellipse out.
  if (!isLake) courseShape.holes.push(hole);
  const course = new THREE.Mesh(
    isLake ? createLakeGeometry(outerA, outerB) : new THREE.ShapeGeometry(courseShape, 48),
    stdMat(isLake ? 0x439ea9 : 0xd9b380, isLake ? { roughness: 0.25, metalness: 0.22 } : {})
  );
  course.rotation.x = -Math.PI / 2;
  course.position.y = 0.02;
  course.receiveShadow = true;
  group.add(course);
  if (isLake) {
    waterSurface = course;
    const pos = course.geometry.attributes.position;
    pos.setUsage(THREE.DynamicDrawUsage);
    course.geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  }

  function edgeRing(rA, rB, width, y, color = 0xb8925f) {
    const sh = ellipseShape(rA + width, rB + width);
    const h = new THREE.Path();
    for (let i = 0; i <= 96; i++) {
      const ang = (i / 96) * Math.PI * 2;
      const x = rA * Math.sin(ang), yy = rB * Math.cos(ang);
      if (i === 0) h.moveTo(x, yy); else h.lineTo(x, yy);
    }
    sh.holes.push(h);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh, 48), stdMat(color));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    group.add(m);
  }
  edgeRing(outerA, outerB, 0.7, 0.03, isLake ? 0xd8c79c : 0xb8925f);
  if (!isLake) edgeRing(innerA - 0.7, innerB - 0.7, 0.7, 0.03, 0xb8925f);

  // Instead of plastic buoys, the lake's lane rails are a procession of
  // floating water-lily pads and lotus blooms — natural, visible, and fixed
  // from track geometry so every client sees the same course.
  if (isLake) {
    // Moving light streaks give the large pond a live surface without a
    // texture or shader dependency.
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xc9eef0, transparent: true, opacity: 0.2, depthWrite: false });
    const glintGeo = new THREE.RingGeometry(0.24, 0.29, 12, 1, 0.3, Math.PI * 1.25);
    for (let i = 0; i < 42; i++) {
      const ang = i * 2.39996;
      const r = Math.sqrt(((i * 37) % 41) / 42) * 0.86;
      const glint = new THREE.Mesh(glintGeo, glintMat.clone());
      glint.rotation.x = -Math.PI / 2;
      glint.rotation.z = ang;
      glint.scale.set(0.8 + (i % 4) * 0.28, 0.32 + (i % 3) * 0.12, 1);
      glint.position.set(Math.sin(ang) * outerA * r, 0.043, Math.cos(ang) * outerB * r);
      group.add(glint);
      waterGlints.push({ mesh: glint, phase: i * 0.71 });
    }
    const padMat = stdMat(0x3f9148, { roughness: 0.7 });
    const petalMat = stdMat(0xffb7c9, { roughness: 0.65 });
    const centerMat = stdMat(0xf7ce45);
    const padGeo = new THREE.CircleGeometry(0.26, 10, 0.25, Math.PI * 1.7);
    const petalGeo = new THREE.SphereGeometry(0.105, 8, 6);
    for (const lateral of [-4.72, 4.72]) {
      for (let i = 0; i < 56; i++) {
        const p = lanePoint(i / 56, lateral);
        const pad = new THREE.Mesh(padGeo, padMat);
        pad.rotation.x = -Math.PI / 2;
        pad.rotation.z = i * 1.7;
        pad.position.set(p.x, 0.061, p.z);
        group.add(pad);
        floaters.push({ mesh: pad, offset: 0.012 });
        if (i % 2 === 0) {
          const bloom = new THREE.Group();
          for (let j = 0; j < 5; j++) {
            const petal = new THREE.Mesh(petalGeo, petalMat);
            const a = j * Math.PI * 2 / 5;
            petal.scale.set(1.25, 0.45, 0.8);
            petal.position.set(Math.sin(a) * 0.09, 0.095, Math.cos(a) * 0.09);
            bloom.add(petal);
          }
          const core = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), centerMat);
          core.scale.y = 0.45;
          core.position.y = 0.12;
          bloom.add(core);
          bloom.position.set(p.x, 0.055, p.z);
          group.add(bloom);
          floaters.push({ mesh: bloom, offset: 0.005 });
        }
      }
    }

    // Decorative lily gardens live safely inside the racing loop. Their
    // irregular clusters make the large pond feel inhabited rather than empty.
    function lotusCluster(x, z, scale = 1, flower = true) {
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.rotation.z = (x * 0.31 + z * 0.17) % (Math.PI * 2);
      pad.scale.setScalar(scale);
      pad.position.set(x, 0.068, z);
      group.add(pad);
      floaters.push({ mesh: pad, offset: 0.012 });
      if (!flower) return;
      const bloom = new THREE.Group();
      for (let j = 0; j < 6; j++) {
        const petal = new THREE.Mesh(petalGeo, petalMat);
        const a = j * Math.PI / 3;
        petal.scale.set(1.45 * scale, 0.45 * scale, 0.9 * scale);
        petal.position.set(Math.sin(a) * 0.1 * scale, 0.105, Math.cos(a) * 0.1 * scale);
        bloom.add(petal);
      }
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.06 * scale, 8, 6), centerMat);
      core.scale.y = 0.45;
      core.position.y = 0.13;
      bloom.add(core);
      bloom.position.set(x, 0.06, z);
      group.add(bloom);
      floaters.push({ mesh: bloom, offset: 0.005 });
    }
    for (let i = 0; i < 34; i++) {
      const angle = i * 2.39996 + 0.3;
      const radius = 0.12 + ((i * 29) % 25) / 25 * 0.6;
      lotusCluster(
        Math.sin(angle) * innerA * radius,
        Math.cos(angle) * innerB * radius,
        0.72 + (i % 4) * 0.15,
        i % 3 !== 1,
      );
    }

    // Two small tied-up rowboats make the lake read as a real place, while
    // staying in the non-racing infield well clear of the outer lane.
    function rowboat(x, z, yaw, color) {
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), stdMat(color));
      hull.scale.set(1.18, 0.19, 0.44);
      hull.position.y = 0.15;
      boat.add(hull);
      const inner = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.07, 0.36), stdMat(0x5b3824));
      inner.position.y = 0.25;
      boat.add(inner);
      const seatMat = stdMat(0xd8a05d);
      for (const bx of [-0.28, 0.28]) {
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.055, 0.64), seatMat);
        seat.position.set(bx, 0.3, 0);
        boat.add(seat);
      }
      const oarMat = stdMat(0xc58a4b);
      for (const side of [-1, 1]) {
        const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.35, 6), oarMat);
        oar.rotation.z = Math.PI / 2 + side * 0.22;
        oar.position.set(0, 0.28, side * 0.5);
        boat.add(oar);
      }
      boat.position.set(x, 0.03, z);
      boat.rotation.y = yaw;
      group.add(boat);
      floaters.push({ mesh: boat, offset: -0.02 });
    }
    rowboat(-innerA * 0.34, innerB * 0.18, -0.42, 0xb95f3f);
    rowboat(innerA * 0.26, -innerB * 0.27, 0.62, 0x4a87a6);
  }

  // white start/finish stripe ACROSS all lanes at progress 0 (south side).
  // Travel at progress 0 runs along X, so the stripe is thin along X and spans
  // the lane band along Z.
  const stripeW = lanes * laneWidth + 0.8;
  const stripeZ = b + (lanes - 1) * laneWidth / 2; // center of lane band at progress 0
  if (isLake) {
    // A shallow row of reeds marks the line without turning it into a dock.
    const reedMat = stdMat(0x3f7837);
    const flowerMat = stdMat(0xffb7c9);
    for (let i = 0; i < 19; i++) {
      const z = stripeZ - stripeW / 2 + i * stripeW / 18;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 0.42 + (i % 3) * 0.08, 5), reedMat);
      stem.position.set(0, 0.16, z);
      group.add(stem);
      if (i % 3 === 0) {
        const blossom = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), flowerMat);
        blossom.scale.y = 0.35;
        blossom.position.set(0, 0.38, z);
        group.add(blossom);
      }
    }
  } else {
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
        if ((i + j) % 2 === 0) continue;
        const sq = new THREE.Mesh(sqGeo, sqMat1);
        sq.rotation.x = -Math.PI / 2;
        sq.position.set((j - 0.5) * 0.4, 0.045, b + i * laneWidth);
        group.add(sq);
      }
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
  // banner lettering on both large faces of the fabric (the ±X sides racers
  // approach from). Canvas texture like the name sprites, justified letter
  // spacing so the line fills the face; redrawn once Reddit Sans has loaded.
  const bannerText = 'Mobu Amazing Race';
  const bFontSize = 100;
  const bFont = `800 ${bFontSize}px 'Reddit Sans', 'Trebuchet MS', sans-serif`;
  const bannerTextH = 1.06;
  // Leave room for the supplied mobu mark on the left side of each banner face.
  const bannerImageW = 1.0;
  const bannerImageGap = 0.18;
  const bannerTextW = halfW * 2 + 0.4 - 0.5 - bannerImageW - bannerImageGap;
  const bannerTextZ = stripeZ + (bannerImageW + bannerImageGap) / 2;
  const bannerImageZ = stripeZ - halfW + 0.3 + bannerImageW / 2;
  const bc = document.createElement('canvas');
  const bctx = bc.getContext('2d');
  bctx.font = bFont;
  const bChars = [...bannerText];
  const bWidths = bChars.map((ch) => bctx.measureText(ch).width);
  let bAsc = 0, bDesc = 0;
  for (const ch of bChars) {
    const m = bctx.measureText(ch);
    bAsc = Math.max(bAsc, m.actualBoundingBoxAscent ?? bFontSize * 0.75);
    bDesc = Math.max(bDesc, m.actualBoundingBoxDescent ?? bFontSize * 0.25);
  }
  bc.height = Math.ceil(bAsc + bDesc) + 26;
  bc.width = Math.round(bc.height * (bannerTextW / bannerTextH));
  const bGap = Math.max(2, (bc.width - 32 - bWidths.reduce((s, w) => s + w, 0)) / (bChars.length - 1));
  const bTotalW = bWidths.reduce((s, w) => s + w, 0) + bGap * (bChars.length - 1);
  const bannerTex = new THREE.CanvasTexture(bc);
  bannerTex.colorSpace = THREE.SRGBColorSpace;
  bannerTex.anisotropy = 4;
  function drawBannerText() {
    bctx.clearRect(0, 0, bc.width, bc.height);
    bctx.font = bFont;
    bctx.textAlign = 'left';
    bctx.textBaseline = 'alphabetic';
    bctx.lineJoin = 'round';
    bctx.lineWidth = 11;
    bctx.strokeStyle = '#5f2a1d';
    bctx.fillStyle = '#fff4e0';
    const y = bc.height / 2 + (bAsc - bDesc) / 2;
    let x = (bc.width - bTotalW) / 2;
    for (let i = 0; i < bChars.length; i++) {
      bctx.strokeText(bChars[i], x, y);
      x += bWidths[i] + bGap;
    }
    x = (bc.width - bTotalW) / 2;
    for (let i = 0; i < bChars.length; i++) {
      bctx.fillText(bChars[i], x, y);
      x += bWidths[i] + bGap;
    }
    bannerTex.needsUpdate = true;
  }
  drawBannerText();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawBannerText);
  const bannerTextMat = new THREE.MeshBasicMaterial({ map: bannerTex, transparent: true });
  const bannerTextGeo = new THREE.PlaneGeometry(bannerTextW, bannerTextH);
  const bannerImageTex = new THREE.TextureLoader().load('/mobu-race.png');
  bannerImageTex.colorSpace = THREE.SRGBColorSpace;
  const bannerImageMat = new THREE.MeshBasicMaterial({
    map: bannerImageTex,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const bannerImageGeo = new THREE.PlaneGeometry(bannerImageW, bannerTextH);
  for (const [tx, rotY] of [[-0.195, Math.PI / 2], [-0.305, -Math.PI / 2]]) {
    const label = new THREE.Mesh(bannerTextGeo, bannerTextMat);
    label.position.set(tx, 3.6, bannerTextZ);
    label.rotation.y = rotY;
    group.add(label);

    const mark = new THREE.Mesh(bannerImageGeo, bannerImageMat);
    mark.position.set(tx, 3.6, bannerImageZ);
    mark.rotation.y = rotY;
    group.add(mark);
  }

  // ---------- scenery ----------
  const rand = mulberry32(42);

  // A dirt road wanders north off the track and fades into the fog — the
  // classic open-world "where does that go?" hook. Kept as a corridor check
  // so trees don't grow in the middle of it.
  const pathPts = [];
  for (let d = 0; d <= fogFar * 0.85; d += 4.2) {
    const wob = Math.sin(d * 0.05) * 5 + Math.sin(d * 0.016 + 2) * 8;
    pathPts.push({ x: wob, z: -(outerB + 2.5) - d });
  }
  function nearPath(x, z, pad) {
    for (const p of pathPts) {
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < pad * pad) return true;
    }
    return false;
  }
  function angDist(a1, a2) {
    let d = (a1 - a2) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  }
  // Where scenery may stand: clear of the track apron's inner ring, the
  // grandstand field (south), the road corridor and the two fence arcs.
  function canSit(x, z, pad = 0) {
    const e = Math.hypot(x / flatA, z / flatB);
    if (e < 0.8) return false;
    if (z > outerZ - 1 && Math.abs(x) < 13) return false;
    if (nearPath(x, z, 5 + pad)) return false;
    if (e < 1.05) {
      const ang = Math.atan2(z, x);
      const rr = Math.hypot(x, z);
      if (rr < outerA + 8 &&
          (angDist(ang, 0.05) < 0.55 || angDist(ang, Math.PI) < 0.55)) return false;
    }
    return true;
  }
  function spotOnSlope(ang, e) {
    return { x: Math.cos(ang) * e * flatA, z: Math.sin(ang) * e * flatB };
  }

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

  // tall round canopy — most go green, a few turn autumn-gold for coziness
  function roundTree(s) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.24 * s, 1.5 * s, 7), stdMat(0x8a5a33));
    trunk.position.y = 0.75 * s;
    trunk.castShadow = true;
    g.add(trunk);
    const r = rand();
    const leaf = r < 0.55 ? 0x5aab48 : r < 0.8 ? 0x6fbf4a : r < 0.9 ? 0xd9822b : 0xc9a83a;
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.05 * s, 9, 8), stdMat(leaf));
    canopy.position.y = 1.95 * s;
    canopy.scale.set(1, 0.92, 1);
    canopy.castShadow = true;
    g.add(canopy);
    return g;
  }

  function bush(x, z, s) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55 * s, 1), stdMat(rand() > 0.5 ? 0x4e9e3d : 0x66b34a));
    b.position.set(x, groundHeight(x, z) + 0.3 * s, z);
    b.scale.set(1, 0.75, 1);
    b.rotation.y = rand() * Math.PI;
    b.castShadow = true;
    group.add(b);
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
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.32 * scale, 0.9 * scale, 0.32 * scale), stdMat(0x9e6b52));
    chimney.position.set(0.9 * scale, 3.2 * scale, -0.4 * scale);
    chimney.castShadow = true;
    g.add(chimney);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.7 * scale, 1.2 * scale, 0.1), stdMat(0x8a5a33));
    door.position.set(0, 0.6 * scale, 1.52 * scale);
    g.add(door);
    for (const wx of [-1.1, 1.1]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.6 * scale, 0.6 * scale, 0.08), stdMat(0x9adcf5));
      win.position.set(wx * scale, 1.3 * scale, 1.52 * scale);
      g.add(win);
    }
    g.position.set(x, groundHeight(x, z) - 0.05, z);
    g.rotation.y = rotY;
    group.add(g);
  }

  function flowerPatch(x, z) {
    const g = new THREE.Group();
    const colors = [0xff6f91, 0xffd54f, 0xba68c8, 0xff8a65];
    const stemGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.3, 5);
    const headGeo = new THREE.SphereGeometry(0.14, 8, 6);
    const n = 5 + Math.floor(rand() * 4);
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
    g.position.set(x, groundHeight(x, z), z);
    group.add(g);
  }

  function rock(x, z, s) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), stdMat(0x9e9e9e, { roughness: 1 }));
    r.position.set(x, groundHeight(x, z) + s * 0.5, z);
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

  function hayBale(x, z) {
    const g = new THREE.Group();
    const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.95, 12), stdMat(0xd9ae4e));
    bale.rotation.z = Math.PI / 2; // lying on its side
    bale.castShadow = true;
    g.add(bale);
    g.position.set(x, groundHeight(x, z) + 0.55, z);
    g.rotation.y = rand() * Math.PI;
    group.add(g);
  }

  function sheep(x, z) {
    const g = new THREE.Group();
    const wool = stdMat(0xf3eee3, { roughness: 1 });
    const dark = stdMat(0x4a4038);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), wool);
    body.scale.set(1.15, 0.9, 0.85);
    body.position.y = 0.52;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 7), dark);
    head.position.set(0, 0.7, 0.44);
    head.castShadow = true;
    g.add(head);
    const legGeo = new THREE.CylinderGeometry(0.05, 0.045, 0.3, 6);
    for (const [lx, lz] of [[-0.18, 0.16], [0.18, 0.16], [-0.18, -0.16], [0.18, -0.16]]) {
      const leg = new THREE.Mesh(legGeo, dark);
      leg.position.set(lx, 0.15, lz);
      g.add(leg);
    }
    g.position.set(x, groundHeight(x, z), z);
    g.rotation.y = rand() * Math.PI * 2;
    group.add(g);
  }

  function chicken(x, z) {
    const g = new THREE.Group();
    const white = stdMat(0xfff8e8);
    const red = stdMat(0xd94b3d);
    const yellow = stdMat(0xf2b84b);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 9, 7), white);
    body.scale.set(1, 1.05, 1.15);
    body.position.y = 0.27;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 7), white);
    head.position.set(0, 0.47, 0.2);
    head.castShadow = true;
    g.add(head);
    const comb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), red);
    comb.position.set(0, 0.6, 0.2);
    g.add(comb);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 5), yellow);
    beak.position.set(0, 0.47, 0.34);
    beak.rotation.x = Math.PI / 2;
    g.add(beak);
    for (const lx of [-0.07, 0.07]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.18, 5), yellow);
      leg.position.set(lx, 0.09, 0);
      g.add(leg);
    }
    g.position.set(x, groundHeight(x, z), z);
    g.rotation.y = rand() * Math.PI * 2;
    group.add(g);
  }

  function pig(x, z) {
    const g = new THREE.Group();
    const pink = stdMat(0xf3a0a7);
    const snoutMat = stdMat(0xe98291);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.48, 10, 8), pink);
    body.scale.set(1.2, 0.78, 0.88);
    body.position.y = 0.45;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 9, 7), pink);
    head.position.set(0, 0.48, 0.42);
    head.castShadow = true;
    g.add(head);
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 8), snoutMat);
    snout.position.set(0, 0.45, 0.67);
    snout.rotation.x = Math.PI / 2;
    g.add(snout);
    for (const lx of [-0.28, 0.28]) {
      for (const lz of [-0.22, 0.22]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.28, 6), pink);
        leg.position.set(lx, 0.14, lz);
        g.add(leg);
      }
    }
    g.position.set(x, groundHeight(x, z), z);
    g.rotation.y = rand() * Math.PI * 2;
    group.add(g);
  }

  function windmill(x, z) {
    const g = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.72, 6.5, 8), stdMat(0x9a6a43));
    tower.position.y = 3.25;
    tower.castShadow = true;
    g.add(tower);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.9, 8), stdMat(0x7c4a2a));
    cap.position.y = 6.9;
    cap.castShadow = true;
    g.add(cap);
    const hub = new THREE.Group();
    hub.position.set(0, 6.1, 0.95);
    const sailMat = stdMat(0xf3e6c8, { side: THREE.DoubleSide });
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Group();
      blade.rotation.z = (i / 4) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.06), stdMat(0x8a5a33));
      arm.position.y = 1.3;
      const sail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.7, 0.04), sailMat);
      sail.position.set(0.34, 1.5, 0);
      sail.rotation.z = 0.16;
      blade.add(arm, sail);
      hub.add(blade);
    }
    g.add(hub);
    spinners.push(hub);
    g.position.set(x, groundHeight(x, z), z);
    g.rotation.y = Math.atan2(-x, -z); // face the valley floor
    group.add(g);
  }

  function bench(cx, cz, rotY, len = 17.2) {
    const g = new THREE.Group();
    const wood = stdMat(0xa97c50);
    const legMat = stdMat(0x8a5a33);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.55), wood);
    seat.position.y = 0.5;
    seat.castShadow = true;
    g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, 0.4, 0.09), wood);
    back.position.set(0, 0.85, -0.26);
    back.rotation.x = -0.12;
    back.castShadow = true;
    g.add(back);
    for (const lx of [-len / 2 + 0.4, len / 2 - 0.4]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.5), legMat);
      leg.position.set(lx, 0.25, 0);
      leg.castShadow = true;
      g.add(leg);
    }
    g.position.set(cx, groundHeight(cx, cz), cz);
    g.rotation.y = rotY;
    group.add(g);
  }

  function post(x, z, h = 1.5) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, h, 7), stdMat(0x8a5a33));
    p.position.set(x, groundHeight(x, z) + h / 2, z);
    p.castShadow = true;
    group.add(p);
    return p;
  }

  // a drooping line of triangle pennants between two points — race-day bunting
  function pennantLine(x0, y0, z0, x1, y1, z1, sag = 0.9) {
    const flagCols = [0xe4574c, 0xf9d976, 0x5fc9c2, 0xb98cf7, 0xf5731f];
    const geo = new THREE.ConeGeometry(0.16, 0.34, 4);
    const mats = flagCols.map((c) => stdMat(c, { side: THREE.DoubleSide }));
    const n = Math.max(4, Math.floor(Math.hypot(x1 - x0, z1 - z0) / 1.5));
    const lineAng = Math.atan2(x1 - x0, z1 - z0);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const y = y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * sag;
      const flag = new THREE.Mesh(geo, mats[i % mats.length]);
      flag.rotation.order = 'YXZ';
      flag.rotation.y = lineAng;
      flag.rotation.x = Math.PI; // hang point-down
      flag.position.set(x, y - 0.17, z);
      group.add(flag);
    }
  }

  // the wandering road, as a single ribbon mesh that follows the terrain
  function buildPathRibbon(pts, width, color) {
    const pos = [], idx = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[Math.min(pts.length - 1, i + 1)];
      const o = pts[Math.max(0, i - 1)];
      let dx = q.x - o.x, dz = q.z - o.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const nx = -dz, nz = dx;
      const y = groundHeight(p.x, p.z) + 0.05;
      pos.push(p.x + nx * width / 2, y, p.z + nz * width / 2);
      pos.push(p.x - nx * width / 2, y, p.z - nz * width / 2);
      if (i > 0) {
        const a0 = (i - 1) * 2;
        idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, stdMat(color, { side: THREE.DoubleSide }));
    m.receiveShadow = true;
    group.add(m);
  }

  // The land course gets a small infield pond; the derby's whole infield is
  // already water, so adding a second pond would leave an artificial island.
  const pondC = { x: -innerA * 0.42, z: innerB * 0.1 };
  const pondRx = Math.min(7, innerA * 0.3);
  const pondRz = pondRx * 0.62;
  if (!isLake) {
    const rim = new THREE.Mesh(new THREE.CircleGeometry(1, 30), stdMat(0xd8c79c));
    rim.rotation.x = -Math.PI / 2;
    rim.scale.set(pondRx + 0.7, pondRz + 0.7, 1);
    rim.position.set(pondC.x, 0.012, pondC.z);
    rim.receiveShadow = true;
    group.add(rim);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(1, 30),
      stdMat(0x5fb6d9, { roughness: 0.35 })
    );
    water.rotation.x = -Math.PI / 2;
    water.scale.set(pondRx, pondRz, 1);
    water.position.set(pondC.x, 0.03, pondC.z);
    group.add(water);
    const padGeo = new THREE.CircleGeometry(0.26, 9);
    const padMat = stdMat(0x3e8e4a);
    for (let i = 0; i < 3; i++) {
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(pondC.x + (rand() - 0.5) * pondRx, 0.045, pondC.z + (rand() - 0.5) * pondRz);
      group.add(pad);
    }
    const reedStem = new THREE.CylinderGeometry(0.02, 0.025, 0.55, 5);
    const reedTip = new THREE.CylinderGeometry(0.035, 0.035, 0.16, 6);
    for (let i = 0; i < 6; i++) {
      const ang = rand() * Math.PI * 2;
      const rx = pondC.x + Math.cos(ang) * (pondRx + 0.5);
      const rz = pondC.z + Math.sin(ang) * (pondRz + 0.5);
      const stem = new THREE.Mesh(reedStem, stdMat(0x4c9a2a));
      stem.position.set(rx, 0.28, rz);
      group.add(stem);
      const tip = new THREE.Mesh(reedTip, stdMat(0x7a4b2a));
      tip.position.set(rx, 0.6, rz);
      group.add(tip);
    }
  }

  // --- tree cover: dense near the valley floor, thinning up the slopes ---
  let planted = 0, attempts = 0;
  while (planted < 108 && attempts++ < 950) {
    const ang = rand() * Math.PI * 2;
    const e = 0.86 + Math.pow(rand(), 0.8) * 3.4; // denser near, sparser far
    const { x, z } = spotOnSlope(ang, e);
    if (!canSit(x, z)) continue;
    const s = 0.9 + rand() * 1.3;
    const kind = rand();
    const tree = kind < 0.4 ? pineTree(s) : kind < 0.78 ? blobTree(s) : roundTree(s);
    tree.position.set(x, groundHeight(x, z) - 0.05, z);
    tree.rotation.y = rand() * Math.PI * 2;
    group.add(tree);
    planted++;
  }

  // --- bushes sprinkled between the trees ---
  for (let i = 0, tries = 0; i < 26 && tries < 200; tries++) {
    const ang = rand() * Math.PI * 2;
    const e = 0.85 + rand() * 2.6;
    const { x, z } = spotOnSlope(ang, e);
    if (!canSit(x, z)) continue;
    bush(x, z, 0.6 + rand() * 0.7);
    i++;
  }

  // --- two cottages near the race; the rest are distant valley homes ---
  house(-a * 1.35, -b * 1.5, 0.5, 0xd32f2f, 1.85); // red roof, near the start
  house(a * 0.2, -b * 1.95, 0.1, 0x7cb342, 1.7);    // green roof, near the road
  house(a * 2.6, -b * 2.6, -0.8, 0x1976d2, 1.65);  // distant blue roof
  house(a * 2.35, b * 2.5, 2.4, 0xf57c00, 1.75);   // distant orange roof
  house(-a * 2.7, b * 2.2, -0.4, 0x1976d2, 1.55); // distant blue roof
  house(a * 1.3, b * 3.1, 3.0, 0xf57c00, 1.55);    // distant orange roof

  // --- fence arcs near the track ---
  fenceArc(0, 0, -0.35, 0.45, outerA + 3.5, 7);
  fenceArc(0, 0, Math.PI - 0.4, Math.PI + 0.4, outerA + 3.5, 7);

  // --- hay bales resting on the apron ---
  for (const [ang, e] of [[0.35, 0.88], [2.6, 0.92], [3.6, 0.87], [5.5, 0.93]]) {
    const { x, z } = spotOnSlope(ang, e);
    if (!canSit(x, z)) continue;
    hayBale(x, z);
  }

  // --- farm animals grazing around the larger houses ---
  for (let i = 0, tries = 0; i < 14 && tries < 160; tries++) {
    const ang = rand() * Math.PI * 2;
    const e = 1.25 + rand() * 1.15;
    const { x, z } = spotOnSlope(ang, e);
    if (!canSit(x, z)) continue;
    sheep(x, z);
    i++;
  }
  for (const [x, z] of [
    [-a * 1.17, -b * 1.63], [-a * 1.08, -b * 1.72], [-a * 1.25, -b * 1.78],
    [a * 0.38, -b * 1.78], [a * 0.5, -b * 1.86],
  ]) chicken(x, z);
  for (const [x, z] of [
    [a * 0.08, -b * 1.7], [a * 0.32, -b * 1.72], [a * 0.2, -b * 1.82],
  ]) pig(x, z);

  // --- windmill on the western slope ---
  {
    const { x, z } = spotOnSlope(2.4, 1.28);
    windmill(x, z);
  }

  // --- flower patches & rocks ---
  for (let i = 0; i < 10; i++) {
    const ang = rand() * Math.PI * 2;
    const rr = outerA + 4 + rand() * a * 1.4;
    flowerPatch(Math.cos(ang) * rr * 1.3, Math.sin(ang) * rr * 0.75);
  }
  for (let i = 0; i < 10; i++) {
    const ang = rand() * Math.PI * 2;
    const rr = outerA + 3 + rand() * a * 1.5;
    rock(Math.cos(ang) * rr * 1.35, Math.sin(ang) * rr * 0.75, 0.3 + rand() * 0.7);
  }
  if (!isLake) {
    // a few rocks and a tree only belong on the grassy land-course infield.
    for (let i = 0; i < 3; i++) {
      const ang = rand() * 1.6 - 0.8;
      rock(Math.cos(ang) * innerA * 0.4, Math.sin(ang) * innerB * 0.4, 0.35 + rand() * 0.4);
    }
    const midTree = blobTree(1.3);
    midTree.position.set(0, 0, 0);
    group.add(midTree);
    flowerPatch(2.5, 1.5);
    flowerPatch(-2.5, -1.5);
  }

  // --- grandstand benches behind the start line ---
  for (let row = 0; row < 3; row++) {
    bench(0, outerZ + 1.5 + row * 2.4 + 1.35, Math.PI);
  }

  // The derby already has natural lotus lane markers; keep the colourful
  // racing bunting for the land course so it cannot be mistaken for buoys.
  if (!isLake) {
    const poleTopY = 4;
    const poleZN = stripeZ - halfW;
    const poleZS = stripeZ + halfW;
    for (const sx of [-1, 1]) {
      const ex = sx * a * 1.05, ez = b * 0.9;
      post(ex, ez);
      pennantLine(-0.25, poleTopY, poleZN, ex, 1.35, ez);
    }
    for (const sx of [-1, 1]) {
      const ex = sx * 8, ez = outerZ + 8.5;
      post(ex, ez);
      pennantLine(-0.25, poleTopY, poleZS, ex, 1.3, ez, 0.7);
    }
  }

  // --- the road north, fading into the fog ---
  buildPathRibbon(pathPts, 3, 0xcdb083);

  // --- clouds ---
  const cloudMat = stdMat(0xffffff, { roughness: 1, flatShading: false });
  const cloudGeo = new THREE.SphereGeometry(1, 10, 8);
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Group();
    const puffs = 3 + Math.floor(rand() * 3);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      puff.position.set((rand() - 0.5) * 6, (rand() - 0.5) * 1, (rand() - 0.5) * 3);
      puff.scale.set(1.6 + rand(), 0.9 + rand() * 0.4, 1.2 + rand() * 0.6);
      c.add(puff);
    }
    const ang = (i / 8) * Math.PI * 2;
    const x = Math.cos(ang) * a * (1.6 + rand() * 0.8);
    const z = Math.sin(ang) * b * (2.2 + rand());
    c.position.set(x, 24 + rand() * 6, z);
    group.add(c);
    clouds.push({ g: c, x, i });
  }

  // --- low mist banks drifting over the lower slopes ---
  const mistTex = mistTexture();
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.SpriteMaterial({
      map: mistTex, transparent: true, depthWrite: false,
      opacity: 0.16 + rand() * 0.14,
    });
    const sp = new THREE.Sprite(mat);
    const ang = rand() * Math.PI * 2;
    const e = 1.25 + rand() * 1.6;
    const x = Math.cos(ang) * e * flatA, z = Math.sin(ang) * e * flatB;
    sp.position.set(x, groundHeight(x, z) + 2 + rand() * 3.5, z);
    const s = 26 + rand() * 34;
    sp.scale.set(s, s * 0.32, 1);
    group.add(sp);
    mists.push({ sp, x, i });
  }

  // ---------- gentle life: wind, mist, clouds ----------
  function animate(t) {
    for (const h of spinners) h.rotation.z = t * 0.85;
    for (const m of mists) m.sp.position.x = m.x + Math.sin(t * 0.02 + m.i * 1.7) * 4;
    for (const c of clouds) c.g.position.x = c.x + Math.sin(t * 0.008 + c.i * 2.1) * 7;
    if (waterSurface) {
      const pos = waterSurface.geometry.attributes.position;
      const normals = waterSurface.geometry.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        const wave = waterAt(pos.getX(i), -pos.getY(i), t);
        pos.setZ(i, wave.height - waterSurface.position.y);
        const len = Math.hypot(wave.dx, wave.dz, 1);
        normals.setXYZ(i, -wave.dx / len, wave.dz / len, 1 / len);
      }
      pos.needsUpdate = true;
      normals.needsUpdate = true;
    }
    for (const f of floaters) {
      f.mesh.position.y = waterAt(f.mesh.position.x, f.mesh.position.z, t).height + f.offset;
    }
    for (const g of waterGlints) {
      const pulse = 0.14 + 0.1 * (0.5 + 0.5 * Math.sin(t * 1.25 + g.phase));
      g.mesh.material.opacity = pulse;
      g.mesh.rotation.z = g.phase + t * 0.025;
      g.mesh.position.y = waterAt(g.mesh.position.x, g.mesh.position.z, t).height + 0.015;
    }
  }

  const track = { a, b, laneWidth, lanes, length, outerZ };

  return { scene, group, track, lanePoint, groundHeight, animate };
}
