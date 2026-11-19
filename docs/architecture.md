# The engine, and where a new setting touches it

The engine lives in `engine/` beside the skill. `engine/REFERENCE-WORLD.md` describes the
world it ships with. This document describes the structure a new setting has to work
within.

---

## One file out, several files in

Every world is **one self-contained `index.html`** — no network fetch, no asset files, no
3D models, no audio files. Everything is generated from mathematics when the page opens.

The sources concatenate in **fixed order** into a single async IIFE injected into
`source/template.html`:

```
quality.js  →  math.js  →  shaders.js  →  world.js  →  main.js  →  audio.js
```

**One shared scope. No imports, no exports, no module syntax.** A name must be defined in
an earlier file, or earlier in the same file, than the code that uses it. That is the whole
module system, and it is why the order is fixed and not merely conventional.

WGSL lives in `/*wgsl*/` template literals. The build minifies those by regex — strips
comments, collapses whitespace, tightens punctuation — before minifying the JavaScript. Keep
shader text inside those markers or it is not shrunk, and keep it free of backticks, which
would end the literal early. JS interpolation with `${...}` inside a WGSL literal is used by
the engine and is fine.

The whole thing runs inside one `async` wrapper with a `.catch` that puts the failure
message on the page. That is why a startup error is visible to the user instead of only to
the console.

### Building

```
cd engine/source
npm install             # esbuild is a devDependency; the build fails without it
npm run build           # -> ../index.html, minified. Prints size and gzipped size.
npm run build:readable  # unminified, same file. For debugging a runtime error.
npm run build:dev       # -> ../dev.html, unminified + dev.js (the F / B flythrough tools)
```

`dev.js` is only ever in `dev.html`, never in `index.html`. It adds `F` (fly the scripted
one-minute path) and `B` (the same flight as a benchmark, resolution pinned, every frame
timed, avg / p99 / max printed at the end). The verification protocol's gate 7 is `B`.

**Do not read a built `index.html`.** It is a 70–100 kB minified single line and contains
nothing the sources do not. Read `source/src/*.js` and `source/template.html`.

---

## File roles

| File | Owns |
|---|---|
| `quality.js` | The detail level, chosen before anything is built. Thinning factor, shadow map size, anti-aliasing samples, shaft step count. Also the crash-recovery path: a load that killed the tab last time comes back one level lower. |
| `math.js` | Noise, fbm, the surface-nets mesher, 3D samplers, small scalar helpers. Setting-independent; you should not need to touch it. |
| `shaders.js` | All WGSL. Terrain density (compute), the shared scene prelude with the palette and haze, the solid-mesh shaders, the instanced-population shaders, the sky backdrop and star field, and the final composite. |
| `world.js` | World layout and all procedural content generation, at load time only. Terrain primitives, the terrain mesh, every instanced population, the procedural meshes, the lighting volume and the ground map. |
| `main.js` | The WebGPU device, the preflight, resource creation, the bakes, the render targets, the pass list, the draw calls, the frame loop and its adaptive-resolution controller, input, and the menu. |
| `audio.js` | The procedural soundscape. No audio files. |
| `template.html` | The page: title, CSS, menu card, control list, stats line, credit footer, and the `/*SCRIPT*/` slot the bundle goes into. |
| `dev.js` | Dev-only flythrough and benchmark tools. Never shipped. |

---

## The seam

**A new setting touches `world.js` + `shaders.js` + `main.js`'s resource / pass / draw
section.**

This is measured. An earlier spike disproved the tidier claim that only `world.js` and
`shaders.js` were involved: it forced **17 separate edits and 98 changed lines in
`main.js`**. Buffers change size, vertex layouts change, passes become unused or newly
needed, bind groups gain entries. Plan for `main.js` work rather than discovering it.

What `main.js` work looks like in practice:

- a population whose instance buffer changed size or stride;
- a pipeline descriptor whose vertex layout must match a changed instance layout;
- a pass that the new setting does not use (leave it out, or repurpose it — the ocean's
  unused bubble pass became the forest's fireflies and gnat swarms);
- a bind group that needs a new texture or buffer entry;
- a one-time bake that is no longer wanted, or a new one that is.

The counter-example worth holding onto: a volcano was built on the stripped base for about
**four lines of renderer surgery and +3.9 kB**. Those two figures are separate
measurements, taken from separate pieces of work — the 17 edits and 98 lines came from the
spike, the four lines and +3.9 kB from the volcano. Neither predicts the other, and neither
is a budget for your world. Read them as the range the seam can span.

---

## Hard constraints

- **Everything procedural.** No images, no model files, no audio files, no fetch.
- **Zero per-frame allocation.** The frame loop allocates no objects and no heap numbers.
  Per-frame scalars live in one preallocated float array indexed by named constants. Do not
  create arrays, objects or closures in the render path.
- **Instance byte layouts are load-bearing.** Change a layout and change the pipeline
  descriptor that reads it in the same edit, or the validation error lands at runtime in the
  console, not at build time.
- **Generation is seeded and must stay reproducible.** No `Math.random()`, nothing seeded
  from the clock.
- **Do not restructure the renderer, the pass list, the culling, or the build.** Those are
  the parts that make the engine fast, and a confident rewrite of them is how that speed
  gets lost.
- **One file out.** If a change needs a second file at runtime, it is the wrong change.
- **The WebGPU preflight stays, with a plain on-page message** that names hardware
  acceleration, not only WebGPU.
- **The Abyssal Garden attribution stays** — in `LICENSE`, in the `template.html` credit
  footer, and in the README.

---

## Where to tune what

The structure below is stable. The names in the third column were **observed in the spike
the engine was extracted from, and in `nc-3d-world-amazon`** — they are a starting point for
a search, not a guarantee. **Confirm each one against `engine/source/src/*.js` and
`engine/REFERENCE-WORLD.md` before relying on it.**

| Want to change | Where | Names seen (confirm) |
|---|---|---|
| Overall colour and mood | the palette block at the top of the shared scene prelude, `shaders.js` | `SUNC`, `SKYC`, `AMB_LO`/`AMB_HI` |
| Haze density and its falloff with height | the floor-density and height constants in the same block | `HZ0` (at the floor), `HZB` (thinning with height), `HAZE_LO`/`MID`/`HI` |
| Sun direction | a sun constant in `main.js` **and** the sun components in `world.js`, together — they must agree, and changing the sun regenerates the world because the placement of ceiling gaps depends on it | `SUN` (main) with `SUNX`/`SUNZ` (world), where `SUNX = x/y` and `SUNZ = z/y` |
| Light shaft colour, strength, step count | the shaft constants in the scene prelude; step count also comes from the detail level in `quality.js` | `SHAFT`, `RAYK`, `RAYN` |
| Ceiling height | a single constant near the top of `shaders.js` | `CAN` |
| Density and size of the holes in the ceiling | the threshold and radius in the ceiling shader | the ceiling/water shader's threshold |
| Placement of the designed clearings | an array in `world.js` | `GAPS` |
| Exposure | a constant in `main.js` | `EXPO` |
| Population counts | the count constants at the top of `world.js` | e.g. `FIREFLIES`, `SWARM`, `SWARMS` |
| Mesh shapes of columns, rocks, creatures | the mesh builders at the foot of `world.js` | `treeMesh`, `meshPole`, `meshLog`, `meshFish`, `meshManta` |
| What the floor is covered in | the ground-map generation in `world.js` (an RGBA texture whose channels the terrain shader reads; spare channels are available) | the `gm` array in `makeWorld` |
| Light reaching a point in the volume | the half-resolution volume in `world.js` — openness in one channel, skylight in another | the `volD` array in `makeWorld` |
| Terrain rock outcrops, arches, tunnels, cleared corridors | the primitive arrays at the top of `world.js`, packed into the density compute's primitive buffer | `MESAS`, `ARCHES`, `HOLES`, `CLEARS`, via `primBuffer()` |
| The six viewpoints | the poses array in `main.js`; their heights are resolved against the generated ground at load | `POSES` |
| The scripted flight path | the flight constants in `main.js`; the path's sample points are also what the generator dresses the scene along | `flyAt`, `flyPts`, `FLYT` |
| Detail-level behaviour | `quality.js` — thinning, shadow map size, anti-aliasing, shaft steps, mesh coarseness | `LV`, `THIN`, `SHADOW`, `AA`, `RAYN` |
| Page title, card text, colours, credit footer | `template.html` | — |

Two couplings worth memorising, because breaking them produces a world that looks
assembled rather than designed:

- **The light shafts and the floor pattern share one sun projection.** They line up by
  construction. Give them separate controls and they will drift apart.
- **The terrain is a signed density field meshed with surface nets**, not a heightmap. That
  is what allows overhangs, arches and tunnels — and it is why vertical placement works by
  querying the field rather than sampling a height function.

---

## Scattering and placement

Populations are placed by rejection-sampling the terrain's own mesh vertices, so every
instance sits on the surface with a correct normal and no raycast is needed. If you add a
population, scatter it the same way rather than inventing a placement pass. Adding a
raycast, or a per-frame placement step, breaks the zero-allocation rule and the load-time-only
rule at once.

---

## Credit

The engine descends from [Abyssal Garden](https://github.com/Noniv/abyssal-garden) by
Maksymilian Dendura, MIT licensed. The renderer, the adaptive-resolution controller, the
surface-nets terrain, the instancing and the single-file build are its work.
