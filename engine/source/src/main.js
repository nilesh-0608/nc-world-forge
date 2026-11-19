// ============================================================================
// nc-world-forge engine
// Derived from Abyssal Garden by Maksymilian Dendura (MIT licence), https://github.com/Noniv/abyssal-garden
// ============================================================================
// Renderer, camera and input.                                      SEAM FILE 3 of 3 (with shaders.js and world.js)
// ============================================================================
// Most of this file is engine and a new world leaves it alone. The parts a new world DOES edit are fenced:
//
//     // >>>> SEAM A ... // <<<< SEAM A     pipelines of the world's own populations
//     // >>>> SEAM B ... // <<<< SEAM B     their buffers, and what goes into the one-time shadow bake
//     // >>>> SEAM C ... // <<<< SEAM C     their draw calls in the scene pass, in order
//
// Adding a population (a new kind of prop, particle or creature) means: its WGSL in shaders.js, its data in world.js
// if it has any, one pipeline in SEAM A, its buffers in SEAM B if it has any, one draw in SEAM C. Nothing else in
// this file names a population. What the rest reads from the world is data, by name, declared in world.js:
// LOADING, POSES, FLY, CAM_YMIN / CAM_YMAX / CAM_RMAX, expose(), RAYS, GM, SUN_DIR (shaders.js), KEY (quality.js).
//
// Rules of this file:
//   - One shared scope: a throw anywhere at the top level stops the page. Anything optional goes in try / catch.
//   - frame() and render() allocate nothing of their own on the JS heap: no arrays, no objects, no closures, no
//     for-of, no destructuring, no template strings. What is left is what WebGPU itself hands back each frame (the
//     command encoder, the pass encoders, the canvas texture view, the command buffer, one mapAsync promise), the
//     stats line twice a second while it is shown, and the saved settings string when a lever moves. Per-frame
//     floats live in the typed array F.
//   - Every population must answer to the draw-distance lever `det` (see "adaptive resolution" below), or the
//     controller spends its time turning a lever that is connected to nothing.

// ---------------------------------------------------------------- [ENGINE] page, preflight, device
const $ = (id) => document.getElementById(id);
const canvas = $('c'), info = $('i'), body = document.body;
// a phone held upright gets the page turned on its side (see template.html)
const rot = matchMedia('(orientation:portrait) and (pointer:coarse)');
// loading bar: each stage glides it to `to` (the share done) over ~`ms` on the compositor, so it moves while this
// thread is busy
let loaded = 0, dead; // dead: the graphics device was lost
const say = (m, to, ms) => {
  if (!dead) $('s').textContent = m;
  const a = $('b').animate({ transform: [`scaleX(${loaded})`, `scaleX(${to})`] }, { duration: ms, fill: 'forwards', easing: 'cubic-bezier(.3,.5,.5,1)' });
  loaded = to;
  // go on once the animation runs: one not started before the thread gets busy stays stuck (timer: hidden tabs)
  return new Promise((r) => { a.ready.then(() => setTimeout(r)); setTimeout(r, document.hidden ? 0 : 1e3); });
};
const fail = (m) => { throw new Error(m, { cause: 1 }); }; // cause marks a message that is shown as it is
// WebGPU preflight. Each way of not having a GPU gets a plain sentence saying what to do about it. The commonest on
// a machine that can run this is the second: WebGPU is there, but the browser's hardware acceleration is off, so no
// adapter is offered.
const ACCEL = ' In Chrome or Edge, open Settings, search for "acceleration", switch on "Use graphics acceleration when available" and relaunch the browser. The page chrome://gpu shows whether WebGPU is then hardware accelerated.';
if (!navigator.gpu) fail('This page draws with WebGPU, and this browser does not offer it. Open it in a current Chrome or Edge on a computer.' + ACCEL);
let adapter = null;
try { adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); } catch (e) { console.warn(e); }
if (!adapter) fail('This browser has WebGPU but offered no graphics adapter. That is what happens when hardware acceleration is switched off, or the graphics driver is blocked.' + ACCEL);
$('w').hidden = !!navigator.userAgentData; // only Chromium-based browsers have it
// a software adapter (what some browsers hand out when hardware acceleration is off) runs, at about a frame a second:
// say so on the loading line instead of leaving a slideshow unexplained
try { if (adapter.isFallbackAdapter || (adapter.info && adapter.info.isFallbackAdapter)) { $('w').textContent = 'Software rendering: this will be very slow. Switch on hardware acceleration in the browser settings and relaunch.'; $('w').hidden = false; } } catch {}
const hasTS = adapter.features.has('timestamp-query');
let device = null;
try { device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] }); } catch (e) { console.warn(e); }
if (!device) fail('The graphics adapter was found but would not start. Close other tabs that use the GPU and reload.' + ACCEL);
device.addEventListener('uncapturederror', (e) => console.error('GPU: ' + e.error.message));
// out of memory or a GPU timeout: reload a level lower, or on Low say what happened
device.lost.then((l) => {
  if (l.reason === 'destroyed') return; // the page is closing
  if (LV < 2) { keep(KEY, LV + 1); location.reload(); }
  dead = body.className = 'l e'; $('s').textContent = 'The graphics device was lost. Reload the page to try again.';
});
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
const Q = device.queue, HDR = 'rgba16float', DEPTH = 'depth32float';
const TU = GPUTextureUsage, BU = GPUBufferUsage, SS = GPUShaderStage;

const mod = (code) => device.createShaderModule({ code });
const buf = (data, usage) => { const b = device.createBuffer({ size: max(4, (data.byteLength + 3) & ~3), usage: usage | BU.COPY_DST }); Q.writeBuffer(b, 0, data.buffer || data, data.byteOffset || 0, data.byteLength); return b; };
const tex = (w, h, format, usage, o = {}) => device.createTexture({ size: [w, h, o.d || 1], format, usage, mipLevelCount: o.mips || 1, sampleCount: o.samples || 1, dimension: o.d ? '3d' : '2d' });

// ---------------------------------------------------------------- [ENGINE] static resources
const sRep = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: LV > 1 ? 1 : 8 });
const sClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const sCmp = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
const tShadow = tex(SHADOW, SHADOW, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tDummy = tex(1, 1, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tMask = tex(MASK, MASK, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 5 });           // W_MASK, every frame
const tDetail = tex(1024, 1024, 'rgba8unorm', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 11 }); // W_DETAIL, once
const tVol = tex(NX / 2, NY / 2, 'rg8unorm', TU.TEXTURE_BINDING | TU.COPY_DST, { d: NZ / 2 });       // makeWorld().volD
const tMap = tex(GM, GM, 'rgba8unorm', TU.TEXTURE_BINDING | TU.COPY_DST);                             // makeWorld().gm

// the frame uniform (struct G in shaders.js): UB for the scene, UBS for the shadow bake
const UB = new Float32Array(60), UBS = new Float32Array(60);
const ubo = device.createBuffer({ size: 240, usage: BU.UNIFORM | BU.COPY_DST }), uboS = device.createBuffer({ size: 240, usage: BU.UNIFORM | BU.COPY_DST });
const WT = new Float32Array(4), uboW = device.createBuffer({ size: 16, usage: BU.UNIFORM | BU.COPY_DST });

// the scene bind group: the nine bindings listed above S_B in shaders.js
const VF = SS.VERTEX | SS.FRAGMENT;
const bgl0 = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: VF, buffer: {} },
  { binding: 1, visibility: VF, sampler: {} }, { binding: 2, visibility: VF, sampler: {} }, { binding: 3, visibility: VF, sampler: { type: 'comparison' } },
  { binding: 4, visibility: VF, texture: { sampleType: 'depth' } },
  { binding: 5, visibility: VF, texture: {} }, { binding: 6, visibility: VF, texture: {} },
  { binding: 7, visibility: VF, texture: { viewDimension: '3d' } }, { binding: 8, visibility: VF, texture: {} }] });
const mkBG0 = (u, sh) => device.createBindGroup({ layout: bgl0, entries: [
  { binding: 0, resource: { buffer: u } }, { binding: 1, resource: sRep }, { binding: 2, resource: sClamp }, { binding: 3, resource: sCmp },
  { binding: 4, resource: sh.createView() }, { binding: 5, resource: tMask.createView() }, { binding: 6, resource: tDetail.createView() },
  { binding: 7, resource: tVol.createView() }, { binding: 8, resource: tMap.createView() }] });
const bg0 = mkBG0(ubo, tShadow), bg0s = mkBG0(uboS, tDummy);
const pl0 = device.createPipelineLayout({ bindGroupLayouts: [bgl0] });

const bglBlit = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: {} }, { binding: 1, visibility: SS.FRAGMENT, sampler: {} }] });
const plBlit = device.createPipelineLayout({ bindGroupLayouts: [bglBlit] });
const mBlit = mod(W_BLIT);
const blitPipe = (entry, format, add) => device.createRenderPipeline({ layout: plBlit, vertex: { module: mBlit, entryPoint: 'vs' },
  fragment: { module: mBlit, entryPoint: entry, targets: [{ format, blend: add ? { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } : undefined }] } });
const pMip8 = blitPipe('fsMip', 'rgba8unorm'), pMip16 = blitPipe('fsMip', HDR), pDown0 = blitPipe('fsDown0', HDR), pDown = blitPipe('fsDown', HDR), pUp = blitPipe('fsUp', HDR, true);
const blitBG = (view) => device.createBindGroup({ layout: bglBlit, entries: [{ binding: 0, resource: view }, { binding: 1, resource: sClamp }] });
const colorAtt = (view, clear) => ({ view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] });

// vertex layouts of solid meshes: 16 bytes per vertex (position, normal + ao), 48 per instance (see W_SOLID)
const A = (shaderLocation, offset, format) => ({ shaderLocation, offset, format });
const vbSolid = { arrayStride: 16, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'snorm8x4')] };
const ibSolid = { arrayStride: 48, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4'), A(4, 32, 'float32x4')] };

// A pipeline that draws into the scene pass: HDR colour, reversed depth, the scene bind group.
//   o.strip   triangle strip instead of list        o.cull   'back' | 'front' | 'none' (default)
//   o.blend   ADD or OVER below: blended pipelines test depth but do not write it
const scenePipe = (m, vsE, fsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers },
  fragment: { module: m, entryPoint: fsE, targets: [{ format: HDR, blend: o.blend }] },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: !o.blend, depthCompare: 'greater' }, multisample: { count: AA } });
// the same geometry into the shadow map
const shadowPipe = (m, vsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 1.5 } });
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
// ordinary alpha blending, premultiplied: what is drawn with it covers what is behind it
const OVER = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };

await say(LOADING[0], 0.05, 300);
const mSolid = mod(W_SOLID), mSurf = mod(W_SURF);
const pTerrain = scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid], { cull: 'back' });
const pBack = scenePipe(mSurf, 'vsB', 'fsB', [], { strip: true });
const pTerrSh = shadowPipe(mSolid, 'vs', [vbSolid, ibSolid], { cull: 'front' });

// >>>> SEAM A: pipelines of the world's populations ----------------------------------------------------------------
// One line each. Instanced props that are plain rock need none: they are drawn with pTerrain (see SEAM C).
// MOTEN / SCHOOLN / SOARN: how many at full draw distance, by detail level (THIN is 1 / 2 / 4, from quality.js).
const MOTEN = (9000 / THIN) | 0, SCHOOLN = (360 / THIN) | 0, SOARN = 5;
const mLife = mod(W_LIFE);
const pMote = scenePipe(mod(W_MOTE), 'vs', 'fs', [], { strip: true, blend: ADD });   // SLOT 5
const pSchool = scenePipe(mLife, 'vsSchool', 'fs', [], { strip: true });              // SLOT 6
const pSoar = scenePipe(mLife, 'vsSoar', 'fs', [], { strip: true });                  // SLOT 7
// <<<< SEAM A --------------------------------------------------------------------------------------------------------

// [ENGINE] the animated mask (SLOT 3), the light shafts (SLOT 2) and the composite. Their bind group layouts are
// 'auto': they hold exactly the bindings the shader uses (rule 3 at the top of shaders.js).
const mMask = mod(W_MASK);
const pMask = device.createRenderPipeline({ layout: 'auto', vertex: { module: mMask, entryPoint: 'vs' }, fragment: { module: mMask, entryPoint: 'fs', targets: [{ format: HDR }] } });
const bgMask = device.createBindGroup({ layout: pMask.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uboW } }] });
const maskViews = [0, 1, 2, 3, 4].map((m) => tMask.createView({ baseMipLevel: m, mipLevelCount: 1 }));
const maskBG = maskViews.map((v) => blitBG(v));
const maskPass = maskViews.map((v) => ({ colorAttachments: [colorAtt(v, true)] }));
const fsPipe = (m, format) => device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format }] } });
const pRays = fsPipe(mod(W_RAYS), HDR), pRB = fsPipe(mod(W_RBLUR), HDR), pPost = fsPipe(mod(W_POST), FMT);

// ---------------------------------------------------------------- [ENGINE] sun + shadow matrix
const SUN = (() => { const l = hypot(...SUN_DIR); return SUN_DIR.map((c) => c / l); })();
{
  const L = SUN, lr = [L[1], -L[0], 0], ll = hypot(...lr); lr[0] /= ll; lr[1] /= ll;
  const lu = [L[1] * lr[2] - L[2] * lr[1], L[2] * lr[0] - L[0] * lr[2], L[0] * lr[1] - L[1] * lr[0]];
  const R = 225, d0 = -175, d1 = 125, m = UBS;
  m[0] = lr[0] / R; m[4] = lr[1] / R; m[8] = lr[2] / R; m[12] = 0;
  m[1] = lu[0] / R; m[5] = lu[1] / R; m[9] = lu[2] / R; m[13] = 0;
  m[2] = -L[0] / (d1 - d0); m[6] = -L[1] / (d1 - d0); m[10] = -L[2] / (d1 - d0); m[14] = d1 / (d1 - d0);
  m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
  for (let i = 0; i < 16; i++) { UBS[16 + i] = m[i]; UB[16 + i] = m[i]; }
  for (let i = 0; i < 3; i++) { UB[48 + i] = UBS[48 + i] = SUN[i]; }
  UBS[32] = 0; UBS[33] = -20; UBS[34] = 0; UBS[35] = 0; UBS[58] = 1;
  Q.writeBuffer(uboS, 0, UBS);
}

// ---------------------------------------------------------------- [ENGINE] world generation
await say(LOADING[1], 0.25, 1200);
// marks a load in progress (quality.js); leaving the page before it ends is not a crash
keep(KEY + 'Load', 1);
addEventListener('pagehide', () => keep(KEY + 'Load', ''));
let D;
{
  // dens() in shaders.js, run once over the whole grid on the GPU and read back
  const di = densInput();
  const m = mod(W_DENS), p = device.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: 'main' } });
  const size = NX * NY * NZ * 4;
  const u = new ArrayBuffer(64), uu = new Uint32Array(u), uf = new Float32Array(u);
  uu[0] = NX; uu[1] = NY; uu[2] = NZ; uf[4] = OX; uf[5] = OY; uf[6] = OZ; uf[7] = VS;
  for (let i = 0; i < 8; i++) uu[8 + i] = di.counts[i];
  const bu = buf(new Uint8Array(u), BU.UNIFORM), bp = buf(di.prims, BU.STORAGE);
  const bd = device.createBuffer({ size, usage: BU.STORAGE | BU.COPY_SRC }), br = device.createBuffer({ size, usage: BU.MAP_READ | BU.COPY_DST });
  const bg = device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: bu } }, { binding: 1, resource: { buffer: bd } }, { binding: 2, resource: { buffer: bp } }] });
  const e = device.createCommandEncoder(), c = e.beginComputePass();
  c.setPipeline(p); c.setBindGroup(0, bg); c.dispatchWorkgroups(NX / 4, NY / 4, NZ / 4); c.end();
  e.copyBufferToBuffer(bd, 0, br, 0, size);
  Q.submit([e.finish()]);
  await br.mapAsync(GPUMapMode.READ);
  D = new Float32Array(br.getMappedRange().slice(0));
  br.unmap(); br.destroy(); bd.destroy();
  // Anchored rock: each column's unbroken run of rock up from the bottom of the grid, and its unbroken run down
  // from the top (a roof), are anchored. Rock between two gaps (overhangs, bulges, specks) is anchored when it
  // touches rock that is. What never connects is a speck of noise floating in mid-air (surface nets would make
  // it a small box), so it is turned back into empty space.
  const S = NX * NY, R = new Uint8Array(D.length), O = [1, -1, NX, -NX, S, -S], b = new Uint8Array(NX), L = [];
  for (let z = 0; z < NZ; z++) {
    const z0 = z * S;
    b.fill(1); for (let y = 0; y < NY; y++) for (let x = 0, i = z0 + y * NX; x < NX; x++, i++) if (D[i] <= 0) b[x] = 0; else if (b[x]) R[i] = 1;
    b.fill(1); for (let y = NY - 1; y >= 0; y--) for (let x = 0, i = z0 + y * NX; x < NX; x++, i++) if (D[i] <= 0) b[x] = 0; else if (b[x]) R[i] = 1;
    for (let i = z0; i < z0 + S; i++) if (D[i] > 0 && !R[i]) L.push(i);
  }
  for (let k = 1; k; L.reverse()) { k = 0; for (const i of L) if (!R[i] && O.some((o) => R[i + o])) R[i] = k = 1; }
  for (const i of L) if (!R[i]) D[i] = -D[i];
}
// Distance to the rock for collide(), in 1/127 m (> 0 in rock, clamped to +-1 m), kept only in the 4x4x4-voxel
// bricks near a surface within the camera's reach. CI per brick: 0 all empty, 1 all rock, n = brick n-2 in CG.
// CAPB bricks at most (64 bytes each); a world with more surface than that gets its last bricks as plain rock or air.
const CO = 52, CN = 102, CAPB = 2e5, CI = new Uint32Array(CN * CN * NY / 4);
let CG = new Int8Array(64 * CAPB), nBrick = 0;
{
  let n = 0;
  for (let bz = 0; bz < CN; bz++) for (let by = 1; by < NY / 4 - 1; by++) for (let bx = 0; bx < CN; bx++) {
    if (hypot(bx - CN / 2 + 0.5, bz - CN / 2 + 0.5) > 52) continue; // more than 156 m out: never reached
    let lo = 127, hi = -127;
    for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const i = CO + bx * 4 + x + NX * (by * 4 + y + NY * (CO + bz * 4 + z)), gz = D[i + NX * NY] - D[i - NX * NY];
      const gx = D[i + 1] - D[i - 1], g = D[i + NX] - D[i - NX], l = sqrt(gx * gx + g * g + gz * gz) / 1.5;
      const q = round(clamp(D[i] / max(l, 0.05), -1, 1) * 127);
      CG[n * 64 + x + 4 * y + 16 * z] = q; if (q < lo) lo = q; if (q > hi) hi = q;
    }
    CI[bx + CN * (by + NY / 4 * bz)] = (lo === hi && lo * lo === 16129) || n >= CAPB - 1 ? +(lo + hi > 0) : (n++, n + 1);
  }
  CG = CG.slice(0, n * 64); nBrick = n;
}
await say(LOADING[2], 0.32, 400);
const T = buildTerrain(D);

// ---------------------------------------------------------------- [ENGINE] camera state, viewpoints, the scripted path
// POSES (keys 1-6) and FLY (the 60 s path dev.js flies) are world data: see world.js.
const FLYN = FLY.length / 6, FLYT = 60, LUTN = 1024, flyLUT = new Float32Array(LUTN + 1);
const flyPts = [];
// per-frame float state lives in one preallocated array, so the frame loop allocates no heap numbers
const F = new Float64Array(32), P6 = new Float64Array(6);
const CX = 0, CY = 1, CZ = 2, YAW = 3, PIT = 4, FX = 5, FY = 6, FZ = 7, RX = 8, RZ = 9, UX = 10, UY = 11, UZ = 12, VX = 13, VY = 14, VZ = 15, TIME = 16, FLT = 17, LAST = 18, GPU = 19, HUDT = 20, SPL = 21, MX = 22, MY = 23, MZ = 24, NGT = 25, NGTT = 26;
// day / night (N key): F[NGTT] is the choice (0 day, 1 night), F[NGT] follows it linearly over NFADE seconds and render()
// eases it into the uniform. localStorage[KEY + 'Night'] keeps the choice, so a reload starts in it without a fade.
const NFADE = 2;
try { F[NGT] = F[NGTT] = localStorage[KEY + 'Night'] === '1' ? 1 : 0; } catch {}
// aim the camera from P6 = position + look-at point
function aim() {
  const dx = P6[3] - P6[0], dy = P6[4] - P6[1], dz = P6[5] - P6[2];
  F[CX] = P6[0]; F[CY] = P6[1]; F[CZ] = P6[2];
  F[YAW] = atan2(dx, -dz); F[PIT] = atan2(dy, sqrt(dx * dx + dz * dz));
}
const lookAt = (x, y, z, tx, ty, tz) => { P6[0] = x; P6[1] = y; P6[2] = z; P6[3] = tx; P6[4] = ty; P6[5] = tz; aim(); };
const pose = (i) => { const p = POSES[i]; lookAt(p[0], p[1], p[2], p[3], p[4], p[5]); };
// camera spline (Catmull-Rom over position + look-at) at parameter F[SPL]
function flyRaw() {
  const s = F[SPL]; let i = floor(s) | 0; if (i > FLYN - 2) i = FLYN - 2;
  const u = s - i, i0 = (i > 0 ? i - 1 : 0) * 6, i1 = i * 6, i2 = (i + 1) * 6, i3 = (i + 2 < FLYN ? i + 2 : FLYN - 1) * 6;
  for (let o = 0; o < 6; o++) {
    const a = FLY[i0 + o], b = FLY[i1 + o], c = FLY[i2 + o], d = FLY[i3 + o];
    P6[o] = 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
  }
  aim();
}
{ // arc-length table: flyLUT[k] = spline parameter at fraction k/LUTN of the total path length
  const M = 4096, len = new Float32Array(M + 1); let px = 0, py = 0, pz = 0;
  for (let k = 0; k <= M; k++) { F[SPL] = k / M * (FLYN - 1); flyRaw(); if (k) len[k] = len[k - 1] + hypot(F[CX] - px, F[CY] - py, F[CZ] - pz); px = F[CX]; py = F[CY]; pz = F[CZ]; }
  for (let k = 0, j = 0; k <= LUTN; k++) { const d = k / LUTN * len[M]; while (j < M - 1 && len[j + 1] < d) j++; flyLUT[k] = (j + (d - len[j]) / max(len[j + 1] - len[j], 1e-6)) / M * (FLYN - 1); }
}
// camera on the scripted path at time F[FLT]
function flyAt() {
  let s = F[FLT] / FLYT; s = s < 0 ? 0 : s > 1 ? 1 : s; s = s * s * (3 - 2 * s) * 0.25 + s * 0.75;
  s *= LUTN; let k = floor(s) | 0; if (k > LUTN - 1) k = LUTN - 1;
  F[SPL] = flyLUT[k] + (flyLUT[k + 1] - flyLUT[k]) * (s - k); flyRaw();
}
// the points the world generator keeps clear of standing props: the path and the viewpoints
for (let t = 0; t <= FLYT; t += 0.1) { F[FLT] = t; flyAt(); flyPts.push([F[CX], F[CY], F[CZ]]); }
for (const p of POSES) flyPts.push([p[0], 0, p[2]]);

await say(LOADING[3], 0.73, 2500);
const Wd = makeWorld(D, T, flyPts);
// viewpoint heights are given above the ground: stand them on it, under the camera's ceiling
for (const p of POSES) p[1] = min(p[1] + Wd.gy(p[0], p[2]), CAM_YMAX);
D = Wd.gy = T.smp = null; // with D goes the generator's working memory (about 200 MB)

await say(LOADING[4], 0.94, 1200);
const vbTerrain = buf(new Uint8Array(T.vb), BU.VERTEX), ibTerrain = buf(T.ib, BU.INDEX);
// The solid instance stream: every prop instance, then one identity instance, which is what the terrain is drawn
// with (the terrain goes through the same pipeline as the props).
const nSolid = Wd.solids.data.length / 12;
const solidData = new Float32Array((nSolid + 1) * 12); solidData.set(Wd.solids.data); solidData.set([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0], nSolid * 12);
const ibSolids = buf(solidData, BU.VERTEX);
Q.writeTexture({ texture: tVol }, Wd.volD, { bytesPerRow: NX, rowsPerImage: NY / 2 }, [NX / 2, NY / 2, NZ / 2]);
Q.writeTexture({ texture: tMap }, Wd.gm, { bytesPerRow: GM * 4 }, [GM, GM]);

// >>>> SEAM B: buffers of the world's populations, and the one-time shadow bake ------------------------------------
// The props share one vertex/index buffer; PROPD has one entry per population (world.js POPS): the slice of the mesh
// buffer it draws (i0, v0, n), its slice of the instance stream (base, count), its culling cells (start, lo, hi)
// and its draw distance (far).
const vbProps = buf(Wd.props.vb, BU.VERTEX), ibProps = buf(Wd.props.ib, BU.INDEX);
const PROPD = Wd.solids.pops.map((d) => ({ ...Wd.props.parts[d.part], base: d.base, count: d.count, far: d.far, start: d.start, lo: d.lo, hi: d.hi }));
// Everything that casts a shadow is drawn once into the shadow map, from the sun. Called from the bake below with
// the pass `r`, the shadow uniform already bound. Whatever is not drawn here casts no shadow.
function bakeShadows(r) {
  r.setPipeline(pTerrSh); r.setVertexBuffer(1, ibSolids);
  r.setVertexBuffer(0, vbTerrain); r.setIndexBuffer(ibTerrain, 'uint32');
  r.drawIndexed(T.ib.length, 1, 0, 0, nSolid);
  r.setVertexBuffer(0, vbProps); r.setIndexBuffer(ibProps, 'uint32');
  for (const d of PROPD) if (d.count) r.drawIndexed(d.n, d.count, d.i0, d.v0, d.base);
}
// <<<< SEAM B --------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------- [ENGINE] one-time bakes: detail texture, shadow map
{
  const m = mod(W_DETAIL), p = device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  const e = device.createCommandEncoder();
  let r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: 0, mipLevelCount: 1 }), true)] });
  r.setPipeline(p); r.draw(3); r.end();
  for (let i = 1; i < 11; i++) {
    r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: i, mipLevelCount: 1 }), true)] });
    r.setPipeline(pMip8); r.setBindGroup(0, blitBG(tDetail.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }))); r.draw(3); r.end();
  }
  r = e.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: tShadow.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
  r.setBindGroup(0, bg0s);
  bakeShadows(r);
  r.end();
  Q.submit([e.finish()]);
}
// the GPU has its own copies now: let go of the generator's
Wd.volD = Wd.gm = Wd.props = Wd.solids = T.vb = T.ib = T.wp = T.wn = 0;

// ---------------------------------------------------------------- [ENGINE] render targets (rebuilt on resize)
// ADAPTIVE RESOLUTION. Two levers hold 60 fps, and frame() turns them:
//   pix   the number of pixels the scene is drawn at (then scaled up to the window)
//   det   the draw-distance scale, 1 .. DETMIN. It reaches the scene in three ways, and every population must be
//         on at least one of them:
//           - drawCells() culls a prop population beyond far * det
//           - the uniform g.mis.z: props shrink to nothing over the last 30% of that distance (vs in W_SOLID)
//           - procedural populations draw count * det * det instances (SEAM C)
//         The terrain alone ignores it: the haze hides its far edge, and holes in the ground are worse than a slow frame.
// Both start where the last visit left them.
const PIXMAX = 2560 * 1440, PIXMIN = mob ? 25e4 : 5e5, DETMIN = 0.4;
let W = 0, H = 0, DW = 0, DH = 0, pix = +SV[1] || (LV > 1 ? 41e4 : mob ? 1280 * 720 : PIXMAX), det = +SV[2] || 1, dynN = 0, dynT = 0, dynG = 0, dynGN = 0, dynBad = 0, dynOk = 0, dynWait = 3;
let passScene, passRays, passBlur, bgBlur, bgRays, passPost, bgPost, bloomPass = [], bloomBG = [], targets = [];
const NB = 6;
function resize() {
  DW = max(2, round(canvas.clientWidth * devicePixelRatio)); DH = max(2, round(canvas.clientHeight * devicePixelRatio));
  const s = min(1, sqrt(pix / (DW * DH)));
  const w = max(2, round(DW * s) & ~1), h = max(2, round(DH * s) & ~1);
  if (w === W && h === H) return;
  dynN = dynG = dynGN = 0; dynT = -300; // let the new size settle before measuring again
  W = w; H = h; canvas.width = W; canvas.height = H;
  ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
  for (const t of targets) t.destroy();
  const tMS = tex(AA > 1 ? W : 1, H, HDR, TU.RENDER_ATTACHMENT, { samples: AA }), tDp = tex(W, H, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { samples: AA });
  const tRes = tex(W, H, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay = tex(W / 2, H / 2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay2 = tex(W / 2, H / 2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
  targets = [tMS, tDp, tRes, tRay, tRay2];
  const bl = [];
  for (let i = 0; i < NB; i++) { const t = tex(max(1, W >> (i + 1)), max(1, H >> (i + 1)), HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING); bl.push(t); targets.push(t); }
  const vDp = tDp.createView(), vRes = tRes.createView(), vRay = tRay.createView(), vRay2 = tRay2.createView(), vBl = bl.map((t) => t.createView());
  // without anti-aliasing (Low) the scene goes straight into the resolve target, and tMS is one unused column
  passScene = { colorAttachments: [{ view: AA > 1 ? tMS.createView() : vRes, resolveTarget: AA > 1 ? vRes : undefined, loadOp: 'clear', storeOp: AA > 1 ? 'discard' : 'store', clearValue: [0, 0, 0, 1] }],
    depthStencilAttachment: { view: vDp, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } };
  passRays = { colorAttachments: [colorAtt(vRay, true)] };
  passBlur = { colorAttachments: [colorAtt(vRay2, true)] };
  bgBlur = device.createBindGroup({ layout: pRB.getBindGroupLayout(0), entries: [{ binding: 0, resource: vRay }] });
  bgRays = device.createBindGroup({ layout: pRays.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sRep }, { binding: 2, resource: sCmp },
    { binding: 3, resource: tShadow.createView() }, { binding: 4, resource: tMask.createView() }, { binding: 5, resource: vDp }, { binding: 6, resource: tVol.createView() }, { binding: 7, resource: sClamp }] });
  passPost = { colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
  bgPost = device.createBindGroup({ layout: pPost.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sClamp }, { binding: 2, resource: vRes },
    { binding: 3, resource: vRay2 }, { binding: 4, resource: vBl[0] }, { binding: 5, resource: vDp }] });
  bloomPass = []; bloomBG = [];
  // down: res -> b0 -> ... -> b5 ; up: b5 -> b4 (additive) ... -> b0
  for (let i = 0; i < NB; i++) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i], true)] }); bloomBG.push(blitBG(i ? vBl[i - 1] : vRes)); }
  for (let i = NB - 1; i > 0; i--) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i - 1], false)] }); bloomBG.push(blitBG(vBl[i])); }
  UB[52] = W; UB[53] = H; UB[54] = 1 / W; UB[55] = 1 / H;
}
resize();
addEventListener('resize', resize);

// ---------------------------------------------------------------- [ENGINE] timing (GPU timestamp queries)
let qs, qResolve, qRead = [], tsBegin, tsEnd;
if (hasTS) {
  qs = device.createQuerySet({ type: 'timestamp', count: 2 });
  qResolve = device.createBuffer({ size: 16, usage: BU.QUERY_RESOLVE | BU.COPY_SRC });
  for (let i = 0; i < 6; i++) {
    const b = device.createBuffer({ size: 16, usage: BU.MAP_READ | BU.COPY_DST });
    const o = { b, busy: false, done: null };
    o.done = () => {
      const a = new BigInt64Array(b.getMappedRange());
      const ms = Number(a[1] - a[0]) / 1e6; F[GPU] = ms; b.unmap(); o.busy = false;
      if (dynT > 0 && ms > 0 && ms < 1e3) { dynG += ms; dynGN++; }
    };
    qRead.push(o);
  }
  tsBegin = { querySet: qs, beginningOfPassWriteIndex: 0 }; tsEnd = { querySet: qs, endOfPassWriteIndex: 1 };
}

// ---------------------------------------------------------------- [ENGINE] frame
let hud = false;
let kf = 0, kb = 0, kl = 0, kr = 0, ku = 0, kd = 0, ks = 0, mdx = 0, mdy = 0, lkx = 0, lky = 0, l2x = 0, l2y = 0, hN = 0, hMax = 0, hMin = 1e9, hPer = 1e9, hLate = 0, hTot = 0, tId = -1, tN = 0, tx0 = 0, ty0 = 0, tx = 0, ty = 0;
// nInst: instances submitted by the last frame's SEAM C (props that passed the culling + procedural ones). Shown in
// the stats line (H), next to det: turn det down and this number must fall.
let nInst = 0;
const TANH = 0.6, NEAR = 0.1;
const submitList = [null];
const rowOrd = new Uint8Array(CELLS);
// Draws the cells of a cell-sorted buffer that are in view and within [minD, maxD) as merged runs, nearest rows first.
//   part = null   the terrain: `start` counts quads; maxD is NOT scaled by det
//   part = {n, i0, v0}   an instanced mesh: `start` counts instances from `base` in the solid instance stream;
//                        minD and maxD ARE scaled by det
// lo / hi: the heights each cell spans; mar: how far its contents reach beyond the cell.
function drawCells(r, start, lo, hi, mar, part, base, minD, maxD) {
  const cx = F[CX], cy = F[CY], cz = F[CZ], fx = F[FX], fy = F[FY], fz = F[FZ], rx = F[RX], rz = F[RZ], ux = F[UX], uy = F[UY], uz = F[UZ];
  const ds = part ? det * det : 1;
  const tx = TANH * W / H, hw = CELLW * 0.5, ex = hw + mar, min2 = minD * minD * ds, max2 = maxD * maxD * ds;
  for (let k = 0; k < CELLS; k++) {
    const rw = rowOrd[k], row = rw * CELLS, pz = OZ + (rw + 0.5) * CELLW - cz, hz = max(abs(pz) - hw, 0);
    let run = -1;
    for (let x = 0; x <= CELLS; x++) {
      const c = row + x; let v = false;
      if (x < CELLS) {
        const l = lo[c], h = hi[c];
        if (l <= h) {
          const px = OX + (x + 0.5) * CELLW - cx, py = (l + h) * 0.5 - cy, ey = (h - l) * 0.5 + mar, hx = max(abs(px) - hw, 0), h2 = hx * hx + hz * hz;
          if (h2 < max2 && h2 >= min2) {
            const lim = px * fx + py * fy + pz * fz + ex * abs(fx) + ey * abs(fy) + ex * abs(fz);
            if (lim >= 0 && abs(px * rx + pz * rz) - ex * (abs(rx) + abs(rz)) <= lim * tx) v = abs(px * ux + py * uy + pz * uz) - ex * (abs(ux) + abs(uz)) - ey * abs(uy) <= lim * TANH;
          }
        }
      }
      if (v) { if (run < 0) run = c; } else if (run >= 0) {
        const a = start[run], n = start[c] - a;
        if (n > 0) { if (part) { r.drawIndexed(part.n, n, part.i0, part.v0, base + a); nInst += n; } else r.drawIndexed(n * 6, 1, a * 6, 0, nSolid); }
        run = -1;
      }
    }
  }
}
function render() {
  // camera basis (right vector is horizontal)
  const cx = F[CX], cy = F[CY], cz = F[CZ], pitch = F[PIT], yaw = F[YAW];
  const cp = cos(pitch), fy = sin(pitch), rx = cos(yaw), rz = sin(yaw), fx = cp * rz, fz = -cp * rx;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  F[FX] = fx; F[FY] = fy; F[FZ] = fz; F[RX] = rx; F[RZ] = rz; F[UX] = ux; F[UY] = uy; F[UZ] = uz;
  // the frame uniform (struct G in shaders.js)
  const asp = W / H, sx = 1 / (TANH * asp), sy = 1 / TANH, m = UB;
  m[0] = rx * sx; m[4] = 0; m[8] = rz * sx; m[12] = -(rx * cx + rz * cz) * sx;
  m[1] = ux * sy; m[5] = uy * sy; m[9] = uz * sy; m[13] = -(ux * cx + uy * cy + uz * cz) * sy;
  m[2] = 0; m[6] = 0; m[10] = 0; m[14] = NEAR;
  m[3] = fx; m[7] = fy; m[11] = fz; m[15] = -(fx * cx + fy * cy + fz * cz);
  m[32] = cx; m[33] = cy; m[34] = cz; m[35] = F[TIME];
  m[36] = rx; m[37] = 0; m[38] = rz; m[39] = TANH * asp;
  m[40] = ux; m[41] = uy; m[42] = uz; m[43] = TANH;
  m[44] = fx; m[45] = fy; m[46] = fz; m[47] = NEAR;
  // night (mis.w, smoothstepped), and the exposure, which the world decides from where the camera is (expose() in world.js)
  const nl = F[NGT], ng = nl * nl * (3 - 2 * nl);
  m[56] = expose(cx, cy, cz, ng); m[57] = RAYS; m[58] = det; m[59] = ng;
  Q.writeBuffer(ubo, 0, UB);
  WT[0] = F[TIME]; Q.writeBuffer(uboW, 0, WT);

  { let cr = floor((cz - OZ) / CELLW) | 0; cr = cr < 0 ? 0 : cr > CELLS - 1 ? CELLS - 1 : cr; let n = 0; rowOrd[n++] = cr; for (let d = 1; d < CELLS; d++) { if (cr - d >= 0) rowOrd[n++] = cr - d; if (cr + d < CELLS) rowOrd[n++] = cr + d; } }
  const e = device.createCommandEncoder();
  let slot = null;
  if (hasTS) { for (let i = 0; i < qRead.length; i++) if (!qRead[i].busy) { slot = qRead[i]; break; } }
  maskPass[0].timestampWrites = slot ? tsBegin : undefined;
  passPost.timestampWrites = slot ? tsEnd : undefined;
  // the animated mask + its mips
  let r = e.beginRenderPass(maskPass[0]); r.setPipeline(pMask); r.setBindGroup(0, bgMask); r.draw(3); r.end();
  for (let i = 1; i < 5; i++) { r = e.beginRenderPass(maskPass[i]); r.setPipeline(pMip16); r.setBindGroup(0, maskBG[i - 1]); r.draw(3); r.end(); }
  // scene
  r = e.beginRenderPass(passScene);
  r.setBindGroup(0, bg0);
  r.setPipeline(pTerrain); r.setVertexBuffer(0, vbTerrain); r.setVertexBuffer(1, ibSolids); r.setIndexBuffer(ibTerrain, 'uint32');
  drawCells(r, T.start, T.lo, T.hi, 1.5, null, 0, 0, 150); // the haze hides the ground well before this (FARD in shaders.js)

  // >>>> SEAM C: the world's draw calls, in this order: opaque things, the backdrop, then blended things ------------
  // `dq` is the draw-distance lever squared: multiply every procedural instance count by it.
  const dq = det * det; let n = 0;
  nInst = 0;
  // SLOT 4: the columns and the rest of the props: the terrain's pipeline (still set) and instance stream, culled by cell
  r.setVertexBuffer(0, vbProps); r.setIndexBuffer(ibProps, 'uint32');
  for (let k = 0; k < PROPD.length; k++) { const d = PROPD[k]; drawCells(r, d.start, d.lo, d.hi, 3, d, d.base, 0, d.far); }
  // SLOT 6: the school; SLOT 7: the soarers (too few to thin)
  n = (SCHOOLN * dq) | 0; if (n) { r.setPipeline(pSchool); r.draw(4, n); nInst += n; }
  r.setPipeline(pSoar); r.draw(4, SOARN); nInst += SOARN;
  // the backdrop: behind everything, opaque. Blended things must come after it
  r.setPipeline(pBack); r.draw(4);
  // SLOT 5: the motes: additive, last
  n = (MOTEN * dq) | 0; if (n) { r.setPipeline(pMote); r.draw(4, n); nInst += n; }
  // <<<< SEAM C ------------------------------------------------------------------------------------------------------
  r.end();
  // SLOT 2: light shafts at half resolution, then their blur
  r = e.beginRenderPass(passRays); r.setPipeline(pRays); r.setBindGroup(0, bgRays); r.draw(3); r.end();
  r = e.beginRenderPass(passBlur); r.setPipeline(pRB); r.setBindGroup(0, bgBlur); r.draw(3); r.end();
  // bloom
  for (let i = 0; i < bloomPass.length; i++) {
    r = e.beginRenderPass(bloomPass[i]); r.setPipeline(i === 0 ? pDown0 : i < NB ? pDown : pUp); r.setBindGroup(0, bloomBG[i]); r.draw(3); r.end();
  }
  // composite
  passPost.colorAttachments[0].view = ctx.getCurrentTexture().createView();
  r = e.beginRenderPass(passPost); r.setPipeline(pPost); r.setBindGroup(0, bgPost); r.draw(3); r.end();
  if (slot) { e.resolveQuerySet(qs, 0, 2, qResolve, 0); e.copyBufferToBuffer(qResolve, 0, slot.b, 0, 16); }
  submitList[0] = e.finish();
  Q.submit(submitList);
  if (slot) { slot.busy = true; slot.b.mapAsync(GPUMapMode.READ).then(slot.done); }
}

// ---------------------------------------------------------------- [ENGINE] collision
// CS[j] = distance to the rock (metres, < 0 in open air) at the camera + CE[3j..3j+2]: the camera, then +-0.375 m on
// each axis for the gradient
const CE = new Float64Array([0, 0, 0, .375, 0, 0, -.375, 0, 0, 0, .375, 0, 0, -.375, 0, 0, 0, .375, 0, 0, -.375]), CS = new Float64Array(7);
const cv = (x, y, z) => { const b = CI[(x >> 2) + CN * ((y >> 2) + NY / 4 * (z >> 2))]; return b > 1 ? CG[b * 64 - 128 + (x & 3) + 4 * (y & 3) + 16 * (z & 3)] : b * 254 - 127; };
function sd(j) {
  const x = (F[CX] + CE[j * 3] - OX) / VS - CO, y = (F[CY] + CE[j * 3 + 1] - OY) / VS, z = (F[CZ] + CE[j * 3 + 2] - OZ) / VS - CO;
  const ix = x | 0, iy = y | 0, iz = z | 0, u = x - ix, v = y - iy, a = cv(ix, iy, iz), b = cv(ix, iy + 1, iz), c = cv(ix, iy, iz + 1), d = cv(ix, iy + 1, iz + 1);
  const p = a + (cv(ix + 1, iy, iz) - a) * u, q = b + (cv(ix + 1, iy + 1, iz) - b) * u, r = c + (cv(ix + 1, iy, iz + 1) - c) * u, s = d + (cv(ix + 1, iy + 1, iz + 1) - d) * u;
  const e = p + (q - p) * v; CS[j] = (e + (r + (s - r) * v - e) * (z - iz)) / 127;
}
// Moves the camera by F[MX..MZ] in steps shorter than its radius CR (so it can't pass through thin rock), pushing it
// back out after each step and dropping velocity into the rock, so it slides along.
const CR = 0.5;
function collide() {
  const n = floor(sqrt(F[MX] * F[MX] + F[MY] * F[MY] + F[MZ] * F[MZ]) / 0.4) + 1;
  for (let i = 0; i < n; i++) {
    F[CX] += F[MX] / n; F[CY] += F[MY] / n; F[CZ] += F[MZ] / n;
    for (let k = 0; k < 2; k++) {
      sd(0); const s = CS[0] + CR; if (s <= 0) break;
      for (let j = 1; j < 7; j++) sd(j);
      let gx = CS[1] - CS[2], gy = CS[3] - CS[4], gz = CS[5] - CS[6]; const l = sqrt(gx * gx + gy * gy + gz * gz);
      if (l < 0.075) break; // flat: deep in rock
      gx /= l; gy /= l; gz /= l; const vn = F[VX] * gx + F[VY] * gy + F[VZ] * gz;
      F[CX] -= gx * s; F[CY] -= gy * s; F[CZ] -= gz * s;
      if (vn > 0) { F[VX] -= gx * vn; F[VY] -= gy * vn; F[VZ] -= gz * vn; }
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dtr = now - F[LAST]; F[LAST] = now;
  let dt = dtr / 1000; if (dt > 0.1) dt = 0.1;
  // Adaptive resolution for 60 fps: every second (0.4 s behind the menu) scale the load by k
  if (dtr < 1e3 && (dynT += dtr) > 0 && (dynN++, dynT > (menu ? 400 : 1000))) {
    const a = dynT / dynN, g = dynGN ? dynG / dynGN : 0; let k = 1;
    // with GPU timing: keep it between 9.8 and 13.6 ms
    if (g) { if (g > 13.6 || g < 9.8) k = 11.7 / g; }
    // without: slow for two periods in a row means fewer pixels, and twice as long before trying to go back up
    else if (a > 17.6) { dynOk = 0; if (++dynBad > 1) { k = 15 / a; dynBad = 0; dynWait = min(dynWait * 2, 60); } }
    // at the display's rate there is no telling if there is room, so try a little more now and then
    else { dynBad = 0; if (a < 12.5) k = 15 / a; else if (++dynOk > dynWait) { k = 1.17; dynOk = 0; } }
    k = k < 0.5 ? 0.5 : k > 1.7 ? 1.7 : k; const top = min(PIXMAX, DW * DH), mid = max(top / 2, PIXMIN), was = pix + det;
    // too slow: pixels down to `mid` first, then draw distance, then the remaining pixels; faster goes back the same way
    if (k < 1 ? pix > mid || det <= DETMIN : pix < mid || det >= 1) {
      const end = k < 1 ? (det > DETMIN ? mid : PIXMIN) : det < 1 ? mid : top;
      pix *= k; if (k < 1 ? pix < end : pix > end) pix = end;
    } else { det *= sqrt(k); det = det < DETMIN ? DETMIN : det > 1 ? 1 : det; }
    if (was !== pix + det) keep(KEY, LV + ',' + (pix < top ? pix | 0 : '') + ',' + det); // nothing kept at full resolution
    dynN = dynT = dynG = dynGN = 0; resize();
  }
  F[TIME] += dt;
  if (F[NGT] !== F[NGTT]) { const s = dt / NFADE; F[NGT] = F[NGT] < F[NGTT] ? min(F[NGT] + s, F[NGTT]) : max(F[NGT] - s, F[NGTT]); }
  {
    // touch: holding the finger away from where it went down keeps turning, like a joystick
    if (tId >= 0) {
      const tr = 4 / (innerWidth < innerHeight ? innerWidth : innerHeight); let jx = (tx - tx0) * tr, jy = (ty - ty0) * tr;
      jx = jx > 1 ? 1 : jx < -1 ? -1 : jx; jy = jy > 1 ? 1 : jy < -1 ? -1 : jy;
      lkx += jx * 1.5 * dt; lky += jy * dt;
    }
    // mouse look through two cascaded low-pass stages
    const kq = 1 - exp(-dt * 30); lkx += mdx * 0.0022; lky += mdy * 0.0022; mdx = 0; mdy = 0;
    const ax = lkx * kq, ay = lky * kq; lkx -= ax; lky -= ay; l2x += ax; l2y += ay;
    const dyw = l2x * kq, dpt = l2y * kq; l2x -= dyw; l2y -= dpt;
    const yaw = F[YAW] + dyw; let pitch = F[PIT] - dpt; pitch = pitch < -1.55 ? -1.55 : pitch > 1.55 ? 1.55 : pitch;
    const sp = ks || tN > 1 ? 26 : 7, k = 1 - exp(-dt * 4.5), mf = tId >= 0 ? 0.7 : kf - kb, mr = kr - kl, mu = ku - kd, cp = cos(pitch), sy = sin(yaw), cw = cos(yaw);
    const vx = F[VX] + ((sy * cp * mf + cw * mr) * sp - F[VX]) * k, vy = F[VY] + ((sin(pitch) * mf + mu) * sp - F[VY]) * k, vz = F[VZ] + ((-cw * cp * mf + sy * mr) * sp - F[VZ]) * k;
    let x = F[CX] + vx * dt, y = F[CY] + vy * dt, z = F[CZ] + vz * dt;
    // the world's limits (world.js): a radius, a floor and a ceiling
    const rad = sqrt(x * x + z * z); if (rad > CAM_RMAX) { x *= CAM_RMAX / rad; z *= CAM_RMAX / rad; }
    y = y < CAM_YMIN ? CAM_YMIN : y > CAM_YMAX ? CAM_YMAX : y;
    F[YAW] = yaw; F[PIT] = pitch; F[VX] = vx; F[VY] = vy; F[VZ] = vz; F[MX] = x - F[CX]; F[MY] = y - F[CY]; F[MZ] = z - F[CZ];
    collide();
  }
  render();
  if (hud) {
    hN++; if (dtr > hMax) hMax = dtr; if (dtr < hMin) hMin = dtr; if (dtr > hPer * 1.5) { hLate++; hTot++; }
    F[HUDT] += dtr / 1000;
    if (F[HUDT] > 0.5) { info.textContent = `${(hN / F[HUDT]).toFixed(0)} fps  ·  worst frame ${hMax.toFixed(1)} ms  ·  late frames ${hLate} (total ${hTot})  ·  GPU ${F[GPU].toFixed(2)} ms  ·  ${W}x${H} (${W * 100 / DW | 0}%)  ·  draw distance ${(det * 100).toFixed(0)}%  ·  ${nInst} instances`; F[HUDT] = 0; hPer = hMin; hN = 0; hMax = 0; hMin = 1e9; hLate = 0; }
  }
}

// ---------------------------------------------------------------- [ENGINE] input
const key = (e, v) => {
  switch (e.code) {
    case 'KeyW': kf = v; break; case 'KeyS': kb = v; break; case 'KeyA': kl = v; break; case 'KeyD': kr = v; break;
    case 'KeyE': ku = v; break; case 'KeyQ': kd = v; break; case 'ShiftLeft': case 'ShiftRight': ks = v; break;
    default: if (v && !e.repeat) {
      if (e.code === 'KeyH') { hud = !hud; hTot = 0; hPer = 1e9; info.textContent = ''; }
      else if (e.code === 'KeyM') mute();
      else if (e.code === 'KeyN') { F[NGTT] = F[NGTT] > 0.5 ? 0 : 1; keep(KEY + 'Night', F[NGTT]); }
      else if (e.code === 'Escape') ui(true);
      else if (e.code >= 'Digit1' && e.code <= 'Digit6') pose(e.code.charCodeAt(5) - 49);
    }
  }
};
// behind the menu only the stats and mute keys work
addEventListener('keydown', (e) => { if (menu && e.code !== 'KeyH' && e.code !== 'KeyM') return; sound(); key(e, 1); });
addEventListener('keyup', (e) => key(e, 0));
const release = () => { kf = kb = kl = kr = ku = kd = ks = 0; tId = -1; tN = 0; };
const capture = () => { sound(); const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => canvas.requestPointerLock()).catch(() => 0); };
canvas.addEventListener('click', capture);
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { mdx += e.movementX; mdy += e.movementY; } });
addEventListener('blur', release);
const touch = (e) => {
  e.preventDefault(); sound(); tN = e.touches.length;
  let f = null, first = false; for (let i = 0; i < tN; i++) if (e.touches[i].identifier === tId) f = e.touches[i];
  if (!f) { tId = -1; if (tN) { f = e.touches[0]; tId = f.identifier; first = true; } }
  if (f) {
    // the touch axes turn with the page when it lies on its side
    const x = rot.matches ? f.clientY : f.clientX, y = rot.matches ? -f.clientX : f.clientY, s = 1100 / min(innerWidth, innerHeight);
    if (first) { tx0 = x; ty0 = y; } else { mdx += (x - tx) * s; mdy += (y - ty) * s; } // the view follows the finger at once
    tx = x; ty = y;
  }
};
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) canvas.addEventListener(n, touch, { passive: false });

// ---------------------------------------------------------------- [ENGINE] menu
// The scene keeps rendering, unblurred, behind the panel. Esc, losing the mouse or the corner button open it.
let menu = true;
const bGo = $('d');
const ui = (m) => {
  if (dead) return;
  menu = m; body.className = m ? 'm' : document.pointerLockElement ? 'g p' : 'g';
  // focus the start button so Enter works (delayed: it can't take focus while still hidden)
  if (m) { release(); setTimeout(() => menu && bGo.focus(), 100); } else document.activeElement.blur();
};
const go = () => {
  sound(); ui(false); bGo.textContent = 'Resume';
  // phones: go fullscreen and ask for landscape; where that is refused the CSS rotation still applies
  if (mob) document.documentElement.requestFullscreen?.()?.then(() => screen.orientation.lock('landscape')).catch(() => 0);
  if (!mob) capture();
};
bGo.onclick = go; $('o').onclick = () => ui(true);
// detail buttons: the current level is lit, the others reload the page with theirs
$('q').querySelectorAll('button').forEach((b, i) => { if (i === 2 - LV) b.className = 'on'; else b.onclick = () => { keep(KEY, 2 - i); location.reload(); }; });
document.addEventListener('pointerlockchange', () => ui(!document.pointerLockElement));

// draw the first frame and wait for the GPU to finish it (pipelines get compiled on first use) before the reveal
pose(0);
await say(LOADING[5], 1, 400);
render(); await Q.onSubmittedWorkDone();
setTimeout(keep, 15e3, KEY + 'Load', ''); // the load counts as survived after 15 s of frames
ui(true);
requestAnimationFrame((t) => { F[LAST] = t; requestAnimationFrame(frame); });
