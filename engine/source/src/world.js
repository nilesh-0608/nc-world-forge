// ============================================================================
// nc-world-forge engine
// Derived from Abyssal Garden by Maksymilian Dendura (MIT licence), https://github.com/Noniv/abyssal-garden
// ============================================================================
// World layout + procedural content generation (load-time only).   SEAM FILE 2 of 3 (with shaders.js and main.js)
// ============================================================================
// Everything in this file runs once, while the loading bar is up. Nothing here is called from the frame loop.
//   [WORLD]   data and generators a new setting rewrites
//   [ENGINE]  the terrain mesher, the ambient volume and the cell sort, which a new setting keeps
// main.js calls exactly four things from here, and reads the data tables by name:
//   densInput()            -> { prims, counts }      the primitives dens() in shaders.js is built from
//   buildTerrain(D)        -> the terrain mesh        [ENGINE]
//   makeWorld(D, T, flyPts)-> { gy, volD, gm, props, solids }
//   LOADING, POSES, FLY, CAM_*, RAYS, expose()        the tables and the exposure hook below
// The reference world is a limestone cavern under a collapsed roof: see REFERENCE-WORLD.md.

// ---------------------------------------------------------------- [WORLD] words and camera
// the loading line, one entry per stage of the load, in this order
const LOADING = ['Compiling shaders…', 'Hollowing the cavern…', 'Raising the rock…', 'Hanging the stalactites…', 'Meshing…', 'Letting the light in…'];
// The camera is held inside these limits (m). They must stay inside the collision field, which covers a radius of
// 153 m and y from -53 to +1: CAM_RMAX <= 150, CAM_YMIN >= -52, CAM_YMAX <= 0. Outside it the lookup in main.js reads
// past its table and the camera's position becomes NaN.
const CAM_YMIN = -52, CAM_YMAX = 0, CAM_RMAX = 150;
// Exposure. main.js calls expose() once a frame with the camera's position and the night blend (0 day .. 1 night)
// and puts what it returns in the uniform g.mis.x. It is a function of where the camera IS, never of what it sees:
// it does not meter the picture, so it cannot cancel a palette change. It must not allocate (no arrays, no for-of).
// Here: wide open in the dark of the cavern, closing as the camera rises into an opening (EXPO_HI between EXPO_Y0
// and EXPO_Y1) and as it walks into a pool of sunlight (EXPO_SUN). *_N: the same at night.
const EXPO = 1.2, EXPO_N = 1.6, EXPO_HI = 0.5, EXPO_HI_N = 0.8, EXPO_SUN = 0.5, EXPO_SUN_N = 0.85, EXPO_Y0 = CAN - 6, EXPO_Y1 = CAN + 14;
function expose(x, y, z, night) {
  const k = clamp((y - EXPO_Y0) / (EXPO_Y1 - EXPO_Y0), 0, 1), s = sunAt(x, z);
  return mix(EXPO, EXPO_N, night) * mix(1, mix(EXPO_HI, EXPO_HI_N, night), k) * mix(1, mix(EXPO_SUN, EXPO_SUN_N, night), s * (1 - k));
}
// overall gain of the light shafts (the uniform g.mis.y; their colour and strength by day and night are in S_G)
const RAYS = 0.54;

// Preset viewpoints, keys 1-6: x, height above the lowest ground in that column, z, then the point looked at.
// A height of 99 means "as high as the camera goes" (it is clamped to CAM_YMAX). All six are aimed at the layout
// in shaders.js (SKYLIGHTS) and below (PILLARS): move those and these must follow.
//   1 on the floor, looking across the cavern at the main opening: the shaft, the pool of light, the mound under it
//   2 half way up, looking down the length of the cavern past two pillars to the second opening
//   3 high under the roof, looking down on the pool of light and the school crossing it
//   4 on the mound, looking straight up through the main opening at the soaring creatures and the sky
//   5 risen into the main opening, as high as the camera goes, looking back down into the cavern
//   6 the far chamber: under a small opening, looking back towards the main one
const POSES = [
  [26, 1.8, 30, -4, -40, -4],
  [20, 7, 16, 48, -42, 34],
  [-28, 19, -34, -4, -46, -2],
  [3, 2, -2, 0.5, 4, -5],
  [8, 99, -12, -16, -48, 12],
  [-56, 2.2, 52, -6, -36, 4],
];
// 60 s camera path (position + look-at, Catmull-Rom). The prop scatter keeps it clear; dev.js flies along it (F / B
// in dev.html). From viewpoint 1 across the floor into the light, round the mound, up through the opening and back.
const FLY = new Float32Array([
  26, -45, 30, -4, -42, -4,
  18, -45, 22, -4, -42, -4,
  10, -44, 12, -6, -40, -8,
  2, -40, 6, -6, -34, -10,
  -10, -38, 2, 2, -30, -8,
  -14, -36, -10, 2, -24, -6,
  -6, -34, -20, 2, -18, -4,
  8, -32, -18, 0, -10, -6,
  12, -28, -6, 0, 0, -6,
  6, -22, 2, -2, 4, -8,
  0, -14, -2, -2, 4, -8,
  -2, -6, -6, 20, -30, 20,
  2, -2, -8, 40, -44, 34,
  10, -10, -2, 48, -44, 34,
  22, -26, 10, 48, -44, 34,
  34, -38, 22, 48, -42, 34,
]);

// ---------------------------------------------------------------- [WORLD] SLOT 1: the primitives of the terrain
// (The openings in the roof are SKYLIGHTS, at the top of shaders.js, because the shaders read them too.)
// pillars: rock standing on the floor: ax, az, bx, bz (a segment), radius, top, overhang at the top, waist.
// A top above CAN (-22) joins the roof: these are the columns that hold it up. Kept clear of the openings.
const PILLARS = [
  [30, 4, 34, 10, 5, -14, 3, 1.5], [-26, 12, -22, 20, 6, -14, 3.5, 2], [14, 52, 22, 56, 5, -14, 3, 1.5],
  [-52, -26, -48, -18, 6, -14, 3, 2], [58, -8, 64, -2, 5, -14, 3, 1.5], [10, -44, 16, -40, 5, -14, 3, 1.5],
  [-16, 62, -10, 66, 5, -14, 3, 2], [70, 64, 76, 70, 6, -14, 3.5, 2], [-80, 30, -74, 36, 6, -14, 3, 2],
  // two that stop short of the roof: stumps
  [-6, 34, -2, 38, 4, -36, 1.5, 1], [40, -24, 44, -20, 4, -33, 2, 1],
];
// arches: a ring of rock standing in the ground: x, y, z, yaw, ring radius, thickness, height stretch. None here.
const ARCHES = [];
// tunnels: a capsule carved out of the rock: ax, ay, az, radius, bx, by, bz. None here.
const TUNNELS = [];
// clearings: regions kept free of floor terraces (round the viewpoints and along the camera path):
// ax, az, bx, bz (a segment), radius, softness
const CLEARS = [
  [26, 30, 0, -6, 15, 8], [20, 16, 48, 34, 13, 8], [-28, -34, 0, -6, 13, 8], [-56, 52, -44, 38, 13, 8], [-44, 38, -8, 6, 12, 8],
];
// [ENGINE] packs the tables for W_DENS: two vec4 per pillar / arch / tunnel / clearing, then one per skylight
function densInput() {
  const a = [];
  for (const m of PILLARS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
  for (const m of ARCHES) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], 0);
  for (const m of TUNNELS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], m[6], 0);
  for (const m of CLEARS) a.push(m[0], m[1], m[2], m[3], m[4], m[5], 0, 0);
  for (const m of SKYLIGHTS) a.push(m[0], m[1], m[2], m[3]);
  a.push(0, 0, 0, 0); // never empty: a zero-sized buffer cannot be bound
  return { prims: new Float32Array(a), counts: [PILLARS.length, ARCHES.length, TUNNELS.length, CLEARS.length, SKYLIGHTS.length, 0, 0, 0] };
}

// ---------------------------------------------------------------- [ENGINE] terrain mesh from the density grid
function buildTerrain(D) {
  const sn = surfaceNets(D, NX, NY, NZ), nv = sn.nv, gp = sn.pos;
  const smp = sampler3(D, NX, NY, NZ);
  const vb = new ArrayBuffer(nv * 16), vf = new Float32Array(vb), v8 = new Int8Array(vb);
  const wp = new Float32Array(nv * 3), wn = new Float32Array(nv * 3);
  for (let k = 0; k < nv; k++) {
    const x = gp[k * 3], y = gp[k * 3 + 1], z = gp[k * 3 + 2], e = 0.8;
    let nx = smp(x - e, y, z) - smp(x + e, y, z), ny = smp(x, y - e, z) - smp(x, y + e, z), nz = smp(x, y, z - e) - smp(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const X = OX + x * VS, Y = OY + y * VS, Z = OZ + z * VS;
    wp[k * 3] = vf[k * 4] = X; wp[k * 3 + 1] = vf[k * 4 + 1] = Y; wp[k * 3 + 2] = vf[k * 4 + 2] = Z;
    wn[k * 3] = nx; wn[k * 3 + 1] = ny; wn[k * 3 + 2] = nz;
    v8[k * 16 + 12] = round(nx * 127); v8[k * 16 + 13] = round(ny * 127); v8[k * 16 + 14] = round(nz * 127); v8[k * 16 + 15] = 127;
  }
  // bucket quads into the XZ culling grid
  const nq = sn.ni / 6, key = new Uint8Array(nq), cnt = new Uint32Array(CELLS * CELLS + 1);
  const lo = new Float32Array(CELLS * CELLS).fill(1e9), hi = new Float32Array(CELLS * CELLS).fill(-1e9);
  for (let q = 0; q < nq; q++) {
    const a = sn.idx[q * 6] * 3;
    const c = clamp(floor((wp[a] - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((wp[a + 2] - OZ) / CELLW), 0, CELLS - 1);
    key[q] = c; cnt[c + 1]++;
    for (let j = 0; j < 6; j++) { const y = wp[sn.idx[q * 6 + j] * 3 + 1]; if (y < lo[c]) lo[c] = y; if (y > hi[c]) hi[c] = y; }
  }
  for (let c = 0; c < CELLS * CELLS; c++) cnt[c + 1] += cnt[c];
  const ib = new Uint32Array(sn.ni), fill = cnt.slice();
  for (let q = 0; q < nq; q++) { const o = fill[key[q]]++ * 6; for (let j = 0; j < 6; j++) ib[o + j] = sn.idx[q * 6 + j]; }
  return { vb, ib, nv, wp, wn, smp, start: cnt, lo, hi };
}

// ---------------------------------------------------------------- surface queries + the volumes the shaders read
function makeWorld(D, T, flyPts) {
  const gi = (x, y, z) => x + NX * (y + NY * z);

  // --- [ENGINE] height of the lowest ground under (x, z), for the preset viewpoints
  const gy = (x, z) => {
    const ix = clamp(round((x - OX) / VS), 1, NX - 2), iz = clamp(round((z - OZ) / VS), 1, NZ - 2);
    let y = FLOOR;
    for (let k = NY - 2; k >= 0; k--) {
      const d = D[gi(ix, k, iz)], da = D[gi(ix, k + 1, iz)];
      if (da <= 0 && d > 0) y = OY + (k + d / (d - da)) * VS; // air over rock: a floor. The last one found is the lowest
    }
    return y;
  };

  // --- [ENGINE] ambient volume at half resolution (binding 7, tV): r = openness of the rock around a point,
  // g = skylight reaching it. The skylight is let in at the top of the grid and carried down layer by layer,
  // spreading sideways a little each layer and stopped by rock: open sky gives 1 everywhere, a roof gives light
  // only under its openings.
  const hx = NX / 2, hy = NY / 2, hz = NZ / 2;
  const volD = new Uint8Array(hx * hy * hz * 2);
  let Lp = new Float32Array(hx * hz).fill(1), Ln = new Float32Array(hx * hz); const tmp = new Float32Array(hx * hz);
  for (let y = hy - 1; y >= 0; y--) {
    for (let z = 0; z < hz; z++) for (let x = 0; x < hx; x++) { const i = x + hx * z; tmp[i] = (Lp[x > 0 ? i - 1 : i] + 2 * Lp[i] + Lp[x < hx - 1 ? i + 1 : i]) * 0.25; }
    for (let z = 0; z < hz; z++) for (let x = 0; x < hx; x++) {
      const i = x + hx * z, g0 = gi(x * 2, y * 2, z * 2), o = x + hx * (y + hy * z);
      const d = (D[g0] + D[g0 + 1] + D[g0 + NX] + D[g0 + NX + 1] + D[g0 + NX * NY] + D[g0 + NX * NY + 1] + D[g0 + NX * NY + NX] + D[g0 + NX * NY + NX + 1]) * 0.125;
      volD[o * 2] = clamp(0.5 - d / 12, 0, 1) * 255;
      const b = (tmp[z > 0 ? i - hx : i] + 2 * tmp[i] + tmp[z < hz - 1 ? i + hx : i]) * 0.25;
      Ln[i] = b * clamp(0.5 - d / 1.5, 0, 1);
      volD[o * 2 + 1] = min(1, b) * 255;
    }
    const t = Lp; Lp = Ln; Ln = t;
  }

  // --- [WORLD] SLOT 3: the ground map (binding 8, tM), GM x GM texels over the 384 m world. What the channels mean
  // is this world's choice; the material block of W_SOLID is the only reader.
  //   r  where daylight lands on the floor: moss and fern grow there (see sunAt)
  //   a  damp hollows
  //   g, b  free
  const gm = new Uint8Array(GM * GM * 4);
  for (let j = 0; j < GM; j++) for (let i = 0; i < GM; i++) {
    const x = (i + 0.5) / GM * 384 - 192, z = (j + 0.5) / GM * 384 - 192, o = (i + GM * j) * 4;
    gm[o] = clamp(sunAt(x, z) * (0.55 + 0.9 * fbm(x * 0.09, 7, z * 0.09, 3)), 0, 1) * 255;
    gm[o + 3] = sstep(0.5, 0.66, fbm(x * 0.04, 3, z * 0.04, 3)) * 255;
  }

  return { gy, volD, gm, props: buildProps(), solids: scatterProps(T, flyPts) };
}

// ---------------------------------------------------------------- [WORLD] SLOT 3: where the daylight lands
const GM = 512;        // the ground map is GM x GM texels (main.js creates the texture at this size)
const SUN_SOFT = 7;    // metres over which growth thins out round a pool of light
// 0 .. 1: how much of the day's sun reaches the floor at (x, z). The sun ray from the floor is followed up to the
// ceiling plane and tested against every opening -- the same construction as cuv() in the shaders, so the green
// lies where the light does. The pools are widened by SUN_SOFT, because the sun moves and the shader's does not.
function sunAt(x, z) {
  const k = (CAN - FLOOR) / SUN_DIR[1], qx = x + SUN_DIR[0] * k, qz = z + SUN_DIR[2] * k;
  let s = 0;
  for (let i = 0; i < SKYLIGHTS.length; i++) { const h = SKYLIGHTS[i]; s = max(s, sstep(h[2] + SUN_SOFT, h[2] - 2, hypot(qx - h[0], qz - h[1]))); } // no for-of: expose() calls this every frame
  return s;
}

// true within reach of an opening in the roof (its radius and 9 m more)
const underHole = (x, z) => SKYLIGHTS.some((h) => hypot(x - h[0], z - h[1]) < h[2] + 9);

// ---------------------------------------------------------------- [WORLD] SLOT 4: the vertical columns
// [ENGINE] one shared vertex/index buffer; `parts` indexes into it (i0 = first index, v0 = base vertex, n = index count)
function mergeMeshes(ms) {
  let nv = 0, ni = 0;
  for (const m of ms) { nv += m.nv; ni += m.ib.length; }
  const vb = new Uint8Array(nv * 16), ib = new Uint32Array(ni), parts = [];
  let vo = 0, io = 0;
  for (const m of ms) {
    vb.set(new Uint8Array(m.vb), vo * 16); ib.set(m.ib, io);
    parts.push({ i0: io, v0: vo, n: m.ib.length });
    vo += m.nv; io += m.ib.length;
  }
  return { vb, ib, parts };
}
// The meshes, built once at unit size and scaled per instance. Mesh (math.js) makes tubes, box sweeps and spheres.
// Part 0: a stalagmite, standing. Part 1: a stalactite, hanging (the same taper, built point down).
// Part 2: a column, floor to roof, waisted in the middle.
const MITE_H = 3.2, TITE_H = 2.6, COLUMN_H = 30;
function buildProps() {
  rseed(41);
  const taper = (h, r0, dir, sides) => {
    const m = new Mesh(), pts = [], N = 7, lx = rr(-0.25, 0.25), lz = rr(-0.25, 0.25); // one lean for the whole length
    for (let k = 0; k <= N; k++) { const t = k / N; pts.push([lx * t * t, dir * (-0.5 + t * (h + 0.5)), lz * t * t]); }
    m.tube(pts, (k) => r0 * (pow(1 - k / N, 1.25) * (1 + 0.16 * sin(k * 2.3)) + 0.03), sides, true);
    return m.build();
  };
  const column = new Mesh();
  {
    const pts = [], N = 10;
    for (let k = 0; k <= N; k++) { const t = k / N; pts.push([rr(-0.2, 0.2), -1.5 + t * COLUMN_H, rr(-0.2, 0.2)]); }
    column.tube(pts, (k) => { const t = k / N; return 0.55 + 1.5 * pow(abs(t - 0.45) * 2, 2.2) + 0.12 * sin(k * 1.9); }, 7, true);
  }
  return mergeMeshes([taper(MITE_H, 0.55, 1, 6), taper(TITE_H, 0.4, -1, 6), column.build()]);
}
// Populations: how many (at High; Medium and Low keep 1/2 and 1/4), how far they are drawn (m, scaled by the
// draw-distance lever `det`), the smallest and largest scale.
//   up > 0: placed on ground that faces up at least that much.  up < 0: on rock that faces down at least that much.
const POPS = [
  { part: 0, n: 2600, far: 95, s0: 0.35, s1: 1.5, up: 0.6 },    // stalagmites
  { part: 1, n: 5200, far: 95, s0: 0.35, s1: 1.8, up: -0.6 },   // stalactites
  { part: 2, n: 46, far: 150, s0: 0.85, s1: 1.25, up: 0.8 },    // columns
];
const CLEAR_R = 4;     // metres kept free of standing props round the camera path and the viewpoints
// [ENGINE] sorts one population's instances (12 floats each) by XZ culling cell and records, per cell, where its run
// starts and the heights it spans: what drawCells() in main.js needs to cull and draw it in merged runs
function cellSort(inst, h0, h1) {
  const n = inst.length / 12, key = new Uint16Array(n), start = new Uint32Array(CELLS * CELLS + 1);
  const lo = new Float32Array(CELLS * CELLS).fill(1e9), hi = new Float32Array(CELLS * CELLS).fill(-1e9);
  for (let i = 0; i < n; i++) {
    const c = clamp(floor((inst[i * 12] - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((inst[i * 12 + 2] - OZ) / CELLW), 0, CELLS - 1);
    key[i] = c; start[c + 1]++;
    const y = inst[i * 12 + 1], s = inst[i * 12 + 3];
    lo[c] = min(lo[c], y + h0 * s); hi[c] = max(hi[c], y + h1 * s);
  }
  for (let c = 0; c < CELLS * CELLS; c++) start[c + 1] += start[c];
  const data = new Float32Array(n * 12), fill = start.slice();
  for (let i = 0; i < n; i++) data.set(inst.subarray(i * 12, i * 12 + 12), fill[key[i]]++ * 12);
  return { data, start, lo, hi };
}
// Places every population on the terrain mesh by picking random vertices of it and keeping those that suit.
// Returns one instance stream (12 floats each: position + scale | quaternion | material, seed, fade distance, bob)
// and, per population, its slice of it and its culling cells.
function scatterProps(T, flyPts) {
  rseed(57);
  const all = [], pops = [];
  let base = 0;
  const clear = (x, z) => {
    for (const p of flyPts) { const dx = x - p[0], dz = z - p[2]; if (dx * dx + dz * dz < CLEAR_R * CLEAR_R) return false; }
    return true;
  };
  for (const P of POPS) {
    const n = (P.n / THIN) | 0, inst = [];
    for (let tries = 0, placed = 0; tries < n * 60 && placed < n; tries++) {
      const k = ((rnd() * T.nv) | 0) * 3, x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
      if (hypot(x, z) > 158 || (P.up > 0 ? ny < P.up : ny > P.up)) continue;
      // standing props: on the cavern floor only, off the camera path, and not in the pools of light (the mounds
      // stay bare rubble). Hanging ones: on the underside of the roof only, not in the throat of an opening.
      if (P.up > 0 ? (y > FLOOR + 14 || !clear(x, z) || sunAt(x, z) > 0.5) : (y < CAN - 8 || y > CAN + 6)) continue;
      // columns: on the low floor only, and never under an opening, where there is no roof for one to reach
      if (P.part === 2 && (y > FLOOR + 3 || underHole(x, z))) continue;
      const s = P.s0 + (P.s1 - P.s0) * pow(rnd(), 2.2); // many small, few large
      const q = qMul(qAxis(0, 1, 0, rr(0, TAU)), qAxis(1, 0, 0, rr(-0.07, 0.07)));
      inst.push(x, y, z, s, q[0], q[1], q[2], q[3], 1, rnd(), P.far, 0);
      placed++;
    }
    const h = P.part === 0 ? [-0.5, MITE_H] : P.part === 1 ? [-TITE_H, 0.5] : [-1.5, COLUMN_H];
    const cs = cellSort(new Float32Array(inst), h[0], h[1]);
    for (let i = 0; i < cs.data.length; i++) all.push(cs.data[i]);
    pops.push({ part: P.part, base, count: cs.data.length / 12, far: P.far, start: cs.start, lo: cs.lo, hi: cs.hi });
    base += cs.data.length / 12;
  }
  return { data: new Float32Array(all), pops };
}
