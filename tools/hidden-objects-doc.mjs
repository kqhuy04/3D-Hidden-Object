// Regenerates the "where the objects are" section of docs/HIDDEN_OBJECTS.md
// straight from src/data/hiddenItems.ts, so the table can never drift from the
// data it describes.
//
// Usage: node tools/hidden-objects-doc.mjs [--write]
import fs from 'node:fs';

const SRC = 'src/data/hiddenItems.ts';
const DOC = 'docs/HIDDEN_OBJECTS.md';
const REGISTRY = 'src/data/mapRegistry.ts';

const src = fs.readFileSync(SRC, 'utf8');

// Labels come from the registry, which `prepare-maps.mjs` owns. A hand-kept
// table here meant a newly added map fell back to its raw id — `alpine-and-snow`
// rather than "Alpine Ski Resort" — and the doc quietly disagreed with the map
// card the player sees.
const LABELS = Object.fromEntries(
  Array.from(
    fs.readFileSync(REGISTRY, 'utf8').matchAll(/"id":\s*"([^"]+)",\s*\n\s*"label":\s*"([^"]+)"/g),
    (m) => [m[1], m[2]],
  ),
);

const blocks = src.split(/^  '([a-z-]+)': \{$/m);
const maps = [];
for (let i = 1; i < blocks.length; i += 2) {
  const id = blocks[i];
  const body = blocks[i + 1];
  const brief = /brief: '((?:[^'\\]|\\.)*)'/.exec(body)?.[1] ?? '';
  // `y` is optional: an object standing on the ground omits it and the loader
  // asks the collision resolver for the surface height. Requiring `y` here made
  // a whole map's table come out empty without any error, which is the worst
  // possible failure for a generated document.
  const items = [...body.matchAll(
    /id: '([^']+)',\s*\n\s*asset: '([^']+)',\s*\n\s*name: '([^']+)',\s*\n\s*hint: '((?:[^'\\]|\\.)*)',[\s\S]*?spot: \{ x: (-?[\d.]+), (?:y: (-?[\d.]+), )?z: (-?[\d.]+) \},\s*\n\s*rotationY: (-?[\d.]+)/g
  )].map((m) => ({
    id: m[1],
    asset: m[2],
    name: m[3],
    hint: m[4],
    x: m[5],
    y: m[6] ?? null,
    z: m[7],
    rot: m[8],
  }));
  maps.push({ id, brief, items });
}

const total = maps.reduce((n, m) => n + m.items.length, 0);

const out = [];
out.push('## 3. The objects');
out.push('');
out.push(`Twenty-two maps, five objects each: **${total}** in total. Positions come from`);
out.push("the map's own collision geometry (`node tools/spots.mjs <map-id>`), not from guesswork,");
out.push('and every one is verified pickable from a natural standing spot with the real follow');
out.push('camera (`node tools/pickable.mjs <map-id>`).');
out.push('');
out.push('A position of `ground` means the height is not written down: the object stands on');
out.push('whatever the collision resolver finds under that point, which is what keeps it from');
out.push('floating or sinking on maps whose floor is not at zero.');
out.push('');
out.push('The rule for choosing them is the same on every map: the object must be *impossible*');
out.push('there, not merely unusual. A toaster in a forest needs a socket that does not exist; a');
out.push('pizza box at a campsite is just a pizza box.');
out.push('');

for (const m of maps) {
  out.push(`### ${LABELS[m.id] ?? m.id} — \`${m.id}\``);
  out.push('');
  out.push(`*${m.brief}*`);
  out.push('');
  out.push('| Object | Hint (what a local says about it) | Position |');
  out.push('|---|---|---|');
  for (const it of m.items) {
    out.push(`| **${it.name}** | ${it.hint} | \`${it.x}, ${it.y ?? 'ground'}, ${it.z}\` |`);
  }
  out.push('');
}

const section = out.join('\n');
const doc = fs.readFileSync(DOC, 'utf8');
const start = doc.indexOf('## 3.');
const end = doc.indexOf('## 4. Authoring the next map');
if (start < 0 || end < 0) throw new Error('section markers not found in the doc');

const next = doc.slice(0, start) + section + '\n---\n\n' + doc.slice(end);

if (process.argv.includes('--write')) {
  fs.writeFileSync(DOC, next);
  console.log(`wrote ${DOC}: ${maps.length} maps, ${total} objects`);
} else {
  console.log(section);
}
