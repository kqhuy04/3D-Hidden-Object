// Downloads the player-character roster from Polyfork.
//
// The roster itself is authored in `src/data/characters.ts` — names and blurbs
// are content, not something a download script should invent — so the ids are
// read out of that file rather than duplicated here. Same pattern as
// `hidden-objects-doc.mjs` reading `hiddenItems.ts`.
//
// Usage: node tools/fetch-characters.mjs
import fs from 'node:fs';
import path from 'node:path';
import { readGlb } from './terrain.mjs';

const OUT = path.join('public', 'assets', 'characters');
const SRC = path.join('src', 'data', 'characters.ts');

/** The bones `CharacterAnimator` drives by name. A character missing any of
 *  these would play its idle and then stand still in the walk, so the download
 *  refuses it rather than shipping a broken costume. */
const REQUIRED_BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
];

const src = fs.readFileSync(SRC, 'utf8');
const ids = Array.from(src.matchAll(/^\s{4}id: '([a-z0-9-]+)',$/gm), (m) => m[1]);
if (!ids.length) throw new Error(`no character ids found in ${SRC}`);

fs.mkdirSync(OUT, { recursive: true });

const credits = [];
let total = 0;

for (const id of ids) {
  const dest = path.join(OUT, `${id}.glb`);
  let bytes;

  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
    bytes = fs.statSync(dest).size;
    console.log(`have ${id.padEnd(32)} ${Math.round(bytes / 1024)} kB`);
  } else {
    const res = await fetch(`https://polyfork.dev/cdn/${id}.glb`);
    if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    bytes = buf.length;
    console.log(`got  ${id.padEnd(32)} ${Math.round(bytes / 1024)} kB`);
  }
  total += bytes;

  // Check the rig before trusting it. Cheap — the GLB is already on disk.
  const { gltf } = readGlb(dest);
  const names = new Set((gltf.nodes || []).map((n) => n.name).filter(Boolean));
  const missing = REQUIRED_BONES.filter((b) => !names.has(b));
  if (missing.length) {
    throw new Error(`${id}: missing bones ${missing.join(', ')} — it would not animate`);
  }

  const detail = await (await fetch(`https://polyfork.dev/api/assets/${id}`)).json();
  credits.push({
    id,
    title: detail.title,
    credit: detail.credit,
    height: detail.size_m?.y ?? null,
    triangles: detail.triangles ?? null,
  });
}

fs.writeFileSync(
  path.join(OUT, 'CREDITS.json'),
  JSON.stringify(credits, null, 2) + '\n',
);

const md = [
  '# Player-character credits',
  '',
  'The roster on the start screen. These are free low-poly models from',
  'Polyfork, used under CC BY 4.0 — the credit line below is the attribution',
  'that licence asks for. Files are hosted locally so the game keeps working',
  'offline (it ships as a Tauri desktop app).',
  '',
  '| Character | Asset | Licence |',
  '| --- | --- | --- |',
  ...credits.map((c) => `| ${c.title} | ${c.credit} | CC BY 4.0 |`),
  '',
  'Every one shares the same 22-bone Mixamo rig, which is what lets a single',
  'set of animation keyframes drive all of them. `fetch-characters.mjs` refuses',
  'any character that is missing a bone the animator needs.',
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), md);

console.log(
  `\n${credits.length} characters, ${(total / 1024 / 1024).toFixed(2)} MB total`,
);
