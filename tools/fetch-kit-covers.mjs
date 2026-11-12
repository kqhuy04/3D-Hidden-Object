// Downloads the map-picker artwork from Polyfork's kit pages.
//
// Each kit has an isometric diorama cover at /kits/<kit-id>/cover.png — the
// whole kit arranged as one picture, which is a far better card than a
// screenshot from the game's own spawn point. It is not in the API (no kit
// response carries a thumbnail field), so the URL is derived from the kit id.
//
// The source PNGs are ~1.5 MB each, so they are re-encoded down to a card-sized
// JPEG. Twenty-two of them at full size would be 34 MB in an offline desktop
// build; at 720 px they are about 1 MB in total.
//
// Usage: node tools/fetch-kit-covers.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const OUT = path.join('public', 'maps');
const SHOTS = path.join(OUT, 'shots');
const REGISTRY = path.join('src', 'data', 'mapRegistry.ts');
const KIT_INDEX = path.join(OUT, 'kits.json');
const force = process.argv.includes('--force');

const WIDTH = 720;
const QUALITY = 84;

// One kit's promo art carries a palette legend — a grid of colour swatches in
// the top-left corner, left over from a promotional layout. It is part of the
// PNG, so it has to be cropped off rather than covered: patching the corner
// with cloned backdrop leaves a visible band across the scene. The value is the
// number of source pixels to drop from the top, and it is the deepest cut that
// still clears the church crosses at y = 229.
const CROP_TOP = {
  'dia-de-muertos': 200,
};

const mapIds = Array.from(
  fs.readFileSync(REGISTRY, 'utf8').matchAll(/"id":\s*"([^"]+)"/g),
  (m) => m[1],
);
if (!mapIds.length) throw new Error('no map ids found in mapRegistry.ts');

// --- resolve every map to its kit ------------------------------------------
//
// A kit id is `<name>-kit-<hex>` or `<name>-<hex>` depending on when the kit was
// made, so the match is on the *name* with the suffix stripped — the exact
// inverse of `idOf()` in `prepare-maps.mjs`. A prefix match is not good enough:
// `office` and `office-reefscape-kit-1afd7c` both start with `office-`, and the
// prefix rule silently produced the wrong cover for one of them.
const KEY = process.env.POLYFORK_KEY ?? 'pf_e44a2372179cf2158746f88a7a31c9a94e264723';

function kitNameOf(kitId) {
  return kitId.replace(/-kit-[0-9a-f]{6}$/i, '').replace(/-[0-9a-f]{6}$/i, '');
}

async function loadKits() {
  const byId = new Map();
  for (let page = 1; page <= 6; page++) {
    const res = await fetch(`https://polyfork.dev/api/kits?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    if (!res.ok) throw new Error(`kits page ${page}: HTTP ${res.status}`);
    const json = await res.json();
    if (!json.kits?.length) break;
    for (const k of json.kits) byId.set(k.id, k);
  }
  return [...byId.values()];
}

const kits = await loadKits();
console.log(`${kits.length} kits in /api/kits`);

// `/api/kits` is a fixed list of 54 — it ignores `per_page`, `page`, `q` and
// `limit`, and returns the same 54 whatever you ask. All twenty-two of our kits
// happen to be in it, but a future map's might not, so `kits.json` is kept as
// the record: it is written after every successful run and read back when the
// live list cannot resolve an id. Same idea as `maps/reports/` being the record
// of a prepared map.
const recorded = fs.existsSync(KIT_INDEX) ? JSON.parse(fs.readFileSync(KIT_INDEX, 'utf8')) : {};

const resolved = {};
const problems = [];
for (const id of mapIds) {
  const hits = kits.filter((k) => kitNameOf(k.id) === id);
  if (hits.length === 1) resolved[id] = hits[0].id;
  else if (hits.length > 1) problems.push(`${id}: ambiguous — ${hits.map((k) => k.id).join(', ')}`);
  else if (recorded[id]) resolved[id] = recorded[id];
  else problems.push(`${id}: no kit`);
}
if (problems.length) {
  throw new Error('kit resolution failed:\n  ' + problems.join('\n  '));
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

let bytes = 0;
let got = 0;

for (const id of mapIds) {
  const kitId = resolved[id];
  const dest = path.join(OUT, `${id}.jpg`);
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 4000) {
    bytes += fs.statSync(dest).size;
    got++;
    console.log(`have ${id.padEnd(32)} ${kitId}`);
    continue;
  }

  const url = `https://polyfork.dev/kits/${kitId}/cover.png`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${id}: ${url} HTTP ${res.status}`);
  const png = Buffer.from(await res.arrayBuffer());

  // `inside` keeps the whole diorama: the covers are 11:6 and cropping to the
  // card's ratio shaved the ends off the arrangement, which is the part that
  // tells you what the map is.
  let pipeline = sharp(png);
  const cut = CROP_TOP[id];
  if (cut) {
    const meta = await sharp(png).metadata();
    pipeline = sharp(png).extract({ left: 0, top: cut, width: meta.width, height: meta.height - cut });
  }
  const jpg = await pipeline
    .resize({ width: WIDTH, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toBuffer();

  fs.writeFileSync(dest, jpg);
  bytes += jpg.length;
  got++;
  console.log(`got  ${id.padEnd(32)} ${kitId}  ${Math.round(jpg.length / 1024)} kB`);
}

fs.writeFileSync(KIT_INDEX, JSON.stringify(resolved, null, 2) + '\n');

// The in-game captures stay as a fallback: a kit cover says what the kit
// contains, a capture says what the player will actually walk into.
const shots = fs.existsSync(SHOTS) ? fs.readdirSync(SHOTS).filter((f) => f.endsWith('.jpg')) : [];

console.log(
  `\n${got}/${mapIds.length} covers, ${(bytes / 1024 / 1024).toFixed(2)} MB total` +
    `  (${shots.length} in-game captures kept as fallback)`,
);
