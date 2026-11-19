// ============================================================================
// nc-world-forge engine
// Derived from Abyssal Garden by Maksymilian Dendura (MIT licence), https://github.com/Noniv/abyssal-garden
// This notice must stay in every world generated from this engine (see also template.html and build.mjs).
// ============================================================================
// [ENGINE] quality level, chosen before anything is built
// ============================================================================
// KEY: the localStorage prefix of this world. [ALSO TOUCH for a new world] Give every world its own, or two worlds
// served from one origin share their detail level and their crash guard.
//   localStorage[KEY]           = "level,pixels,detail"   (what the resolution controller settled on)
//   localStorage[KEY + 'Load']  = set while the world is built: still set on the next visit means that load crashed
//                                 the tab, so this one runs a level lower
//   localStorage[KEY + 'Night'] = the day / night choice
const KEY = 'ncwf';
// LV: 0 High, 1 Medium, 2 Low. What each level changes:
//   SHADOW  shadow map size (4096 / 2048 / 2048)
//   AA      anti-aliasing samples (4 / 4 / 1)
//   MASK    size of the animated mask texture (512 / 512 / 256)
//   RAYN    steps of the light shaft march (34 / 34 / 12)
//   THIN    populations are divided by this (1 / 2 / 4): see MOTEN, SCHOOLN and the props in world.js
//   Low also takes one shadow tap instead of nine (LOW in shaders.js) and drops anisotropic filtering.
const mob = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory;
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };
let SV = [], LV, bad;
try { SV = (localStorage[KEY] || '').split(','); bad = localStorage[KEY + 'Load']; } catch {}
LV = SV[0] ? +SV[0] : mob ? (mem > 7 ? 1 : 2) : mem <= 4 ? 2 : 0;
if (bad && LV < 2) { SV = [++LV]; keep(KEY, LV); }
const THIN = 1 << LV, SHADOW = LV ? 2048 : 4096, AA = LV > 1 ? 1 : 4, MASK = LV > 1 ? 256 : 512, RAYN = LV > 1 ? 12 : 34;
