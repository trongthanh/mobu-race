import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.js';
import { waterAt, createLakeGeometry, createSurfaceTrail } from '../public/js/surface.js';
import { createDuck } from '../public/js/duck.js';
import { DUCK_OUTFITS, duckCostumeFromSeed } from '../public/js/duck-costumes.js';
import { createMobu, disposeRig } from '../public/js/mobu.js';
import { costumeFromSeed, COSTUME_LOOKS, normalizeCostume } from '../public/js/costumes.js';

for (let i = 0; i < 1000; i++) {
  const x = Math.sin(i) * 90, z = Math.cos(i * 3) * 60, t = i / 11;
  const wave = waterAt(x, z, t), e = 0.0001;
  assert.ok(wave.height > 0.11 && wave.height < 0.21, 'water never exposes the y=0 terrain');
  assert.ok(Math.abs(wave.dx - (waterAt(x + e, z, t).height - waterAt(x - e, z, t).height) / (2 * e)) < 1e-6);
  assert.ok(Math.abs(wave.dz - (waterAt(x, z + e, t).height - waterAt(x, z - e, t).height) / (2 * e)) < 1e-6);
}
const geometry = createLakeGeometry(32, 21);
assert.ok(geometry.attributes.position.count > 4000, 'lake has interior tessellation');
const positions = geometry.attributes.position, index = geometry.index;
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
for (let i = 0; i < index.count; i += 3) {
  a.fromBufferAttribute(positions, index.getX(i)); b.fromBufferAttribute(positions, index.getX(i + 1)); c.fromBufferAttribute(positions, index.getX(i + 2));
  assert.ok(b.sub(a).cross(c.sub(a)).z >= -1e-7, 'lake front faces point up after rotation');
}
geometry.dispose();
const themes = new Set();
for (let seed = 0; seed < 256; seed++) {
  const spec = duckCostumeFromSeed(seed);
  assert.deepEqual(spec, duckCostumeFromSeed(seed)); themes.add(spec.theme);
  assert.deepEqual(normalizeCostume(costumeFromSeed(seed)), costumeFromSeed(seed));
}
assert.equal(themes.size, DUCK_OUTFITS.length);
assert.ok(COSTUME_LOOKS.length >= 8);
for (const theme of themes) {
  let seed = 0; while (duckCostumeFromSeed(seed).theme !== theme) seed++;
  const duck = createDuck({ seed });
  assert.ok(duck.group.getObjectByName(`duck-outfit-${theme}`));
  for (const speed of [0, 0.3, 1]) for (const t of [0, 0.3, 2, 30]) {
    duck.group.position.set(8, 0, 12); duck.setHeading(1.2); duck.setCelebrating(true);
    duck.animate(t, speed, { distance: t * 4, acceleration: 2, turn: 0.1 });
    assert.ok(Math.abs(duck.group.position.y - (waterAt(8, 12, t).height - 0.32)) < 1e-9);
    duck.group.updateMatrixWorld(true);
    duck.group.traverse(o => assert.ok(o.matrixWorld.elements.every(Number.isFinite)));
  }
  disposeRig(duck.group);
}
const mobu = createMobu();
for (let i = 0; i < 100; i++) {
  mobu.animate(i / 30, 0.8, { distance: i / 10, turn: 0.2 });
  mobu.group.updateMatrixWorld(true);
  const feet = [mobu.rig.parts.legL, mobu.rig.parts.legR].map(leg => new THREE.Box3().setFromObject(leg).min.y);
  assert.ok(feet.every(y => y >= 0.049), 'running feet do not sink below dirt');
  assert.ok(feet.some(y => y < 0.051), 'at least one planted foot supports the waddle');
}
const scene = new THREE.Scene();
for (const lake of [false, true]) {
  const trail = createSurfaceTrail(scene, lake, 42);
  const poolSize = scene.children.length;
  for (let i = 0; i < 300; i++) trail.update(i / 60, new THREE.Vector3(i / 10, 0, 3), 1.5, 6, i / 10);
  assert.equal(scene.children.length, poolSize, 'trail pool is bounded');
  trail.update(10, new THREE.Vector3(), 0, 0);
  assert.ok(scene.children.every(o => !o.visible), 'trails expire at rest');
  trail.dispose(); assert.equal(scene.children.length, 0);
}
disposeRig(mobu.group);
console.log('PASS: shared wave normals, buoyancy, 8 duck outfits, seeded mobu looks, planted feet, bounded trails');
