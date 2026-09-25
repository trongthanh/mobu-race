// Geometry and edition-scope checks; no browser or rendering required.
// Run: node tests/scenery-check.mjs
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.js';
import { createGoat, createCoconutPalm, trackFacingYaw } from '../public/js/countryside.js';
import { createWorld } from '../public/js/environment.js';
import { disposeRig } from '../public/js/mobu.js';

function count(root, name) {
  let n = 0;
  root.traverse(o => { if (o.name === name) n++; });
  return n;
}
function checkGeometry(root, maxMeshes) {
  root.updateMatrixWorld(true);
  let meshes = 0;
  root.traverse(o => {
    assert.ok(o.matrixWorld.elements.every(Number.isFinite));
    if (!o.isMesh) return;
    meshes++;
    for (const attribute of Object.values(o.geometry.attributes)) {
      assert.ok(attribute.array.every(Number.isFinite), `${o.name}: finite geometry`);
    }
  });
  assert.ok(meshes <= maxMeshes, `${root.name}: bounded draw count (${meshes})`);
}
for (const [x,z] of [[-30,-20],[30,-20],[30,20],[-30,20],[0,40],[40,0]]) {
  const facade = new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0),trackFacingYaw(x,z));
  const towardTrack = new THREE.Vector3(-x,0,-z).normalize();
  assert.ok(facade.dot(towardTrack) > 0.9999, 'window facade faces the track in every quadrant');
}
const goat = createGoat();
checkGeometry(goat,24);
assert.equal(count(goat,'goat-horn'),2);
assert.equal(count(goat,'goat-ear'),2);
assert.equal(count(goat,'goat-hoof'),8);
assert.equal(count(goat,'goat-beard'),1);
const goatBox = new THREE.Box3().setFromObject(goat);
assert.ok(Math.abs(goatBox.min.y) < 1e-6, 'goat hooves meet the ground');
assert.ok(goatBox.max.y > 1.4 && goatBox.max.y < 1.6, 'small farm-animal scale');
disposeRig(goat);
for (const scale of [0.9,1,2.2]) {
  const palm = createCoconutPalm(scale);
  checkGeometry(palm,5);
  assert.equal(count(palm,'coconut'),3);
  assert.equal(count(palm,'coconut-fronds'),1, 'feathered fronds use one mesh');
  const box = new THREE.Box3().setFromObject(palm);
  assert.ok(Math.abs(box.min.y) < 1e-6, 'trunk meets ground');
  assert.ok(box.max.y > 3.6*scale && box.max.y < 4.3*scale);
  disposeRig(palm);
}

// The world builds a few canvas textures. Stub only that drawing boundary and
// image loading; the actual Three.js scene, geometry and placement run normally.
const previousDocument = globalThis.document;
const bannerTexts = new Set();
let fontWidthFactor = 1;
const ctx = {
  createRadialGradient() { return { addColorStop() {} }; },
  measureText(text) {
    const size = Number(/([\d.]+)px/.exec(this.font)?.[1] || 100);
    return { width:text.length*size*0.65*fontWidthFactor,
      actualBoundingBoxAscent:size*0.8, actualBoundingBoxDescent:size*0.2 };
  },
  strokeText(text,x,y) {
    const m = this.measureText(text), outline = this.lineWidth / 2;
    assert.ok(x-m.width/2-outline >= 0 && x+m.width/2+outline <= this.canvas.width, 'banner text and stroke fit horizontally');
    assert.ok(y-m.actualBoundingBoxAscent-outline >= 0 && y+m.actualBoundingBoxDescent+outline <= this.canvas.height, 'banner text and stroke fit vertically');
    bannerTexts.add(text);
  },
  fillRect() {}, clearRect() {}, fillText() {},
  beginPath() {}, arc() {}, ellipse() {}, fill() {},
};
globalThis.document = {
  createElement() {
    const canvas = { width:0, height:0 };
    const context = { ...ctx, canvas };
    canvas.getContext = () => context;
    return canvas;
  },
  createElementNS() { return { addEventListener() {}, removeEventListener() {}, set src(value) {} }; },
  fonts: { ready: { then(redraw) {
    fontWidthFactor = 2; // Simulate a much wider font arriving after first draw.
    try { redraw(); } finally { fontWidthFactor = 1; }
  } } },
};
try {
  for (const raceType of ['mobu','lake']) {
    for (const trackScale of [0.55+10/60,2.6]) {
      const counts = [];
      for (const edition of ['classic','moon']) {
        const world = createWorld({ raceType,trackScale,edition });
        const scene = world.scene;
        scene.updateMatrixWorld(true);
        assert.equal(count(scene,'countryside-house'),6);
        scene.traverse(o => {
          if (o.name !== 'countryside-house') return;
          const direction = new THREE.Vector3(0,0,1).applyQuaternion(o.quaternion);
          const inward = new THREE.Vector3(-o.position.x,0,-o.position.z).normalize();
          assert.ok(direction.dot(inward)>0.9999, `${edition}: actual house faces track`);
        });
        if (edition === 'moon') {
          assert.equal(count(scene,'countryside-sheep'),0);
          assert.equal(count(scene,'countryside-pine'),0);
          assert.ok(count(scene,'countryside-goat')>=14);
          assert.ok(count(scene,'coconut-palm')>0);
          assert.equal(count(scene,'festival-lit-window'),12);
          counts.push([count(scene,'countryside-goat'),count(scene,'coconut-palm')]);
        } else {
          assert.equal(count(scene,'countryside-goat'),0);
          assert.equal(count(scene,'coconut-palm'),0);
          assert.ok(count(scene,'countryside-sheep')>=14);
          assert.ok(count(scene,'countryside-pine')>0);
          assert.equal(count(scene,'festival-lit-window'),0);
          counts.push([count(scene,'countryside-sheep'),count(scene,'countryside-pine')]);
        }
        world.animate(1.25);
        disposeRig(scene);
      }
      assert.deepEqual(counts[0],counts[1],'edition swaps preserve animal and tree counts');
    }
  }
} finally {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
}
assert.deepEqual([...bannerTexts].sort(), ['Mid-Autumn Race','Mobu Amazing Race']);
console.log('PASS: houses face track; Moon-only goats/palms; finish banner fits before/after font load (both editions, land/lake, short/long tracks)');
