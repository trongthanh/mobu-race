// Vietnamese Mid-Autumn paper lanterns: coloured panels, bamboo frames,
// hanging threads and tassels. Pure geometry; safe to use in headless tests.
import * as THREE from '../vendor/three.module.js';

export const LANTERN_SHAPES = Object.freeze([
  'star', 'bunny', 'rooster', 'fish', 'boat', 'pig',
  'butterfly', 'mobu', 'airplane', 'lotus', 'dragon',
]);
const COLORS = [0xff654e, 0xffc34c, 0xff83b5, 0x64dec9, 0xc49aff, 0xff9d48];
const ellipse = (x, y, rx, ry, n = 20) => Array.from({ length: n }, (_, i) => {
  const a = i / n * Math.PI * 2;
  return [x + Math.cos(a) * rx, y + Math.sin(a) * ry];
});

export function lanternSpecFromSeed(seed) {
  const n = seed >>> 0;
  return { shape: LANTERN_SHAPES[n % LANTERN_SHAPES.length], color: COLORS[(n >>> 8) % COLORS.length] };
}

function rod(group, from, to, radius, material) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 5), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
  group.add(mesh);
  return mesh;
}

/** A lantern centred at the origin, roughly 1.4 canonical units tall. */
export function createLantern(seed = 0, shapeOverride) {
  const spec = lanternSpecFromSeed(seed);
  const shape = LANTERN_SHAPES.includes(shapeOverride) ? shapeOverride : spec.shape;
  const group = new THREE.Group();
  group.name = `lantern-${shape}`;
  group.userData.lanternShape = shape;
  const translucentPaper = (color, glow) => new THREE.MeshStandardMaterial({
    color, emissive: glow, emissiveIntensity: 0.65, roughness: 0.8,
    transparent: true, opacity: 0.82, depthWrite: false,
    side: THREE.DoubleSide, forceSinglePass: true,
  });
  const paper = translucentPaper(spec.color, spec.color);
  const cream = translucentPaper(0xffecb5, 0xffcb68);
  const pink = translucentPaper(0xf98cac, 0xf95a78);
  // Deeper side walls are paper too, not a solid slab of bamboo. The frame
  // remains opaque; a warm inner flame shows through the translucent shell.
  const sidePaper = new THREE.MeshStandardMaterial({
    color: spec.color, emissive: 0xffa54f, emissiveIntensity: 0.7,
    transparent: true, opacity: 0.58, depthWrite: false,
    side: THREE.DoubleSide, forceSinglePass: true, roughness: 0.8,
  });
  const bamboo = new THREE.MeshStandardMaterial({ color: 0xc88736, emissive: 0x7c3e12, emissiveIntensity: 0.25 });
  const ink = new THREE.MeshBasicMaterial({ color: 0x522444 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x9c3340 });
  let panelDepth = 0.32;
  const artworkZ = 0.22;

  function panel(points, material = paper, detail = false) {
    const outline = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    if (detail) {
      const geo = new THREE.ShapeGeometry(outline);
      for (const side of [-1, 1]) {
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.z = side * artworkZ;
        // Flip the face normal, not X: the reverse artwork must still align
        // with asymmetric silhouettes (rooster head, fish eye, dragon snout).
        if (side < 0) mesh.scale.z = -1;
        group.add(mesh);
      }
    } else {
      // Layer overlapping wings/petals without coplanar faces on either side.
      const depth = panelDepth;
      panelDepth += 0.003;
      const geo = new THREE.ExtrudeGeometry(outline, {
        depth, steps: 1, bevelEnabled: true,
        bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1,
      });
      geo.translate(0, 0, -depth / 2);
      // ExtrudeGeometry assigns bevels AND walls to its second material. Split
      // those triangles into three contiguous draws, so only the thin bamboo
      // rim is opaque, while the broad side walls transmit the interior glow.
      const buckets = [[], [], []];
      const normals = geo.attributes.normal;
      for (let i = 0; i < normals.count; i += 3) {
        const nz = Math.abs(normals.getZ(i));
        const bucket = nz > 0.99 ? 0 : nz < 0.01 ? 1 : 2;
        buckets[bucket].push(i, i + 1, i + 2);
      }
      geo.setIndex(buckets.flat());
      geo.clearGroups();
      let start = 0;
      buckets.forEach((indices, index) => {
        geo.addGroup(start, indices.length, index);
        start += indices.length;
      });
      const shell = new THREE.Mesh(geo, [material, sidePaper, bamboo]);
      shell.name = 'lantern-paper-shell';
      group.add(shell);
    }
  }
  const oval = (x, y, rx, ry, mat = paper, detail = false) => panel(ellipse(x, y, rx, ry), mat, detail);
  const eye = (x, y, size = 0.065) => {
    oval(x, y, size * 1.6, size * 1.6, cream, true);
    // A slight extra depth avoids coplanar decoration flicker.
    const before = group.children.length;
    oval(x, y, size, size, ink, true);
    for (const mesh of group.children.slice(before)) mesh.position.z *= 1.02;
  };
  const seam = (a, b) => {
    for (const side of [-1, 1]) rod(group, [...a, side * (artworkZ + 0.015)], [...b, side * (artworkZ + 0.015)], 0.012, bamboo);
  };
  const smile = (width, y, rise, thickness, material, name) => {
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 17 }, (_, i) => {
      const u = i / 8 - 1;
      return new THREE.Vector3(u * width, y + rise * u * u, 0);
    }));
    const geo = new THREE.TubeGeometry(curve, 24, thickness, 8, false);
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.z = side * (artworkZ + thickness);
      mesh.name = name;
      group.add(mesh);
    }
  };

  switch (shape) {
    case 'star': {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.31 : 0.76;
        return [Math.cos(a) * r, Math.sin(a) * r];
      });
      panel(pts);
      for (let i = 0; i < 10; i += 2) seam([0, 0], pts[i]);
      oval(0, 0, 0.12, 0.12, cream, true);
      break;
    }
    case 'bunny':
      panel([[-0.47,-0.48],[-0.6,-0.1],[-0.46,0.28],[-0.38,0.4],[-0.44,0.93],[-0.23,1.02],[-0.08,0.45],[0.1,0.45],[0.23,1.02],[0.43,0.93],[0.35,0.34],[0.54,0.1],[0.5,-0.4],[0.25,-0.55]], cream);
      oval(-0.3,0.69,0.055,0.22,pink,true); oval(0.28,0.69,0.055,0.22,pink,true);
      eye(-0.2,0.13); eye(0.2,0.13); oval(0,-0.05,0.09,0.06,pink,true);
      oval(0,-0.31,0.27,0.14,paper,true);
      break;
    case 'rooster':
      panel([[-0.55,-0.43],[-0.82,0.15],[-0.74,0.57],[-0.48,0.28],[-0.35,0.5],[-0.18,0.13],[0.16,0.23],[0.17,0.62],[0.35,0.76],[0.56,0.66],[0.53,0.24],[0.68,0.06],[0.43,-0.39],[0.08,-0.55]]);
      panel([[0.18,0.66],[0.12,0.87],[0.28,0.84],[0.35,1],[0.44,0.84],[0.62,0.86],[0.54,0.65]],pink);
      panel([[0.53,0.48],[0.83,0.36],[0.53,0.29]],cream);
      oval(-0.08,-0.07,0.29,0.23,cream,true); eye(0.37,0.51);
      break;
    case 'fish':
      panel([[-0.62,0],[-0.89,0.42],[-0.88,-0.42]]);
      panel([[-0.61,0],[-0.31,0.36],[0.23,0.45],[0.65,0.22],[0.81,0],[0.65,-0.22],[0.23,-0.45],[-0.31,-0.36]]);
      panel([[-0.2,0.36],[0.08,0.66],[0.35,0.42]],pink);
      eye(0.48,0.1); seam([0.25,0.39],[0.25,-0.39]);
      for (const x of [-0.28,-0.06]) seam([x,0.24],[x,-0.24]);
      break;
    case 'boat':
      panel([[-0.88,-0.17],[0.87,-0.17],[0.51,-0.56],[-0.51,-0.56]]);
      panel([[-0.04,0.8],[-0.04,-0.08],[-0.7,-0.08]],cream);
      panel([[0.07,0.69],[0.68,-0.08],[0.07,-0.08]],pink);
      seam([0,-0.24],[0,0.83]);
      break;
    case 'pig':
      // Round piglet cheeks, two pointed ears, and a broad two-nostril snout.
      panel([[-0.49,0.27],[-0.61,0.76],[-0.23,0.53],[0.23,0.53],[0.61,0.76],[0.49,0.27]],pink);
      oval(0,-0.03,0.64,0.59,pink);
      panel([[-0.47,0.43],[-0.5,0.62],[-0.31,0.49]],cream,true);
      panel([[0.47,0.43],[0.5,0.62],[0.31,0.49]],cream,true);
      oval(-0.23,0.15,0.045,0.065,ink,true);
      oval(0.23,0.15,0.045,0.065,ink,true);
      oval(0,-0.09,0.29,0.2,cream,true);
      {
        const start = group.children.length;
        oval(-0.105,-0.09,0.04,0.065,dark,true);
        oval(0.105,-0.09,0.04,0.065,dark,true);
        for (const mesh of group.children.slice(start)) mesh.position.z *= 1.03;
      }
      smile(0.16,-0.39,0.045,0.017,dark,'pig-smile');
      break;
    case 'butterfly':
      for (const side of [-1,1]) {
        panel([[0,0.1],[side*0.43,0.7],[side*0.79,0.58],[side*0.7,0.08],[side*0.41,-0.12],[side*0.63,-0.46],[side*0.3,-0.64],[0,-0.21]]);
        oval(side*0.46,0.33,0.16,0.2,cream,true);
        oval(side*0.31,-0.35,0.12,0.13,pink,true);
      }
      oval(0,0,0.08,0.46,cream); seam([-0.03,0.35],[-0.23,0.66]); seam([0.03,0.35],[0.23,0.66]);
      break;
    case 'mobu':
      panel([[-0.48,-0.5],[-0.59,-0.05],[-0.44,0.42],[-0.2,0.63],[0.2,0.63],[0.44,0.42],[0.59,-0.05],[0.48,-0.5]]);
      eye(-0.19,0.29,0.045); eye(0.19,0.29,0.045);
      // Two plump curved lips, with upturned corners rather than a flat oval.
      smile(0.39,-0.035,0.13,0.065,cream,'mobu-upper-lip');
      smile(0.39,-0.13,0.225,0.065,cream,'mobu-lower-lip');
      for (const x of [-0.18,0,0.18]) oval(x,0.69,0.05,0.14,ink);
      panel([[-0.48,-0.32],[0.48,-0.32],[0.4,-0.6],[-0.4,-0.6]],pink);
      break;
    case 'airplane':
      panel([[0,0.85],[0.14,0.62],[0.15,0.19],[0.88,-0.2],[0.88,-0.38],[0.15,-0.18],[0.13,-0.48],[0.38,-0.64],[0.38,-0.77],[0,-0.68],[-0.38,-0.77],[-0.38,-0.64],[-0.13,-0.48],[-0.15,-0.18],[-0.88,-0.38],[-0.88,-0.2],[-0.15,0.19],[-0.14,0.62]]);
      seam([0,-0.64],[0,0.65]); oval(0,0.38,0.08,0.16,cream,true);
      break;
    case 'lotus':
      for (const side of [-1,1]) {
        panel([[0,-0.5],[side*0.61,-0.27],[side*0.82,0.38],[side*0.32,0.12]],pink);
        panel([[0,-0.5],[side*0.44,-0.08],[side*0.43,0.64],[0,0.28]],paper);
      }
      panel([[0,-0.48],[-0.24,0.13],[0,0.8],[0.24,0.13]],cream);
      seam([-0.5,-0.48],[0.5,-0.48]);
      break;
    case 'dragon':
      panel([[-0.91,-0.49],[-0.61,-0.1],[-0.72,0.34],[-0.45,0.23],[-0.23,-0.1],[0.08,-0.17],[0.27,0.11],[0.08,0.43],[0.24,0.64],[0.46,0.66],[0.61,0.42],[0.85,0.37],[0.88,0.11],[0.54,-0.03],[0.4,-0.46],[0.04,-0.58],[-0.4,-0.41]]);
      panel([[0.15,0.56],[0.1,0.88],[0.33,0.7],[0.46,0.88],[0.47,0.6]],cream);
      eye(0.46,0.4);
      for (const x of [-0.38,-0.14,0.1]) seam([x,-0.22],[x+0.06,-0.4]);
      break;
  }
  // Emissive flame, not a PointLight: transparent paper exposes its warm core
  // without adding one lighting/shadow calculation per racer or decoration.
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.085,10,8),new THREE.MeshBasicMaterial({ color: 0xffe6a3 }));
  flame.name = 'lantern-inner-glow';
  flame.position.y = shape === 'boat' ? -0.35 : shape === 'dragon' ? -0.29 : 0;
  flame.scale.y = 1.5;
  group.add(flame);

  // A visible loop and silk tassel make even the playful silhouettes read as lanterns.
  rod(group, [0,0.7,0], [0,1.06,0], 0.012, dark);
  rod(group, [0,-0.5,0], [0,-0.84,0], 0.014, dark);
  const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.085,0.25,6), pink);
  tassel.position.y = -0.9;
  group.add(tassel);
  return group;
}

/** Attach to a canonical Mobu hand, not its wardrobe slots. No per-racer lights. */
export function createCarriedLantern(seed) {
  const group = new THREE.Group();
  group.name = 'lantern-carrier';
  const bamboo = new THREE.MeshStandardMaterial({ color: 0xe4b36a, roughness: 0.85 });
  rod(group, [0,-0.12,0], [0.25,1.68,0.52], 0.035, bamboo);
  rod(group, [0.25,1.68,0.52], [0.55,1.68,0.52], 0.025, bamboo);
  const hanger = new THREE.Group();
  hanger.position.set(0.55,1.68,0.52);
  const lantern = createLantern(seed);
  lantern.scale.setScalar(0.74);
  lantern.position.y = -0.79;
  hanger.add(lantern);
  group.add(hanger);
  return { group, animate(t) { hanger.rotation.z = Math.sin(t * 2.7 + (seed >>> 0) % 17) * 0.12; } };
}
