// Reads a prepared map GLB straight from disk and prints the named props with
// their world-space bounds, so a hiding spot can be chosen against a real
// object ("under the camp kitchen table") instead of guessed coordinates.
//
// No three.js: glTF accessors already carry min/max, so the eight corners of
// each primitive's box can be pushed through the node hierarchy by hand.
import fs from 'node:fs';
import path from 'node:path';

const mapId = process.argv[2] ?? 'campground-lake';
const filter = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;
const MIN_SIZE = Number(process.argv[4] ?? 0);

const MAPS = {
  'campground-lake': 'public/assets/environment/scene.glb',
};
const file = MAPS[mapId] ?? `public/assets/maps/${mapId}.glb`;

function readGlb(p) {
  const buf = fs.readFileSync(p);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a glb');
  let off = 12;
  let json = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  return json;
}

// --- tiny 4x4 matrix helpers (column-major, glTF order) ---------------------
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(t, r, s) {
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
function apply(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

const json = readGlb(file);
const nodes = json.nodes ?? [];
const meshes = json.meshes ?? [];
const accessors = json.accessors ?? [];

const out = [];
function walk(index, parent, depth) {
  const node = nodes[index];
  const local = node.matrix
    ? node.matrix
    : trs(node.translation ?? [0, 0, 0], node.rotation ?? [0, 0, 0, 1], node.scale ?? [1, 1, 1]);
  const world = mul(parent, local);

  if (node.mesh !== undefined) {
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    let tris = 0;
    for (const prim of meshes[node.mesh].primitives ?? []) {
      const acc = accessors[prim.attributes?.POSITION];
      if (!acc?.min) continue;
      tris += prim.indices !== undefined ? accessors[prim.indices].count / 3 : acc.count / 3;
      const [x0, y0, z0] = acc.min;
      const [x1, y1, z1] = acc.max;
      for (const cx of [x0, x1])
        for (const cy of [y0, y1])
          for (const cz of [z0, z1]) {
            const p = apply(world, cx, cy, cz);
            for (let k = 0; k < 3; k++) {
              box.min[k] = Math.min(box.min[k], p[k]);
              box.max[k] = Math.max(box.max[k], p[k]);
            }
          }
    }
    if (box.min[0] !== Infinity) {
      out.push({
        name: node.name || meshes[node.mesh].name || `node${index}`,
        depth,
        tris: Math.round(tris),
        min: box.min.map((v) => +v.toFixed(2)),
        max: box.max.map((v) => +v.toFixed(2)),
        size: [0, 1, 2].map((k) => +(box.max[k] - box.min[k]).toFixed(2)),
      });
    }
  }

  for (const child of node.children ?? []) walk(child, world, depth + 1);
}

for (const scene of json.scenes ?? [{ nodes: [0] }]) {
  for (const root of scene.nodes ?? []) walk(root, I(), 0);
}

// A prop is a group of meshes sharing a name stem (`tent`, `tent_1`, ...).
const groups = new Map();
for (const o of out) {
  const stem = o.name.replace(/_\d+$/, '');
  const g = groups.get(stem) ?? { stem, count: 0, tris: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  g.count++;
  g.tris += o.tris;
  for (let k = 0; k < 3; k++) {
    g.min[k] = Math.min(g.min[k], o.min[k]);
    g.max[k] = Math.max(g.max[k], o.max[k]);
  }
  groups.set(stem, g);
}

const rows = [...groups.values()]
  .map((g) => ({
    stem: g.stem,
    count: g.count,
    tris: g.tris,
    size: [0, 1, 2].map((k) => +(g.max[k] - g.min[k]).toFixed(2)),
    centre: [0, 1, 2].map((k) => +((g.min[k] + g.max[k]) / 2).toFixed(2)),
    min: g.min.map((v) => +v.toFixed(2)),
    max: g.max.map((v) => +v.toFixed(2)),
  }))
  .filter((r) => !filter || filter.test(r.stem))
  .filter((r) => Math.max(...r.size) >= MIN_SIZE)
  .sort((a, b) => b.tris - a.tris);

console.log(`# ${mapId}: ${out.length} mesh nodes, ${rows.length} named groups`);
if (filter) {
  // Instance view: one line per mesh, so a single tent can be picked out of the
  // seven the map places.
  for (const o of out.filter((o) => filter.test(o.name)).sort((a, b) => a.min[1] - b.min[1])) {
    const c = [0, 1, 2].map((k) => +((o.min[k] + o.max[k]) / 2).toFixed(2));
    console.log(
      `  ${o.name.padEnd(30)} size ${o.size.join('x').padEnd(15)} ` +
        `centre ${c.join(', ').padEnd(19)} y ${o.min[1]}..${o.max[1]}`
    );
  }
  console.log('');
}
for (const r of rows) {
  console.log(
    `${r.stem.padEnd(34)} n=${String(r.count).padStart(3)} ${String(r.tris).padStart(6)}t ` +
      `size ${r.size.join('x').padEnd(16)} centre ${r.centre.join(', ').padEnd(20)} ` +
      `y ${r.min[1]}..${r.max[1]}`
  );
}
