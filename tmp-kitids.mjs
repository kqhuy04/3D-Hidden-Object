// The kit id is the name of the map's root node: coral-reef-a7128a.
import { readFileSync, readdirSync } from 'node:fs';
const DIR = 'public/assets/maps';
const rows = [];
for (const f of readdirSync(DIR).filter((n) => n.endsWith('.glb'))) {
  const buf = readFileSync(`${DIR}/${f}`);
  const gltf = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  const roots = (gltf.scenes?.[0]?.nodes ?? []).map((i) => gltf.nodes[i].name);
  rows.push({ map: f.replace('.glb', ''), kit: roots[0] ?? '?' });
}
for (const r of rows) console.log(`${r.map.padEnd(32)} ${r.kit}`);
