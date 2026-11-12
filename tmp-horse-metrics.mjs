// Where is the saddle, how tall is the horse, and which way does it face?
// Walks the GLB node graph in Node, no browser needed.
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const want = new RegExp(process.argv[3] ?? 'horse', 'i');
const buf = readFileSync(file);
const g = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
const nodes = g.nodes ?? [];
const meshes = g.meshes ?? [];
const acc = g.accessors ?? [];

// --- minimal matrix maths (column-major, like glTF) ---
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}
function fromTRS(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function local(node) {
  if (node.matrix) return node.matrix.slice();
  return fromTRS(node.translation, node.rotation, node.scale);
}
const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

const world = new Array(nodes.length).fill(null);
const roots = nodes.map((_, i) => i).filter((i) => !nodes.some((n) => (n.children ?? []).includes(i)));
const stack = roots.map((i) => [i, I()]);
while (stack.length) {
  const [i, parent] = stack.pop();
  const m = mul(parent, local(nodes[i]));
  world[i] = m;
  for (const c of nodes[i].children ?? []) stack.push([c, m]);
}

const hits = nodes.map((n, i) => [n, i]).filter(([n]) => want.test(n.name ?? ''));
console.log(`matches: ${hits.length} ->`, hits.slice(0, 4).map(([n]) => n.name).join(', '));

for (const [, i] of hits.slice(0, 2)) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const bones = [];
  const st = [i];
  while (st.length) {
    const idx = st.pop();
    const node = nodes[idx];
    for (const c of node.children ?? []) st.push(c);
    if (node.mesh === undefined) {
      if (node.name) bones.push([node.name, apply(world[idx], [0, 0, 0])]);
      continue;
    }
    for (const prim of meshes[node.mesh]?.primitives ?? []) {
      const a = acc[prim.attributes.POSITION];
      if (!a?.min || !a?.max) continue;
      // 8 corners through the world matrix
      for (let k = 0; k < 8; k++) {
        const p = apply(world[idx], [
          k & 1 ? a.max[0] : a.min[0],
          k & 2 ? a.max[1] : a.min[1],
          k & 4 ? a.max[2] : a.min[2],
        ]);
        for (let d = 0; d < 3; d++) {
          min[d] = Math.min(min[d], p[d]);
          max[d] = Math.max(max[d], p[d]);
        }
      }
    }
  }
  const f = (v) => v.map((n) => +n.toFixed(2));
  console.log(`\n${nodes[i].name}  bbox min=${f(min)} max=${f(max)} size=${f(max.map((v, k) => v - min[k]))}`);
  for (const [name, p] of bones) {
    if (/hips|spine|chest|neck|head|saddle|bridle|tail\b|upLeg|foot/i.test(name))
      console.log(`   ${name.padEnd(22)} ${f(p)}`);
  }
}
