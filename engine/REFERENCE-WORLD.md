# The reference world: Skylight Cavern

`engine/index.html` is the engine with one world in it, so that it renders the moment it is opened. That world is
a **limestone cavern under a collapsed roof**: a floor at about −48 m, a rock roof at about −22 m, eight ragged
openings in the roof, and daylight coming down through them.

It is a demonstration of what the engine does, not a third published world. It was chosen because it is the plain
form of the shape this engine is built for — **an enclosed, layered volume lit from above** — and because it is
neither a rainforest nor a volcano.

Engine derived from [Abyssal Garden](https://github.com/Noniv/abyssal-garden) by Maksymilian Dendura, MIT License.
The notice in `source/template.html` (an HTML comment and the credit line on the start screen) must stay in every
world built from this engine; `build.mjs` refuses to write a page without it.

## Build

```
cd engine/source
npm install        # once: esbuild is the only dependency, and only at build time
npm run build      # -> engine/index.html, minified, one self-contained file
npm run build:readable   # the same, unminified
npm run build:dev        # -> engine/dev.html, unminified, with the fly-through and benchmark keys (F, B)
```

The six files in `source/src/` are not modules. They are concatenated in the order
`quality, math, shaders, world, main, audio` into one async function and injected into `template.html` at
`/*SCRIPT*/`. One shared scope, no imports, no exports.

## The seam: what a new world touches

A new setting is written in **three places**:

| # | Where | What |
|---|-------|------|
| 1 | `src/shaders.js` | every block tagged `[WORLD]`. Blocks tagged `[ENGINE]` stay. |
| 2 | `src/world.js` | every block tagged `[WORLD]`: the data tables, the prop meshes, the scatter, the ground map, `expose()`. |
| 3 | `src/main.js` | only between the three fences `>>>> SEAM A/B/C … <<<< SEAM A/B/C`: population pipelines, population buffers + the shadow bake, population draw calls. |

and four small things outside them, tagged `[ALSO TOUCH]` where they live:

| Where | What |
|-------|------|
| `src/quality.js` | `KEY`: the localStorage prefix. Give each world its own. |
| `template.html` | the title, the two lines under it, the five colours in `:root`. Keep the credit. |
| `src/audio.js` | the layers between the two `[WORLD]` marks in `mkSound()`. Optional: untouched, it sounds like a cave. |
| `package.json` | `name` and `description`. |

Nothing else in `main.js` names a population or holds a world constant. What it reads from the world it reads as
data, by name: `LOADING`, `POSES`, `FLY`, `CAM_YMIN`, `CAM_YMAX`, `CAM_RMAX`, `RAYS`, `GM`, `expose()` (world.js),
`SUN_DIR` (shaders.js), `KEY` (quality.js).

Three rules that have each broken a build (they are spelled out at the top of `shaders.js`):

1. **Order.** A JS constant interpolated into WGSL with `${…}` must be declared above its use in `shaders.js` (or
   in `quality.js` / `math.js`). `world.js` comes later; a constant from there is a start-up crash. This is why
   `CAN`, `FLOOR`, `SUN_DIR` and `SKYLIGHTS` are in `shaders.js`.
2. **Brackets.** The WGSL minifier turns `a - -3.` into `a--3.`, which does not compile. Interpolate numbers only
   through `wf()`, `wv2()`, `wv3()`.
3. **Auto layouts.** `W_RAYS`, `W_POST`, `W_MASK`, `W_RBLUR` get exactly the bindings they use. Remove the last use
   of one and the matching entry in `main.js` (`bgRays`, `bgPost`) must go too.

And one that governs every population you add: **it must answer to `det`**, the draw-distance lever of the
adaptive resolution controller (see "The draw-distance lever" below).

## The eight slots

| Slot | What it is | In the reference world | Where |
|------|-----------|------------------------|-------|
| 1 | A ceiling with holes | a rock roof with eight openings | `dens()` in `W_DENS`; `SKYLIGHTS` |
| 2 | Light through it | shafts of sun in the dusty air | `W_RAYS` |
| 3 | A floor pattern cast by that light | pools of sun, dappled, with moss growing in them | shadow map + `W_MASK` + `caus()` + ground map |
| 4 | Vertical columns | stalagmites, stalactites, floor-to-roof columns | `buildProps()`, `POPS`, `scatterProps()` |
| 5 | Drifting motes | dust that lights up in the shafts | `W_MOTE` |
| 6 | A schooling creature | a colony of swiftlets | `vsSchool` in `W_LIFE` |
| 7 | A soaring creature | kites circling in the main opening | `vsSoar` in `W_LIFE` |
| 8 | A haze profile | cold damp air, thickest on the floor | palette at the top of `S_G` |

### Slot 1 — the ceiling with holes

Real geometry. `dens()` is evaluated once on the GPU for every voxel of a 512 × 80 × 512 grid (0.75 m); the
surface-nets mesh, the collision bricks, the ambient volume and the shadow map are all made from it.

| Change | Constant | File |
|--------|----------|------|
| Height of the roof's underside | `CAN` (−22) | shaders.js, top |
| Height of the floor | `FLOOR` (−48) | shaders.js, top |
| Where the openings are, how big, how tall the rubble mound under each | `SKYLIGHTS` rows `[x, z, radius, mound]` | shaders.js, top |
| How fast an opening widens upward | `FLARE` (0.45) | shaders.js, top |
| How much the underside rolls | `ROOF_AMP` (9) | `W_DENS` |
| Where the wall that closes the world stands | `WALL_R0`, `WALL_R1` (150, 166) | `W_DENS` |
| Rock pillars: where, how thick, how tall (top above `CAN` joins the roof) | `PILLARS` | world.js |
| Rock arches, carved tunnels (none here) | `ARCHES`, `TUNNELS` | world.js |
| Floor kept free of terraces | `CLEARS` | world.js |

For an **open sky**, delete the two "roof" lines in `dens()` and end it with `return min(d, top - p.y);` so nothing
solid reaches the top of the grid (this path was booted once, headless, with `top = -27`: it builds and draws
without errors; the palette and the 30 m columns are of course wrong for it). Then make the ceiling a pattern instead of rock: that is what slot 3's mask is
for (`caus()` and `W_RAYS` already project it from the plane `y = CAN` along the sun).

Moving `SKYLIGHTS[0]` moves the soarers with it (they read it) but not viewpoints 1, 3, 4 and 5 (`POSES`).

### Slot 2 — the light through it

A half-resolution march along each view ray, asking the shadow map at every step whether that point of air is in
the sun, then a blur, then added in `W_POST`.

| Change | Constant | File |
|--------|----------|------|
| Direction of the sun | `SUN_DIR` | shaders.js, top |
| Colour of sun / moon | `SUNC_D`, `SUNC_N` | `S_G` |
| Tint of the shafts | `SHAFT_D`, `SHAFT_N` | `S_G` |
| How fast a shaft builds along the ray | `RAYK_D`, `RAYK_N` | `S_G` |
| Brightest a shaft can get | `RY_MAX` (0.26) | `W_RAYS` |
| How far the march goes | `RY_FAR` (90 m) | `W_RAYS` |
| How streaked by the mask | `RY_MASK` (0.45) | `W_RAYS` |
| Dust that is everywhere | `RY_AIR` | `W_RAYS` |
| Brighter looking into the sun | `RY_FWD` | `W_RAYS` |
| Overall gain | `RAYS` (0.54) | world.js |
| Steps of the march, per detail level | `RAYN` (34 / 34 / 12) | quality.js |

### Slot 3 — the floor pattern

Three things, all aligned because all three follow the sun ray to the plane `y = CAN`:

- the **shadow map** cuts the pools of light out of the roof's shadow (nothing to tune: it is the geometry);
- the **mask** (`W_MASK`, an animated tileable texture, binding 5) dapples the light inside the pools;
- the **ground map** (`makeWorld()` in world.js, binding 8) marks where the light lands, and the material grows
  moss there.

| Change | Constant | File |
|--------|----------|------|
| The dapple pattern itself | body of `fs` in `W_MASK`; `MK_LO`, `MK_HI`, `MK_SWAY` | shaders.js |
| Size of the pattern on the ground | `CA_TILE` (23 m) — keep `RY_TILE` equal | `S_B`, `W_RAYS` |
| How dark its dark parts are | `CA_DARK` (0.22) | `S_B` |
| Where it fades to an average | `CA_FAR0`, `CA_FAR1` | `S_B` |
| How far growth spreads past a pool | `SUN_SOFT` (7 m) | world.js |
| What the ground map's channels mean (r growth, a damp; g, b free) | the loop in `makeWorld()` and its one reader, the material block of `W_SOLID` | world.js, shaders.js |
| Resolution of the mask, per detail level | `MASK` (512 / 512 / 256) | quality.js |

### Slot 4 — the vertical columns

Instanced meshes, scattered on the terrain mesh at load, drawn through the terrain's own pipeline.

| Change | Constant | File |
|--------|----------|------|
| The meshes | `buildProps()`; `MITE_H`, `TITE_H`, `COLUMN_H` | world.js |
| How many of each, how far drawn, size range, floor or roof | `POPS` rows `{ part, n, far, s0, s1, up }` | world.js |
| Where each may stand | the three `continue` lines in `scatterProps()` | world.js |
| Room kept free round the camera path | `CLEAR_R` (4 m) | world.js |
| Their colour (and the terrain's) | `ROCK_A … ROCK_D`, `ROCK_WET`, `GROWTH`, `SILT_A`, `SILT_B` and the material block | `W_SOLID` |

A prop with its **own material** takes a new number in instance field `c.x` and a branch in the material block. A
prop that is **not rock at all** (cards, ribbons) takes its own shader, a pipeline in SEAM A, and a draw in SEAM C.

### Slot 5 — the drifting motes

No buffers: position, colour and size are a closed-form function of the instance index and the time.

| Change | Constant | File |
|--------|----------|------|
| How many | `MOTEN` (9000 at High) | main.js, SEAM A |
| Size of the field round the camera | `M_BOX`, `M_Y0`, `M_H` | `W_MOTE` |
| Sink speed (negative rises), wander | `M_FALL`, `M_WOB` | `W_MOTE` |
| Size | `M_R`, `M_PX` | `W_MOTE` |
| Colour in the light / out of it | `M_LIT`, `M_DIM` | `W_MOTE` |

### Slots 6 and 7 — the creatures

Both are one four-vertex flyer (`flyer()` in `W_LIFE`: two triangles hinged along the body), placed by a
closed-form path. No buffers, no JS per frame.

| Change | Constant | File |
|--------|----------|------|
| School: how many | `SCHOOLN` (360 at High) | main.js, SEAM A |
| School: where it roams | `SC_C` (centre), `SC_R` (half-size of the loop), `SC_T` (speed) | `W_LIFE` |
| School: how tight | `SC_W` | `W_LIFE` |
| School: size, wing beat, colour | `SC_SPAN`, `SC_FLAP`, `SC_COL` | `W_LIFE` |
| School: the path itself | `schoolAt()` | `W_LIFE` |
| Soarers: how many | `SOARN` (5) | main.js, SEAM A |
| Soarers: where, how wide, how high | `SO_C`, `SO_R`, `SO_Y0`, `SO_Y1` | `W_LIFE` |
| Soarers: speed, size, colour | `SO_T`, `SO_SPAN`, `SO_COL` | `W_LIFE` |
| Wing shape of both | `WING` and the `discard` line in `fs` | `W_LIFE` |

The paths are not collision-tested: nothing stops a creature flying through rock. Choose `SC_C ± (SC_R + SC_W/2 + 4)`
and the soarers' circle in open air. Here both stay inside and under the main opening, clear of every pillar.

### Slot 8 — the haze profile

Exponential in height, integrated in closed form along every view ray (`hzt()`), coloured by the layer the ray
passes through (`hazeCol()`).

| Change | Constant | File |
|--------|----------|------|
| Density at the floor | `HZ0` (0.016 /m) | `S_G` |
| How fast it thins with height | `HZB` (0.045 /m) | `S_G` |
| Where geometry is gone | `FARD` (150 m) | `S_G` |
| Colour low / under the ceiling / above it, day and night | `HAZE_LO_*`, `HAZE_MID_*`, `HAZE_HI_*` | `S_G` |
| Ambient light below / above the ceiling plane | `AMB_LO_*`, `AMB_HI_*`, `AMB_MIN` | `S_G` |
| Sky, sun disc, moon | `SKYC_*`, `SUNC_*`, `MOON` | `S_G` |
| Exposure (a function of where the camera is) | `expose()` and `EXPO*` | world.js |
| Bloom, vignette, contrast, saturation | `BLOOM_*`, `VIGNETTE`, `CONTRAST`, `SATURATE`, `TINT_*` | `W_POST` |

## Camera, viewpoints, words

All in world.js: `POSES` (keys 1–6: x, height above the ground, z, look-at), `FLY` (the 60 s path of the dev build),
`CAM_YMIN` / `CAM_YMAX` / `CAM_RMAX` (the box the camera is held in; it must stay inside the collision field:
`CAM_RMAX` ≤ 150, `CAM_YMIN` ≥ −52, `CAM_YMAX` ≤ 0, or the camera's position becomes NaN), `LOADING` (the six lines of the loading bar).

1. on the floor, looking at the main opening: shaft, pool, mound
2. half way up, looking down the cavern to the second opening
3. high under the roof, looking down on the pool
4. on the mound, looking straight up at the soarers and the sky
5. risen into the opening, looking back down
6. the far chamber, under a small opening

## The draw-distance lever

The adaptive resolution controller in `frame()` (main.js) has two levers: `pix`, the number of pixels rendered,
and `det`, a draw-distance scale from 1 down to 0.4. When frames are slow it lowers `pix` to half, then `det`,
then the rest of `pix`.

`det` is only worth turning if something is connected to it. In this engine three things are:

- `drawCells()` culls each prop population beyond `far × det`;
- the vertex stage of `W_SOLID` shrinks props to nothing over the last 30 % of that distance (uniform `g.mis.z`,
  instance field `c.z` = the population's `far`);
- SEAM C draws `count × det²` instances of every procedural population.

The stats line (key `H`) shows `draw distance N%` and the number of instances submitted, so the lever can be
watched working. Any population added to SEAM C must use one of the three, or `det` goes back to being a wait.

## Limits worth knowing

- The grid is 384 × 60 × 384 m, y from −56 to +4. Nothing outside it exists.
- The terrain is one mesh of about 750 000 quads in this world (a roof doubles the surface of a floor-only world).
- The collision field keeps at most 200 000 bricks of 64 bytes; this world uses about 40 000.
- Shadows are baked once: nothing that moves casts one, and the sun does not move. Day / night changes colours
  and intensities only.
