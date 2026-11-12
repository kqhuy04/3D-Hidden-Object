// Downloads the "wrong thing in the wrong place" props from Polyfork.
//
// The free low-poly meshes are CC BY 4.0: they may be hosted in the build as
// long as each asset's credit line travels with them, so the credit strings
// come down with the files and are written to CREDITS.md next to them.
//
// Usage: node tools/fetch-hidden-items.mjs
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join('public', 'assets', 'hidden');

/** Everything the twenty-one maps use. Ids are Polyfork asset ids. */
const ITEMS = [
  // Campground & Lake — canvas, cordwood, cold water. Anything that needs a
  // town to make sense is the intruder.
  'toaster-0d6c5c',
  'fire-hydrant-b68b17',
  'parking-meter-e9cf71',
  'phone-booth-10967f',
  'kitchen-sink-7ea438',
  // Chrome Arcology Transit — chrome and neon, so pre-industrial things are wrong.
  'wooden-barrel-ab50ca',
  'hay-bale-079e8c',
  'stone-well-b2dfcd',
  'treasure-chest-c2ac4f',
  'candle-spike-cluster-d7c566',
  // Chronos Hearth — a timber-and-clay survival settlement, so consumer goods are wrong.
  'office-chair-7c9874',
  'vending-machine-471c29',
  'microwave-oven-7f60d4',
  'rubber-duck-e41831',
  'skateboard-667a82',
  // Construction Site — dirt, concrete and cranes; nothing here was ever a home.
  'sofa-9c0e7e',
  'fridge-freezer-fb9b5a',
  'upright-piano-c0b0ef',
  'garden-birdbath-9671de',
  'red-post-box-f12045',
  // Coral Reef — six metres down; everything dry-land is wrong.
  'jukebox-1e2ea6',
  'toilet-2edbd9',
  // Countryside Railway — a rural halt with steam and coal.
  'espresso-machine-a2db84',
  'hammock-on-posts-7d5c47',
  // Cozy Farm — a working farm; the town arrived in the yard.
  // (reuses phone booth, vending machine, jukebox, fridge, parking meter)
  // Día de Muertos — a cemetery and a plaza; domestic appliances are the intruder.
  // (reuses toilet, sofa, kitchen sink, office chair, post box)
  // Frontier Town — 1880s; anything with a plug is from the future.
  // (reuses vending machine, phone booth, fridge, jukebox, microwave)
  // Hospital — clinical; the outdoors is the intruder.
  'campfire-4390aa',
  'scarecrow-334079',
  'anvil-0ad53c',
  'rowboat-c42d85',
  // Japanese Suburban City Street — a dense modern street.
  'straw-bale-56facd',
  'riding-lawn-tractor-09e93c',
  'coffin-prop-d62082',
  // Medieval Village — pre-industrial; consumer goods are the intruder.
  'traffic-cone-c421e4',
  // Modern Restaurant Cafe — a city cafe; the farm is the intruder.
  // Neighborhood Pathways — a suburb; medieval and maritime things are wrong.
  'deck-cannon-17849e',
  'forest-outhouse-e968d1',
  // NYC City — a dense street grid.
  // Office — a workplace; the outdoors is the intruder.
  'camp-tent-3c5c89',
  // Pirate Cove — sail and timber; modern consumer goods are the intruder.
  'laptop-e775ba',
  // Skatepark — concrete and plywood.
  // Space Base — a habitat on regolith.
  'admiralty-anchor-bd6882',
  // Stadium — a match day.
  // Symphony Stagecraft — a concert hall.
];

fs.mkdirSync(OUT, { recursive: true });

const credits = [];
for (const id of ITEMS) {
  const dest = path.join(OUT, `${id}.glb`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
    console.log(`have ${id} (${Math.round(fs.statSync(dest).size / 1024)} kB)`);
  } else {
    const res = await fetch(`https://polyfork.dev/cdn/${id}.glb`);
    if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    console.log(`got  ${id} (${Math.round(buf.length / 1024)} kB)`);
  }

  const detail = await (await fetch(`https://polyfork.dev/api/assets/${id}`)).json();
  credits.push({
    id,
    title: detail.title,
    credit: detail.credit,
    size: detail.size_m,
    triangles: detail.triangles,
  });
}

fs.writeFileSync(
  path.join(OUT, 'CREDITS.json'),
  JSON.stringify(credits, null, 2) + '\n'
);

const md = [
  '# Hidden-item credits',
  '',
  'These are the "out of place" props the player hunts. The meshes are free',
  'low-poly models from Polyfork, used under CC BY 4.0 — the credit line below',
  'is the attribution that licence asks for. Files are hosted locally so the',
  'game keeps working offline (it ships as a Tauri desktop app).',
  '',
  '| Item | Asset | Licence |',
  '| --- | --- | --- |',
  ...credits.map((c) => `| ${c.title} | ${c.credit} | CC BY 4.0 |`),
  '',
  'HD editions and the `.mjs` source are **not** used: only the free GLB meshes.',
  'Nothing is resold or redistributed as an asset library.',
  '',
].join('\n');
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), md);

const total = credits.reduce(
  (sum, c) => sum + fs.statSync(path.join(OUT, `${c.id}.glb`)).size,
  0
);
console.log(`\n${credits.length} items, ${(total / 1024 / 1024).toFixed(2)} MB total`);
