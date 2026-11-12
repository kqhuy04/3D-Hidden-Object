// Prints, per map, every named prop group with its instance centres and the
// height of its top surface — the raw material for choosing a hiding spot
// against real furniture.
//
// One line per stem (three instances shown), so a whole map fits on a screen:
// the point is to pick "the bench by the water", not to read a scene graph.
//
// Usage: node tmp-anchors.mjs <map-id> [min-size] [max-stems]
import fs from 'node:fs';

const mapId = process.argv[2];
const MIN_SIZE = Number(process.argv[3] ?? 0.5);
const MAX_STEMS = Number(process.argv[4] ?? 45);

const MAPS = { 'campground-lake': 'public/assets/environment/scene.glb' };
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
const apply = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

const json = readGlb(file);
const nodes = json.nodes ?? [];
const meshes = json.meshes ?? [];
const accessors = json.accessors ?? [];

const out = [];
function walk(index, parent) {
  const node = nodes[index];
  const local = node.matrix ?? trs(node.translation ?? [0, 0, 0], node.rotation ?? [0, 0, 0, 1], node.scale ?? [1, 1, 1]);
  const world = mul(parent, local);

  if (node.mesh !== undefined) {
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const prim of meshes[node.mesh].primitives ?? []) {
      const acc = accessors[prim.attributes?.POSITION];
      if (!acc?.min) continue;
      for (const cx of [acc.min[0], acc.max[0]])
        for (const cy of [acc.min[1], acc.max[1]])
          for (const cz of [acc.min[2], acc.max[2]]) {
            const p = apply(world, cx, cy, cz);
            for (let k = 0; k < 3; k++) {
              box.min[k] = Math.min(box.min[k], p[k]);
              box.max[k] = Math.max(box.max[k], p[k]);
            }
          }
    }
    if (box.min[0] !== Infinity) {
      out.push({ name: node.name || meshes[node.mesh].name || `node${index}`, min: box.min, max: box.max });
    }
  }
  for (const child of node.children ?? []) walk(child, world);
}

for (const scene of json.scenes ?? [{ nodes: [0] }]) for (const root of scene.nodes ?? []) walk(root, I());

// Group by stem, then merge each stem's meshes into instances by proximity.
const stems = new Map();
for (const o of out) {
  const stem = o.name.replace(/_\d+$/, '');
  const list = stems.get(stem) ?? [];
  list.push(o);
  stems.set(stem, list);
}

const rows = [];
for (const [stem, list] of stems) {
  // Each instance is a set of meshes sharing a stem; merge boxes that overlap
  // in x/z so a table and its legs count once.
  const inst = [];
  for (const o of list) {
    const cx = (o.min[0] + o.max[0]) / 2;
    const cz = (o.min[2] + o.max[2]) / 2;
    const hit = inst.find((b) => Math.abs(b.cx - cx) < 1.2 && Math.abs(b.cz - cz) < 1.2);
    if (hit) {
      for (let k = 0; k < 3; k++) {
        hit.min[k] = Math.min(hit.min[k], o.min[k]);
        hit.max[k] = Math.max(hit.max[k], o.max[k]);
      }
      hit.cx = (hit.min[0] + hit.max[0]) / 2;
      hit.cz = (hit.min[2] + hit.max[2]) / 2;
    } else {
      inst.push({ cx, cz, min: [...o.min], max: [...o.max] });
    }
  }
  const size = [0, 1, 2].map((k) =>
    +(Math.max(...inst.map((b) => b.max[k])) - Math.min(...inst.map((b) => b.min[k]))).toFixed(2)
  );
  rows.push({ stem, inst, size, count: inst.length });
}

const filter = process.argv[5] ? new RegExp(process.argv[5], 'i') : null;

if (filter) {
  // Instance view: every placement of the named props, so one bench can be
  // picked out of the seven the map puts down.
  const hit = rows.filter((r) => filter.test(r.stem));
  if (!hit.length) console.log(`(nothing matches ${filter})`);
  for (const r of hit) {
    console.log(`${r.stem}  n=${r.count}`);
    r.inst
      .sort((a, b) => a.min[1] - b.min[1])
      .slice(0, 12)
      .forEach((b) => {
        const cx = ((b.min[0] + b.max[0]) / 2).toFixed(2);
        const cz = ((b.min[2] + b.max[2]) / 2).toFixed(2);
        const sx = (b.max[0] - b.min[0]).toFixed(1);
        const sz = (b.max[2] - b.min[2]).toFixed(1);
        console.log(
          `   x ${String(cx).padStart(7)}  z ${String(cz).padStart(7)}  ` +
            `top ${b.max[1].toFixed(2).padStart(6)}  base ${b.min[1].toFixed(2).padStart(6)}  ` +
            `footprint ${sx}x${sz}`
        );
      });
  }
} else {
  rows
    .filter((r) => Math.max(...r.size) >= MIN_SIZE)
    .sort((a, b) => b.count * Math.max(...b.size) - a.count * Math.max(...a.size))
    .slice(0, MAX_STEMS)
    .forEach((r) => {
      const inst = r.inst
        .sort((a, b) => a.min[1] - b.min[1])
        .slice(0, 3)
        .map(
          (b) =>
            `(${((b.min[0] + b.max[0]) / 2).toFixed(1)},${((b.min[2] + b.max[2]) / 2).toFixed(1)})` +
            ` top${b.max[1].toFixed(2)} h${(b.max[1] - b.min[1]).toFixed(1)}`
        )
        .join('  ');
      console.log(`${r.stem.padEnd(30)} n=${String(r.count).padStart(3)} ${r.size.join('x').padEnd(14)} ${inst}`);
    });
}

