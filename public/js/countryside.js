// Small, deterministic countryside props. Moon-edition replacements are
// opt-in at world construction; the daytime sheep and pines stay unchanged.
import * as THREE from '../vendor/three.module.js';

const mat = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...options });

// House windows are on local +Z. Point that facade at the oval's centre in
// every quadrant, rather than giving each cottage an arbitrary rotation.
export function trackFacingYaw(x, z) {
  return Math.atan2(-x, -z);
}

export function createGoat() {
  const group = new THREE.Group();
  group.name = 'countryside-goat';
  const coat = mat(0xd4bd94), face = mat(0x80634b), hoof = mat(0x453b35);
  const horn = mat(0xa3987e), ink = mat(0x211d19);
  const sphere = new THREE.SphereGeometry(1, 10, 8);
  function ellipsoid(name, material, position, scale) {
    const mesh = new THREE.Mesh(sphere, material);
    mesh.name = name; mesh.position.set(...position); mesh.scale.set(...scale);
    group.add(mesh);
    return mesh;
  }
  // Lean, smooth body and long legs distinguish the goat from a woolly sheep.
  ellipsoid('goat-body',coat,[0,0.64,0],[0.27,0.28,0.48]);
  const neck = ellipsoid('goat-neck',coat,[0,0.85,0.3],[0.13,0.29,0.15]);
  neck.rotation.x = 0.3;
  ellipsoid('goat-head',face,[0,1.04,0.48],[0.15,0.2,0.21]);
  ellipsoid('goat-muzzle',coat,[0,0.97,0.65],[0.12,0.1,0.13]);
  const legGeo = new THREE.CylinderGeometry(0.055,0.045,0.42,6);
  const hoofGeo = new THREE.BoxGeometry(0.037,0.08,0.115);
  for (const x of [-0.18,0.18]) {
    for (const z of [-0.29,0.29]) {
      const leg = new THREE.Mesh(legGeo,coat);
      leg.position.set(x,0.29,z); group.add(leg);
      // Two toes and a visible little cleft; soles sit exactly at ground level.
      for (const toe of [-1,1]) {
        const foot = new THREE.Mesh(hoofGeo,hoof);
        foot.name = 'goat-hoof';
        foot.position.set(x+toe*0.023,0.04,z+0.015); group.add(foot);
      }
    }
  }
  const hornGeo = new THREE.CylinderGeometry(0.012,0.052,0.35,6,5);
  hornGeo.translate(0,0.175,0);
  const vertices = hornGeo.attributes.position;
  for (let i=0;i<vertices.count;i++) {
    const t = vertices.getY(i)/0.35;
    vertices.setZ(i,vertices.getZ(i)-0.23*t*t);
  }
  hornGeo.computeVertexNormals();
  for (const side of [-1,1]) {
    const h = new THREE.Mesh(hornGeo,horn);
    h.name = 'goat-horn'; h.position.set(side*0.095,1.16,0.44);
    h.rotation.z = -side*0.17; group.add(h);
    const ear = ellipsoid('goat-ear',coat,[side*0.23,1.075,0.43],[0.16,0.045,0.07]);
    ear.rotation.z = -side*0.3;
    ellipsoid('goat-eye',ink,[side*0.125,1.085,0.59],[0.022,0.027,0.02]);
  }
  const beard = new THREE.Mesh(new THREE.ConeGeometry(0.065,0.22,6),face);
  beard.name = 'goat-beard'; beard.rotation.z = Math.PI;
  beard.position.set(0,0.77,0.64); group.add(beard);
  const tail = ellipsoid('goat-tail',coat,[0,0.86,-0.46],[0.06,0.17,0.065]);
  tail.rotation.x = -0.5;
  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return group;
}

export function createCoconutPalm(scale = 1) {
  const group = new THREE.Group();
  group.name = 'coconut-palm';
  group.scale.setScalar(scale);
  const height = 3.6, lean = 0.46;
  // A gently bent, tapering trunk with raised growth rings in one mesh.
  const profile = [];
  for (let i=0;i<=16;i++) {
    const t=i/16, radius=0.18-0.085*t;
    profile.push(new THREE.Vector2(radius+0.014,height*t));
    if (i<16) profile.push(new THREE.Vector2(radius,height*t+0.045));
  }
  const trunkGeo = new THREE.LatheGeometry(profile,8);
  const pos=trunkGeo.attributes.position;
  for (let i=0;i<pos.count;i++) {
    const t=pos.getY(i)/height;
    pos.setX(i,pos.getX(i)+lean*t*t);
  }
  trunkGeo.computeVertexNormals();
  const trunk = new THREE.Mesh(trunkGeo,mat(0x9b805b));
  trunk.name='coconut-trunk'; group.add(trunk);

  // Eight arching, feathered fronds. All ribs and leaflets share ONE mesh,
  // avoiding dozens of additional draw calls per tree around the valley.
  const positions=[], colors=[];
  const green=new THREE.Color(0x408c3b), lightGreen=new THREE.Color(0x69a84a);
  function triangle(a,b,c,color) {
    for (const p of [a,b,c]) {
      positions.push(p.x,p.y,p.z); colors.push(color.r,color.g,color.b);
    }
  }
  for (let f=0;f<8;f++) {
    const angle=f*Math.PI/4+0.16, length=1.85+(f%3)*0.15;
    const radial=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
    const side=new THREE.Vector3(-radial.z,0,radial.x);
    const point=(t) => new THREE.Vector3(lean,height+0.62*Math.sin(t*Math.PI)-0.75*t*t,0)
      .addScaledVector(radial,length*t);
    for (let j=0;j<12;j++) {
      const a=point(j/12), b=point((j+1)/12);
      const aL=a.clone().addScaledVector(side,0.025), aR=a.clone().addScaledVector(side,-0.025);
      const bL=b.clone().addScaledVector(side,0.012), bR=b.clone().addScaledVector(side,-0.012);
      triangle(aL,aR,bL,lightGreen); triangle(aR,bR,bL,lightGreen);
    }
    for (let j=1;j<12;j++) {
      const t=j/12, width=0.46*Math.sin(t*Math.PI)**0.7;
      for (const direction of [-1,1]) {
        const base=point(t-0.035), end=point(t+0.035);
        const tip=point(Math.min(1,t+0.12)).addScaledVector(side,direction*width);
        tip.y-=0.16;
        const ridge=base.clone().lerp(tip,0.48); ridge.y+=0.04;
        triangle(base,ridge,tip,lightGreen);
        triangle(ridge,end,tip,green);
        triangle(base,end,ridge,green);
      }
    }
  }
  const leafGeo=new THREE.BufferGeometry();
  leafGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  leafGeo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  leafGeo.computeVertexNormals();
  const fronds=new THREE.Mesh(leafGeo,mat(0xffffff,{ vertexColors:true, side:THREE.DoubleSide }));
  fronds.name='coconut-fronds'; group.add(fronds);
  const nutGeo=new THREE.SphereGeometry(0.16,8,6), nutMat=mat(0x8c9c3d);
  for (let i=0;i<3;i++) {
    const angle=i*Math.PI*2/3;
    const nut=new THREE.Mesh(nutGeo,nutMat);
    nut.name='coconut'; nut.scale.y=1.18;
    nut.position.set(lean+Math.cos(angle)*0.17,height-0.13,Math.sin(angle)*0.17);
    group.add(nut);
  }
  group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return group;
}
