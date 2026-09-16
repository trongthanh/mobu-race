// Shared surface sampling: water geometry, buoyancy and wake heights use the
// same waves and clock. Cosmetic motion never changes authoritative progress.
import * as THREE from '../vendor/three.module.js';

export function waterAt(x, z, t) {
  const a = x * 0.62 + z * 0.28 - t * 1.65;
  const b = x * -0.34 + z * 0.81 - t * 1.2;
  const c = x * 1.7 + z * 1.1 - t * 2.4;
  return {
    height: 0.16 + 0.025 * Math.sin(a) + 0.016 * Math.sin(b) + 0.006 * Math.sin(c),
    dx: 0.0155 * Math.cos(a) - 0.00544 * Math.cos(b) + 0.0102 * Math.cos(c),
    dz: 0.007 * Math.cos(a) + 0.01296 * Math.cos(b) + 0.0066 * Math.cos(c),
  };
}

export function createLakeGeometry(a, b) {
  const positions = [], indices = [];
  const rings = 40, segments = 128;
  for (let r = 0; r <= rings; r++) {
    for (let j = 0; j <= segments; j++) {
      const angle = j / segments * Math.PI * 2;
      // Local XY, rotated onto world XZ by the course mesh.
      positions.push(a * r / rings * Math.sin(angle), b * r / rings * Math.cos(angle), 0);
      if (r && j) {
        const k = r * (segments + 1) + j;
        indices.push(k, k - 1, k - segments - 1, k - 1, k - segments - 2, k - segments - 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // The animated surface remains in this conservative bound.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.max(a, b) + 1);
  return geometry;
}

// Fixed-size, world-space effect pool. Trails stay where they were shed, rather
// than rotating with a duck or dragging a dust cloud around a corner.
export function createSurfaceTrail(scene, lake, seed) {
  const count = lake ? 18 : 14;
  const geometry = lake
    ? new THREE.RingGeometry(0.92, 1, 20, 1, Math.PI * 0.08, Math.PI * 0.84)
    : new THREE.IcosahedronGeometry(1, 0);
  const particles = Array.from({ length: count }, () => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: lake ? 0xd7f6ed : 0xc7a477, transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide,
    }));
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, born: -Infinity, speed: 0, side: 1 };
  });
  let cursor = 0, lastEmit = -Infinity, lastTime = null;
  function update(t, position, heading, speed, phase = 0) {
    if (lastTime !== null && (t < lastTime || t - lastTime > 0.5)) {
      for (const p of particles) p.born = -Infinity;
      lastEmit = t;
    }
    lastTime = t;
    const interval = lake ? 0.105 : 0.14;
    if (speed > 0.2 && t - lastEmit >= interval) {
      const p = particles[cursor++ % count];
      p.born = t; p.speed = Math.min(speed, 14);
      p.side = Math.sin(phase) >= 0 ? 1 : -1;
      const behind = lake ? 0.65 : 0.12;
      p.mesh.position.set(position.x - Math.sin(heading) * behind + Math.cos(heading) * p.side * (lake ? 0 : 0.22),
        lake ? waterAt(position.x, position.z, t).height + 0.012 : 0.08,
        position.z - Math.cos(heading) * behind - Math.sin(heading) * p.side * (lake ? 0 : 0.22));
      p.mesh.rotation.set(lake ? -Math.PI / 2 : 0, 0, lake ? -heading : seed + cursor);
      lastEmit = t;
    }
    for (const p of particles) {
      const age = t - p.born, life = lake ? 1.8 : 0.7;
      p.mesh.visible = age >= 0 && age < life;
      if (!p.mesh.visible) continue;
      const k = age / life;
      if (lake) {
        p.mesh.position.y = waterAt(p.mesh.position.x, p.mesh.position.z, t).height + 0.014;
        p.mesh.scale.set(0.65 + age * 0.65, 0.5 + age * (0.7 + p.speed * 0.07), 1);
      } else {
        p.mesh.position.y = 0.08 + age * 0.38;
        p.mesh.scale.setScalar(0.045 + k * 0.2);
      }
      p.mesh.material.opacity = (lake ? 0.3 : 0.22) * (1 - k) ** 2 * Math.min(1, p.speed / 2);
    }
  }
  function dispose() {
    geometry.dispose();
    for (const p of particles) { scene.remove(p.mesh); p.mesh.material.dispose(); }
  }
  return { update, dispose };
}
