# Verification — the ten gates

> ## Read this first
>
> **A green build is not the bar.** Every known defect in `nc-3d-world-amazon` — black
> buttress roots, a canopy that stayed daylight-green at night, a canopy that read flat
> from above — passed a green build. The build cannot see any of them. WGSL compile errors
> do not even fail the build; they appear in the browser console at runtime.
>
> **Subagents have no WebGPU adapter. All visual gates must run in the main session.**
> This is how the protocol gets faked. A subagent asked to "check
> the world" will come back with a confident report based on nothing, because it has no
> adapter and no browser. If you are a subagent: build, then stop at *built, not Verified*,
> hand back the gate list, and say which gates are unrun. Gates 1 and the attribution
> checks are the only ones a subagent can honestly complete.

A world is **Verified** when all ten gates pass and each has evidence recorded. Not before.

---

## The gates

### 1. The build is clean
`npm run build` exits 0 and prints its size line. Record the size and the gzipped size.

### 2. There is a real adapter
In the browser you are about to judge with, confirm `navigator.gpu.requestAdapter()`
returns non-null **before judging anything**. A null adapter means you are about to review
a blank page and blame the shaders. Record the adapter's reported info if available.

### 3. The page does not land in its error state
The loading state clears and the scene reveals. The page's error class is not set. If the
page shows the preflight message instead, that is gate 3 failing *and* a working
preflight — fix the environment, then rerun.

### 4. The console is clean
WGSL compile errors, pipeline validation errors and uncaptured GPU errors surface here and
nowhere else. Read the console; do not assume it. Record it as empty or quote what is in it.

### 5–6. Six viewpoints, screenshotted, with performance read at each
Press `1` through `6` with **real** keypresses and screenshot each. At each viewpoint, turn
the stats line on with `H` and record the whole line: fps, worst frame, late frames, GPU ms,
and the resolution it is currently running at.

Six viewpoints with a reading at each is two gates, not one, because they fail separately:
a viewpoint can look right and perform badly, or perform well and be pointed at nothing.

Judge each screenshot for what a build cannot see:
- anything black, white, or flat that should be shaded;
- geometry floating, intersecting, or sunk into the floor;
- the floor pattern and the overhead light not agreeing;
- popping or banding as the camera settles;
- a silhouette that reads as nothing recognisable.

### 7. The flythrough benchmark
`npm run build:dev` produces `dev.html`. Open it, enter the scene, and press **`B`**. That
runs the scripted one-minute flight through the whole world as a benchmark: it hides the
stats line, **pins the resolution** so the adaptive-resolution controller cannot flatter the
result, times every frame, and prints avg / p99 / max for both frame time and GPU time at the
end.

Record the numbers exactly as printed, with the resolution they were taken at. `F` runs the
same flight without benchmarking, which is useful for watching but is not this gate.

### 8. All three detail levels load
Low, Medium and High, each from the menu, each reaching the scene. They change mesh
resolution, population thinning, anti-aliasing, shadow map size and shaft step count, so a
population that only exists at High is a real failure, not a cosmetic one.

### 9. The camera is never inside geometry
At every one of the six viewpoints, and along the flythrough. A viewpoint inside a trunk or
under the floor can survive a review, because the screenshot just looks dark.

### 10. A reload reproduces the same world
Reload and compare against a viewpoint screenshot from before. The RNG is seeded; a world
that differs between loads has nondeterminism in generation and will never be reviewable.

---

## Attribution and preflight checks

Run these alongside the gates, and report them with the same evidence discipline.

- `grep -c "Noniv/abyssal-garden" index.html` returns at least 1.
- `LICENSE` exists in the world folder and still carries the Maksymilian Dendura copyright
  line.
- The credit link is visible in the menu card, not just present in the source.
- The WebGPU preflight branch exists in `source/src/main.js`, shows its message on the page
  rather than only in the console, and names hardware acceleration.

---

## Four traps that produce confident garbage

These are measured failure modes from running this protocol by hand, not hypotheticals.

1. **Viewpoint keys are ignored while the menu is open.** A sweep run from the menu samples
   one viewpoint six times and reports it as six. Enter the scene first.

2. **Synthetic `KeyboardEvent`s do not work.** Losing pointer lock reopens the menu, and a
   synthetic event cannot re-acquire it. Drive real input through the browser.

3. **Cold start lies.** The first stretch after load is shader compilation and terrain
   generation; it reports single-digit fps and triple-digit GPU times. Discard it.

4. **An unfocused window throttles to 1 Hz while still reporting
   `visibilityState: "visible"`.** Check the actual requestAnimationFrame interval before
   you believe a slow number.

---

## Recording the result

One row per gate. No gate marked pass without its evidence, and no gate marked pass because
it probably would.

| Gate | Result | Evidence |
|---|---|---|
| 1 build clean | | size, gzipped size |
| 2 adapter non-null | | adapter info |
| 3 no error state | | screenshot of the revealed scene |
| 4 console clean | | console contents |
| 5 six viewpoints | | six screenshots |
| 6 performance at each | | six stats lines |
| 7 flythrough benchmark | | avg / p99 / max frame and GPU, plus resolution |
| 8 three detail levels | | one screenshot each |
| 9 camera never inside geometry | | per-viewpoint note |
| 10 reload reproduces | | before/after pair |
| attribution | | grep count, LICENSE check, visible link |
| preflight | | the message text, as the page shows it |

---

## About performance numbers

Report what the benchmark printed on the machine it ran on, and name the machine and the
resolution. Do not generalise from one box.

The one figure measured for the engine so far: **median frame time 5.6 ms at 1440×900 on an
RTX 4060 Ti.** That run was refresh-capped, so 5.6 ms is a floor on what the engine can do,
not a ceiling — it says the frame had headroom left, not how much. There are no numbers yet
for phones, integrated graphics, or any other GPU. Do not invent them, and do not present a
figure from one machine as a specification.
