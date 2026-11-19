# nc-world-forge

**An agent skill that interviews you about a world, then builds it.**

You install it, describe a place, and answer twelve questions about it. The agent maps your
answers onto a bundled procedural WebGPU engine, makes the edits, builds it, and checks the
result against a ten-gate visual protocol. What you get back is **one self-contained HTML
file** you can fly through — terrain, vegetation, light shafts, creatures, haze, six fixed
viewpoints, three detail levels, a day/night toggle. No images, no 3D models, no audio
files, nothing fetched over the network. The whole world is generated from mathematics when
the page opens.

---

## See it first

**[Open Skylight Cavern →](https://nilesh-0608.github.io/nc-world-forge/engine/)** — the
reference world that ships with the engine, running in your browser.

A limestone cavern under a collapsed roof: shafts falling through the openings onto a moss
mound, dust lit only inside the beams, swiftlets wheeling under the roof and kites circling
the sky above it. It renders the moment you clone the repo, and it fills all eight content
slots the interview asks about — so there is always a working example to read the docs
against.

---

## Install

```
npx skills add nilesh-0608/nc-world-forge
```

Then, in your agent session, ask for a world. The skill triggers on requests like "build me
a procedural world", "a flooded cathedral I can fly through", or by name.

**You need:** Node, and a browser with WebGPU and graphics acceleration switched on — in
Chrome, `chrome://settings/system` → *Use graphics acceleration when available*. The build
works without a GPU; the verification does not.

---

## How to use it

**1. Install it** (above), then open an agent session in the folder where you want the world
to live — an empty folder is fine.

**2. Ask for a world.** Say what you want in your own words:

```
Build me a procedural world: a flooded gothic cathedral, knee-deep in
still water, light coming down through broken rose windows.
```

Or invoke it directly — in Claude Code the skill's name is its slash command:

```
/nc-world-forge
```

You do not need to know the engine, WGSL or WebGPU. There is nothing else to configure: the
skill registers on install, and it also triggers on its own when you describe a world.

**3. Answer the twelve questions.** They come a few at a time, and each one maps onto
something the engine actually draws, so there are no throwaway answers. "I don't know" is a
usable answer — the skill proposes something and you correct it.

**4. Let it build and verify.** It copies `engine/` into `./<your-world>/`, runs
`npm install`, edits the seam, builds, and then works through the ten gates. Expect to be
asked to look at screenshots: **the visual gates need a real GPU, so they run in your
session, not in a subagent.**

**5. You get back:**

| | |
|---|---|
| `<your-world>/index.html` | the world — one self-contained file, open it in Chrome |
| `<your-world>/WORLD-BRIEF.md` | your answers, and which slots you left empty |
| `<your-world>/source/` | the readable source, to keep tuning |
| the gate table | ten gates with evidence, and an honest list of what still looks wrong |

**6. Keep tuning, or publish it.** `cd source && npm run build` rebuilds after any edit.
`index.html` works offline and can be emailed; to put it online, push the folder to a repo
and switch on GitHub Pages, which is how the two worlds below are hosted.

### If something goes wrong

- **A blank screen** usually means WebGPU or graphics acceleration is off. Check
  `chrome://gpu`. Every generated world shows a plain message instead of a broken scene.
- **"It built fine" is not done.** A green build is not the bar — see the gates.
- **Keep the installed `engine/` clean.** Each world is a copy; never edit the original.

---

## What a session looks like

1. **The interview.** Twelve questions, asked a few at a time. What the setting is; whether
   distance here reads as colour loss, occlusion or darkness; what the ceiling is and what
   punches holes in it; what the light through those holes looks like; what pattern it casts
   on the floor; what stands vertically; what drifts in the air; what moves in groups; what
   moves alone and large; how the air changes with height; the palette and what night looks
   like; and what it is called. Each question maps onto something the engine actually draws,
   which is why there are twelve of them and not one open-ended one.

2. **The build.** The engine is copied into a new folder and edited at its seam —
   `world.js`, `shaders.js`, and the resource/pass/draw section of `main.js` — then bundled
   into a single file.

3. **The verification.** Six viewpoints screenshotted with performance read at each, a
   pinned-resolution flythrough benchmark, all three detail levels loaded, the console read,
   the camera checked against the geometry, and a reload compared for reproducibility. Ten
   gates, each recorded with its evidence.

   A green build is explicitly not the finish line. Every known defect in the worlds built
   before this skill existed passed a green build, including a canopy that stayed
   daylight-green at night.

4. **The handover.** The file, the gate table, the screenshots, the benchmark numbers, the
   brief, a tuning table for your world, and an honest list of what looks wrong.

---

## Honest scope

**The engine is built for enclosed layered volumes lit from above.** A rainforest, an
ocean, a cavern and a volcanic basin are not four settings — they are one shape: something
overhead with holes in it, light coming through, a floor patterned by that light, things
standing between the two, and air with a density gradient. If your world is that shape, the
engine's content slots all have an obvious occupant and the result is strong.

**The skill will attempt any world you name.** It does not refuse, and it does not shape-test
you first. But be clear about the trade: a world outside that family comes out weaker, and
not because the agent gave up. A desert empties most of the content slots — no ceiling, so no
shafts, so no floor pattern — and it turns haze into heat shimmer, which is a different
shader than the one that ships. An open plain has the same problem. You will get something,
and the agent will tell you which slots went empty, but you will be getting a world the
engine was not shaped for.

The family is guidance so you can self-select. It is not a gate.

Also honest:

- **The skill has not shipped yet and has not been used by anyone.** There are no download
  counts, benchmarks across machines, or user reports to show you, because there are none.
- **One performance figure has been measured:** median frame time 5.6 ms at 1440×900 on an
  RTX 4060 Ti. That run was refresh-capped, so it is a floor on what the engine can do, not
  a ceiling. Nothing has been measured on phones, on integrated graphics, or on any other
  GPU.
- **Quality depends on your answers.** The interview is twelve questions because twelve
  questions is what the engine can act on. Vague answers get concrete defaults, and the
  agent will say which defaults it chose, but it cannot invent a world you have not
  described.

---

## Worlds built this way

Both of these were built by hand on the same lineage, before the skill existed. They are
what the output looks like, not output of the skill.

- **nc-3d-world-amazon** — an Amazon rainforest. Buttressed trunks, light shafts through
  canopy gaps, fireflies in the understorey, stars above the canopy at night.
  [Open it →](https://nilesh-0608.github.io/nc-3d-world-amazon/) ·
  [source](https://github.com/nilesh-0608/nc-3d-world-amazon)
- **nc-3d-world-volcano** — an active volcano. A breached crater rim, a lava lake, a cascade
  down a gorge with a rock bridge over it, and a lava river out across the basin floor.
  [Open it →](https://nilesh-0608.github.io/nc-3d-world-volcano/) ·
  [source](https://github.com/nilesh-0608/nc-3d-world-volcano)

Those two are linked to each other: each has a doorway standing in it that you can fly
through to reach the other. Press `1` in either and look for it.

---

## What's in the repo

```
SKILL.md                 the skill: interview, map, edit, build, verify
README.md                this file
LICENSE                  MIT
docs/question-set.md     the twelve questions, what each determines, and what a weak answer looks like
docs/verification.md     the ten gates, and four traps that produce confident garbage
docs/architecture.md     the seam, the file roles, the build, the constraints, the tuning table
engine/                  the neutral engine, with a reference world that renders on install
  index.html             the reference world, built
  source/                build.mjs, package.json, template.html, src/*.js
  REFERENCE-WORLD.md     what the reference world puts in each content slot
```

The engine ships with a working reference world, so you can see it render before you build
anything of your own.

---

## Credit and licence

MIT. Published by [nilesh-0608](https://github.com/nilesh-0608).

The engine descends from **[Abyssal Garden](https://github.com/Noniv/abyssal-garden)** by
**Maksymilian Dendura**, MIT licensed. The renderer, the adaptive-resolution controller, the
surface-nets terrain, the instancing and the single-file build are all its work. That
attribution travels two hops on purpose: into this engine, and into every world the skill
generates. The skill will not build you a world that drops it.
