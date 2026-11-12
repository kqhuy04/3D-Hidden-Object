// Object-to-spawn distance for every map, parsed from the data files.
//
// The first version of this used a lazy regex across the whole map block and
// silently swallowed the *next* item's spot whenever an item had no `y` in its
// spot (the kits' exporters omit it when the object sits on the ground). That
// reported a hay bale at 39 m when it is at 27. This version cuts the file into
// one block per object first, so a block can only ever yield its own spot.
import fs from 'node:fs';

const src = fs.readFileSync('src/data/hiddenItems.ts', 'utf8');
const reg = fs.readFileSync('src/data/mapRegistry.ts', 'utf8');

const spawns = new Map();
for (const m of reg.matchAll(/"id": "([^"]+)"[\s\S]*?"spawn": \{\s*"x": (-?[\d.]+),\s*"y": (-?[\d.]+),\s*"z": (-?[\d.]+)/g)) {
  spawns.set(m[1], { x: +m[2], y: +m[3], z: +m[4] });
}

const rows = [];
const mapStarts = [...src.matchAll(/^  '([a-z0-9-]+)': \{/gm)];
for (let i = 0; i < mapStarts.length; i++) {
  const mapId = mapStarts[i][1];
  const from = mapStarts[i].index;
  const to = i + 1 < mapStarts.length ? mapStarts[i + 1].index : src.length;
  const body = src.slice(from, to);
  const spawn = spawns.get(mapId);
  if (!spawn) continue;

  // One block per object: from its id up to the next id.
  const idStarts = [...body.matchAll(/id: '([^']+)'/g)];
  for (let k = 0; k < idStarts.length; k++) {
    const a = idStarts[k].index;
    const b = k + 1 < idStarts.length ? idStarts[k + 1].index : body.length;
    const block = body.slice(a, b);
    const spot = block.match(/spot: \{\s*x: (-?[\d.]+),(?:\s*y: (-?[\d.]+),)?\s*z: (-?[\d.]+)\s*\}/);
    if (!spot) continue;
    const x = +spot[1];
    const z = +spot[3];
    rows.push({ map: mapId, item: idStarts[k][1], spot: { x, z }, d: +Math.hypot(x - spawn.x, z - spawn.z).toFixed(1) });
  }
}

rows.sort((p, q) => q.d - p.d);
const over = rows.filter((r) => r.d > 20);
console.log(`${rows.length} objects parsed; ${over.length} beyond 20 m of spawn\n`);
for (const r of over) console.log(`  ${r.map.padEnd(32)} ${r.item.padEnd(18)} ${r.d} m`);

// Is the spawn misplaced, or are the objects? If every object on a map sits
// well to one side of the spawn, moving the spawn fixes five objects at once;
// if they are spread evenly around it, the map is simply big.
console.log('\nspawn vs the centre of its objects:');
for (const [mapId, spawn] of spawns) {
  const mine = rows.filter((r) => r.map === mapId);
  if (mine.length < 2) continue;
  const pts = mine.map((r) => r.spot);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  const offset = Math.hypot(cx - spawn.x, cz - spawn.z);
  const spread = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.z - cz)));
  console.log(
    `  ${mapId.padEnd(32)} offset ${offset.toFixed(1).padStart(5)} m   spread ${spread.toFixed(1).padStart(5)} m   ` +
    `farthest ${Math.max(...mine.map((r) => r.d)).toFixed(1)} m`
  );
}
