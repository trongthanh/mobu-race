// Moon-edition scenery; deliberately absent from the ordinary daytime world.
import * as THREE from '../vendor/three.module.js';
import { createLantern } from './lanterns.js';

export function addMoonSky(scene, radius) {
  // A camera-facing, cratered full moon, with a soft silver halo. Canvas is
  // generated locally, so the festival has no external image dependency.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const glow = ctx.createRadialGradient(128,128,65,128,128,128);
  glow.addColorStop(0,'rgba(212,227,255,0.25)');
  glow.addColorStop(1,'rgba(212,227,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(0,0,256,256);
  const disc = ctx.createRadialGradient(109,105,3,128,128,71);
  disc.addColorStop(0,'#ffffec'); disc.addColorStop(1,'#d9e5f7');
  ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(128,128,70,0,Math.PI*2); ctx.fill();
  for (const [x,y,r] of [[100,108,17],[118,85,10],[151,113,21],[145,150,12],[106,156,9],[168,142,7]]) {
    ctx.fillStyle = 'rgba(135,158,185,0.17)';
    ctx.beginPath(); ctx.ellipse(x,y,r,r*0.8,0.4,0,Math.PI*2); ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, fog: false, depthWrite: false, toneMapped: false }));
  moon.name = 'festival-full-moon';
  moon.position.set(-radius * 0.35, radius * 0.32, -radius * 0.65);
  moon.scale.setScalar(radius * 0.25);
  scene.add(moon);

  // One mesh for the starfield rather than hundreds of separate objects.
  const pos = [];
  for (let i = 0; i < 180; i++) {
    const angle = i * 2.3999632297;
    const y = 0.16 + ((i * 73) % 179) / 179 * 0.79;
    const r = Math.sqrt(1-y*y);
    const p = new THREE.Vector3(Math.cos(angle)*r,y,Math.sin(angle)*r).multiplyScalar(radius*0.92);
    const s = radius * (i % 5 === 0 ? 0.0011 : 0.0006);
    pos.push(p.x-s,p.y-s,p.z, p.x+s,p.y-s,p.z, p.x,p.y+s,p.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  const stars = new THREE.Mesh(geo,new THREE.MeshBasicMaterial({ color: 0xc7d9ff, side: THREE.DoubleSide, fog:false }));
  stars.name = 'festival-stars';
  scene.add(stars);
}

export function addFestivalLights(group, { lanePoint, groundHeight, outerZ }) {
  const lanterns = [];
  const wood = new THREE.MeshStandardMaterial({ color: 0x75433e, roughness: 0.9 });
  const thread = new THREE.MeshBasicMaterial({ color: 0xb68d64 });
  function cable(points) {
    const curve = new THREE.CatmullRomCurve3(points);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve,24,0.022,4,false),thread));
  }
  function pole(x,z,h) {
    const y = groundHeight(x,z);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.075,0.11,h,6),wood);
    mesh.position.set(x,y+h/2,z); group.add(mesh);
    return new THREE.Vector3(x,y+h,z);
  }
  function hang(p, seed, scale = 0.85) {
    const pivot = new THREE.Group();
    pivot.position.copy(p);
    // Alternate traditional five-pointed stars with the playful silhouettes.
    const model = createLantern(seed, seed % 3 === 0 ? undefined : 'star');
    model.scale.setScalar(scale);
    model.position.y = -1.06*scale;
    pivot.add(model); group.add(pivot);
    lanterns.push(pivot);
  }
  // A continuous garland outside the racing band, safely above the audience.
  const count = 24;
  const anchors = Array.from({length:count},(_,i) => {
    const p = lanePoint(i/count,7.6);
    return pole(p.x,p.z,4.7);
  });
  for (let i=0;i<count;i++) {
    const a = anchors[i], b = anchors[(i+1)%count];
    const mid = a.clone().lerp(b,0.5); mid.y -= 0.45;
    cable([a,mid,b]); hang(mid,i*827+41);
  }
  // A dedicated canopy behind all three spectator benches.
  for (const z of [outerZ+2.2,outerZ+9]) {
    const a = pole(-10,z,5.3), b = pole(10,z,5.3);
    const mid = a.clone().lerp(b,0.5); mid.y -= 0.5;
    cable([a,mid,b]);
    for (let i=1;i<8;i++) {
      const p = a.clone().lerp(b,i/8); p.y -= Math.sin(i/8*Math.PI)*0.5;
      hang(p,i*991+Math.round(z),0.7);
    }
  }
  // Fixed budget of warm pools: no shadow maps or point lights per lantern/racer.
  for (const progress of [0,0.25,0.5,0.75]) {
    const p = lanePoint(progress,5.8);
    const light = new THREE.PointLight(0xffb65b,22,16,2);
    light.position.set(p.x,3.1,p.z); group.add(light);
  }
  const audienceLight = new THREE.PointLight(0xffc477,30,20,2);
  audienceLight.position.set(0,4,outerZ+5); group.add(audienceLight);
  return (t) => lanterns.forEach((p,i) => { p.rotation.z = Math.sin(t*0.8+i*1.7)*0.065; });
}
