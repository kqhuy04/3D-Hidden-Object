// How many props per map fall into each interaction family, using the same
// size filter the decoy list uses (span 0.1 - 2.0 m).
import { readFileSync, readdirSync } from 'node:fs';

const FAMILIES = {
  hinge: /(^|[-_])(doors?|gates?|shutters?|hatch|lid|drawers?|cabinets?|cupboard|wardrobe|chest|trunk|locker|fridge|freezer|toolbox|window)([-_]|$)/i,
  spin: /(^|[-_])(wheel|valve|crank|propeller|fan|turbine|winch|reel|spool|handwheel)([-_]|$)/i,
  rock: /(^|[-_])(swing|bell|rocking-chair|hanging-sign|chime|pendulum)([-_]|$)/i,
  lamp: /(^|[-_])(lamp|lantern|torch|candle|sconce|streetlight|floodlight|neon)([-_]|$)/i,
  ride: /(^|[-_])(saddled-horse|horse|burro|donkey|pony|mule|cow|ibex|llama|camel)([-_]|$)/i,
};

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
const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

const totals = {};
const samples = {};
for (const file of readdirSync('public/assets/maps').filter((f) => f.endsWith('.glb'))) {
  const buf = readFileSync(`public/assets/maps/${file}`);
  let g;
  try {
    g = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  } catch {
    continue;
  }
  const nodes = g.nodes ?? [];
  const meshes = g.meshes ?? [];
  const acc = g.accessors ?? [];
  const world = new Array(nodes.length).fill(null);
  const roots = nodes.map((_, i) => i).filter((i) => !nodes.some((n) => (n.children ?? []).includes(i)));
  const stack = roots.map((i) => [i, I()]);
  while (stack.length) {
    const [i, parent] = stack.pop();
    const m = mul(parent, nodes[i].matrix ? nodes[i].matrix.slice() : fromTRS(nodes[i].translation, nodes[i].rotation, nodes[i].scale));
    world[i] = m;
    for (const c of nodes[i].children ?? []) stack.push([c, m]);
  }
  // container: descend while a single child that is not a mesh
  let container = 0;
  const rootIndex = roots[0];
  container = rootIndex;
  for (let d = 0; d < 8; d++) {
    const kids = nodes[container].children ?? [];
    if (kids.length !== 1) break;
    const only = kids[0];
    if (nodes[only].mesh !== undefined) break;
    if ((nodes[only].children ?? []).length === 0) break;
    container = only;
  }

  const counts = {};
  for (const childIndex of nodes[container].children ?? []) {
    const name = (nodes[childIndex].name ?? '').toLowerCase();
    if (!name) continue;
    let family = null;
    for (const [f, re] of Object.entries(FAMILIES)) if (re.test(name)) { family = f; break; }
    if (!family) continue;
    // world bbox of the whole subtree
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const st = [childIndex];
    while (st.length) {
      const idx = st.pop();
      for (const c of nodes[idx].children ?? []) st.push(c);
      if (nodes[idx].mesh === undefined) continue;
      for (const prim of meshes[nodes[idx].mesh]?.primitives ?? []) {
        const a = acc[prim.attributes.POSITION];
        if (!a?.min) continue;
        for (let k = 0; k < 8; k++) {
          const p = apply(world[idx], [k & 1 ? a.max[0] : a.min[0], k & 2 ? a.max[1] : a.min[1], k & 4 ? a.max[2] : a.min[2]]);
          for (let d = 0; d < 3; d++) { min[d] = Math.min(min[d], p[d]); max[d] = Math.max(max[d], p[d]); }
        }
      }
    }
    if (!Number.isFinite(min[0])) continue;
    const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    if (span > 2.0 || span < 0.1) continue;
    counts[family] = (counts[family] ?? 0) + 1;
    totals[family] = (totals[family] ?? 0) + 1;
    if (!samples[family]) samples[family] = new Set();
    if (samples[family].size < 12) samples[family].add(name);
  }
  const line = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ');
  if (line) console.log(`${file.replace('.glb', '').padEnd(30)} ${line}`);
}
console.log('\ntotals', totals);
for (const [f, s] of Object.entries(samples)) console.log(`${f}:`, [...s].join(', '));
