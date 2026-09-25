// Headless Mid-Autumn regression checks. Run: node tests/moon-check.mjs
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.js';
import { LANTERN_SHAPES, lanternSpecFromSeed, createLantern } from '../public/js/lanterns.js';
import { createMobu, disposeRig } from '../public/js/mobu.js';
import { createDuck } from '../public/js/duck.js';
import { costumeFromSeed } from '../public/js/costumes.js';
import { addFestivalLights } from '../public/js/moon-festival.js';

function finiteGeometry(group) {
  group.updateMatrixWorld(true);
  group.traverse(o => {
    assert.ok(o.matrixWorld.elements.every(Number.isFinite));
    for (const attr of Object.values(o.geometry?.attributes || {})) {
      assert.ok(attr.array.every(Number.isFinite), `${o.name}: finite geometry`);
    }
  });
}
function signature(group) {
  const shapes = [];
  group.traverse(o => {
    if (o.isMesh) shapes.push([
      Array.from(o.geometry.attributes.position.array),
      (Array.isArray(o.material) ? o.material : [o.material]).map(m => m.color.getHex()),
    ]);
  });
  return shapes;
}

assert.equal(LANTERN_SHAPES.length, 11);
assert.equal(lanternSpecFromSeed(5).shape, 'pig', 'pig replaces the former lion slot without reshuffling other seeds');
assert.ok(!LANTERN_SHAPES.includes('lion'));
const signatures = new Set();
for (const [index, shape] of LANTERN_SHAPES.entries()) {
  assert.equal(lanternSpecFromSeed(index).shape, shape);
  const lantern = createLantern(index);
  assert.equal(lantern.userData.lanternShape, shape);
  finiteGeometry(lantern);
  assert.ok(lantern.getObjectByName('lantern-inner-glow'), `${shape}: warm interior glow`);
  lantern.traverse(o => {
    if (o.name !== 'lantern-paper-shell') return;
    const [face, sides, frame] = o.material;
    // Black Mobu tufts intentionally remain opaque; all side walls are paper.
    if (!face.isMeshBasicMaterial) assert.ok(face.transparent && face.opacity < 1);
    assert.ok(sides.transparent && sides.opacity < 0.7 && sides.emissiveIntensity > 0);
    assert.equal(sides.depthWrite, false, 'transparent paper does not hide its inner glow');
    assert.equal(frame.transparent, false, 'bamboo rim stays solid');
    assert.ok(o.geometry.groups.every(g => g.count > 0), 'separate face / wall / bevel draws');
    o.geometry.computeBoundingBox();
    assert.ok(o.geometry.boundingBox.max.z - o.geometry.boundingBox.min.z >= 0.37, 'deeper lantern sides');
  });
  if (shape === 'mobu') {
    for (const name of ['mobu-upper-lip', 'mobu-lower-lip']) {
      const lip = lantern.getObjectByName(name);
      assert.ok(lip, `${name}: curved lip mesh`);
      const path = lip.geometry.parameters.path;
      assert.ok(path.getPoint(0).y > path.getPoint(0.5).y + 0.1);
      assert.ok(path.getPoint(1).y > path.getPoint(0.5).y + 0.1);
    }
  }
  const box = new THREE.Box3().setFromObject(lantern);
  assert.ok(box.max.y < 1.15 && box.min.y > -1.15, `${shape}: portable size`);
  assert.ok(box.max.z > 0.1 && box.min.z < -0.1, `${shape}: paper has volume`);
  const other = createLantern(index);
  assert.deepEqual(signature(lantern), signature(other), `${shape}: deterministic geometry and palette`);
  signatures.add(JSON.stringify(signature(lantern)));
  disposeRig(lantern); disposeRig(other);
}
assert.equal(signatures.size, 11, 'eleven distinct silhouettes');
assert.deepEqual(lanternSpecFromSeed(-1), lanternSpecFromSeed(0xffffffff));

const ordinary = createMobu();
assert.equal(ordinary.group.getObjectByName('lantern-carrier'), undefined, 'ordinary Mobus stay unchanged');
disposeRig(ordinary.group);
const duck = createDuck({ seed: 123 });
assert.equal(duck.group.getObjectByName('lantern-carrier'), undefined, 'ducks never carry Mobu lanterns');
disposeRig(duck.group);

for (const seed of [0,1,2,3,4,5,6,7,8,9,10,0xffffffff]) {
  const mobu = createMobu({ lanternSeed: seed });
  const carrier = mobu.group.getObjectByName('lantern-carrier');
  assert.equal(carrier.parent, mobu.rig.parts.handR);
  mobu.setCostume(costumeFromSeed(seed));
  mobu.setCostume(costumeFromSeed(seed+29));
  assert.equal(carrier.parent, mobu.rig.parts.handR, 'costume changes preserve carried lantern');
  for (const celebrating of [false,true]) {
    mobu.setCelebrating(celebrating);
    for (const speed of [0,0.5,1]) {
      for (const t of [0,0.4,1.7,12,59]) {
        mobu.animate(t,speed,{ distance:t*2, phase:seed%7 });
        finiteGeometry(mobu.group);
        const box = new THREE.Box3().setFromObject(carrier);
        assert.ok(box.min.y > 0.1, 'carried lantern clears the ground in all poses');
        // The hand rotation and counter-rotation cancel in torso space.
        const q = mobu.rig.parts.armR.quaternion.clone().multiply(carrier.quaternion);
        assert.ok(q.angleTo(new THREE.Quaternion()) < 1e-6, 'handle stays upright');
      }
    }
  }
  let lights = 0;
  carrier.traverse(o => { if (o.isLight) lights++; });
  assert.equal(lights,0,'no per-racer light cost');
  const geometry = carrier.children[0].geometry;
  let disposed = false;
  geometry.addEventListener('dispose',() => { disposed = true; });
  disposeRig(mobu.group);
  assert.ok(disposed,'lantern GPU resources use normal rig disposal');
}

const scenery = new THREE.Group();
const animate = addFestivalLights(scenery, {
  lanePoint(p,lateral) { return new THREE.Vector3(Math.sin(p*Math.PI*2)*(26+lateral),0,Math.cos(p*Math.PI*2)*(15+lateral)); },
  groundHeight() { return 0; }, outerZ: 22,
});
animate(0); animate(15); finiteGeometry(scenery);
let lights = 0, lanterns = 0;
scenery.traverse(o => {
  if (o.isLight) { lights++; assert.equal(o.castShadow,false); }
  if (o.userData.lanternShape) lanterns++;
});
assert.equal(lights,5,'fixed environment light budget');
assert.equal(lanterns,38,'track garland plus two audience canopies');
disposeRig(scenery);
console.log('Moon edition: 11 deterministic lanterns, costumes, poses, ground clearance, disposal and scenery budget OK');
