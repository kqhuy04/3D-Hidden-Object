// Read the JSON chunk of a GLB and list node/mesh names. No three.js, no GPU:
// this is the cheap way to ask "does this map already contain a water plane".
import { readFileSync } from 'node:fs';

function glbJson(file) {
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
}

for (const file of process.argv.slice(2)) {
  const gltf = glbJson(file);
  const names = (gltf.nodes ?? []).map((n) => n.name ?? '');
  const hits = names.filter((n) => /water|sea|ocean|lake|river|wave|snow|ice/i.test(n));
  console.log(`\n== ${file} — ${names.length} nodes, ${gltf.meshes?.length ?? 0} meshes`);
  console.log('   water-ish:', hits.length ? hits.join(', ') : '(none)');
  const roots = (gltf.scenes?.[0]?.nodes ?? []).map((i) => names[i]);
  console.log('   roots:', roots.slice(0, 8).join(', '));
}
