---
name: nc-world-forge
description: >-
  Interview the user about a world they want, then build it as a single
  self-contained procedural WebGPU HTML file on the bundled neutral engine,
  and verify it against a 10-gate visual protocol. Produces a flyable world:
  terrain, instanced vegetation, light shafts, creatures, haze, six
  viewpoints, three detail levels, no asset files.
  TRIGGER when: the user asks for a 3D world, a procedural scene, a WebGPU
  world, "a forest/ocean/cavern I can fly through", wants to build a world
  from a description, or names this skill.
  DO NOT TRIGGER for: ordinary web pages, 2D canvas work, game logic,
  Three.js/Babylon work, or editing a world that already exists and only
  needs a constant changed.
license: MIT
---

# nc-world-forge

You are going to interview the user about a world, then build it. The interview is
plumbing. **The world is the deliverable, and it is not delivered until it is Verified**
(`docs/verification.md`). A green build is not the bar.

Work through the phases in order. Do not skip the interview and do not skip the gates.

---

## Phase 0 — Preconditions

Check these before asking the user anything, and say plainly if one fails.

1. **Node is available.** `node --version` must succeed.
2. **You can drive a real browser from this session.** The visual gates need a real
   browser with a real WebGPU adapter.
3. **You are the main session, not a subagent.** Subagents have no WebGPU adapter. If you
   are a subagent, you may still interview, edit and build — but you must stop at *built,
   not Verified*, hand the world and the gate list back to the main session, and say so
   explicitly. Never report a gate you could not run.

If the user's own browser lacks WebGPU or has hardware acceleration switched off, the
world will still build; it just cannot be verified here. Say that rather than guessing.

---

## Phase 1 — Interview

Run `docs/question-set.md` in order. Rules:

- **Ask in small batches** (two or three questions), not all twelve at once.
- **Take a weak answer as an answer, but say what you are inferring.** The question set
  names what a weak answer looks like for each question; when you get one, offer a
  concrete default and let the user correct it.
- **Do not refuse a setting.** This skill attempts any world the user names. If the
  setting sits outside the engine's family — enclosed layered volumes lit from above — say
  which content slots will come out empty and what will consequently look thin. Say it
  once, as information, then build it anyway.
- **Write the answers down.** Create `WORLD-BRIEF.md` in the new world's folder holding:
  the setting, the distance answer, one line per content slot, the palette, and the
  explicit list of slots you are leaving empty. Every later edit should trace to a line
  in it.

---

## Phase 2 — Set up the world folder

1. Find this skill's own directory (the one holding this `SKILL.md`). The engine is at
   `engine/` beside it.
2. **Copy** `engine/` into a new folder for the world — e.g. `./<world-name>/`. Never
   edit the installed copy; the next world needs it clean.
3. In the new folder: `cd source && npm install`. `esbuild` is a devDependency and the
   build fails without it.
4. Build the untouched reference world once: `npm run build`. It must exit 0 and print a
   size line. **If the reference world does not build before you change anything, stop and
   report that** — do not debug your own edits on top of a broken base.
5. Open the built `index.html` in the browser and confirm it renders. That is your
   before-picture and your proof the toolchain works.

---

## Phase 3 — Map the brief onto the engine's content slots

Read `docs/architecture.md` for the seam, and `engine/REFERENCE-WORLD.md` for what the
reference world puts in each slot. Then fill this table into `WORLD-BRIEF.md`:

| Slot | Engine role | This world |
|---|---|---|
| Ceiling with holes | the occluder overhead, gaps punched by `discard` | |
| Light through the holes | volumetric shafts along the sun | |
| Floor pattern cast by that light | the same sun projection, landing on the ground | |
| Vertical columns | instanced meshes spanning floor to ceiling | |
| Drifting motes | camera-local particles | |
| Schooling creature | closed-form orbiting instances, many and small | |
| Soaring creature | the slow large-wing animation, few and large | |
| Haze profile | height-graded fog plus the palette | |

Two rules for this mapping:

- **The shafts and the floor pattern share one sun projection.** Move the sun and both
  move together; they must keep lining up. Do not give them separate controls.
- **The distance answer is not a slot — it is a global.** Colour loss means sparse, vast,
  long draw distance, fog eating far detail. Occlusion means dense, close, shorter draw
  distance, higher near-camera density. Darkness means light falling off with depth, with
  emissive detail carrying the read. Settle this before you touch a slot: it sets density,
  draw distance and haze together, and getting it wrong makes every slot look wrong.

---

## Phase 4 — Edit at the seam

The seam a new setting touches is **`world.js` + `shaders.js` + `main.js`'s
resource/pass/draw section.** This is measured, not assumed: stripping the base to a
neutral engine forced 17 separate edits and 98 changed lines in `main.js` alone. Plan for
`main.js` work. Do not tell the user, or yourself, that only `world.js` and `shaders.js`
are involved.

Order of work, one buildable step at a time:

1. **The `shaders.js` palette and haze block first.** Get the colour and the haze profile
   right while the content is still the reference world's. It is the cheapest possible
   place to discover the mood is wrong.
2. **`world.js` populations.** Counts, placement, the procedural meshes, and the volume
   and ground-map channels the shaders read.
3. **`shaders.js` geometry and lighting** for the new meshes and the new occluder.
4. **`main.js`**, only where the above forces it: a buffer that changed size, a pipeline
   whose vertex layout changed, a pass that is now unused or newly needed, a bind group
   that gained an entry.
5. **`template.html`**: title, menu card text, `theme-color`, and the CSS mood. The page's
   own colours should match the world they frame.

Hard constraints — breaking one of these is a defect, not a trade-off:

- **One shared scope.** The sources concatenate into a single async IIFE in fixed order:
  `quality, math, shaders, world, main, audio`. No `import`, no `export`, no module
  syntax. A name must be defined before the file that uses it.
- **WGSL lives in `/*wgsl*/` template literals** and is minified by regex. Keep shader
  text inside those markers or it will not be shrunk, and keep it free of backticks. (JS
  interpolation with `${...}` inside a WGSL literal is used by the engine and is fine.)
- **Everything procedural.** No images, no model files, no audio files, no network fetch.
- **Zero per-frame allocation.** The frame loop allocates no objects and no heap numbers.
  Per-frame scalars live in the preallocated float array; do not create arrays, objects or
  closures inside the render path.
- **Instance byte layouts are load-bearing.** Change a layout and you change the pipeline
  descriptor that reads it, in the same edit.
- **A reload must reproduce the same world.** The RNG is seeded. Do not introduce
  `Math.random()` or anything time-seeded into generation.
- **Never read a built `index.html`.** It is a minified single-line bundle of 70–100 kB
  and tells you nothing the sources do not. Read `source/src/*.js` and
  `source/template.html`.

### Two obligations you must carry into every world

These are not optional, and they are not satisfied by a line in the README alone.

**1. MIT attribution to Abyssal Garden survives into the generated world.**

The engine descends from [Abyssal Garden](https://github.com/Noniv/abyssal-garden) by
Maksymilian Dendura, MIT licensed. That attribution has to survive two hops — into the
engine, and into every world built from it. So, in every world you generate:

- Copy the `LICENSE` beside this `SKILL.md` into the world's folder unchanged (or
  `engine/LICENSE` if the engine carries its own). It holds the MIT text with
  *Copyright (c) 2026 Maksymilian Dendura*. Do not replace that line. If the user wants
  their own copyright, add it as a second line.
- Keep — or, if it is missing, add — a credit link in `template.html` pointing at
  `https://github.com/Noniv/abyssal-garden`, with visible text naming Abyssal Garden.
  Restyle it to fit the world; do not remove it.
- Put the credit in the world's README as well, naming Maksymilian Dendura and MIT.
- **Verify it after building.** `grep -c "Noniv/abyssal-garden" index.html` must return at
  least 1, and `LICENSE` must exist in the world folder. Report both results.

**2. A WebGPU preflight with a plain message.**

Before any device work, the world checks `navigator.gpu`, then
`navigator.gpu.requestAdapter()`, and on failure shows a message on the page — not only in
the console — that a non-technical reader can act on. "No WebGPU adapter found." is not
good enough: hardware acceleration being switched off is a known cause — the engine's own
author hit it in his own Chrome — so the message must name it and say where to change it.
If the message you inherit does not, **rewrite it**. Use wording of this shape:

> This scene needs WebGPU and graphics acceleration. In Chrome, open
> `chrome://settings/system` and switch on *Use graphics acceleration when available*,
> then reload.

Confirm the branch exists by reading it in `source/src/main.js` before you claim it does.

---

## Phase 5 — Build

```
cd <world>/source
npm run build           # -> ../index.html, minified; prints size and gzipped size
npm run build:readable  # unminified, for debugging a runtime error
npm run build:dev       # -> ../dev.html, unminified, plus the F / B flythrough tools
```

`npm run build` must exit 0 and print its size line. A WGSL compile error does **not** fail
the build — it surfaces in the browser console at runtime. That is why gate 4 exists.

---

## Phase 6 — Verify

Run `docs/verification.md` end to end, in this session, in a real browser. Ten gates:
build, adapter, no error state, clean console, six viewpoints screenshotted with
performance read at each, the pinned-resolution flythrough benchmark, all three detail
levels, camera never inside geometry, and a reload that reproduces the world.

Record each gate as pass or fail with its evidence. **Do not call a world done with a gate
unrun.** If you could not run the visual gates, name which ones and why.

---

## Phase 7 — Deliver

Give the user:

- the path to `index.html`, with its size and gzipped size;
- the gate table, with evidence per gate and any failure named;
- the six viewpoint screenshots;
- the flythrough numbers exactly as the benchmark reported them, with the resolution they
  were taken at;
- `WORLD-BRIEF.md`, including the slots you left empty;
- a tuning table for this world — what to change where, by constant name and file;
- what you expect looks wrong, and what you did not attempt.

Be straight about those last two. Every known defect in the worlds built before this skill
existed passed a green build.
