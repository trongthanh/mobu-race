# MOBU.md — how to build mobu

A complete, self-contained specification of the mobu character mesh: every measurement, the two
non-obvious algorithms, the invariants that make him recognisable, and the defects that have shipped
more than once so you do not ship them again.

It depends on **three.js and nothing else** — no asset files, no textures, no fonts, no glTF. Every
surface is generated. The code blocks below are complete and standalone; they do not import anything
from this repo. In this repo the canonical implementation lives in `public/js/rig.js` (measurements),
`public/js/mobu.js` (meshes and poses) and `public/js/costumes.js` (wardrobe), with
`tests/mobu-check.mjs` asserting §10 headlessly.

---

## 1. Who he is — the read

**Mobu is not a duck and he has no bill.** He is a round amber egg with **enormous lips**. Nothing
about him is read more often, or from further away, than his grin, and the grin is the one thing this
character has repeatedly shipped wrong.

- **One egg**, no neck: a body wider than his head, the two joined by a soft shoulder.
- **A grin made of TWO SAUSAGES joined at the corners** — a thin upper lip arcing over a fuller
  lower one, each a round tube, meeting at each end in a single **round, thick bulb**.
  *Khóe môi phải tròn và dày như 2 thanh xúc xích nối với nhau.*
- Two `ink` dot **eyes** above the grin with a clear amber gap.
- **Three `ink` tufts** on the crown, leaning **back** and slightly splayed.
- **Stubby arms**, blobs rather than sticks, resting outward and slightly **down**. No hands.
- **Two short thick legs**, close together.
- **Orange shorts** with white rounded blobs, each with an orange tick inside.

He is "he" — use he/him.

Reference images (in `ville/ref/`): `mobu-front.png`, `mobu-front34.png`, `mobu-rear34.png`,
`mobu-rear.png`, `mobu-high34.png` are authoritative for SHAPE; `mobu2d.png` for COLOUR and for the
grin's proportions (it is flat-coloured, so the mass can be isolated as a connected component and
measured exactly instead of by eye); `mobu-product.jpg` is the square-on product shot.
**Copy that folder along with this file** — every number below is derived from those six images, and
without them the next person has nothing to re-measure against and will fall back to eyeballing it,
which is how each entry in §11 happened.

> **Porting it:** §3, §4 and §5 are the whole load-bearing part and their code blocks are complete —
> paste them into a module, supply three materials, and you have the body and the grin. §6–§9 are
> straightforward once those exist. Read §10 and §11 before you change any of it.

## 2. Conventions

| | |
|---|---|
| **Up** | +Y. Feet at **y = 0** — he stands ON the ground plane, never through it. |
| **Facing** | **+Z** at `rotation.y = 0`. His lips point +Z. |
| **Height** | **3.75** world units to the tip of the tufts. Scale the whole rig, never the parts. |
| **Shading** | Flat — `flatShading: true`, untextured. Colour comes from the material and the light. |
| **Black** | Never `#000000`, not even for the eyes. The darkest value is `ink` = `#231F20`. |
| **Sides** | `armL`/`legL` are at **−X**, `armR`/`legR` at **+X**. `handR` is the working hand. |

Materials should be **memoised** — one `MeshLambertMaterial` per colour for the whole cast, not one
per mesh. A village of 24 mobus is otherwise 24× the material count for no visual difference. Flag
cached materials `userData.shared`, and have `disposeRig()` skip them when a rig is torn down (it
disposes geometries and unshared materials only).

**World scale.** The canonical rig is 3.75 tall; the track world is built around ~1.9-unit
characters (lane width 1.1). So the assembled rig is scaled as ONE unit — `MOBU_SCALE = 0.5` on an
inner root — inside an outer group that carries the heading (yaw), the run hop and the name
sprite; lean/bob go on `upper`, and the whole rig is lifted by the ground offset (0.05, the dirt
height at `lanePoint`).

## 3. The measurements

Every number is in world units with feet at y=0. These are the inputs; §4 and §5 derive the surfaces.

```js
const MOBU_HEIGHT = 3.75;   // including tufts

// ---- the egg
const CROWN_Y     = 3.46;   // top of the skull; the tufts stand above it
const BODY_BOTTOM = 0.23;   // the foot hollow, where the egg closes between the legs
const BODY_C      = 1.18;   // body ellipsoid centre…
const BODY_DOWN   = 0.95;   // …semi-height below it (closes at 0.23)
const BODY_UP     = 1.38;   // …and above it (closes at 2.56, INSIDE the head sphere)
const BLEND       = 0.30;   // smooth-max blend width — how soft the shoulder is
const WAIST_Y     = 2.03;   // where the body mesh hands over to the head mesh
const HEAD_Y      = 2.59;   // head sphere centre
const HEAD_R      = 0.87;   // …and radius
const HIP_R       = 1.02;   // the widest turn — WIDER THAN THE HEAD
const CHEST_Y     = 1.55;
const CHEST_R     = 1.00;

// ---- limbs
const LEG_LEN     = 0.44;
const LEG_X       = 0.50;
const LEG_R       = 0.38;
const SHOULDER_Y  = 1.86;
const SHOULDER_X  = 0.76;
const ARM_LEN     = 0.52;
const ARM_R       = 0.31;
const ARM_OUT_ROT = 1.25;   // rad from straight down: arms rest out and ~18° BELOW horizontal

// ---- the grin (see §5 for what each one does)
const LIP_Y       = 2.21;   // the crease line's height at the centre
const LIP_R       = HEAD_R * 1.10;   // 0.957 — the collar ring the tubes' centre lines run on
const LIP_THETA   = 1.15;   // ±66°: half-angle of the sweep
const LIP_UP_DY   = 0.126;  // upper tube: offset from the crease…
const LIP_UP_R    = 0.21;   // …and radius
const LIP_LOW_DY  = 0.175;  // lower tube: the fuller half, 1.4x the upper
const LIP_LOW_R   = 0.29;
const LIP_END_R   = 0.31;   // the shared corner-bulb radius BOTH tubes run to
const LIP_CURL    = 0.45;   // how far the corners ride up
const LIP_FUSE    = 0.70;   // how far the two tubes converge into one bulb at the corner

const LIP_FLOOR = LIP_Y - LIP_LOW_DY - LIP_LOW_R;   // 1.745 — lowest point; a top's edge may rise
                                                     // past it only where the lip's front bulk
                                                     // hides it (see §9)
const LIP_CEIL  = LIP_Y + LIP_CURL + LIP_END_R;     // 2.97 — highest, and it is at the CORNERS

// ---- face
const EYE_Y = 2.95;  const EYE_X = 0.25;  const EYE_Z = 0.72;
const TUFT_Y = 3.32;          // tuft pivot (the crown) — sway rotates HERE
const TUFT_LEAN = -0.42;      // rad about X: they lean BACK, not sideways
```

Three of these are **relationships, not free parameters**, and breaking them breaks the character:

- `HIP_R > HEAD_R` — he is a pear, not a lollipop.
- `LIP_UP_DY ≈ 0.60 × LIP_UP_R`, and the same for the lower tube. This ratio *is* the crease; see §5.
- `LIP_R = HEAD_R × 1.10` — the grin rides ON the head, overlapping the skull by about half a tube
  radius, which is what makes the corners die INTO his cheeks instead of floating off them.

## 4. The body — one generated egg

The body is **one profile of revolution**, lathed once and cut in two at `WAIST_Y`. Do not stack
ellipsoids: intersecting solids meet in hard circles that flat shading turns into bright seam rings,
visible from every angle except the front. A lathe cannot have that seam — there is only one surface.

The profile is **generated, not tabulated**: `r(y)` is the smooth maximum of a body ellipsoid and the
head sphere. A hand-written table of rows drifts, and the one this replaced carried a pinched neck
(0.79 → 0.74 → 0.827) that no reference has — two rows fighting the eighteen that described an egg.

```js
/** An ellipsoid's radius at height y: 0 outside it, so it can be unioned. */
function ellipsoid(y, centre, down, radius, up = down) {
  const t = (y - centre) / (y < centre ? down : up);
  return t <= -1 || t >= 1 ? 0 : radius * Math.sqrt(1 - t * t);
}

/** Smooth maximum: the union that rounds its own join. */
function smax(a, b, k) {
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (a - b)) / k));
  return b + (a - b) * h + k * h * (1 - h);
}

function eggRadius(y) {
  const bodyR = ellipsoid(y, BODY_C, BODY_DOWN, HIP_R, BODY_UP);
  const headR = ellipsoid(y, HEAD_Y, HEAD_R, HEAD_R);
  // Blend ONLY where both solids are present: smax(0, 0, k) is k/4, not 0, which
  // at the crown leaves a flat 0.075-wide plateau instead of a closed skull.
  if (bodyR <= 0 || headR <= 0) return Math.max(bodyR, headR);
  return smax(bodyR, headR, BLEND);
}

// Rows are COSINE-SPACED, so they bunch at the foot hollow and the crown where the
// curve turns hardest and thin out down the straight of the flank.
const PROFILE_ROWS = 26;
const BODY_PROFILE = Array.from({ length: PROFILE_ROWS }, (_, i) => {
  const t = i / (PROFILE_ROWS - 1);
  const y = BODY_BOTTOM + (CROWN_Y - BODY_BOTTOM) * (0.5 - 0.5 * Math.cos(Math.PI * t));
  return [eggRadius(y), y];
});

/** The silhouette half-width at height y — cut every garment from THIS. */
function radiusAt(y) {
  if (y <= BODY_PROFILE[0][1] || y >= BODY_PROFILE[BODY_PROFILE.length - 1][1]) return 0;
  for (let i = 1; i < BODY_PROFILE.length; i++) {
    const [r1, y1] = BODY_PROFILE[i];
    if (y <= y1) {
      const [r0, y0] = BODY_PROFILE[i - 1];
      const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
      return r0 + (r1 - r0) * t;
    }
  }
  return 0;
}

/** The profile between two heights, with the cut ends interpolated onto it. */
function profileSlice(y0, y1) {
  const out = [[radiusAt(y0) || 1e-4, y0]];
  for (const [r, y] of BODY_PROFILE) if (y > y0 && y < y1) out.push([r, y]);
  out.push([radiusAt(y1) || 1e-4, y1]);
  return out;
}

function lathe(profile, segments = 20) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), segments);
}

const body = new THREE.Mesh(lathe(profileSlice(BODY_BOTTOM, WAIST_Y)), bodyMat);
const head = new THREE.Mesh(lathe(profileSlice(WAIST_Y, CROWN_Y)), bodyMat);
```

The resulting silhouette: **1.02** at the hips → **0.81** at the shoulder → **0.87** at the head →
closed at the crown, with no local minimum sharp enough to read as a neck.

> `body` and `head` share a material and never move apart, so it is tempting to merge them. **Do
> not**, if you want to keep the invariants in §10 testable: they exist as two meshes so that
> `parts.head`'s bounding box still measures a head and can be compared against the grin's.

## 5. The grin — two sausages joined at the corners

This is the part to get right. Each lip is a circular tube swept along a smiling arc round the head
and **closed at both ends with a hemisphere**. Three properties then fall out of the construction
instead of being tuned in — which is the whole reason for building it this way:

1. **The corner is round and thick because it is half a ball.** Both tubes run to the same
   `LIP_END_R` at the tips, so the two hemispheres that close them are the *same bulb*: two sausages
   joined, not two pipe ends side by side. `LIP_FUSE` converges their centre lines to ~0.15 apart by
   the tip, against a 0.31 bulb, so they are deep inside one another.
2. **The crease is shallow because it is not modelled.** It is only where the two tubes' surfaces
   cross, and the groove between two overlapping circles is at most `r − √(r² − d²)`. At
   `DY = 0.60 R` that is a third of the crest. It is not a free parameter: at `DY = 0.76 R` the
   groove goes 46% deep, which from a side view splits the mass into two lobes and reads as an open
   beak.
3. **The smile is a parabola in X, not in θ.** The tubes run round a ring, so the visible front of
   the mouth is only the middle of the sweep. Lifting the corners by `u²` gives that visible part
   barely a third of the lift, and the whole readable grin renders as a horizontal band wrapped round
   his face. `sin²θ` is the same parabola measured in the plane the camera actually sees.

```js
const LIP_COLS = 26;   // sweep columns per tube, tip to tip
const LIP_SEG  = 14;   // samples round the tube's circumference
const LIP_CAPS = 4;    // rings closing each hemispherical end

/** How far along the smile we are: 0 at the centre, 1 at the corner, as the square of the corner's X. */
function sway(u) {
  const s = Math.sin(u * LIP_THETA) / Math.sin(LIP_THETA);
  return s * s;
}

/** The centre line of one lip at sweep position u ∈ [-1,1], offset dy from the crease. */
function lipCentre(u, dy, out) {
  const th = u * LIP_THETA;
  const s = sway(u);
  return out.set(
    LIP_R * Math.sin(th),
    LIP_Y + LIP_CURL * s + dy * (1 - LIP_FUSE * s),
    LIP_R * Math.cos(th),
  );
}

/** One lip, appended to pos/idx. Returns the index count it added (for a material group). */
function lipTube(dy, r0, pos, idx) {
  const c = new THREE.Vector3(), t = new THREE.Vector3();
  const ahead = new THREE.Vector3(), behind = new THREE.Vector3();
  const capC = new THREE.Vector3(), p = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const rings = [];

  const frameAt = (u) => {
    lipCentre(u, dy, c);
    lipCentre(Math.min(1, u + 0.01), dy, ahead);
    lipCentre(Math.max(-1, u - 0.01), dy, behind);
    t.copy(ahead).sub(behind).normalize();
  };

  // The first basis vector is the OUTWARD radial direction squared up against the
  // tangent, so consecutive rings share an orientation and the tube cannot twist
  // along the sweep. A free-floating frame twists, and it shows as a spiral crease.
  const ring = (centre, tan, r) => {
    e1.set(centre.x, 0, centre.z).normalize();
    e1.addScaledVector(tan, -e1.dot(tan)).normalize();
    e2.crossVectors(tan, e1);
    rings.push(pos.length / 3);
    for (let j = 0; j < LIP_SEG; j++) {
      const a = (j / LIP_SEG) * Math.PI * 2;
      p.copy(centre).addScaledVector(e1, r * Math.cos(a)).addScaledVector(e2, r * Math.sin(a));
      pos.push(p.x, p.y, p.z);
    }
  };

  const radiusAtU = (u) => r0 + (LIP_END_R - r0) * sway(u);

  // ---- the corner at -θ: apex first, then rings opening out to full radius, so
  // every ring in `rings` runs in one direction along the tube.
  frameAt(-1);
  const apexA = pos.length / 3;
  p.copy(c).addScaledVector(t, -LIP_END_R);
  pos.push(p.x, p.y, p.z);
  for (let k = LIP_CAPS; k >= 1; k--) {
    const al = (k / (LIP_CAPS + 1)) * (Math.PI / 2);
    capC.copy(c).addScaledVector(t, -LIP_END_R * Math.sin(al));
    ring(capC, t, LIP_END_R * Math.cos(al));
  }

  // ---- the sweep (column 0 IS the -θ cap's base ring, at α=0)
  for (let i = 0; i < LIP_COLS; i++) {
    const u = -1 + (2 * i) / (LIP_COLS - 1);
    frameAt(u);
    ring(c, t, radiusAtU(u));
  }

  // ---- the corner at +θ
  frameAt(1);
  for (let k = 1; k <= LIP_CAPS; k++) {
    const al = (k / (LIP_CAPS + 1)) * (Math.PI / 2);
    capC.copy(c).addScaledVector(t, LIP_END_R * Math.sin(al));
    ring(capC, t, LIP_END_R * Math.cos(al));
  }
  const apexB = pos.length / 3;
  p.copy(c).addScaledVector(t, LIP_END_R);
  pos.push(p.x, p.y, p.z);

  // Stitch. Ring vertices run about (e1 → e2), rings advance along +t, and
  // (e1, e2, t) is right-handed, so ∂angle × ∂t points OUT of the tube.
  const before = idx.length;
  for (let r = 0; r < rings.length - 1; r++) {
    for (let j = 0; j < LIP_SEG; j++) {
      const j2 = (j + 1) % LIP_SEG;
      const a = rings[r] + j, b = rings[r] + j2;
      const d = rings[r + 1] + j, e = rings[r + 1] + j2;
      idx.push(a, b, d, b, e, d);
    }
  }
  const last = rings[rings.length - 1];
  for (let j = 0; j < LIP_SEG; j++) {
    const j2 = (j + 1) % LIP_SEG;
    idx.push(rings[0] + j2, rings[0] + j, apexA);   // near apex fans backward…
    idx.push(last + j, last + j2, apexB);           // …far apex forward
  }
  return idx.length - before;
}

/** The grin: upper lip, then lower, as one geometry with two material groups. */
function sausageLips() {
  const pos = [], idx = [];
  const upper = lipTube(LIP_UP_DY, LIP_UP_R, pos, idx);
  const lower = lipTube(-LIP_LOW_DY, LIP_LOW_R, pos, idx);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.addGroup(0, upper, 0);        // material 0: `lips`
  geo.addGroup(upper, lower, 1);    // material 1: `lipsShade`
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

const lips = new THREE.Mesh(sausageLips(), [lipsMat, lipsShadeMat]);
```

The smile line is also the colour line: upper lip lighter, lower darker.

**The pose engine must only ever TRANSLATE the lips mesh** — a bounce on the run cycle, an
occasional dip at idle. Its vertices sit at absolute rig heights; scaling it about the rig origin
slides the whole grin down into his hips (same failure mode as the eyes in §11).

**What the measurements come out as** (check these when you port it): the mass is **0.80 thick** at
the centre line, its bounding box is **1.25 tall** because *the corners ride up*, and it is
**1.36× the head's width**. The grin's highest point is **beside his mouth, not above it** — that is
the single most characteristic fact about the shape, and the reason `LIP_CURL` is large while the
tubes stay modest.

> **Why ±66° and not ±83°.** A tapering swept profile could wrap all the way to his ears safely,
> because its tip collapsed onto the ring at z = +0.12, still in front of him. A *round* corner
> cannot: a bulb reaches `LIP_END_R` behind its own centre, and at 83° that puts the back of his
> smile at **z = −0.19**, behind the line of his shoulders — where collars, scarves and straps live.
> At 66° the bulb clears z = 0 with 0.08 to spare, the grin is still 1.36× the head wide, the corners
> still stand 0.31 proud of the skull so they read from directly behind, and *more* of the smile
> lands on the face that faces the camera.

## 6. Eyes, tufts, arms, legs

```js
// ---- eyes: two ink dots, level with the corner bulbs, riding the head's surface.
// Position the PAIR at EYE_Y and put the dots at y=0 relative to it, so a "blink"
// that squashes them in Y flattens them in place instead of collapsing them
// toward the rig origin (eyes sliding down into his hips).
for (const sx of [-1, 1]) {
  const eye = new THREE.Mesh(unitSphere(8), inkMat);
  eye.scale.set(0.085, 0.1, 0.085);
  eye.position.set(sx * EYE_X, 0, EYE_Z);
  eyes.add(eye);
}
eyes.position.set(0, EYE_Y, 0);

// ---- tufts: three fat ink lozenges on the crown, LEANING BACK over it (about X),
// the outer two also splayed (about Z). The GROUP pivots at the crown, so pose sway
// rocks them about their base rather than shearing the cluster around the rig origin.
// Tilting them sideways in the frontal plane instead reads as horns.
tufts.position.set(0, TUFT_Y, 0);
//        x      z      height  splay
// tuft(-0.24, -0.04,   0.24,   0.30)
// tuft( 0.00, -0.10,   0.30,   0.00)
// tuft( 0.24, -0.04,   0.24,  -0.30)
// each = a tapered stem (cylinder, rTop 0.10 → rBottom 0.14, `height`, 6 segments)
// rotated about its base by Euler(TUFT_LEAN, 0, splay, 'ZXY'), capped with a
// sphere scaled (0.15, 0.16, 0.15) at the stem's far end.

// ---- arms: a CAPSULE, not a cone. Pivot at (±SHOULDER_X, SHOULDER_Y, 0) with
// rotation.z = ±ARM_OUT_ROT. Straight shaft, BOTH ends capped with a sphere of the
// same radius: a tapered shaft with a wider stub on the end leaves a lip at the
// wrist and a point at the tip, which end-on from the side reads as a spike
// growing out of his chest.
//   cylinder(ARM_R, ARM_R, ARM_LEN, 10) at y = -ARM_LEN/2
//   sphere r=ARM_R at y = 0  and  at y = -ARM_LEN
// `hand` is a bare pivot at (0, -ARM_LEN, 0) under each arm — a held prop parented
// there inherits every arm-swing pose for free.

// ---- legs: pivot at (±LEG_X, LEG_LEN, 0).
//   cylinder(LEG_R, LEG_R, LEG_LEN, 8) at y = -LEG_LEN/2
//   foot: sphere scaled (LEG_R, LEG_R*0.78, LEG_R*1.1) at (0, -LEG_LEN + LEG_R*0.78, 0.05)
// Centre chosen so the rounded bottom just REACHES y=0 and never goes below it.
// Body-coloured, not shaded: in the reference only the SOLE is dark, and the sole
// is not modelled at all — a tilted bird's-eye camera never sees the underside of
// a foot, so it would be pure invisible draw calls.
//
// He has NO tail. A back nub was built once and cut — the reference has none,
// and from behind it read as a weird third tuft.
```

## 7. Hierarchy

The split between `root` and `upper` is load-bearing: **a torso bob must not lift his feet off the
ground**, so the legs are siblings of the torso, not children of it.

```
root ─────────────────── yaw only (setFacing)
 ├── legL, legR           grounded — NOT children of `upper`
 └── upper                bob / lean / tilt move this whole group as one unit
      ├── body, head      two lathes, one material, coincident cut at WAIST_Y
      ├── lips            a SIBLING of head, never its child (see §10)
      ├── eyes
      ├── tufts           pivots at the crown
      ├── armL, armR      pivots at the shoulders
      │    └── handR/handL   bare pivots at the arm tip — props parent here
      └── attach.{hips,waist,chest,neck,back,head,face}   empty pivots for garments
```

**Garment pivots hang off the part that MOVES.** Parenting clothes to `root` while the torso is
`upper` means the body travels *inside* stationary clothing on every pose — 0.05 on an idle bob,
0.35 rad on a stumble. They sit at the rig origin (not at hip/chest height) so a garment builder can
work in absolute rig-local Y and call `radiusAt(y)` directly.

## 8. Palette

```js
const MOBU_PALETTE = {
  ink:       0x231F20,   // eyes, tufts — never #000000
  bodyLight: 0xFFC24A,
  bodyBase:  0xF7A81C,   // the whole body, head, arms and legs
  bodyShade: 0xE08A00,
  lips:      0xF5731F,   // the upper tube
  lipsShade: 0xD65A12,   // the lower tube
  white:     0xFFFFFF,
};
```

The reference's brighter crown is the **key light, not pigment** — do not paint a lighter cap on his
head. `bodyLight` is declared for the palette's completeness, not because the body uses it.

## 9. His clothes

The orange shorts are part of who he is, not an optional garnish — a mobu built without them is never
correct. Build them with the rest of the character, not as a separate dressing step.

A garment is **a shell on the body's own surface**, never a box: at every angle θ and height y its
radius is `radiusAt(y) + gap`, so it follows the egg and follows any change to it. Layers stack by
gap — pants 0.05, tops 0.095, coat 0.13 — so cloth never z-fights. The classic shorts are a shell
from **yTop 1.25** to **yHem 0.36** with a crotch notch of 0.12, a darker cuff, an `ink` drawstring
at y 1.19, and white rounded blob decals at y ≈ 0.86 each with an orange tick arc inside. The shell
carries a **tapered minimum radius** (`minR` easing 0.97 → 0.93 toward the hem): a constant minimum
reads as a bucket, while the taper keeps the hem — at 0.93 — still clear of the legs (outer edge
0.88, at x ±0.5 with r 0.38).

**The neckline tucks behind the lip.** A collar top's front edge does NOT stop below `LIP_FLOOR` —
it rises to just under the lower lip tube's centre line, `LIP_Y + LIP_CURL·s − LIP_LOW_DY·(1 −
LIP_FUSE·s) − 0.04` with `s = sway(θ)`, and holds there across the whole ±66° sweep: the lip's
front bulk (it reaches ~1.25 from the axis against the shell's ~0.92) overlaps and hides the edge.
Past the sweep the edge eases down behind the corner bulbs (a point at θ 75°, y 2.45 sits ~0.22
from the bulb centre — inside it) to the garment's full height over the shoulders and back.

**Tops cover above the arms.** The shoulder pivots sit at (±0.76, 1.86) with a 0.31 ball; full
garment height is 2.14–2.2 so the arms emerge from UNDER the top. The shipped wardrobe is exactly:
tops — nothing, shirt (collar band behind the shoulders + three ink buttons down the chest), tee
(short sleeves), trunk top (sleeveless), long coat (skips a ±0.55 rad front wedge so the pants
show, flares `+0.18·v` down to a hem at y 0.5, long sleeves); pants — classic/plain shorts, long
pants, skirt; head — cap (long visor), beanie, bow, headband; face — glasses, freckles, blush.

**Sleeves are parented to the ARM pivots**, not to the torso, so they swing with every pose; they
are tagged with their slot and swept off the arms when the top changes.

**Hats perch above the eyes.** The eye dots top out at `EYE_Y + 0.1`; every hat rim sits at
`EYE_Y + 0.12` or higher (`domeAbove(rimY)` cuts a skullcap at a given rim height) and the
headband is a slim ring at y 3.16. A crown-covering hat (cap, beanie) hides the tufts, and glasses
are suppressed under one — their rings reach ~1.04 from the head centre and poke through any dome.

**Outfits are seeds, not state.** A costume spec is plain JSON, one `[itemId, paletteIndex]` pair
per slot (`pants/top/head/face`). Costumes are not controllable: the server rolls a fresh
`costumeSeed` per racer at every race create, and every client derives the identical outfit via
`costumeFromSeed(seed)` (mulberry32 → weighted picks; bare slots are common). A racer without a
seed falls back to `costumeSeedFromText(id|name)` — also deterministic across clients. Never
randomize outfits per client.

## 10. Verification — assert these, don't eyeball them

Seven of the twelve reference facts were once got wrong in ways that are **invisible from the front**,
which is the only angle anyone ever draws. Build a turntable (fixed yaws: 0, 40, 90, 180) before you
trust any of this, and assert:

| Check | Why it exists |
|---|---|
| `lipsWidth > headWidth`, and `lipsWidth / headWidth ≥ 1.25` | Lips narrower than the head read as a flat duck bill. "Wider than the head" alone passed a model that was at 1.24. |
| `lips.max.z > head.max.z` | The grin must protrude. |
| `lips` is a **sibling** of `head`, not a child | A child's bounding box flows into its parent's, and the check above then compares the head with itself. |
| `torsoWidth > headWidth` | He is a pear, not a lollipop. This read was once fully inverted. |
| `root.min.y > -0.02` | Feet on the ground, in **every** pose. |
| `\|root.max.y − 3.75\| < 0.25` | The one number everything else is scaled against. |
| tufts ≥ 3 meshes | |
| every pose × several time values produces **finite** transforms | |
| garment vertices stay within 0.4 (`top`) / 0.52 (`pants`) of `radiusAt(y)` | The measurable form of "a shell, not a box". A crate's bounding box is no wider than the hips it fails to wrap, so every width test in the world passes it. The pants get slack because the tapered hem must clear the legs. |
| sleeve vertices stay within 0.13 of the arm surface (r 0.31) | Sleeves are arm-parented; measure point-to-segment from the arm's WORLD pivot along its world quaternion, in the rest pose. |

Measure a pose **in screen space, not world space.** With a camera 55° above the ground, screen-up
reads world Y at only 0.57 and world Z at −0.82 — a motion can have real world-space amplitude and
still cancel to nothing on screen.

Measure garments **at the rest pose** (`animate(0, 0)`), with world matrices refreshed — vertices
are read through `matrixWorld`, and a rig left mid-animation (or measured in rig-local space while
it carries the ground/hop offsets) fails in weird ways. Cylinder cap-centre vertices sit exactly on
the axis; skip points closer than 0.06.

## 11. The defect log — things that have shipped broken

Read this before changing the grin. Each line is a bug that reached production at least once.

- **The bill, three times.** Any construction whose corners come to a point is a bill from 90°. The
  swept cross-section tapered *in order to close itself*, which made the corners — the one part every
  reference draws fattest — the one part the geometry drew sharpest. Do not reintroduce a taper.
- **The deep crease.** Cut past about a third of the crest and the mass notches in two; from a pure
  side view (the angle no reference photo shows) it is a pointed, notched wedge.
- **The flat smile.** Parameterising the corner lift by the sweep parameter instead of by the
  corner's X makes the whole *visible* part of the grin horizontal, like a bandage wrapped round his
  face, while looking perfectly correct in code.
- **Lips under-measured.** 1.32× and "0.80 tall" were both eyeball readings off the product shot.
  The flat 2D art measures 1.40× and a 1.25-tall bbox over a 0.80-thick mass.
- **The pinched neck.** A hand-written profile table drifts row by row until two of its rows describe
  a shape the other eighteen contradict.
- **A permanent shrug.** Arms at 2.35 rad rest 45° *above* horizontal, and park every held tool up
  beside his face where the grin hides it. The rest angle is measured from straight DOWN.
- **The lantern in his skull.** A prop held in a hand must take the hand's **position** and the
  **root's orientation** — not the hand pivot's world matrix. The arm is rolled out ~72°, so copying
  that matrix rolls a held pole into his own head, and a point light with it. Author offsets in the
  rig's upright frame (+Y up, +Z his facing) with x = 0, so they read the same in either hand.
- **Horns.** Tufts tilted sideways in the frontal plane instead of leaning back over the crown.
- **Eyes in his hips.** Squashing an eye mesh whose vertices sit at absolute height collapses it
  toward the rig origin instead of flattening it in place.
- **Clothes he walks out of.** Garments parented to `root` while the torso is `upper`.
- **A grin in his hips.** The run cycle's jowl bounce scaled the lips mesh about the rig origin;
  its vertices live at absolute heights, so the whole grin slid down his front. Translate only.
- **Hats over his eyes.** Cap/beanie domes were cut at the head's equator and a headband sat at
  y 3.0, swallowing the eye dots (top ≈ `EYE_Y + 0.1`). Every hat rim now perches at
  `EYE_Y + 0.12` or higher.
- **Glasses through the beanie.** Glasses reach ~1.04 from the head centre (to stay visible around
  the eyes) and poked arcs through any hat dome. Suppress glasses under crown-covering hats.
- **Bucket shorts.** A constant minimum radius on the shorts shell erased the egg's taper; the hem
  now eases 0.97 → 0.93 so it clears the legs without reading as a box.
- **Scraps, not clothes.** Side-panel vests and back-only capes shipped and were cut — from most
  angles they read as nothing worn at all. Tops are full garments that cover above the arms.
- **A tail he never had.** A back nub was built once and removed; the reference has no tail.
- **Ghost garment failures in tests.** Measuring garment vertices against a posed rig (or in
  rig-local coordinates) fails spuriously; measure the rest pose in world space and skip
  cap-centre vertices.

## 12. Budget

At the tessellation above, one dressed mobu is **~4,150 triangles** and roughly a dozen meshes.

The grin is ~1,900 of those (26 columns × 14 round × 2 tubes, plus caps) — down from ~3,500 for the
swept-profile version it replaced, so two sausages are the cheaper mesh as well as the right one.

If you need to cut draw calls for a crowd, **bake and merge meshes that share a material and move as
one rigid unit** (the two halves of each leg, each arm's shaft and caps, the pair of eyes, each
tuft's stem and tip). Never merge `body` with `head`: they share a material and never move apart, so
a merge pass *will* take them, and that collapses the two bounding boxes the invariants in §10 are
measured against into one.
