// Buoyant duck rig: body and clothes move together, feet paddle under water.
import * as THREE from '../vendor/three.module.js';
import { dressDuck } from './duck-costumes.js';
import { waterAt } from './surface.js';

const BODY_COLORS = [0xffdf63, 0xffedc0, 0xffffff, 0xb4dce9, 0xf5bac9, 0xb7dba3];
// Keep the duck silhouette comfortably inside its 1.1m lane and leave a
// little breathing room between the close front-row starting slots.
export const DUCK_SCALE = 0.76;
const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.68 });
export function createDuck({ seed = 1 } = {}) {
  const group = new THREE.Group();
  const swimmer = new THREE.Group();
  swimmer.rotation.order = 'YXZ';
  group.add(swimmer);
  const bodyMat = mat(BODY_COLORS[(seed >>> 8) % BODY_COLORS.length]);
  const orange = mat(0xf5973a), ink = mat(0x263446);
  function sphere(material, x, y, z, sx, sy, sz) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), material);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz); swimmer.add(m); return m;
  }
  sphere(bodyMat, 0, 0.64, 0, 0.756, 0.5184, 0.9);
  sphere(bodyMat, 0, 1.04, 0.48, 0.4324, 0.517, 0.423);
  sphere(orange, 0, 1.03, 0.91, 0.285, 0.085, 0.25);
  for (const side of [-1, 1]) {
    sphere(ink, side * 0.16, 1.25, 0.845, 0.055, 0.065, 0.035);
    sphere(mat(0xffffff), side * 0.16 - 0.012, 1.27, 0.876, 0.014, 0.017, 0.009);
  }
  const wings = [];
  for (const side of [-1, 1]) {
    const wing = sphere(bodyMat, side * 0.73, 0.76, -0.04, 0.18, 0.17, 0.44);
    wing.rotation.z = side * 0.18;
    wings.push(wing);
  }
  const tail = sphere(bodyMat, 0, 0.76, -0.85, 0.27, 0.19, 0.35);
  tail.rotation.x = -0.35;
  const feet = [];
  for (const side of [-1, 1]) {
    const foot = sphere(orange, side * 0.36, 0.18, -0.28, 0.20, 0.045, 0.30);
    feet.push(foot);
  }
  const wardrobe = dressDuck(swimmer, seed);
  group.userData.duckCostume = wardrobe.spec;
  // Scale the complete rig together so the body, costume, feet, and label
  // preserve their proportions while the start grid reads less crowded.
  group.scale.setScalar(DUCK_SCALE);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  let heading = 0, celebrating = false;
  const phase = (seed >>> 0) / 4294967296 * Math.PI * 2;
  function animate(t, speed = 0, motion = {}) {
    const effort = Math.min(1, Math.max(0, speed));
    const wave = waterAt(group.position.x, group.position.z, t);
    const stroke = (motion.distance ?? t * effort * 3) * 4 + phase;
    const forwardSlope = wave.dx * Math.sin(heading) + wave.dz * Math.cos(heading);
    const sideSlope = wave.dx * Math.cos(heading) - wave.dz * Math.sin(heading);
    group.rotation.y = heading;
    // Displacement puts the belly under the sampled waterline, not on top.
    group.position.y = wave.height - 0.32;
    swimmer.position.y = Math.sin(stroke * 2) * effort * 0.009;
    swimmer.rotation.x = -forwardSlope + effort * 0.025 + Math.max(-0.04, Math.min(0.04, (motion.acceleration || 0) * 0.006));
    swimmer.rotation.z = sideSlope + Math.sin(stroke) * effort * 0.025 - (motion.turn || 0) * 0.3;
    swimmer.rotation.y = Math.sin(stroke) * effort * 0.018;
    for (let i = 0; i < feet.length; i++) {
      const kick = Math.sin(stroke + i * Math.PI);
      feet[i].position.z = -0.28 + kick * effort * 0.23;
      feet[i].rotation.x = kick * effort * 0.6;
      // Recovery folds the webbed foot; the power stroke opens it.
      feet[i].scale.x = 0.20 * (1 - Math.max(0, kick) * effort * 0.55);
    }
    const victory = celebrating && effort <= 0.02;
    for (let i = 0; i < wings.length; i++) {
      wings[i].rotation.z = (i ? 1 : -1) * (0.18 + (victory ? 0.7 + Math.sin(t * 9) * 0.5 : 0));
    }
    if (victory) swimmer.position.y += Math.abs(Math.sin(t * 4)) * 0.035;
    wardrobe.animate(t, effort);
  }
  return { group, animate, setHeading: (h) => { heading = h; }, setCelebrating: (on) => { celebrating = !!on; } };
}
