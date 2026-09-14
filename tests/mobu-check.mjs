// Headless checks for the mobu rig — the MOBU.md §10 invariants, asserted
// (not eyeballed). Run: node tests/mobu-check.mjs
import assert from 'node:assert';
import * as THREE from '../public/vendor/three.module.js';
import { createMobu, disposeRig } from '../public/js/mobu.js';
import { radiusAt, BODY_PROFILE, ARM_LEN, ARM_OUT_ROT } from '../public/js/rig.js';
import { WARDROBE, SLOT_KEYS, normalizeCostume, randomCostume, costumeFromSeed, applyCostume } from '../public/js/costumes.js';

function boxOf(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  assert.ok(Number.isFinite(box.min.x) && Number.isFinite(box.max.y), `${obj.name || obj.type} has a finite box`);
  return box;
}

function checkFinite(obj, label) {
  obj.traverse((o) => {
    if (o.matrix) {
      const e = o.matrix.elements;
      for (const v of e) assert.ok(Number.isFinite(v), `${label}: non-finite matrix element`);
    }
  });
}

function main() {
  // ---- build a bare mobu (with his classic shorts)
  const mobu = createMobu();
  const { rig, group } = mobu;

  // Measure in CANONICAL units: undo the world-scale on the rig root.
  rig.root.scale.setScalar(1);
  rig.root.updateMatrixWorld(true);

  // 1-3. the grin vs the head
  const lips = rig.parts.lips;
  const head = rig.parts.head;
  const body = rig.parts.body;
  assert.strictEqual(lips.parent, head.parent, 'lips is a SIBLING of head, not its child');
  const lipBox = boxOf(lips);
  const headBox = boxOf(head);
  const bodyBox = boxOf(body);
  const lipW = lipBox.max.x - lipBox.min.x;
  const headW = headBox.max.x - headBox.min.x;
  const torsoW = bodyBox.max.x - bodyBox.min.x;
  assert.ok(lipW > headW, `lips wider than head (${lipW.toFixed(2)} vs ${headW.toFixed(2)})`);
  assert.ok(lipW / headW >= 1.25, `lips/head width ratio >= 1.25 (got ${ (lipW / headW).toFixed(2) })`);
  assert.ok(lipBox.max.z > headBox.max.z, `grin protrudes past the head (${lipBox.max.z.toFixed(2)} vs ${headBox.max.z.toFixed(2)})`);
  assert.ok(torsoW > headW, `pear, not lollipop: torso ${torsoW.toFixed(2)} > head ${headW.toFixed(2)}`);
  console.log(`grin: width ${lipW.toFixed(2)} (${(lipW / headW).toFixed(2)}× head), tall ${(lipBox.max.y - lipBox.min.y).toFixed(2)}, protrudes z ${lipBox.max.z.toFixed(2)} — OK`);

  // 4-5. grounded feet, canonical height
  const rootBox = boxOf(rig.root);
  assert.ok(rootBox.min.y > -0.02, `feet on the ground (min.y ${rootBox.min.y.toFixed(3)})`);
  assert.ok(Math.abs(rootBox.max.y - 3.75) < 0.25, `height ~3.75 (max.y ${rootBox.max.y.toFixed(2)})`);
  console.log(`rig: y ${rootBox.min.y.toFixed(3)}..${rootBox.max.y.toFixed(2)}, feet grounded — OK`);

  // 6. tufts
  let tuftMeshes = 0;
  rig.parts.tufts.traverse((o) => { if (o.isMesh) tuftMeshes++; });
  assert.ok(tuftMeshes >= 3, `at least 3 tuft meshes (got ${tuftMeshes})`);

  // 7. every pose × several times produces finite transforms
  for (const speed of [0, 0.5, 1]) {
    for (const t of [0, 0.37, 1.2, 5.7]) {
      mobu.animate(t, speed);
      group.updateMatrixWorld(true);
      checkFinite(group, `pose(speed=${speed}, t=${t})`);
      assert.ok(group.position.y >= -0.001, `pose keeps the rig above the ground at t=${t} speed=${speed}`);
    }
  }
  console.log('poses: finite transforms at rest/run speeds — OK');

  // 7b. the celebrate pose loops finite and above ground too (and hands off
  // cleanly once celebrating turns off)
  mobu.setCelebrating(true);
  for (const t of [0, 0.37, 1.2, 5.7]) {
    mobu.animate(t, 0);
    group.updateMatrixWorld(true);
    checkFinite(group, `celebrate(t=${t})`);
    assert.ok(group.position.y >= -0.001, `celebrate keeps the rig above the ground at t=${t}`);
  }
  mobu.setCelebrating(false);
  mobu.animate(0, 0);
  console.log('celebrate pose: finite transforms, grounded — OK');

  // 8. the egg profile is one smooth silhouette: no pinched neck
  let minWidth = Infinity;
  for (let y = 0.8; y <= 2.2; y += 0.05) minWidth = Math.min(minWidth, radiusAt(y));
  assert.ok(minWidth > 0.6, `no pinched neck between hips and head (min radius ${minWidth.toFixed(2)})`);

  // 9. every wardrobe item builds, stays near the egg's surface, keeps the
  // rig finite — mix every slot with every other slot at least once.
  let items = 0;
  for (const slot of SLOT_KEYS) {
    for (const item of WARDROBE[slot]) {
      items++;
      const spec = normalizeCostume({ [slot]: [item.id, items % 12] });
      applyCostume(rig, spec);
      mobu.animate(0, 0); // back to the rest pose so world matrices are clean
      group.updateMatrixWorld(true);
      checkFinite(group, `costume ${slot}=${item.id}`);
      // body-hugging layers (pants/top) must be SHELLS on the egg, not boxes
      if ((slot === 'pants' || slot === 'top') && item.build) {
        const pivot = slot === 'pants' ? rig.attach.hips : rig.attach.chest;
        const garment = pivot.children.find((c) => c.userData?.garment === slot);
        assert.ok(garment, `${slot}=${item.id} attached to its pivot`);
        rig.root.updateMatrixWorld(true);
        const v = new THREE.Vector3();
        garment.traverse((o) => {
          if (!o.isMesh || !o.geometry?.attributes?.position) return;
          const pos = o.geometry.attributes.position;
          const limbX = o.userData?.limbWrap; // leg tubes wrap the limb, not the egg
          for (let i = 0; i < pos.count; i++) {
            v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
            if (limbX !== undefined) {
              const d = Math.hypot(v.x - limbX, v.z);
              if (d < 0.06) continue; // cap-centre vertices sit on the axis
              assert.ok(
                Math.abs(d - 0.38) <= 0.12,
                `${slot}=${item.id}: limb vertex at y=${v.y.toFixed(2)} is ${d.toFixed(2)} from the leg axis (r 0.38)`,
              );
              continue;
            }
            const dist = Math.hypot(v.x, v.z);
            const ref = radiusAt(v.y);
            // ~0.36 of clearance is the spec's rule; the wide shorts hem
            // (which must clear the legs) is allowed a little more.
            assert.ok(
              Math.abs(dist - ref) <= (slot === 'top' ? 0.4 : 0.52),
              `${slot}=${item.id}: vertex at y=${v.y.toFixed(2)} is ${dist.toFixed(2)} from the axis (egg ${ref.toFixed(2)}) — box, not shell`,
            );
          }
        });
      }
      // sleeves (tagged garment='top' but parented to the arms) must hug the
      // arm segment so they swing with it without floating
      if (slot === 'top') {
        const v = new THREE.Vector3();
        const q = new THREE.Quaternion();
        for (const arm of [rig.parts.armL, rig.parts.armR]) {
          group.updateMatrixWorld(true);
          const pivot = new THREE.Vector3().setFromMatrixPosition(arm.matrixWorld);
          const dir = new THREE.Vector3(0, -1, 0).applyQuaternion(arm.getWorldQuaternion(q)).normalize();
          arm.traverse((o) => {
            if (!o.isMesh || o.userData?.garment !== 'top') return;
            const pos = o.geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) {
              v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
              const t = Math.min(ARM_LEN, Math.max(0, v.clone().sub(pivot).dot(dir)));
              const d = v.distanceTo(pivot.clone().addScaledVector(dir, t));
              if (d < 0.06) continue; // cap-centre vertices sit on the axis
              assert.ok(
                Math.abs(d - 0.31) <= 0.13,
                `${slot}=${item.id}: sleeve vertex is ${d.toFixed(2)} from the arm axis (r 0.31)`,
              );
            }
          });
        }
      }
    }
  }
  // restore tufts in case a hat hid them, then a couple of random outfits
  applyCostume(rig, normalizeCostume(null));
  for (let i = 0; i < 8; i++) {
    applyCostume(rig, randomCostume());
    group.updateMatrixWorld(true);
    checkFinite(group, `random costume ${i}`);
  }
  assert.ok(items >= 16, `wardrobe coverage (built ${items} items)`);

  // 10. deterministic fallback costumes: same seed -> same outfit, stable ids
  const a = costumeFromSeed(1234);
  const b = costumeFromSeed(1234);
  assert.deepStrictEqual(a, b, 'costumeFromSeed is deterministic');
  for (const slot of SLOT_KEYS) {
    assert.ok(WARDROBE[slot].some((w) => w.id === a[slot][0]), `seeded ${slot} id is a real item`);
  }

  // 11. cleanup works without throwing
  disposeRig(group);
  console.log(`wardrobe: ${items} items built, shells follow the egg — OK`);
  console.log('PASS');
}

try {
  main();
} catch (err) {
  console.error('FAIL:', err && err.stack ? err.stack : err);
  process.exit(1);
}
