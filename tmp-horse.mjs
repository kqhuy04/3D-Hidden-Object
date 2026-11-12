// Is the kit's horse rigged? Walk the node graph from the horse's node and look
// for a skin, then print the bone names of whatever skeleton it carries.
import { readFileSync } from 'node:fs';
const file = process.argv[2];
const match = process.argv[3] ?? 'horse';
const buf = readFileSync(file);
const gltf = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
const nodes = gltf.nodes ?? [];
const kids = new Map();
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => kids.set(c, i)));

const hits = nodes.map((n, i) => [n, i]).filter(([n]) => new RegExp(match, 'i').test(n.name ?? ''));
console.log(`nodes matching /${match}/:`, hits.map(([n]) => n.name).slice(0, 6));

for (const [n, i] of hits.slice(0, 3)) {
  const stack = [i];
  const skins = new Set();
  const boneNames = [];
  let meshes = 0;
  while (stack.length) {
    const idx = stack.pop();
    const node = nodes[idx];
    if (!node) continue;
    if (node.skin !== undefined) skins.add(node.skin);
    if (node.mesh !== undefined) meshes++;
    (node.children ?? []).forEach((c) => stack.push(c));
  }
  const bones = [];
  for (const s of skins) for (const b of gltf.skins[s].joints) bones.push(nodes[b].name);
  console.log(`\n${n.name}: meshes=${meshes} skins=${skins.size} joints=${bones.length}`);
  console.log('  bones:', bones.slice(0, 18).join(', ') || '(none — rigid mesh)');
}
