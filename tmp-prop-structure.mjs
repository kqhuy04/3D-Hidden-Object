// Structure of the props worth wiring a verb to: how deep the named node sits,
// how many meshes it owns, and whether its origin looks like a hinge.
// Also: every skeleton in the map, classified humanoid / quadruped / other.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const want = new RegExp(process.argv[3] ?? 'door|chair|horse|bench|lantern', 'i');
const buf = readFileSync(file);
const gltf = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
const nodes = gltf.nodes ?? [];
const meshes = gltf.meshes ?? [];
const acc = gltf.accessors ?? [];

const parent = new Map();
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));

function depth(i) {
  let d = 0;
  let p = parent.get(i);
  while (p !== undefined) {
    d++;
    p = parent.get(p);
  }
  return d;
}

function subtreeMeshes(i) {
  const out = [];
  const stack = [i];
  while (stack.length) {
    const idx = stack.pop();
    const node = nodes[idx];
    if (!node) continue;
    if (node.mesh !== undefined) out.push(idx);
    (node.children ?? []).forEach((c) => stack.push(c));
  }
  return out;
}

const hits = nodes.map((n, i) => [n, i]).filter(([n]) => want.test(n.name ?? ''));
console.log(`matches for /${want.source}/: ${hits.length}`);
for (const [n, i] of hits.slice(0, 10)) {
  const meshIds = subtreeMeshes(i);
  // Bounding box from the POSITION accessor min/max of each mesh, in node space
  // (ignores node transforms, which is enough to see the shape of the thing).
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const m of meshIds) {
    for (const prim of meshes[nodes[m].mesh]?.primitives ?? []) {
      const a = acc[prim.attributes.POSITION];
      if (!a?.min || !a?.max) continue;
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], a.min[k]);
        max[k] = Math.max(max[k], a.max[k]);
      }
    }
  }
  const size = max.map((v, k) => +(v - min[k]).toFixed(2));
  const t = n.translation ?? [0, 0, 0];
  const r = n.rotation ?? [0, 0, 0, 1];
  console.log(
    `  ${(n.name ?? '?').padEnd(28)} depth=${depth(i)} meshes=${meshIds.length} ` +
      `skinned=${meshIds.some((m) => nodes[m].skin !== undefined)} ` +
      `size=${size.join('x')} origin=[${t.map((v) => v.toFixed(2))}] rot=${r.map((v) => v.toFixed(2))}`
  );
}

// Skeletons
const skins = gltf.skins ?? [];
console.log(`\nskins: ${skins.length}`);
const seen = new Set();
for (const skin of skins) {
  const names = skin.joints.map((j) => (nodes[j].name ?? '').replace(/_\d+$/, ''));
  const key = names.length + ':' + names.slice(0, 3).join(',');
  if (seen.has(key)) continue;
  seen.add(key);
  const set = new Set(names);
  const human = ['Hips', 'Spine2', 'LeftForeArm', 'RightUpLeg'].every((b) => set.has(b));
  const quad = set.has('Hips') && !human && names.some((b) => /FrontUpLeg|HindUpLeg/.test(b));
  const kind = human ? 'humanoid' : quad ? 'QUADRUPED' : 'other';
  // name of the owning node
  const owners = nodes.map((n, i) => [n, i]).filter(([n]) => (n.skin === skins.indexOf(skin)));
  console.log(`  ${kind.padEnd(9)} joints=${String(names.length).padStart(3)} ${(owners[0]?.[0].name ?? '?').slice(0, 30)}  [${names.slice(0, 10).join(',')}]`);
}
