import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.js';
import { createWatcher, disposeRig } from '../public/js/mobu.js';
import { visitorStyleFromSeed, VISITOR_HAIR, VISITOR_OUTFITS } from '../public/js/visitors.js';

const hair = new Set(), outfits = new Set(), gestures = new Set();
let maxTriangles = 0, maxMeshes = 0;
for (let seed = 0; seed < 80; seed++) {
  const style = visitorStyleFromSeed(seed);
  assert.deepEqual(style, visitorStyleFromSeed(seed), 'appearance and gesture phase are seeded');
  hair.add(style.hairstyle); outfits.add(style.outfit); gestures.add(style.gesture);
  const visitor = createWatcher({ seed });
  assert.deepEqual(visitor.group.userData.style, style);
  let triangles = 0, meshes = 0;
  visitor.group.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    const geo = o.geometry;
    triangles += (geo.index?.count ?? geo.attributes.position.count) / 3;
    for (const v of geo.attributes.position.array) assert.ok(Number.isFinite(v), 'finite mesh');
    for (const v of geo.attributes.normal.array) assert.ok(Number.isFinite(v), 'finite normals');
  });
  maxTriangles = Math.max(maxTriangles, triangles); maxMeshes = Math.max(maxMeshes, meshes);
  const shoePositions = visitor.rig.shoes.map(s => s.getWorldPosition(new THREE.Vector3()));
  for (const excitement of [0, 0.5, 1]) for (const t of [0, 0.08, 0.5, 2, 9, 31]) {
    visitor.animate(t, excitement);
    visitor.group.updateMatrixWorld(true);
    visitor.group.traverse(o => assert.ok(o.matrixWorld.elements.every(Number.isFinite)));
    const box = new THREE.Box3().setFromObject(visitor.group);
    assert.ok(box.min.y >= -0.001, 'no mesh falls below the ground');
    assert.ok(box.max.y < 1.99, 'name labels at y=2 stay above hair and hands');
    visitor.rig.shoes.forEach((s, i) => assert.ok(s.getWorldPosition(new THREE.Vector3()).distanceTo(shoePositions[i]) < 1e-9, 'soles remain planted'));
    assert.ok(visitor.rig.eyes.every(e => e.scale.y > 0 && e.scale.y <= 1));
  }
  visitor.setHeading(1.7); visitor.animate(2, 1);
  assert.equal(visitor.group.rotation.y, 1.7);
  visitor.animate(2, 0);
  assert.equal(visitor.rig.elbows[0].rotation.x, -0.18, 'cheer returns cleanly to idle');
  disposeRig(visitor.group);
}
assert.equal(hair.size, VISITOR_HAIR.length);
assert.equal(outfits.size, VISITOR_OUTFITS.length);
assert.equal(gestures.size, 3);
assert.ok(maxTriangles < 35000 && maxMeshes < 100, 'bounded spectator complexity');
console.log(`PASS: 80 seeded visitors, ${hair.size} hairstyles, ${outfits.size} outfits, planted soles, finite idle/cheer/blinks; max ${maxTriangles} triangles / ${maxMeshes} meshes`);
