// nc-world-forge engine -- build script.
// Derived from Abyssal Garden by Maksymilian Dendura (MIT), https://github.com/Noniv/abyssal-garden
//
// Bundles src/*.js into the single self-contained ../index.html
//   npm run build            minified
//   npm run build:readable   unminified, for debugging
//   npm run build:dev        ../dev.html: unminified, plus the development tools in src/dev.js
//
// The sources are NOT modules. They are concatenated in the fixed order below into ONE async function, so every
// top-level const / let / function in any file is visible in every later file (and, at call time, in earlier ones).
// No imports, no exports. A template literal is evaluated where it is written, so a constant that is interpolated
// into WGSL must be declared in an earlier file, or earlier in the same file (see the note at the top of shaders.js).
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = ['quality.js', 'math.js', 'shaders.js', 'world.js', 'main.js', 'audio.js']; // concatenation order matters
const dev = process.argv.includes('--dev'), readable = dev || process.argv.includes('--readable');
const out = dev ? 'dev.html' : 'index.html';
if (dev) FILES.push('dev.js');

let js = FILES.map((f) => readFileSync(path.join(here, 'src', f), 'utf8')).join('\n');
const tpl = readFileSync(path.join(here, 'template.html'), 'utf8');
// everything runs inside one async function; startup errors are shown on screen
const wrap = (body) => `(async()=>{${body}\n})().catch(e=>{console.error(e);document.body.className='l e';document.getElementById('s').textContent=(e.cause?'':'Failed to start: ')+e.message});`;

let html;
if (readable) {
  html = tpl.replace('/*SCRIPT*/', () => wrap(js));
} else {
  // shrink the WGSL inside /*wgsl*/ template literals, then minify the JS and the page's CSS.
  // The WGSL minifier removes the spaces round operators, so "a - -b" becomes "a--b" (a decrement: a compile error).
  // Every number interpolated into WGSL must therefore be bracketed -- use wf() / wv2() / wv3() in shaders.js.
  const minWgsl = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').replace(/ ?([{}()\[\];,:=+\-*\/<>&|!%@]) ?/g, '$1').trim();
  js = js.replace(/\/\*wgsl\*\/`([^`]*)`/g, (_, w) => '`' + minWgsl(w) + '`');
  const code = transformSync(wrap(js), { minify: true, target: 'es2022', legalComments: 'none' }).code.trim();
  const css = (_, s) => '<style>' + transformSync(s, { loader: 'css', minify: true }).code.trim();
  html = tpl.replace(/<style>([^]*?)(?=<\/style>)/, css).replace(/>\s+</g, '><').replace('/*SCRIPT*/', () => code).replace(/<script>\s+/, '<script>').replace(/\s+<\/script>/, '</script>');
}
// The MIT licence of Abyssal Garden requires its notice to travel with every copy. The minifier strips the source
// headers, so the notice lives in template.html (an HTML comment and a visible line on the start screen). Refuse to
// write a page that has lost it.
for (const t of ['Abyssal Garden', 'Maksymilian Dendura', 'MIT', 'github.com/Noniv/abyssal-garden']) {
  if (!html.includes(t)) { console.error(`build refused: the attribution "${t}" is missing from template.html`); process.exit(1); }
}
writeFileSync(path.join(here, '..', out), html);
const gz = gzipSync(Buffer.from(html), { level: 9 }).length;
console.log(`${out}: ${(html.length / 1024).toFixed(1)} kB${readable ? ' (readable)' : ''}, ${(gz / 1024).toFixed(1)} kB gzipped`);
