// Out-of-focus backdrops for the start screen.
//
// The start screen shows the map behind the character, blurred almost past
// recognition. Doing that with `filter: blur(20px)` on a full-screen element
// works, and costs the compositor a full-screen pass on every frame the menu is
// up — which on a laptop is enough to drag the frame rate down and, before the
// scaler was gated, to talk the game into its lowest quality preset.
//
// Blurring a 320 px copy once and letting the browser stretch it is the same
// picture for none of the per-frame cost: a 4.5x bilinear upscale *is* a blur.
//
// Usage: node tools/make-backdrops.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const MAPS = path.join('public', 'maps');
const SHOTS = path.join(MAPS, 'shots');
const OUT = path.join(MAPS, 'backdrop');
const force = process.argv.includes('--force');

const WIDTH = 320;
const BLUR = 6;
const QUALITY = 72;

const ids = Array.from(
  fs.readFileSync(path.join('src', 'data', 'mapRegistry.ts'), 'utf8').matchAll(/"id":\s*"([^"]+)"/g),
  (m) => m[1]
);
if (!ids.length) throw new Error('no map ids found in mapRegistry.ts');

fs.mkdirSync(OUT, { recursive: true });

let bytes = 0;
let made = 0;
let missing = [];

for (const id of ids) {
  const dest = path.join(OUT, `${id}.jpg`);
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 1500) {
    bytes += fs.statSync(dest).size;
    made++;
    continue;
  }

  // The in-game capture first — it is the map at eye level, which is what
  // "standing in it" looks like — then the kit's isometric cover.
  const shot = path.join(SHOTS, `${id}.jpg`);
  const cover = path.join(MAPS, `${id}.jpg`);
  const source = fs.existsSync(shot) ? shot : fs.existsSync(cover) ? cover : null;
  if (!source) {
    missing.push(id);
    continue;
  }

  const jpg = await sharp(source)
    .resize({ width: WIDTH })
    .blur(BLUR)
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toBuffer();

  fs.writeFileSync(dest, jpg);
  bytes += jpg.length;
  made++;
}

console.log(
  `${made}/${ids.length} backdrops, ${(bytes / 1024).toFixed(0)} kB total` +
    (missing.length ? `  — no artwork for: ${missing.join(', ')}` : '')
);
