// Finds props whose footprint does not sit on the terrain.
//
// Reads the GLB directly: the ground primitive is rasterised into a coarse
// heightmap, then every prop's lowest corners are compared against it. Pure
// JavaScript, no browser and no GPU — the point is to answer "is this fence end
// in mid-air" in two seconds instead of a thirteen-minute SwiftShader run.
import fs from 'node:fs';

const file = process.argv[2];
const nameFilter = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;
/** Anything whose lowest corner floats more than this is reported, in metres. */
const FLOAT_LIMIT = Number(process.argv[4] ?? 0.12);

const buf = fs.readFileSync(file);
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

const CT = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(i) {
  const a = gltf.accessors[i];
  const bv = gltf.bufferViews?.[a.bufferView];
  // A sparse or initialised-to-zero accessor has no bufferView; every component
  // is zero, which for indices means a degenerate triangle and for positions
  // means a vertex at the origin. Skipping the primitive is not an option, so
  // hand back zeros and let the caller cope.
  if (!bv) return new CT[a.componentType](a.count * NC[a.type]);
  const TA = CT[a.componentType];
  const n = NC[a.type];
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new TA(a.count * n);
  // Stride-aware copy: interleaved attributes are legal glTF.
  const stride = bv.byteStride || TA.BYTES_PER_ELEMENT * n;
  const view = new DataView(bin.buffer, bin.byteOffset + start, a.count * stride);
  const getter = {
    5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16',
    5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32',
  }[a.componentType];
  for (let e = 0; e < a.count; e++) {
    for (let c = 0; c < n; c++) {
      out[e * n + c] = view[getter](e * stride + c * TA.BYTES_PER_ELEMENT, true);
    }
  }
  return out;
}

const nodes = gltf.nodes || [];
const meshes = gltf.meshes || [];

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
const xf = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

// Collect every triangle of the terrain into world space, plus each prop's box.
const terrain = [];
const props = [];
function walk(i, parent, depth) {
  const n = nodes[i];
  const world = mul(parent, fromTRS(n));
  if (n.mesh !== undefined) {
    const mesh = meshes[n.mesh];
    const name = n.name || mesh.name || `node_${i}`;
    const isTerrain = /^(ground|terrain|duff|grass|snow|sand)$/i.test(name);
    let mn = [Infinity, Infinity, Infinity];
    let mx = [-Infinity, -Infinity, -Infinity];
    for (const p of mesh.primitives || []) {
      const posAcc = p.attributes?.POSITION;
      if (posAcc === undefined) continue;
      const pos = readAccessor(posAcc);
      const idx = p.indices !== undefined ? readAccessor(p.indices) : null;
      const count = idx ? idx.length : pos.length / 3;
      if (isTerrain) {
        for (let t = 0; t < count; t += 3) {
          const a = xf(world, [pos[idx[t] * 3], pos[idx[t] * 3 + 1], pos[idx[t] * 3 + 2]]);
          const b = xf(world, [pos[idx[t + 1] * 3], pos[idx[t + 1] * 3 + 1], pos[idx[t + 1] * 3 + 2]]);
          const c = xf(world, [pos[idx[t + 2] * 3], pos[idx[t + 2] * 3 + 1], pos[idx[t + 2] * 3 + 2]]);
          terrain.push([a, b, c]);
        }
      }
      for (let v = 0; v < pos.length; v += 3) {
        const w = xf(world, [pos[v], pos[v + 1], pos[v + 2]]);
        for (let k = 0; k < 3; k++) {
          mn[k] = Math.min(mn[k], w[k]);
          mx[k] = Math.max(mx[k], w[k]);
        }
      }
    }
    if (mn[0] !== Infinity && !isTerrain) {
      props.push({ name, depth, min: mn, max: mx });
    }
  }
  for (const c of n.children || []) walk(c, world, depth + 1);
}
const scene = gltf.scenes?.[gltf.scene ?? 0];
for (const r of scene?.nodes || []) walk(r, IDENT, 0);

console.log(`terrain triangles: ${terrain.length}, props: ${props.length}`);

/** Height of the terrain directly above/below (x, z), or null if nothing there. */
function groundAt(x, z) {
  let best = null;
  for (const [a, b, c] of terrain) {
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-9) continue;
    const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
    if (best === null || y > best) best = y;
  }
  return best;
}

// --- profile mode -------------------------------------------------------
if (process.argv[5] === '--profile') {
  const target = props.filter((p) => nameFilter.test(p.name));
  target.sort((a, b) => a.min[0] - b.min[0] || a.min[2] - b.min[2]);
  for (const p of target) {
    const cx = (p.min[0] + p.max[0]) / 2;
    const cz = (p.min[2] + p.max[2]) / 2;
    // Sample the two ends along the long axis, inset by 10 cm so the sample
    // lands under the post rather than past the end of the rail.
    const alongX = p.max[0] - p.min[0] > p.max[2] - p.min[2];
    const pts = alongX
      ? [[p.min[0] + 0.1, cz], [p.max[0] - 0.1, cz]]
      : [[cx, p.min[2] + 0.1], [cx, p.max[2] - 0.1]];
    const gs = pts.map(([x, z]) => groundAt(x, z));
    console.log(
      `${p.name.padEnd(8)} x[${p.min[0].toFixed(1)},${p.max[0].toFixed(1)}] ` +
        `z[${p.min[2].toFixed(1)},${p.max[2].toFixed(1)}] ` +
        `bottom ${p.min[1].toFixed(2)} top ${p.max[1].toFixed(2)}  ` +
        `ground ${gs.map((g) => (g === null ? 'none' : g.toFixed(2))).join(' / ')}  ` +
        `gap ${gs.map((g) => (g === null ? '-' : (p.min[1] - g).toFixed(2))).join(' / ')}`
    );
  }
  process.exit(0);
}

const bad = [];
for (const p of props) {
  if (nameFilter && !nameFilter.test(p.name)) continue;
  // Four footprint corners; the gap is measured against the lowest of them,
  // because a prop that is only partly over a hole still reads as floating when
  // the hole is under its visible end.
  const xs = [p.min[0], p.max[0]];
  const zs = [p.min[2], p.max[2]];
  const gaps = [];
  for (const x of xs)
    for (const z of zs) {
      const g = groundAt(x, z);
      if (g !== null) gaps.push(p.min[1] - g);
    }
  if (!gaps.length) continue;
  const worst = Math.max(...gaps);
  if (worst > FLOAT_LIMIT) {
    bad.push({ ...p, worst, gaps: gaps.map((g) => +g.toFixed(2)) });
  }
}

bad.sort((a, b) => b.worst - a.worst);
console.log(`\nprops floating more than ${FLOAT_LIMIT} m: ${bad.length}`);
for (const p of bad.slice(0, 40)) {
  console.log(
    `${p.name.padEnd(30)} float ${p.worst.toFixed(2)}m  ` +
      `x[${p.min[0].toFixed(1)}, ${p.max[0].toFixed(1)}] ` +
      `y${p.min[1].toFixed(2)} z[${p.min[2].toFixed(1)}, ${p.max[2].toFixed(1)}] ` +
      `corners ${p.gaps.join(' ')}`
  );
}
