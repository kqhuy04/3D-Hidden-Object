// Dumps node names + world-space bounds from a GLB without a browser.
// The kit archives are plain glTF 2.0 binary, so the JSON chunk is enough:
// every POSITION accessor carries its own min/max, and the node hierarchy
// carries the transform. No three.js, no GPU, no SwiftShader.
import fs from 'node:fs';

const file = process.argv[2];
const filter = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;

const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
let off = 12;
let gltf = null;
let bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) gltf = JSON.parse(data.toString('utf8'));
  if (type === 0x004e4942) bin = data;
  off += 8 + len + ((4 - (len % 4)) % 4);
}

const nodes = gltf.nodes || [];
const meshes = gltf.meshes || [];
const accessors = gltf.accessors || [];

// 4x4 column-major matrices, same layout glTF stores.
const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
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
function fromTRS(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0, 0, 0];
  const q = n.rotation || [0, 0, 0, 1];
  const s = n.scale || [1, 1, 1];
  const [x, y, z, w] = q;
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
function xf(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

const rows = [];
function walk(i, parent, depth) {
  const n = nodes[i];
  const world = mul(parent, fromTRS(n));
  if (n.mesh !== undefined) {
    const mesh = meshes[n.mesh];
    let mn = [Infinity, Infinity, Infinity];
    let mx = [-Infinity, -Infinity, -Infinity];
    let prims = 0;
    for (const p of mesh.primitives || []) {
      const acc = accessors[p.attributes?.POSITION];
      if (!acc || !acc.min) continue;
      prims++;
      // Only the 8 corners of the accessor's own box, which is exact enough for
      // "does this prop stand on the ground".
      for (let k = 0; k < 8; k++) {
        const c = [
          k & 1 ? acc.max[0] : acc.min[0],
          k & 2 ? acc.max[1] : acc.min[1],
          k & 4 ? acc.max[2] : acc.min[2],
        ];
        const w = xf(world, c);
        for (let a = 0; a < 3; a++) {
          mn[a] = Math.min(mn[a], w[a]);
          mx[a] = Math.max(mx[a], w[a]);
        }
      }
    }
    if (prims) {
      rows.push({
        name: n.name || mesh.name || `node_${i}`,
        depth,
        min: mn.map((v) => +v.toFixed(2)),
        max: mx.map((v) => +v.toFixed(2)),
        size: mx.map((v, a) => +(v - mn[a]).toFixed(2)),
      });
    }
  }
  for (const c of n.children || []) walk(c, world, depth + 1);
}

const scene = gltf.scenes?.[gltf.scene ?? 0];
for (const r of scene?.nodes || []) walk(r, IDENT, 0);

const hit = filter ? rows.filter((r) => filter.test(r.name)) : rows;
console.log(`nodes with geometry: ${rows.length}, matching: ${hit.length}`);
for (const r of hit.slice(0, 80)) {
  console.log(
    `${'  '.repeat(r.depth)}${r.name.padEnd(34)} min(${r.min.join(', ')}) max(${r.max.join(', ')}) size(${r.size.join(', ')})`
  );
}
