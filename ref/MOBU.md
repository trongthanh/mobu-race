# Mobu — reference mesh and animation

## 1. Source of truth

**`ref/mobu.jpg` is the shape and colour reference in this repository.** It shows a
smooth, yellow-orange vinyl character with a huge, joined orange smile, tiny black
eyes, three rounded crown tufts, stubby limbs, and golden shorts with white tick
patches. He is not a duck: his mouth must read as **soft lips, never a bill**.

The previous specification described two intersecting swept tubes. That construction
passed bounding-box tests but did not reproduce the photo: the crease was an
intersection seam, the corners wrapped too far around the skull, and flat shading
made the surface look faceted. The current mouth supersedes that algorithm. It is
**one closed sculpted surface**, with two visible lip lobes joined into round cheeks.

The photograph is a front/three-quarter view, not a turnaround. The unseen back and
exact depth remain procedural interpretations; check them in the model studio.

## 2. Files and inspection

- `public/js/rig.js`: canonical measurements, egg profile, shared vinyl materials.
- `public/js/mobu-mouth.js`: continuous mouth geometry and smile morph target.
- `public/js/mobu.js`: body, limbs, face, rig hierarchy, poses and disposal.
- `public/js/costumes.js`: body-following wardrobe and signature tick shorts.
- `public/js/mobu-shorts.js`: two-leg boxing-trunks loft and fitted patch projection.
- `public/mobu-lab.html`: model studio; front / 40° / side / back, smile slider,
  idle / run / celebration, signature or seeded outfit.
- `tests/mobu-check.mjs`: headless geometry, expression, grounding and wardrobe checks.

Run `pnpm start`, then open **http://localhost:3000/mobu-lab.html**. Also inspect an
actual Countryside Mobu Dash race: studio lighting cannot substitute for game lighting.

## 3. Coordinate system and scale

- Up is **+Y**, forward is **+Z**, feet rest at **y = 0** in canonical space.
- Canonical height is approximately **3.75**, including tufts.
- `MOBU_SCALE = 0.5` scales the assembled inner rig as one unit.
- The outer group owns heading, world-space motion, and the dirt offset **0.05**.
- Arms/legs L are at −X; R are at +X.
- Use he/him.

Do not rescale individual parts to fix the silhouette. Garments, eyes, lips and
body share canonical coordinates.

## 4. Body

One generated radius-of-revolution profile joins a lower ellipsoid to the head
sphere using a smooth maximum. Separate body/head meshes share that profile and
material, and must never move apart or form a neck.

| Measurement | Value |
|---|---:|
| Crown | 3.46 |
| Body bottom | 0.23 |
| Body ellipsoid centre | 1.18 |
| Body down / up semi-heights | 0.95 / 1.38 |
| Hip radius | 1.02 |
| Head centre / radius | 2.59 / 0.87 |
| Smooth-max blend | 0.30 |
| Body/head mesh split | 2.03 |
| Profile rows / radial segments | 48 / 48 |

`HIP_R > HEAD_R` is essential: a chubby egg, not a lollipop. The profile is
cosine-sampled to concentrate rows near the poles. `radiusAt(y)` interpolates
this very same profile; every torso garment must follow it. Skin below y=1.14
is omitted from the rendered torso because lower wear is permanent. Otherwise the
old egg skin would show through the new shorts' real crotch/leg gap.

## 5. Mouth: one soft, grooved sculpt

### Construction

`createMouthGeometry()` builds one connected indexed surface, closed at both ends.
The completed sculpt is uniformly scaled to **0.91** around its face-attachment
anchor `(0, LIP_Y, 0.78)`. This matches the pre-rendered Mobu's proportions while
preserving rear overlap with the head. Across the unscaled construction sweep,
`u ∈ [−1, 1]`:

```js
x = (LIP_R * sin(LIP_THETA) - 0.08) * u;
arc = 0.7 * u² + 0.3 * u⁴;
y = LIP_Y + LIP_CURL * arc;
z = 0.99 - 0.25 * u * u;
```

The frontal sweep is deliberately shallower than the old collar ring. The lip is
attached to the cheeks, not wrapped around to the ears. Cross-sections use a stable
front/up frame perpendicular to this path, avoiding twisted sweep normals.

The outer envelope remains symmetric around the quartic-blended sweep: its
upper and lower half-heights are both **0.38**, and smiling adds 0.012 to both.
The visible separator is independently fitted to the annotated quadratic curve:

```js
separatorY = LIP_Y + 0.035 + (LIP_CURL + 0.13) * u²;
```

This slight optical lift compensates for the frontal projection so the lobes
*look* equally substantial. Crucially, it does not deform the outer envelope:
each elliptical cross-section is only reparameterised so a vertex row lands on
the separator; the sides, back, and silhouette remain unchanged.
- Construction front depth: **0.30** at the centre (**0.273** after scaling).
- Sweep centre Y: **2.21**; construction crease Y: **2.245**, final **2.242**.
- Separator's construction rise is **0.58** centre-to-cheek (**0.528** final)
  before its groove fades.
- `LIP_R = 1.10 × HEAD_R`, sweep reference `LIP_THETA = 1.15`; the final
  visible width is about **1.26 ×** the rendered head after `LIP_SCALE = 0.91`.
- Both section halves become a construction circle of radius **0.40** (final
  radius **0.364**) at the cheeks. Fullness increases with `u²` rather than
  swelling in the middle.
- Each end closes with a hemisphere tangent to that single circular section.

A narrow Gaussian depression in the **front only** makes the actual smile groove.
Its depth parameter is 0.065, tapering away before the corners; the visible groove
is shallower relative to the adjacent crests. Warm orange/rust vertex tint adds
contact shadow at the bottom of the groove, not a black line pasted on the face.
Both lobes have the **same orange pigment**. Do not colour the entire lower half
brown: the darker underside in the photograph comes from lighting.

The mouth is one watertight component, not overlapping meshes. It has no hard rim,
open seam, separate corner balls, or pointy ends. Cross-section samples concentrate
around the raised crease while retaining the exact smooth ellipse, avoiding folds
or angular transitions into the rounded end caps.

### Smile deformation

A second sculpt with identical topology is stored as a GPU **position and normal
morph target** named `smile`. It broadens the smile a little, raises the corners,
and adds the same slight fullness to both lips. No geometry is rebuilt per frame.

```js
const mobu = createMobu();
mobu.setSmile(0);   // the reference's relaxed, already-smiling mouth
mobu.setSmile(1);   // a bigger, delighted smile
mobu.setCelebrating(true);
mobu.animate(timeSeconds, speed);
```

`setSmile` clamps to 0…1 and rejects non-finite input. A stopped celebrating racer
automatically uses the delighted smile. Running still takes precedence until the
winner parks. Stopping celebration restores the requested smile on the next pose.

**Never scale the lips mesh about the origin.** Its vertices are at absolute rig
heights. Shape changes use the morph target; jowl bounce only translates the mesh.
The lips remain a **sibling** of the head, so head bounds do not include the mouth.

## 6. Face and limbs

- Two tiny smooth ink dots centred at x ±0.22, y 2.85. Their pair has its own pivot,
  so blinking squashes them in place rather than moving them down the face.
- Delighted expressions use curved happy-eye arches. Other expressions retain dot
  eyes and an occasional short blink.
- Three rounded ink lozenges pivot at y 3.32, lean back about X (−0.42 rad), and
  splay slightly outward. No cylinder/cap seams or pointed horn tips.
- Arms are single smooth capsules, radius **0.31**, segment length **0.52**, pivots
  at (±0.76, 1.86, 0). Rest rotation ±1.25 rad keeps them outward/slightly down.
- Bare `handL`/`handR` pivots at the tips support future props.
- Legs pivot at (±0.50, 0.44, 0). Rounded lathed feet have radius **0.38** and a
  flat sole at canonical y=0. There is no overlapping shaft/ball ridge.
- **No tail.**

The reference holds his arms slightly up; that is a pose, not a permanent rest
angle. Celebration raises both arms in a wide V, waves them out of phase, sways the
body and tufts, and adds gentle victory hops. Idle/run remain grounded and reset
all transient pose offsets.

## 7. Hierarchy

```text
outer group                 heading, world hop, ground offset
└─ root                     uniform MOBU_SCALE
   ├─ legL, legR            NOT children of the breathing torso
   └─ upper                 torso bob / lean
      ├─ body, head
      ├─ lips               independent, morphable sibling of head
      ├─ eyes, happyEyes
      ├─ tufts              pivot at the crown
      ├─ armL, armR
      │  └─ handL / handR
      └─ attach.{hips,waist,chest,neck,back,head,face}
```

Garment pivots are at the rig origin under `upper`. Sleeves parent to the arms.
Clothes therefore follow their wearer instead of staying stationary during poses.

## 8. Materials and wardrobe

Use smooth `MeshStandardMaterial`, not flat Lambert shading. Modest roughness gives
the soft vinyl highlights of the photograph without metallic/glassy reflections.
`sharedMat` caches by colour, side, roughness and vertex-colour flag. Cached materials
are tagged `userData.shared`; `disposeRig` skips them but releases each rig's buffers.

- Body: **#FFBB08**.
- Lips: **#FF7908**, crease tint **#C13D05**.
- Eyes/tufts/drawstring: **#231F20**, never pure black.
- Classic shorts: **#FFB008**, cream-white patches and golden check marks.

The signature and plain shorts are **boxing trunks**, not a skirt-like bucket:
two separate leg/hem loops, a shared curved crotch seam, baggy leg panels, a thick
rounded elastic waistband, and an ink drawstring. The signature pair keeps its
staggered rounded white patches. Each tick has two rounded strokes, not a
C-shaped torus. Patch/tick vertices project onto the actual shaped leg surface.
Same-material decorations are merged into a few draw calls; trouser leg meshes
stay separately identifiable for fit/gap tests.

Tops and waists follow `radiusAt(y)`, with layer gaps preventing z-fighting.
Below the waistband, shorts split into two tailored legs; the inner seams must
come inside the egg profile. Outer surfaces still stay inside the hip envelope.
Necklines tuck behind the lower lip; hats stay above the eyes;
crown-covering hats hide the tufts and suppress incompatible glasses.

Race outfits are server-seeded and deterministic across clients. Lower wear is
approximately **96% trousers/shorts and 4% skirts**. Both coordinated looks and
mix-and-match picks are weighted; only the rare mushroom look keeps a skirt by
default. This changes seed-to-outfit selection but not seed generation, server
state or the race plan.

## 9. Reconstruction procedure

This is the reproducible order for rebuilding Mobu from primitives. Keep all work
in canonical units until the final root scale; changing the order tends to hide
proportion or attachment errors.

### Step 1 — Establish the canonical frame

1. Create an outer `group` for world heading/hops and an inner `root` for geometry.
2. Scale only `root` by `MOBU_SCALE = 0.5` and put world ground at y=0.05.
3. Build geometry with soles at canonical y=0 and tuft tips at y≈3.75.
4. Add an `upper` group for torso lean/bob. Keep both leg pivots directly under
   `root`, otherwise breathing or celebration lifts the stance feet.

### Step 2 — Reconstruct the yellow egg

1. Evaluate the asymmetric body ellipsoid using centre 1.18, down/up semi-heights
   0.95/1.38 and radius 1.02.
2. Evaluate the spherical head using centre 2.59 and radius 0.87.
3. Where both are positive, combine their radii with `smax(..., 0.30)`; elsewhere
   take the positive radius directly so the crown closes rather than plateauing.
4. Cosine-sample 48 profile rows from y=0.23 to 3.46 and lathe with 48 segments.
5. Slice the same profile at y=2.03 into body/head meshes. At the shared row,
   overwrite normals from the profile derivative so lighting cannot reveal the cut.
6. Render body only from y=1.14 because permanent lower wear covers the omitted hip.
   Keep the complete profile in `radiusAt(y)` for all garment construction.

### Step 3 — Sculpt the mouth as one watertight mesh

1. Build 33 sweep rings (`COLS = 32`) across u=−1…1 from the centreline formula
   in §5. At every ring derive tangent, front and up vectors; never use world axes
   for the cross-section after the curve begins turning.
2. Sample 48 points around each ellipse. Upper and lower construction half-heights
   both start at 0.38 and blend with u² to the 0.40 cheek section.
3. Reparameterise only the front half of each ellipse so the raw front vertex lies
   on `separatorY(u)`. This changes sampling, not the ellipse or its silhouette.
4. Recess that front row with a 0.065 Gaussian. Multiply by
   `(1 − u⁸)²` so the groove disappears before the rounded ends; apply the narrow
   rust vertex tint only at this depression.
5. Add six shrinking rings per end, followed by one pole vertex, to form tangent
   hemispherical caps. Connect every adjacent ring with consistently wound indexed
   quads. The result is one component: **2,162 vertices / 4,320 triangles**.
6. Build the neutral and delighted geometries through the same function. Store the
   delighted positions and normals as morph target `smile`, then dispose its shell.
7. Uniformly shrink all resulting positions by 0.91 around `(0, 2.21, 0.78)`.
   Do not scale the runtime lips mesh: its absolute-height vertices would move.

### Step 4 — Add face, tufts and limbs

1. Place tiny eye ellipsoids at x=±0.22, y=2.85, z≈0.805. Parent them to an eye
   pair pivot at y=2.85 so blinking changes scale without sliding the eyes.
2. Build happy eyes as two short tube arches and toggle them at expression ≥0.75.
3. Place three smooth ellipsoidal tufts on a y=3.32 pivot, lean them backward and
   splay only the outer pair.
4. Use single capsule meshes for arms and single lathed flat-soled meshes for feet;
   overlapping cylinder/sphere parts produce visible seams in vinyl lighting.
5. Add empty hand and garment attachment pivots only after the structural meshes.

### Step 5 — Reconstruct the boxing shorts

1. Loft each leg independently on a 14×48 grid from waistband 1.25 to hem 0.37.
   The inner top boundaries meet at the same curved crotch seam while hem loops
   remain on opposite sides of x=0.
2. Add separate two-row darker cuffs and a lathed elastic waistband from y=1.12–1.30.
3. Project every cream patch and both strokes of its tick onto `boxingPoint`; a flat
   decal will sink into the tapered leg near the hem.
4. Merge rigid decoration by material, but preserve the two leg meshes for correct
   normals, seams and testability.
5. Generate all other tops from `radiusAt(y) + gap`. Use seeded weighted lower-wear
   selection so skirts remain near 4%, rather than duplicating skirt entries.

### Step 6 — Wire expressions and motion

1. `setSmile(v)` clamps finite values to 0…1 and directly drives morph influence 0.
2. Blink by scaling the eye-pair pivot; never translate individual eyes.
3. Run phase comes from distance, not wall time. Lift only the recovery foot and
   bob `upper`, keeping the stance sole at ground.
4. Celebration activates only below speed 0.02: switch to happy eyes, drive smile
   0.9–1.0, raise arms, sway tufts/torso and hop through the outer group.
5. Reset every transient translation/rotation before choosing a pose branch so
   changing state cannot preserve an old foot offset or expression.

### Step 7 — Validate visually and structurally

The default signature character is currently about **22 meshes, 14,044 vertices and
22,144 triangles** before the world scale. Treat these as diagnostics, not API
contracts. Inspect front, 40°, side and back views at smile 0 and 1. The reference
front view is authoritative for silhouette and colour; unseen angles should remain
smooth, attached and plausible.

## 10. Verification

Run **`node tests/mobu-check.mjs`** after changing rig, mouth, animation or wardrobe.
Checks include:

- Mouth/head width ratio **1.25–1.34** (currently ~1.26), forward protrusion,
  and torso wider than head.
- Lips are head's sibling; canonical height ~3.75 and feet grounded.
- Every mouth edge has two oppositely wound incident faces; the whole mouth is one
  connected component. Sculpted crease has measurable but shallow depth.
- Smile position/normal targets preserve topology and visibly alter the mesh.
- Smile input clamping, celebration expression, run precedence, and clean reset.
- Finite transforms across idle/run/celebration; real foot bounds stay above dirt.
- All wardrobe items build and hug body/limbs; boxing hems have a real gap.
- Seed-based outfits are repeatable; 5,000 sampled seeds keep skirts rare.

Also inspect **front, 40°, 90° and 180°** in the studio, then complete a short
Countryside Mobu Dash race. Check the mouth in moving side views, the winner's
expression, clothing intersections, shadows and browser console. A bounding box
can pass while the character still looks wrong — the photo comparison matters.
