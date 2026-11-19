// ============================================================================
// nc-world-forge engine
// Derived from Abyssal Garden by Maksymilian Dendura (MIT licence), https://github.com/Noniv/abyssal-garden
// ============================================================================
// WGSL sources.                                                    SEAM FILE 1 of 3 (with world.js and main.js)
// ============================================================================
// How to read this file. Every block is tagged:
//   [ENGINE]  plumbing a new world keeps as it is (noise, blits, shadow lookups, the fog integral, the vertex stages)
//   [WORLD]   content: a new setting rewrites these. The numbered slots are the eight things a world is made of:
//     SLOT 1  the ceiling with holes      dens() in W_DENS  (+ SKYLIGHTS below, PILLARS in world.js)
//     SLOT 2  the light through it        W_RAYS            (+ SUN_DIR, SUNC_*, SHAFT_*, RAYK_* in S_G)
//     SLOT 3  the floor pattern it casts  W_MASK + caus() in S_B (+ the ground map baked in world.js)
//     SLOT 4  the vertical columns        the material block of W_SOLID (meshes and scatter are in world.js)
//     SLOT 5  the drifting motes          W_MOTE
//     SLOT 6  the schooling creature      vsSchool in W_LIFE
//     SLOT 7  the soaring creature        vsSoar in W_LIFE
//     SLOT 8  the haze profile            the palette at the top of S_G
//   The reference world that fills them here is a limestone cavern under a collapsed roof (REFERENCE-WORLD.md).
//
// Three rules of this file, each of which has broken a build before:
//   1. ORDER. The files are concatenated quality, math, shaders, world, main, audio into one scope, and a template
//      literal is evaluated where it stands. A JS constant interpolated into WGSL with ${...} must therefore be
//      declared ABOVE its use in this file (or in quality.js / math.js). One declared in world.js is a
//      "Cannot access before initialization" error that kills the whole page. That is why the layout constants the
//      shaders need (CAN, FLOOR, SUN_DIR, SKYLIGHTS) live here and not in world.js.
//   2. BRACKETS. The build's WGSL minifier removes the spaces round operators, so "a - -3." becomes "a--3." which
//      does not compile. Interpolate numbers only through wf() / wv2() / wv3(), which bracket them.
//   3. BINDINGS. W_RAYS, W_POST, W_MASK and W_RBLUR are compiled with layout 'auto', which drops any binding the
//      shader does not use; main.js then fails to build the bind group. Remove a use and you must remove the binding
//      in both files.

// ---------------------------------------------------------------- [WORLD] layout the shaders need
const CAN = -22;                       // the ceiling plane: nominal height of the underside of the roof (m)
const FLOOR = -48;                     // nominal height of the floor. The grid spans y = -56 .. +4.
const SUN_DIR = [0.27, 1, -0.24];      // towards the sun (normalised in main.js). Steeper = rounder pools, shorter shafts
// SLOT 1: openings in the roof: x, z, radius at the underside (m), height of the rubble mound under it (m).
// The first is the main collapse; the soaring creature circles in it and viewpoints 1, 4 and 5 are aimed at it.
const SKYLIGHTS = [
  [0, -6, 17, 7], [48, 34, 9, 3.5], [-44, 38, 11, 4], [-30, -62, 8, 3],
  [52, -48, 12, 5], [4, 78, 9, 3.5], [-84, -12, 10, 4], [92, 4, 8, 3],
];
const FLARE = 0.45;                    // how fast an opening widens with height: 0 = a vertical shaft

// [ENGINE] bracketed WGSL literals (rule 2 above)
const wf = (v) => '(' + (+v).toFixed(3) + ')';
const wv2 = (v) => `vec2f(${wf(v[0])}, ${wf(v[1])})`;
const wv3 = (v) => `vec3f(${wf(v[0])}, ${wf(v[1])}, ${wf(v[2])})`;

// ---------------------------------------------------------------- [ENGINE] noise
const W_NOISE = /*wgsl*/`
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn h31(p: vec3f) -> f32 { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn h33(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn vn(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3f(1., 0., 0.)), u.x), mix(h31(i + vec3f(0., 1., 0.)), h31(i + vec3f(1., 1., 0.)), u.x), u.y),
             mix(mix(h31(i + vec3f(0., 0., 1.)), h31(i + vec3f(1., 0., 1.)), u.x), mix(h31(i + vec3f(0., 1., 1.)), h31(i + vec3f(1., 1., 1.)), u.x), u.y), u.z);
}
fn fbm(p: vec3f, n: i32) -> f32 {
  var a = .5; var s = 0.; var q = p;
  for (var i = 0; i < n; i++) { s += a * vn(q); q = q * 2.03 + vec3f(17.1, 31.7, 5.3); a *= .5; }
  return s / (1. - 2. * a);
}
fn wor(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); var d = 9.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let o = vec3f(f32(x), f32(y), f32(z)); let r = o + h33(i + o) - f; d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
`;

// ---------------------------------------------------------------- terrain density (compute)
// Run once at load over the whole 512 x 80 x 512 grid (0.75 m voxels). dens() > 0 is rock. The surface-nets mesh, the
// collision bricks, the ambient volume and the shadow map are all made from what it returns: this one function is
// the shape of the world.
// The primitive buffer P and the counts in u.c / u.e come from densInput() in world.js:
//   u.c.x pillars (2 vec4 each)   u.c.y arches (2)   u.c.z tunnels (2)   u.c.w clearings (2)   u.e.x skylights (1)
const W_DENS = W_NOISE + /*wgsl*/`
struct U { n: vec4u, o: vec4f, c: vec4u, e: vec4u };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> D: array<f32>;
@group(0) @binding(2) var<storage, read> P: array<vec4f>;
// [ENGINE] smooth max / min and distances to a segment
fn smax(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.) / k; return max(a, b) + h * h * k * .25; }
fn smin(a: f32, b: f32, k: f32) -> f32 { return -smax(-a, -b, k); }
fn seg2(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
fn seg3(p: vec3f, a: vec3f, b: vec3f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0., 1.); return length(pa - ba * h); }
// ---- [WORLD] SLOT 1: the shape of the world. Everything worth tuning is here
const CAN = ${wf(CAN)};
const FLOOR = ${wf(FLOOR)};
const FLARE = ${wf(FLARE)};
const ROOF_AMP = 9.;                         // the underside of the roof rolls by this much (m, peak to peak)
const WALL_R0 = 150.;                        // the wall that closes the world starts rising here (m from the centre)
const WALL_R1 = 166.;                        // ... and has met the roof by here
fn dens(p: vec3f) -> f32 {
  let w = vec3f(fbm(p * .04 + 11., 3), fbm(p * .04 + 47., 3), fbm(p * .04 + 83., 3)) - .5;
  let q = p + w * vec3f(15., 6., 15.);
  // the floor: gentle rises and hollows, and a mound of fallen rock under every opening
  var g0 = FLOOR + 5. * (fbm(vec3f(q.xz * .011, 3.), 4) - .5) + 1.4 * (fbm(vec3f(q.xz * .07, 9.), 3) - .5);
  var hole = 1e3;                            // > 0 in the roof, < 0 inside an opening
  let ks = (u.c.x + u.c.y + u.c.z + u.c.w) * 2u;
  for (var i = 0u; i < u.e.x; i++) {
    let a = P[ks + i];
    let dd = length(p.xz + w.xz * 9. - a.xy);
    g0 += a.w * exp(-dd * dd / (a.z * a.z * .6));
    hole = min(hole, dd - a.z - FLARE * max(p.y - CAN, 0.));
  }
  let tn = 3. * (fbm(vec3f(q.xz * .09, 2.), 3) - .5);
  // pillars: rock standing on the floor up to its "top"; one whose top is above CAN joins the roof
  var dm = -1e3; var de = 1e3;
  var k = 0u;
  for (var i = 0u; i < u.c.x; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    let yr = clamp((p.y - g0) / (b.y - g0), 0., 1.3);
    var e = seg2(q.xz, a.xy, a.zw) - b.x;
    e -= b.z * ss(.3, .92, yr) + 3. * (1. - yr) * (1. - yr) - b.w * ss(.0, .5, yr) * (1. - ss(.5, 1., yr));
    dm = smax(dm, smin(-e, b.y + tn - p.y, 3.), 2.5);
    de = min(de, e);
  }
  var clr = 0.;
  let kc = (u.c.x + u.c.y + u.c.z) * 2u;
  for (var i = 0u; i < u.c.w; i++) {
    let a = P[kc + i * 2u]; let b = P[kc + i * 2u + 1u];
    clr = max(clr, 1. - ss(0., b.y, seg2(q.xz, a.xy, a.zw) - b.x));
  }
  let rad = length(p.xz) + w.x * 14.;
  let n = fbm(vec3f(q.xz * .0125, 1.7), 4);
  let ring = ss(WALL_R0, WALL_R1, rad);
  // low terraces on the floor where the noise allows and no clearing forbids; the ring wall closes the world
  let plat = max(ss(.5, .565, n) * (1. - clr), ring);
  let th = g0 + plat * mix(3. + 7. * fbm(vec3f(q.xz * .03, 5.), 2), 60., ring);
  var d = smax(g0 + 2.5 * ss(10., 0., de) - p.y, dm, 3.);
  d = smax(d, (th - p.y) * .7, 3.);
  // the roof: rock above a rolling underside, cut away inside the openings. A world with an open sky deletes these
  // two lines and returns min(d, top - p.y) at the end instead, so that nothing solid reaches the top of the grid.
  let ry = CAN + ROOF_AMP * (fbm(vec3f(q.xz * .021, 4.), 3) - .5);
  d = smax(d, smin(p.y - ry, hole, 4.), 4.);
  // arches: a torus of rock standing in the ground
  k = u.c.x * 2u;
  for (var i = 0u; i < u.c.y; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    var r = p + w * 3. - a.xyz;
    let cs = cos(a.w); let sn = sin(a.w);
    r = vec3f(cs * r.x + sn * r.z, r.y / b.z, -sn * r.x + cs * r.z);
    d = smax(d, b.y - length(vec2f(length(r.xy) - b.x, r.z)), 1.5);
  }
  // rock detail: smooth silt on the floor, craggy bedded limestone on everything that stands or hangs
  let hg = p.y - g0;
  let rk = mix(.1, 1., ss(.8, 6., hg));
  d += rk * ((.5 - wor(p * .17 + w * 2.)) * 3.4 + (.5 - wor(p * .41 + 7.)) * 1.3 + (fbm(p * .3, 3) - .5) * 2.2);
  d += rk * 2.2 * (abs(fract(p.y * .21 + w.y * 2.2) - .5) - .25);
  // tunnels: capsules carved out of whatever is there
  for (var i = 0u; i < u.c.z; i++) {
    let a = P[k]; let b = P[k + 1u]; k += 2u;
    d = smin(d, seg3(p + w * 2., a.xyz, b.xyz) - a.w, 2.);
  }
  return d;
}
// [ENGINE] the four sides of the grid are forced empty; the top is not, so a roof may run out of the top of the grid
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= u.n.xyz)) { return; }
  var d = dens(u.o.xyz + vec3f(id) * u.o.w);
  if (id.x == 0u || id.z == 0u || id.x == u.n.x - 1u || id.z == u.n.z - 1u) { d = -1.; }
  D[id.x + u.n.x * (id.y + u.n.y * id.z)] = d;
}
`;

// ---------------------------------------------------------------- [ENGINE] fullscreen helpers
const W_FS = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0., 1.); }
`;

// [ENGINE] tileable noise (period `per` cells): value noise, fbm, worley
const W_PER = /*wgsl*/`
fn hp(p: vec2f, per: f32) -> f32 { return h31(vec3f(p - per * floor(p / per), per)); }
fn tn(p: vec2f, per: f32) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(hp(i, per), hp(i + vec2f(1., 0.), per), u.x), mix(hp(i + vec2f(0., 1.), per), hp(i + vec2f(1., 1.), per), u.x), u.y);
}
fn tf(uv: vec2f, per: f32, n: i32) -> f32 { var a = .5; var s = 0.; var pr = per; for (var i = 0; i < n; i++) { s += a * tn(uv * pr + f32(i) * 7.3, pr); pr *= 2.; a *= .5; } return s / (1. - 2. * a); }
fn tw(p: vec2f, per: f32) -> vec3f {
  let i = floor(p); let f = fract(p); var d = vec2f(9.); var id = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) {
    let o = vec2f(f32(x), f32(y)); let c = i + o; let cw = c - per * floor(c / per);
    let hh = h33(vec3f(cw, per)); let r = o + hh.xy - f; let l = dot(r, r);
    if (l < d.x) { d.y = d.x; d.x = l; id = hh.z; } else if (l < d.y) { d.y = l; }
  } }
  return vec3f(sqrt(d), id);
}
`;
// [WORLD] the surface detail texture, baked once (1024 x 1024, tileable): rg = slope, b = height, a = mottling.
// Every solid surface is textured from it, three ways (tri() in W_SOLID). H() is the relief: cracks, ridges and pits.
const W_DETAIL = W_NOISE + W_FS + W_PER + /*wgsl*/`
fn H(uv: vec2f) -> f32 {
  let wq = uv + .11 * (vec2f(tf(uv, 3., 4), tf(uv + .5, 3., 4)) - .5);
  let f = tf(wq, 3., 8);
  let r1 = 1. - abs(tf(wq + 1.7, 5., 6) * 2. - 1.);
  let cr = min(abs(tf(wq + 4.1, 4., 5) * 2. - 1.) * 7., 1.);
  let cr2 = min(abs(tf(wq.yx + 2.3, 9., 4) * 2. - 1.) * 9., 1.);
  let pt = tw(wq * 29., 29.);
  let pit = (1. - ss(.0, .34, pt.x)) * step(.62, pt.z);
  return f * .50 + r1 * r1 * .24 + cr * cr2 * .26 - pit * .07;
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / 1024.; let e = 1. / 1024.;
  let h = H(uv);
  let gx = H(uv + vec2f(e, 0.)) - H(uv - vec2f(e, 0.)); let gy = H(uv + vec2f(0., e)) - H(uv - vec2f(0., e));
  let s = clamp(vec2f(gx, gy) * 1024. * .5 * .075, vec2f(-1.), vec2f(1.));
  return vec4f(-s * .5 + .5, h, tf(uv + 3.7, 3., 5));
}
`;

// ---------------------------------------------------------------- [ENGINE] blit / mip / bloom chain
const W_BLIT = W_FS + /*wgsl*/`
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
fn uvOf(fc: vec4f, k: f32) -> vec2f { return fc.xy * k / vec2f(textureDimensions(t)); }
@fragment fn fsMip(@builtin(position) fc: vec4f) -> @location(0) vec4f { return textureSampleLevel(t, s, uvOf(fc, 2.), 0.); }
fn kar(c: vec3f) -> vec4f { let w = 1. / (1. + max(c.r, max(c.g, c.b))); return vec4f(c * w, w); }
@fragment fn fsDown0(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  let a = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.).rgb, vec3f(24.)));
  let b = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.).rgb, vec3f(24.)));
  let c = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.).rgb, vec3f(24.)));
  let d = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.).rgb, vec3f(24.)));
  let m = a + b + c + d;
  return vec4f(m.rgb / m.a, 1.);
}
@fragment fn fsDown(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
@fragment fn fsUp(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, .5); let e = .75 / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
`;

// ---------------------------------------------------------------- [WORLD] SLOT 3: the animated mask
// A tileable texture redrawn every frame (binding 5, tW): r = how much light gets through (0 .. 1), g = spare noise.
// It lies on the ceiling plane and is looked up ALONG THE SUN (cuv() in S_B), so the pattern on the floor, the
// streaks in the shafts and the motes that light up all come from the same place and line up.
// Here: the gaps between roots and creepers hanging in the openings, swaying a little.
const W_MASK = W_NOISE + W_FS + W_PER + /*wgsl*/`
@group(0) @binding(0) var<uniform> tm: vec4f;
const MK_SWAY = .004;                        // how far the whole pattern sways (share of a tile)
const MK_LO = .40;                           // noise level below which no light passes
const MK_HI = .62;                           // ... and above which all of it does
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let u0 = fc.xy / ${MASK}.; let t = tm.x;
  // whole periods of sin / cos, so the texture still tiles
  let uv = u0 + MK_SWAY * vec2f(sin(t * .5 + u0.y * 12.566371), cos(t * .4 + u0.x * 18.849556));
  let wq = uv + .05 * (vec2f(tf(uv, 4., 3), tf(uv + .5, 4., 3)) - .5);
  let w = tw(wq * 9., 9.);
  let gap = ss(MK_LO, MK_HI, tf(wq, 6., 4) * .7 + w.x * .5);
  return vec4f(gap, tf(uv + 2.3, 8., 4), 0., 1.);
}
`;

// ---------------------------------------------------------------- shared scene code
// The frame uniform G (240 bytes, written by render() in main.js):
//   vp   view-projection           sm   world -> shadow map
//   cam  xyz eye, w time (s)       right / up / fwd  camera basis; w = tan(half fov) * aspect, tan(half fov), near
//   sun  xyz towards the sun       res  xy render size (0 in the shadow pass), zw its reciprocal
//   mis  x exposure, y shaft gain, z draw-distance scale `det` (1 .. 0.4), w night (0 day .. 1 night)
const S_G = /*wgsl*/`
struct G { vp: mat4x4f, sm: mat4x4f, cam: vec4f, right: vec4f, up: vec4f, fwd: vec4f, sun: vec4f, res: vec4f, mis: vec4f };
// ---- [WORLD] SLOT 8: palette + haze profile. Everything worth tuning is here
const CAN = ${wf(CAN)};                      // the ceiling plane (see the top of the file)
const FLR = ${wf(FLOOR)};                    // the haze is densest here
const HZ0 = .016;                            // haze extinction per metre at the floor
const HZB = .045;                            // how fast the haze thins with height (1/m)
const FARD = 150.;                           // geometry fades into the haze by here (m)
// every light has a day (_D) and a night (_N) value; g.mis.w (0 day .. 1 night, eased in main.js) blends them, so the
// N key changes colours and intensities only: the sun direction, the shadow map and the world stay as they are
const HAZE_LO_D = vec3f(.050, .062, .070);   // haze on the floor: cold damp air
const HAZE_LO_N = vec3f(.008, .012, .020);
const HAZE_MID_D = vec3f(.075, .090, .095);  // haze under the ceiling
const HAZE_MID_N = vec3f(.012, .018, .030);
const HAZE_HI_D = vec3f(.36, .50, .68);      // haze above the ceiling plane: daylight in the openings
const HAZE_HI_N = vec3f(.04, .07, .14);
const SKYC_D = vec3f(.10, .30, .85);         // zenith sky
const SKYC_N = vec3f(.02, .05, .16);
const SUNC_D = vec3f(1.9, 1.7, 1.32);        // direct sun / moonlight (same direction)
const SUNC_N = vec3f(.20, .28, .50);
const SHAFT_D = vec3f(1., .93, .74);         // tint of the light shafts
const SHAFT_N = vec3f(.45, .6, 1.);
const RAYK_D = 6.;                           // how quickly a shaft builds up along the eye's ray (its ceiling is RY_MAX)
const RAYK_N = 5.;
const AMB_LO_D = vec3f(.40, .46, .48);       // skylight that has found its way in (below the ceiling plane)
const AMB_LO_N = vec3f(.05, .075, .13);
const AMB_HI_D = vec3f(.62, .80, 1.);        // open skylight (above the ceiling plane)
const AMB_HI_N = vec3f(.14, .22, .44);
const AMB_MIN = .30;                         // share of AMB_LO that reaches even where no sky is seen at all
const MOON = vec3f(5., 5.6, 6.5);            // disc of the moon (the disc of the sun is 30 x SUNC_D)
// ---- [ENGINE]
fn ngt() -> f32 { return g.mis.w; }
fn hazeLo() -> vec3f { return mix(HAZE_LO_D, HAZE_LO_N, ngt()); }
fn hazeMid() -> vec3f { return mix(HAZE_MID_D, HAZE_MID_N, ngt()); }
fn hazeHi() -> vec3f { return mix(HAZE_HI_D, HAZE_HI_N, ngt()); }
fn skyc() -> vec3f { return mix(SKYC_D, SKYC_N, ngt()); }
fn sunc() -> vec3f { return mix(SUNC_D, SUNC_N, ngt()); }
fn shaftc() -> vec3f { return mix(SHAFT_D, SHAFT_N, ngt()); }
fn rayk() -> f32 { return mix(RAYK_D, RAYK_N, ngt()); }
fn ambLo() -> vec3f { return mix(AMB_LO_D, AMB_LO_N, ngt()); }
fn ambHi() -> vec3f { return mix(AMB_HI_D, AMB_HI_N, ngt()); }
const TAU = 6.2831853;
const LOW = ${LV > 1};
fn sat(x: f32) -> f32 { return clamp(x, 0., 1.); }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(.06711056, .00583715)))); }
fn hs(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }
fn fin(c: vec3f) -> vec4f { return vec4f(min(max(c, vec3f(0.)), vec3f(40.)), 1.); }
// 0 below the ceiling plane, 1 above it
fn hk(y: f32) -> f32 { return ss(CAN - 3., CAN + 1., y); }
// haze density at height y, and its optical depth along a ray (closed form of the exponential profile)
fn hzd(y: f32) -> f32 { return HZ0 * exp(-HZB * (clamp(y, -60., 40.) - FLR)); }
fn hzt(ro: vec3f, rd: vec3f, d: f32) -> f32 {
  let x = clamp(HZB * rd.y * d, -6., 80.);
  var f = 1. - .5 * x;
  if (abs(x) > .01) { f = (1. - exp(-x)) / x; }
  return hzd(ro.y) * d * f;
}
fn hazeCol(y: f32) -> vec3f { return mix(mix(hazeLo(), hazeMid(), ss(FLR, CAN - 2., y)), hazeHi(), ss(CAN - 1., CAN + 5., y)); }
fn skyCol(rd: vec3f, sun: vec3f) -> vec3f {
  let mu = max(dot(rd, sun), 0.);
  return mix(hazeHi() * 1.5, skyc() * 1.5, pow(sat(rd.y), .45)) + sunc() * pow(mu, 14.) * .3 + mix(SUNC_D * 30., MOON, ngt()) * pow(mu, 1200.);
}
`;

// The scene bind group (group 0, built in main.js as bgl0): every pipeline made by scenePipe() sees exactly this.
//   0 g    frame uniform        1 sR  repeating sampler    2 sC  clamping sampler    3 sS  shadow comparison sampler
//   4 tSh  shadow map (depth)   5 tW  the animated mask (W_MASK)                     6 tD  surface detail (W_DETAIL)
//   7 tV   ambient volume, 256 x 40 x 256: r = openness of the rock around, g = skylight reaching this point
//   8 tM   ground map, 512 x 512 over the world (baked in world.js): what each channel means is the world's choice
const S_B = S_G + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sC: sampler;
@group(0) @binding(3) var sS: sampler_comparison;
@group(0) @binding(4) var tSh: texture_depth_2d;
@group(0) @binding(5) var tW: texture_2d<f32>;
@group(0) @binding(6) var tD: texture_2d<f32>;
@group(0) @binding(7) var tV: texture_3d<f32>;
@group(0) @binding(8) var tM: texture_2d<f32>;
// ---- [ENGINE] shadow map lookups: 1 tap, and 9 taps (1 on Low)
fn shUV(p: vec3f) -> vec3f { let s = g.sm * vec4f(p, 1.); return vec3f(s.x * .5 + .5, .5 - s.y * .5, s.z - .0007); }
fn shadow1(p: vec3f) -> f32 { let s = shUV(p); return textureSampleCompareLevel(tSh, sS, s.xy, s.z); }
fn shadow9(p: vec3f) -> f32 {
  if (LOW) { return shadow1(p); }
  let s = shUV(p); let e = 2.1 / ${SHADOW}.; var a = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { a += textureSampleCompareLevel(tSh, sS, s.xy + vec2f(f32(x), f32(y)) * e, s.z); } }
  return a / 9.;
}
fn vol(p: vec3f) -> vec4f { return textureSampleLevel(tV, sC, (p - vec3f(-192., -56., -192.)) / vec3f(384., 60., 384.), 0.); }
// ---- [WORLD] SLOT 3: the pattern the light casts
const CA_TILE = 23.;                         // metres per tile of the mask on the ceiling plane
const CA_DARK = .22;                         // light left in the darkest part of the pattern
const CA_FAR0 = 40.;                         // the pattern fades to its average between these distances (m)
const CA_FAR1 = 110.;
// where the sun ray through p crosses the ceiling plane: the floor pattern, the shafts and the motes all use it
fn cuv(p: vec3f) -> vec2f { return p.xz - g.sun.xz * ((p.y - CAN) / g.sun.y); }
// share of the sun that reaches p through the mask (the shadow map has already dealt with the rock)
fn caus(p: vec3f, d: f32) -> vec3f {
  let m = textureSample(tW, sR, cuv(p) / CA_TILE).r;
  return vec3f(mix(mix(CA_DARK, 1., m), .6, ss(CA_FAR0, CA_FAR1, d)));
}
// ---- [WORLD] ambient light: n = surface normal, sky = the g channel of vol() at the point
fn amb(p: vec3f, n: vec3f, sky: f32) -> vec3f {
  let up = n.y * .5 + .5;
  return mix(ambLo() * (AMB_MIN + (1. - AMB_MIN) * sky), ambHi(), hk(p.y)) * (.3 + .7 * up * up) + vec3f(.003, .004, .005);
}
// light from the side: what open air beside a wall adds to it
fn side(p: vec3f, n: vec3f, open: f32, sky: f32) -> vec3f { return mix(ambLo() * (.1 + .5 * sky), ambHi() * .6, hk(p.y)) * open * (1. - abs(n.y)) * .5; }
// ---- [ENGINE] height haze: transmittance from the closed-form optical depth, in-scatter in the colour of the layer
// the ray runs through
fn fogD(c: vec3f, wp: vec3f, far: f32) -> vec3f {
  let v = wp - g.cam.xyz; let d = max(length(v), 1e-3); let rd = v / d;
  let T = exp(-hzt(g.cam.xyz, rd, d)) * ss(far, far * .8, d);
  let hm = g.cam.y + rd.y * min(d, mix(22., 70., sat(-rd.y * 3.)));
  let mu = max(dot(rd, g.sun.xyz), 0.);
  let hc = hazeCol(hm) * mix(.35 + .65 * vol(g.cam.xyz + rd * min(d, 40.)).g, 1. + .6 * mu * mu, hk(hm));
  return c * T + hc * (1. - T);
}
fn fog(c: vec3f, wp: vec3f) -> vec3f { return fogD(c, wp, FARD); }
fn qrot(q: vec4f, v: vec3f) -> vec3f { return v + 2. * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
`;

// ---------------------------------------------------------------- solid meshes: the terrain and every instanced prop
// One pipeline, one instance layout (12 floats, written by world.js):
//   a = position xyz + uniform scale      b = rotation quaternion      c = material, seed, fade distance, bob
//   c.x  material: 0 the terrain, 1 a prop of the same rock. Add your own numbers in the material block below.
//   c.z  for a prop: the distance (m) at which it has shrunk to nothing, times the draw-distance scale g.mis.z.
//        1 (the terrain) = never fades.
const W_SOLID = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) on: vec3f,
  @location(4) @interpolate(flat) m: vec4f, @location(5) @interpolate(flat) q: vec4f, @location(6) ao: f32 };
// [ENGINE]
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  var sc = i.a.w;
  // props shrink away over the last 30% of their draw distance (not in the shadow pass, where res.x is 0)
  if (i.c.z > 1.5 && g.res.x > 0.) { sc *= 1. - ss(i.c.z * .7, i.c.z, distance(i.a.xyz, g.cam.xyz) / g.mis.z); }
  var w = i.a.xyz + qrot(i.b, i.p * sc);
  w.y += sin(g.cam.w * .3 + i.c.y * 40.) * i.c.w;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = qrot(i.b, i.n.xyz); o.op = i.p * i.a.w + i.c.y * 37.; o.on = i.n.xyz;
  o.m = i.c; o.q = i.b; o.ao = i.n.w;
  return o;
}
// [ENGINE] three-way projection of the detail texture at scale s: height, mottling and a bump vector
struct TP { h: f32, c: f32, n: vec3f };
fn tri(p: vec3f, n: vec3f, s: f32) -> TP {
  var w = pow(abs(n), vec3f(4.)); w /= (w.x + w.y + w.z);
  let x = textureSample(tD, sR, p.zy * s); let y = textureSample(tD, sR, p.xz * s); let z = textureSample(tD, sR, p.xy * s);
  var o: TP;
  o.h = x.b * w.x + y.b * w.y + z.b * w.z;
  o.c = x.a * w.x + y.a * w.y + z.a * w.z;
  let a = x.rg * 2. - 1.; let b = y.rg * 2. - 1.; let c = z.rg * 2. - 1.;
  o.n = vec3f(0., a.y, a.x) * w.x + vec3f(b.x, 0., b.y) * w.y + vec3f(c.x, c.y, 0.) * w.z;
  return o;
}
// ---- [WORLD] SLOT 4 (and the terrain): surface colours. Everything worth tuning is here
const ROCK_A = vec3f(.17, .16, .145);        // limestone, in the dark of its mottling
const ROCK_B = vec3f(.50, .47, .41);         // ... and in the light of it
const ROCK_C = vec3f(.36, .27, .17);         // beds stained with iron
const ROCK_D = vec3f(.30, .31, .29);         // beds stained grey
const ROCK_WET = vec3f(.075, .07, .065);     // where water runs down a wall
const GROWTH = vec3f(.055, .125, .035);        // moss and fern, where daylight lands (ground map r)
const SILT_A = vec3f(.115, .095, .075);      // floor: damp silt
const SILT_B = vec3f(.27, .23, .175);        // floor: dry silt and grit
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let mat = i32(i.m.x + .5); let fl_ = select(-1., 1., ff);
  let on = normalize(i.on) * fl_; let n0 = normalize(i.n) * fl_;
  let dist = length(i.wp - g.cam.xyz);
  // [ENGINE] the detail texture at four scales (F only close up), two large mottlings, the ground map, the mask
  let A = tri(i.op, on, .1); let B = tri(i.op, on, .43); let C = tri(i.op, on, 1.9); let F = tri(i.op, on, 6.7); let fk = ss(10., 1.5, dist);
  let big = textureSample(tD, sR, i.op.xz * .013 + i.op.y * .021).a;
  let big2 = textureSample(tD, sR, i.op.zx * .031 + i.op.y * .043 + .37).a;
  let run = textureSample(tD, sR, vec2f((i.op.x + i.op.z) * .33, i.op.y * .035)).a;
  let gm = textureSample(tM, sC, i.wp.xz / 384. + .5);
  let ca = caus(i.wp, dist);
  let hgt = A.h * .5 + B.h * .35 + C.h * .15;
  let flt = ss(.72, .93, n0.y);
  var gloss = .1;
  // ---- [WORLD] the material: bedded limestone, streaked where water runs, green where the daylight lands
  let st = i.op.y * .55 + A.h * 1.6 + big * 5. + big2 * 3.;
  let bed = hs(floor(st)); let sf = fract(st);
  var alb = mix(ROCK_A, ROCK_B, sat(A.c * 1.5 - .25));
  alb = mix(alb, mix(ROCK_C, ROCK_D, bed), ss(.42, .66, big) * .6);
  alb *= mix(.74, 1.14, bed) * (1. - .45 * ss(.12, .0, sf) * (1. - abs(on.y)));
  let wet = ss(.52, .72, run) * (1. - abs(n0.y));
  alb = mix(alb, ROCK_WET, wet * .75);
  gloss = mix(gloss, .55, wet);
  let grow = gm.r * ss(-.25, .5, n0.y) * ss(.30, .55, B.c * .55 + big * .5 + gm.r * .25);
  alb = mix(alb, GROWTH * (.5 + .9 * B.h), grow * .9);
  alb *= (.22 + 1.3 * hgt) * mix(1., .62 + .76 * F.h, fk);
  let sgro = -ss(.14, .0, sf) * (1. - abs(on.y)) * 1.2;
  if (mat == 0) {
    // the terrain's level ground: silt, damp in the hollows (ground map a), overgrown in the light (ground map r)
    var fo = mix(SILT_A, SILT_B, B.h * (1. - .6 * gm.a));
    fo = mix(fo, GROWTH * (.55 + .9 * B.h), sat(gm.r * 1.25 - .3 + (B.c - .5) * 1.1) * .8);
    alb = mix(alb, fo * (.55 + .7 * hgt) * mix(1., .62 + .76 * F.h, fk), flt);
    gloss = mix(gloss, .4, flt * gm.a * ss(.55, .35, A.h));
  }
  // ---- [ENGINE] lighting: sun through the shadow map and the mask, ambient from the volume, haze
  let N = normalize(qrot(i.q, normalize(on + (A.n * .85 + B.n * .65 + C.n * .45 * ss(60., 12., dist) + F.n * .5 * fk) * 1.7 + vec3f(0., sgro, 0.))));
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let v1 = vol(i.wp + n0 * 1.5); let v2 = vol(i.wp + n0 * 4.5);
  let open = sat((v2.r - .5) * 2.7);
  let ao = (sat((v1.r - .5) * 8.) * .55 + open * .45) * ss(.12, .6, hgt) * (.55 + .45 * i.ao);
  let E = sunc() * shadow9(i.wp + n0 * .35);
  let ndl = sat(dot(N, L));
  let am = (amb(i.wp, N, v1.g) + side(i.wp, N, open, v2.g)) * ao;
  let dl = E * ndl * ca * 1.3;
  var c = alb * (dl + am);
  let Hv = normalize(V + L);
  c += E * ca * pow(sat(dot(N, Hv)), mix(10., 70., gloss)) * gloss * ndl * 1.8;
  let R = reflect(-V, N);
  c += (amb(i.wp, R, v1.g) + side(i.wp, R, open, v2.g)) * ao * (.08 + gloss) * .6 * pow(1. - sat(dot(N, V)), 2.5);
  return fin(fog(c, i.wp));
}
`;

// ---------------------------------------------------------------- [WORLD] the backdrop: what is seen where there is no geometry
// One quad behind everything. Here: the sky through the haze, with stars at night. In an enclosed world it shows
// only through the openings.
const W_SURF = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f };
@vertex fn vsB(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  o.wp = g.cam.xyz + g.fwd.xyz + g.right.xyz * (p.x * g.right.w) + g.up.xyz * (p.y * g.up.w);
  o.cp = vec4f(p, 1e-7, 1.);
  return o;
}
// ---- stars: everything worth tuning is here
const ST_N = 90.;                            // grid cells from the zenith to the horizon (about 25000 cells in the sky)
const ST_FILL = .16;                         // share of the cells that hold a star
const ST_GAIN = 5.;                          // brightest star (HDR); most are far dimmer
const ST_PX = 1.3;                           // smallest radius in pixels, so a star never falls between them
fn h22(p: vec2f) -> vec2f { var q = fract(p.xyx * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
// One hashed point per cell of a stereographic map of the upper hemisphere (conformal: stars stay round, and
// 1 + rd.y >= 1 so nothing divides by zero). rd.y > 0 only.
fn stars(rd: vec3f) -> vec3f {
  let k = ST_N / (1. + rd.y);
  let p = rd.xz * k; let c = floor(p);
  let h = h22(c); let h2 = h22(c + 71.3);
  if (h2.x > ST_FILL) { return vec3f(0.); }
  let r = min(max(.0011, ST_PX * 2. * g.up.w * g.res.w) * k, .15);
  let v = (p - c - (.15 + .7 * h)) / r;
  let b = h2.x / ST_FILL;
  let tw = .75 + .25 * sin(g.cam.w * (1.5 + 4. * h2.y) + h.x * 90.);
  return mix(vec3f(.65, .78, 1.), vec3f(1., .9, .72), h.y) * (ST_GAIN * (.06 + .94 * b * b * b * b) * tw * exp(0. - dot(v, v) * 2.5) * ss(0., .1, rd.y));
}
@fragment fn fsB(i: VO) -> @location(0) vec4f {
  let rd = normalize(i.wp - g.cam.xyz);
  let T = exp(-hzt(g.cam.xyz, rd, 900.));
  let hm = g.cam.y + rd.y * mix(22., 70., sat(-rd.y * 3.));
  let hc = hazeCol(hm) * mix(.35 + .65 * vol(g.cam.xyz + rd * 40.).g, 1., hk(hm));
  var sk = skyCol(rd, g.sun.xyz);
  // night only, and only above the horizon: by day this costs one branch
  if (ngt() > 0. && rd.y > 0.) { sk += stars(rd) * ngt() * ngt(); }
  return fin(sk * T + hc * (1. - T));
}
`;

// ---------------------------------------------------------------- [WORLD] SLOT 5: drifting motes
// Fully procedural from @builtin(instance_index): no instance buffer, no vertex layout, no JS state. The field wraps
// round the camera in XZ, so a constant count covers any view; main.js draws MOTEN * det^2 of them.
// Additive, depth-tested but not depth-writing, so rock in front still hides them.
// Here: dust hanging in the air, all but invisible until it drifts into a shaft of sun.
const W_MOTE = S_B + /*wgsl*/`
// ---- motes: everything worth tuning is here
const M_BOX = 96.;                           // width of the wrapping field (m)
const M_Y0 = ${wf(FLOOR - 1)};               // bottom of the field
const M_H = ${wf(CAN - FLOOR + 5)};          // its height: a mote that sinks out of the bottom comes back in at the top
const M_FALL = .16;                          // sink speed (m/s)
const M_WOB = 1.3;                           // sideways wander (m)
const M_R = .028;                            // radius (m)
const M_PX = 1.05;                           // smallest radius in pixels, so a distant mote never flickers out
const M_LIT = vec3f(1.5, 1.35, 1.0);         // colour in direct light (times the sun's colour)
const M_DIM = vec3f(.012, .014, .016);       // colour everywhere else (times the ambient light)
fn mh3(n: f32) -> vec3f { var p = fract(vec3f(n) * vec3f(.1031, .1030, .0973)); p += dot(p, p.yzx + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
struct MO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) wp: vec3f, @location(2) @interpolate(flat) col: vec3f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> MO {
  var o: MO;
  let f = f32(ii);
  let a = mh3(f + 1.5); let b = mh3(f * 1.37 + 91.3);
  // wrap the mote's fixed grid position into the box centred on the camera
  let bx = (a.x - .5) * M_BOX; let bz = (a.y - .5) * M_BOX;
  let px = bx - M_BOX * floor((bx - g.cam.x) / M_BOX + .5);
  let pz = bz - M_BOX * floor((bz - g.cam.z) / M_BOX + .5);
  let t = fract(a.z - g.cam.w * M_FALL * (.6 + .8 * b.x) / M_H);
  let wob = vec2f(sin(g.cam.w * .23 + f * 2.1), cos(g.cam.w * .19 + f * 3.3)) * M_WOB;
  let wp = vec3f(px + wob.x, M_Y0 + t * M_H, pz + wob.y);
  // in the sun or not: the shadow map says whether rock is in the way, the mask whether the pattern is
  let lit = shadow1(wp) * mix(.3, 1., textureSampleLevel(tW, sR, cuv(wp) / CA_TILE, 1.).r);
  let tw = .6 + .4 * sin(g.cam.w * (1.3 + 2.5 * b.z) + f);
  o.col = (M_LIT * sunc() * lit * tw + M_DIM * ambLo()) * (.4 + .6 * b.y);
  let d = max(distance(wp, g.cam.xyz), .05);
  let r = max(M_R * (.55 + .9 * b.x), M_PX * 2. * g.up.w * g.res.w * d);
  let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.;
  o.wp = wp;
  o.uv = q;
  o.cp = g.vp * vec4f(wp + (g.right.xyz * q.x + g.up.xyz * q.y) * r, 1.);
  return o;
}
@fragment fn fs(i: MO) -> @location(0) vec4f {
  let d2 = dot(i.uv, i.uv);
  if (d2 > 1.) { discard; }
  let v = i.wp - g.cam.xyz; let d = max(length(v), 1e-3);
  // the haze between the camera and the mote eats it, the same way geometry fades; very near ones fade out too
  let T = exp(0. - hzt(g.cam.xyz, v / d, d)) * ss(FARD * .6, FARD * .3, d) * ss(.3, 1.5, d);
  return fin(i.col * (exp(0. - d2 * 3.4) * T));
}
`;

// ---------------------------------------------------------------- [WORLD] SLOTS 6 and 7: the creatures
// Both are the same four-vertex flyer -- two triangles hinged along the body, the outer corners are the wing tips --
// placed by a closed-form function of the instance index and the time. No buffers, no JS state, nothing to keep in
// step: main.js only says how many (SCHOOLN * det^2 and SOARN). Opaque, depth-written, lit and fogged like rock.
//   vsSchool  SLOT 6: many small ones that keep together. Here: a colony of swiftlets wheeling under the roof.
//   vsSoar    SLOT 7: a few large ones on slow wide circles. Here: kites turning in the light of the main opening.
const W_LIFE = S_B + /*wgsl*/`
// ---- the school: everything worth tuning is here
const SC_C = vec3f(2., ${wf(CAN - 10)}, -2.); // centre of the loop the whole school flies (x, y, z): under the main opening
const SC_R = vec3f(17., 3.5, 15.);           // half-size of that loop. Nothing tests it against the rock: keep SC_C +- (SC_R + SC_W / 2 + 4) in open air
const SC_T = .11;                            // how fast it goes round (rad/s)
const SC_W = vec3f(10., 4., 10.);            // size of the cloud the members keep within
const SC_SPAN = .34;                         // half wingspan (m)
const SC_FLAP = 11.;                         // wing beats (rad/s)
const SC_COL = vec3f(.045, .04, .04);        // their colour
// ---- the soarers
const SO_C = ${wv2(SKYLIGHTS[0])};           // they circle this point (x, z): the main opening
const SO_R = ${wf(SKYLIGHTS[0][2] * 0.62)};  // largest circle (m)
const SO_Y0 = ${wf(CAN - 12)};               // lowest and highest they fly
const SO_Y1 = ${wf(CAN + 12)};
const SO_T = .16;                            // how fast they go round (rad/s)
const SO_SPAN = 1.25;                        // half wingspan (m)
const SO_COL = vec3f(.10, .075, .05);
const WING = .2;                             // chord of a wing, as a share of the body's length (both creatures)
fn lh3(n: f32) -> vec3f { var p = fract(vec3f(n) * vec3f(.1031, .1030, .0973)); p += dot(p, p.yzx + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
struct LO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) wp: vec3f, @location(2) n: vec3f, @location(3) @interpolate(flat) col: vec3f };
// [ENGINE] one flyer: body at c, flying along h, half span s, wings raised by the angle a, rolled by bank.
// Triangle strip: 0 left tip, 1 nose, 2 tail, 3 right tip.
fn flyer(vi: u32, c: vec3f, h: vec3f, s: f32, a: f32, bank: f32, col: vec3f) -> LO {
  var o: LO;
  let s0 = normalize(cross(h, vec3f(0., 1., 0.)) + vec3f(1e-4, 0., 0.));
  let u0 = cross(s0, h);
  let sd = s0 * cos(bank) + u0 * sin(bank); let up = u0 * cos(bank) - s0 * sin(bank);
  let tip = f32(vi == 0u || vi == 3u);
  let ux = tip * select(-1., 1., vi == 3u);
  let uy = (1. - tip) * select(1., -1., vi == 2u);
  let wp = c + sd * (ux * s * cos(a)) + up * (tip * s * sin(a)) + h * (uy * s * .5 - tip * s * .25);
  o.wp = wp; o.uv = vec2f(ux, uy); o.col = col;
  o.n = normalize(up * cos(a) - sd * (ux * sin(a)));
  o.cp = g.vp * vec4f(wp, 1.);
  return o;
}
// ---- SLOT 6: where member f of the school is at time t
fn schoolAt(f: f32, t: f32) -> vec3f {
  let h = lh3(f + 3.1); let h2 = lh3(f * 1.37 + 9.7);
  let ct = t * SC_T;
  let c = SC_C + SC_R * vec3f(sin(ct), sin(ct * 2.3 + 1.), sin(ct * 1.31 + 2.));
  let ph = t * (.9 + .8 * h.x) + h.y * TAU;
  return c + (h2 - .5) * SC_W + vec3f(sin(ph), sin(ph * 1.7 + h.z * 6.) * .4, cos(ph)) * (1.5 + 3. * h.z);
}
@vertex fn vsSchool(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LO {
  let f = f32(ii); let t = g.cam.w;
  let p = schoolAt(f, t);
  let hd = normalize(schoolAt(f, t + .06) - p + vec3f(0., 0., 1e-5));
  return flyer(vi, p, hd, SC_SPAN * (.8 + .4 * fract(f * .618)), sin(t * SC_FLAP * (.85 + .3 * fract(f * .37)) + f) * .85, 0., SC_COL);
}
// ---- SLOT 7: soarer f at time t
@vertex fn vsSoar(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LO {
  let f = f32(ii); let t = g.cam.w; let h = lh3(f * 2.71 + 5.3);
  let dir = select(-1., 1., h.z > .4);
  let an = dir * t * SO_T * (.7 + .6 * h.y) + h.x * TAU;
  let r = SO_R * (.45 + .55 * h.x);
  let y = mix(SO_Y0, SO_Y1, .5 + .5 * sin(t * .05 * (1. + h.z) + f * 2.4));
  let p = vec3f(SO_C.x + cos(an) * r, y, SO_C.y + sin(an) * r);
  let hd = vec3f(-sin(an), 0., cos(an)) * dir;
  return flyer(vi, p, hd, SO_SPAN * (.85 + .3 * h.y), .16 + .07 * sin(t * 1.1 + f * 4.), -.38 * dir, SO_COL);
}
@fragment fn fs(i: LO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  // the outline, cut out of the two triangles: the leading edge is theirs; behind it the wing keeps only a narrow
  // chord (WING of the way back), widening into the body and tail near the middle
  let ax = abs(i.uv.x);
  if (i.uv.y < (ax - 1.) * mix(1., WING, ss(.06, .34, ax))) { discard; }
  let n = normalize(i.n) * select(-1., 1., ff);
  let v = vol(i.wp);
  let c = i.col * (amb(i.wp, n, v.g) * 1.4 + sunc() * shadow1(i.wp) * (.25 + .75 * sat(dot(n, g.sun.xyz))));
  return fin(fog(c, i.wp));
}
`;

// ---------------------------------------------------------------- [WORLD] SLOT 2: the light shafts (half resolution)
// A march along every view ray through the haze: at each step, is this point of air in the sun (the shadow map), and
// how much of the sun does the mask let through to it. Blurred by W_RBLUR and added to the picture in W_POST.
// Bindings are 'auto' (rule 3 at the top): all eight below are used; drop a use and the bind group in main.js fails.
const W_RAYS = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sS: sampler_comparison;
@group(0) @binding(3) var tSh: texture_depth_2d;
@group(0) @binding(4) var tW: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
@group(0) @binding(6) var tV: texture_3d<f32>;
@group(0) @binding(7) var sC: sampler;
// ---- shafts: everything worth tuning is here (their colour and gain are SHAFT_* and RAYK_* in S_G)
const RY_FAR = 90.;                          // the march stops here (m): the haze hides the rest
const RY_TILE = 23.;                         // metres per tile of the mask: keep equal to CA_TILE in S_B
const RY_MASK = .45;                         // how deep the mask cuts into a shaft: 0 = solid beams, 1 = fully streaked
const RY_AIR = .010;                         // a little dust everywhere, so shafts show even where the haze is thin
const RY_FWD = 2.2;                          // how much brighter a shaft is looking towards the sun
const RY_MAX = .26;                          // brightest a shaft can get, as a share of the sun's colour
fn vuv(p: vec3f) -> vec3f { return (p - vec3f(-192., -56., -192.)) / vec3f(384., 60., 384.); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dp = textureLoad(tDp, vec2i(fc.xy) * 2, 0);
  let uv = fc.xy * 2. * g.res.zw;
  let nd = vec2f(uv.x * 2. - 1., 1. - uv.y * 2.);
  let rv = g.fwd.xyz + g.right.xyz * (nd.x * g.right.w) + g.up.xyz * (nd.y * g.up.w);
  let rl = length(rv); let rd = rv / rl;
  let zl = g.fwd.w / max(dp, 1e-6);
  let ro = g.cam.xyz; let sx = g.sun.xyz;
  let t1 = min(zl * rl, RY_FAR);
  let dt = t1 / ${RAYN}.;
  let j = ign(fc.xy);
  var acc = 0.; var tau = 0.;
  for (var n = 0; n < ${RAYN}; n++) {
    let p = ro + rd * ((f32(n) + j) * dt);
    let s = g.sm * vec4f(p, 1.);
    let vis = textureSampleCompareLevel(tSh, sS, vec2f(s.x * .5 + .5, .5 - s.y * .5), s.z - .0006);
    let q = p.xz - sx.xz * ((p.y - CAN) / sx.y);
    let m = mix(1., textureSampleLevel(tW, sR, q / RY_TILE, 1.5).r, RY_MASK);
    // air close to rock holds more dust
    let mist = sat(1. - (textureSampleLevel(tV, sC, vuv(p), 0.).r - .5) * 3.4);
    let sg = hzd(p.y);
    acc += exp(-tau) * vis * m * (sg + RY_AIR) * (1. + .6 * mist * mist);
    tau += sg * dt;
  }
  let mu = max(dot(rd, sx), 0.);
  let ph = .35 + RY_FWD * mu * mu * mu;
  // the light gathered along the ray saturates: an eye inside a shaft sees bright air, not a white screen
  let lum = 1. - exp(0. - acc * dt * rayk() * g.mis.y * ph);
  return vec4f(shaftc() * sunc() * (lum * RY_MAX), zl);
}
`;
// [ENGINE] depth-aware 3x3 blur of the half-res shafts (hides the sampling dither)
const W_RBLUR = W_FS + /*wgsl*/`
@group(0) @binding(0) var tR: texture_2d<f32>;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2i(fc.xy); let mx = vec2i(textureDimensions(tR)) - 1;
  let c = textureLoad(tR, p, 0);
  var acc = vec3f(0.); var ws = 0.;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let r = textureLoad(tR, clamp(p + vec2i(x, y) , vec2i(0), mx), 0);
    let w = 1. / (.03 + abs(r.a - c.a) / c.a);
    acc += r.rgb * w; ws += w;
  } }
  return vec4f(acc / ws, c.a);
}
`;

// ---------------------------------------------------------------- final composite
// Bindings are 'auto' (rule 3 at the top): all six are used.
const W_POST = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sC: sampler;
@group(0) @binding(2) var tS: texture_2d<f32>;
@group(0) @binding(3) var tR: texture_2d<f32>;
@group(0) @binding(4) var tB: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
// ---- [WORLD] the grade: everything worth tuning is here
const BLOOM_MIX = .06;                       // share of the picture replaced by the bloom
const BLOOM_ADD = .03;                       // bloom added on top
const VIGNETTE = .55;                        // darkening towards the corners
const CONTRAST = .55;                        // strength of the S-curve
const SATURATE = .93;                        // 1 = as rendered, 0 = grey
const TINT_D = vec3f(.004, .003, .002);      // lifted blacks by day
const TINT_N = vec3f(.001, .003, .008);      // ... and by night
fn sat3(x: vec3f) -> vec3f { return clamp(x, vec3f(0.), vec3f(1.)); }
fn tmap(x: vec3f) -> vec3f { return sat3((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14)); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = vec2i(fc.xy);
  let uv = fc.xy * g.res.zw;
  // [ENGINE] depth-aware upsample of the half-res shafts
  let zf = g.fwd.w / max(textureLoad(tDp, px, 0), 1e-6);
  let h = fc.xy * .5 - .5; let b = floor(h); let f = h - b; let bi = vec2i(b);
  let mx = vec2i(textureDimensions(tR)) - 1;
  var acc = vec3f(0.); var ws = 0.;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let r = textureLoad(tR, clamp(bi + o, vec2i(0), mx), 0);
    let bw = mix(1. - f.x, f.x, f32(o.x)) * mix(1. - f.y, f.y, f32(o.y));
    let w = (bw + .02) / (.02 + abs(r.a - zf) / zf);
    acc += r.rgb * w; ws += w;
  }
  var c = textureLoad(tS, px, 0).rgb + acc / ws;
  let bl = textureSampleLevel(tB, sC, uv, 0.).rgb;
  c = mix(c, bl, BLOOM_MIX) + bl * BLOOM_ADD;
  c *= g.mis.x;
  let q = uv - .5;
  c *= 1. - dot(q, q) * VIGNETTE;
  c = tmap(c);
  let l0 = dot(c, vec3f(.2126, .7152, .0722));
  let l = mix(l0, l0 * l0 * (3. - 2. * l0), CONTRAST);
  c *= l / max(l0, 1e-4);
  c = mix(c, vec3f(l), ss(.55, 1., l) * .1);
  c = mix(vec3f(l), c, SATURATE) + mix(TINT_D, TINT_N, g.mis.w);
  c = pow(max(c, vec3f(0.)), vec3f(1. / 2.2));
  let n = ign(fc.xy) + ign(fc.xy + 37.) - 1.;
  return vec4f(c + n / 255., 1.);
}
`;
