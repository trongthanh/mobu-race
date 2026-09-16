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
this very same profile; every torso garment must follow it.

## 5. Mouth: one soft, grooved sculpt

### Construction

`createMouthGeometry()` builds one connected indexed surface, closed at both ends.
Across the smile, `u ∈ [−1, 1]`:

```js
x = (LIP_R * sin(LIP_THETA)) * u;
y = LIP_Y + LIP_CURL * u * u;
z = 0.99 - 0.25 * u * u;
```

The frontal sweep is deliberately shallower than the old collar ring. The lip is
attached to the cheeks, not wrapped around to the ears. Cross-sections use a stable
front/up frame perpendicular to this path, avoiding twisted sweep normals.

The section has a full upper lobe and a slightly fuller lower one:

- Upper half-height: `LIP_UP_DY + LIP_UP_R = 0.15 + 0.25 = 0.40`.
- Lower half-height: `LIP_LOW_DY + LIP_LOW_R = 0.192 + 0.32 = 0.512`.
- Front depth: **0.30** at the centre.
- Centre crease Y: **2.21**; corner curl: **0.45**.
- `LIP_R = 1.10 × HEAD_R`, sweep reference `LIP_THETA = 1.15`.
- Both section halves become a circle of radius **0.31** at the cheeks.
- Each end closes with a hemisphere tangent to that single circular section.

A narrow Gaussian depression in the **front only** makes the actual smile groove.
Its depth parameter is 0.065, tapering away before the corners; the visible groove
is shallower relative to the adjacent crests. Warm orange/rust vertex tint adds
contact shadow at the bottom of the groove, not a black line pasted on the face.
Both lobes have the **same orange pigment**. Do not colour the entire lower half
brown: the darker underside in the photograph comes from lighting.

The mouth is one watertight component, not overlapping meshes. It has no hard rim,
open seam, separate corner balls, or pointy ends. Cross-section samples concentrate
around the crease to preserve it without sharp shading artifacts.

### Smile deformation

A second sculpt with identical topology is stored as a GPU **position and normal
morph target** named `smile`. It broadens the smile a little, raises the corners,
and adds slight fullness to the lower lip. No geometry is rebuilt per frame.

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

The shorts have a fitted waistband, a small front crotch notch, an ink drawstring,
and staggered rounded white patches. Each tick has two rounded strokes, not a
C-shaped torus. Patch/tick vertices project onto the actual shorts shell, including
its minimum-radius hem. Same-material decorations are merged into a few draw calls.

Pants and tops remain shells on `radiusAt(y)`, with layer gaps preventing z-fighting.
The shorts' minimum radius tapers toward the hem, clearing the legs without a boxy
bucket silhouette. Necklines tuck behind the lower lip; hats stay above the eyes;
crown-covering hats hide the tufts and suppress incompatible glasses.

Race outfits are server-seeded and deterministic across clients. This mesh revision
does not alter costume seed generation, server state or the race plan.

## 9. Verification

Run **`node tests/mobu-check.mjs`** after changing rig, mouth, animation or wardrobe.
Checks include:

- Mouth wider than head (ratio ≥1.25) and protruding past it; torso wider than head.
- Lips are head's sibling; canonical height ~3.75 and feet grounded.
- Every mouth edge has two oppositely wound incident faces; the whole mouth is one
  connected component. Sculpted crease has measurable but shallow depth.
- Smile position/normal targets preserve topology and visibly alter the mesh.
- Smile input clamping, celebration expression, run precedence, and clean reset.
- Finite transforms across idle/run/celebration; real foot bounds stay above dirt.
- All wardrobe items build and hug body/limbs; seed-based outfits are repeatable.

Also inspect **front, 40°, 90° and 180°** in the studio, then complete a short
Countryside Mobu Dash race. Check the mouth in moving side views, the winner's
expression, clothing intersections, shadows and browser console. A bounding box
can pass while the character still looks wrong — the photo comparison matters.
