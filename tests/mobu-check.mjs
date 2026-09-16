// Headless checks for the mobu rig — the MOBU.md §10 invariants, asserted
// (not eyeballed). Run: node tests/mobu-check.mjs
import assert from 'node:assert';
import * as THREE from '../public/vendor/three.module.js';
import { createMobu, disposeRig } from '../public/js/mobu.js';
import { separatorY } from '../public/js/mobu-mouth.js';
import { boxingPoint } from '../public/js/mobu-shorts.js';
import { radiusAt, sharedMat, ARM_LEN, LIP_Y, LIP_SCALE, LIP_UP_DY, LIP_UP_R, LIP_LOW_DY, LIP_LOW_R, LIP_END_R } from '../public/js/rig.js';
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
  assert.ok(lipW / headW >= 1.25 && lipW / headW <= 1.34, `reference lips/head width ratio 1.25–1.34 (got ${(lipW / headW).toFixed(2)})`);
  assert.ok(LIP_SCALE >= 0.9 && LIP_SCALE <= 0.95, 'whole-mouth reference scale remains a subtle reduction');
  assert.ok(lipBox.max.z > headBox.max.z, `grin protrudes past the head (${lipBox.max.z.toFixed(2)} vs ${headBox.max.z.toFixed(2)})`);
  assert.ok(torsoW > headW, `pear, not lollipop: torso ${torsoW.toFixed(2)} > head ${headW.toFixed(2)}`);
  console.log(`grin: width ${lipW.toFixed(2)} (${(lipW / headW).toFixed(2)}× head), tall ${(lipBox.max.y - lipBox.min.y).toFixed(2)}, protrudes z ${lipBox.max.z.toFixed(2)} — OK`);

  // A single watertight mouth, not intersecting closed tubes. Every edge is
  // used twice and every vertex belongs to the same connected component.
  const geometry = lips.geometry;
  const positions = geometry.attributes.position;
  const indices = geometry.index.array;
  const edges = new Map();
  const neighbors = Array.from({ length: positions.count }, () => []);
  for (let i = 0; i < indices.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = indices[i + j], b = indices[i + (j + 1) % 3];
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      const edge = edges.get(key) || { count: 0, winding: 0 };
      edge.count++;
      edge.winding += a < b ? 1 : -1;
      edges.set(key, edge);
      neighbors[a].push(b);
      neighbors[b].push(a);
    }
  }
  for (const edge of edges.values()) {
    assert.equal(edge.count, 2, 'mouth is closed, with no non-manifold edges');
    assert.equal(edge.winding, 0, 'adjacent mouth triangles agree on winding');
  }
  const seen = new Set([0]), queue = [0];
  for (let i = 0; i < queue.length; i++) {
    for (const next of neighbors[queue[i]]) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  assert.equal(seen.size, positions.count, 'lips form ONE joined surface');
  // At the front centre, two orange crests protrude beyond the shallow crease.
  let creaseZ = 0, crestZ = 0;
  const scaledCreaseY = LIP_Y + (separatorY(0) - LIP_Y) * LIP_SCALE;
  for (let i = 0; i < positions.count; i++) {
    if (Math.abs(positions.getX(i)) > 0.025) continue;
    const y = Math.abs(positions.getY(i) - scaledCreaseY), z = positions.getZ(i);
    if (y < 0.01) creaseZ = Math.max(creaseZ, z);
    if (y > 0.06 && y < 0.25) crestZ = Math.max(crestZ, z);
  }
  assert.ok(crestZ - creaseZ > 0.025 && crestZ - creaseZ < 0.12, 'smile crease is sculpted but shallow');
  assert.ok(lips.material.isMeshStandardMaterial && !lips.material.flatShading, 'smooth vinyl mouth');
  assert.notStrictEqual(sharedMat(0xffffff), sharedMat(0xffffff, { vertexColors: true }), 'vertex colour option is cached separately');
  assert.notStrictEqual(sharedMat(0xffffff), sharedMat(0xffffff, { roughness: 0.9 }), 'roughness option is cached separately');

  const upperHalf = LIP_UP_DY + LIP_UP_R;
  const lowerHalf = LIP_LOW_DY + LIP_LOW_R;
  assert.ok(Math.abs(upperHalf - lowerHalf) < 1e-9, 'outer envelope has equal upper/lower half-heights');
  assert.ok(upperHalf + 0.012 <= LIP_END_R, 'centre stays slimmer than corner bulbs, including full smile');
  const quarterRise = separatorY(0.5) - separatorY(0);
  const endRise = separatorY(1) - separatorY(0);
  assert.ok(Math.abs(quarterRise / endRise - 0.25) < 1e-9, 'separator follows the annotated quadratic curve');
  assert.ok(endRise > 0.55 && endRise < 0.61, 'separator reaches the annotated cheek height');

  // Smile is a real shape target (including normals), not a translation/scale.
  const target = geometry.morphAttributes.position[0];
  assert.equal(target.count, positions.count, 'smile preserves topology');
  assert.equal(geometry.morphAttributes.normal[0].count, positions.count);
  let change = 0;
  for (let i = 0; i < target.array.length; i++) {
    assert.ok(Number.isFinite(target.array[i]), 'finite smile target');
    change = Math.max(change, Math.abs(target.array[i] - positions.array[i]));
  }
  assert.ok(change > 0.08, 'smile visibly changes the sculpt');
  for (const [input, expected] of [[-1, 0], [0.5, 0.5], [2, 1], [NaN, 0]]) {
    mobu.setSmile(input);
    mobu.animate(0, 0);
    assert.equal(lips.morphTargetInfluences[0], expected, 'bounded smile amount');
    assert.equal(lips.scale.y, 1, 'never scale absolute-height mouth vertices');
  }
  mobu.setSmile(0);
  console.log('mouth: joined manifold, sculpted crease, smile morph + normals — OK');

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
      for (const foot of [rig.parts.legL, rig.parts.legR]) {
        assert.ok(boxOf(foot).min.y >= 0.049, `foot stays above dirt at t=${t} speed=${speed}`);
      }
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
    assert.ok(group.position.y >= 0.049, `celebrate keeps the rig above the ground at t=${t}`);
    assert.ok(lips.morphTargetInfluences[0] >= 0.9, 'winner smiles');
    assert.ok(rig.parts.happyEyes.visible && !rig.parts.eyes.visible, 'winner has happy eyes');
    assert.ok(Math.abs(rig.parts.armL.rotation.z) > Math.PI / 2, 'celebration raises arms');
  }
  mobu.animate(0, 1);
  assert.equal(lips.morphTargetInfluences[0], 0, 'celebration waits until racer stops');
  mobu.setCelebrating(false);
  mobu.animate(0, 0);
  assert.ok(rig.parts.eyes.visible && !rig.parts.happyEyes.visible, 'idle restores dot eyes');
  assert.equal(lips.morphTargetInfluences[0], 0, 'idle restores requested smile');
  console.log('celebrate pose: finite transforms, grounded, expressive, resets cleanly — OK');

  // 8. the egg profile is one smooth silhouette: no pinched neck
  let minWidth = Infinity;
  for (let y = 0.8; y <= 2.2; y += 0.05) minWidth = Math.min(minWidth, radiusAt(y));
  assert.ok(minWidth > 0.6, `no pinched neck between hips and head (min radius ${minWidth.toFixed(2)})`);

  // Both leg lofts join at exactly the same crotch seam, but NOT at the hems.
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI / 2 + Math.PI * i / 16;
    const left = boxingPoint(-1, a, 0), right = boxingPoint(1, a, 0);
    assert.ok(left.distanceTo(right) < 1e-6, 'boxing legs share a continuous crotch seam');
  }
  assert.ok(boxingPoint(1, Math.PI, 1).x - boxingPoint(-1, Math.PI, 1).x >= 0.039, 'boxing hems remain separated');

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
            if (o.userData.trouserLeg) {
              // Inner trouser seams must come INSIDE the old egg silhouette;
              // that is the deliberate split between two legs, not a box.
              assert.ok(dist - ref <= 0.52, 'boxing legs keep a fitted outer silhouette');
              assert.ok(Math.abs(v.x) < 1.12 && Math.abs(v.z) < 1.12, 'boxing legs stay inside hip envelope');
              if (v.y < 0.50) assert.ok(v.x * o.userData.trouserLeg > 0.008, 'each hem stays on its own side: two separate openings');
              continue;
            }
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

  // Skirts remain possible but are rare in BOTH branches of the seeded picker.
  let skirts = 0;
  const samples = 5000;
  for (let seed = 0; seed < samples; seed++) {
    if (costumeFromSeed(seed).pants[0] === 'skirt') skirts++;
  }
  assert.ok(skirts / samples > 0.015 && skirts / samples < 0.065, `skirts stay rare, not absent (${skirts}/${samples})`);
  console.log(`lower wear: ${((1 - skirts / samples) * 100).toFixed(1)}% pants/shorts, ${((skirts / samples) * 100).toFixed(1)}% skirts — OK`);

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
