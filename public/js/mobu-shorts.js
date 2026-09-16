// Boxing trunks: two shaped leg tubes sharing a front/crotch/back seam,
// not a single skirt-like shell. The elastic waistband is added by costumes.js.
import * as THREE from '../vendor/three.module.js';
import { radiusAt } from './rig.js';

const WAIST = 1.25, CROTCH = 0.64, HEM = 0.37;
const LEG_X = 0.49, LEG_RX = 0.47, LEG_RZ = 0.80;
const ROWS = 14, COLS = 48;

export function boxingPoint(side, angle, v, out = new THREE.Vector3()) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const r = radiusAt(WAIST) + 0.055;
  // Each top boundary is half the waist plus the same curved crotch seam.
  // The two seams coincide; the two hem loops remain separate.
  const topY = c >= 0 ? WAIST : CROTCH + (WAIST - CROTCH) * s ** 4;
  const bottomY = HEM + 0.035 * Math.max(0, -c) ** 2;
  const puff = Math.sin(v * Math.PI) * 0.025;
  return out.set(
    side * (THREE.MathUtils.lerp(r * Math.max(0, c), LEG_X + LEG_RX * c, v) + puff * Math.max(0, c)),
    THREE.MathUtils.lerp(topY, bottomY, v),
    THREE.MathUtils.lerp(r * s, LEG_RZ * s, v) + puff * s,
  );
}

export function boxingLeg(side, material, cuff = false) {
  const positions = [], indices = [];
  const rows = cuff ? 2 : ROWS;
  const p = new THREE.Vector3();
  for (let i = 0; i <= rows; i++) {
    const v = cuff ? 0.89 + 0.11 * i / rows : i / rows;
    for (let j = 0; j <= COLS; j++) {
      const a = j / COLS * Math.PI * 2;
      boxingPoint(side, a, v, p);
      if (cuff) { p.x += side * Math.cos(a) * 0.008; p.z += Math.sin(a) * 0.008; }
      positions.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < COLS; j++) {
      const a = i * (COLS + 1) + j, b = a + 1, c = a + COLS + 1, d = c + 1;
      if (side > 0) indices.push(a, b, c, b, d, c);
      else indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // Match normals at the duplicate angular UV seam (outer side of each leg).
  const n = geo.attributes.normal, avg = new THREE.Vector3();
  for (let i = 0; i <= rows; i++) {
    const a = i * (COLS + 1), b = a + COLS;
    avg.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, avg.x, avg.y, avg.z); n.setXYZ(b, avg.x, avg.y, avg.z);
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = `boxing-${side < 0 ? 'left' : 'right'}-${cuff ? 'hem' : 'leg'}`;
  mesh.userData.trouserLeg = side;
  mesh.castShadow = true;
  return mesh;
}

/** Project a patch's local XY onto a leg, including its tailored crotch. */
export function boxingPatchPoint(side, angle, y, x, dy, depth, out) {
  const a = angle - side * x / 0.8;
  const c = Math.cos(a), s = Math.sin(a);
  const topY = c >= 0 ? WAIST : CROTCH + (WAIST - CROTCH) * s ** 4;
  const bottomY = HEM + 0.035 * Math.max(0, -c) ** 2;
  const v = THREE.MathUtils.clamp((topY - y - dy) / (topY - bottomY), 0.02, 0.96);
  boxingPoint(side, a, v, out);
  out.x += side * c * (depth + 0.012);
  out.z += s * (depth + 0.012);
  return out;
}
