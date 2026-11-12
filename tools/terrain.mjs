// Decodes the Draco-compressed terrain out of a kit GLB and answers "what is
// the ground height at (x, z)".
//
// Every archive in this project is Draco-compressed, so the vertex data is not
// in the file as plain floats and `accessor.min/max` is the only thing left to
// read without a decoder. three ships the decoder in
// `examples/jsm/libs/draco/`, and the emscripten build runs in Node, so the
// terrain can be sampled here — in about two seconds, with no GPU and no
// browser, which matters because a SwiftShader harness run on this machine
// takes thirteen minutes and pins every core.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function loadDraco() {
  // The wrapper is CommonJS; `tools/draco.cjs` boots it. See that file.
  const factory = require('./draco.cjs');
  return factory();
}

export function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB`);
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
  return { gltf, bin };
}

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
export function fromTRS(n) {
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
export const xf = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

/** Decodes one primitive's POSITION + indices into world-space triangles. */
function decodePrimitive(mod, gltf, bin, prim, world) {
  const ext = prim.extensions?.KHR_draco_mesh_compression;
  const posAccessor = gltf.accessors[prim.attributes.POSITION];

  if (!ext) {
    const bv = gltf.bufferViews[posAccessor.bufferView];
    const start = (bv.byteOffset || 0) + (posAccessor.byteOffset || 0);
    const arr = new Float32Array(bin.buffer, bin.byteOffset + start, posAccessor.count * 3);
    const idx = prim.indices !== undefined ? readIndex(gltf, bin, prim.indices) : null;
    return toTris(arr, idx, world);
  }

  const bv = gltf.bufferViews[ext.bufferView];
  const start = (bv.byteOffset || 0) + (ext.byteOffset || 0);
  const data = bin.subarray(start, start + bv.byteLength);

  const decoder = new mod.Decoder();
  const buffer = new mod.DecoderBuffer();
  buffer.Init(new Int8Array(data), data.length);
  const mesh = new mod.Mesh();
  const status = decoder.DecodeBufferToMesh(buffer, mesh);
  if (!status.ok() || mesh.ptr === 0) throw new Error('draco decode failed: ' + status.error_msg());

  const attr = decoder.GetAttributeByUniqueId(mesh, ext.attributes.POSITION);
  const count = mesh.num_points();
  const ncomp = attr.num_components();
  const dracoArr = new mod.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(mesh, attr, dracoArr);

  const pos = new Float32Array(count * 3);
  // `GetValue` takes a flat index and *returns* the float; it does not write
  // into an out-parameter. Passing an array here silently yields zeros, and
  // every vertex lands on the same point.
  for (let i = 0; i < count; i++) {
    pos[i * 3] = dracoArr.GetValue(i * 3);
    pos[i * 3 + 1] = dracoArr.GetValue(i * 3 + 1);
    pos[i * 3 + 2] = dracoArr.GetValue(i * 3 + 2);
  }

  const idxArr = new mod.DracoInt32Array();
  const faceCount = mesh.num_faces();
  const idx = new Uint32Array(faceCount * 3);
  for (let f = 0; f < faceCount; f++) {
    decoder.GetFaceFromMesh(mesh, f, idxArr);
    idx[f * 3] = idxArr.GetValue(0);
    idx[f * 3 + 1] = idxArr.GetValue(1);
    idx[f * 3 + 2] = idxArr.GetValue(2);
  }

  mod.destroy(dracoArr);
  mod.destroy(idxArr);
  mod.destroy(mesh);
  mod.destroy(buffer);
  mod.destroy(decoder);
  return toTris(pos, idx, world);
}

function readIndex(gltf, bin, accIndex) {
  const a = gltf.accessors[accIndex];
  const bv = gltf.bufferViews[a.bufferView];
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const TA = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
  return new TA(bin.buffer, bin.byteOffset + start, a.count);
}

function toTris(pos, idx, world) {
  const out = [];
  const n = idx ? idx.length : pos.length / 3;
  for (let t = 0; t < n; t += 3) {
    const a = idx ? idx[t] : t;
    const b = idx ? idx[t + 1] : t + 1;
    const c = idx ? idx[t + 2] : t + 2;
    out.push([
      xf(world, [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]]),
      xf(world, [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]]),
      xf(world, [pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]]),
    ]);
  }
  return out;
}

/**
 * What a ground mesh is called, across every kit in this project.
 *
 * Matched on the *end* of the name, not the whole of it: kits prefix their
 * ground mesh with the map (`alpine-snow-terrain`) or name it for what it is
 * (`mountain`), and an exact-match list silently found nothing on either. The
 * leading separator is required so that `snow-laden-spruce` — 44 of them — is
 * not mistaken for terrain, and `bare-mountain-rowan` is not mistaken for a
 * mountain. `water` is deliberately absent: a lake is not ground to stand on.
 *
 * Exported because `audit-grounding.mjs` needs the same answer, and two copies
 * of this regex is how one of them ends up wrong.
 */
export const TERRAIN_NAME = /^(snow)$|(?:^|[-_.])(terrain|ground|mountain|duff|grass|sand|soil|beach|shore)$/i;

/** Walks the node tree and decodes every mesh named like terrain. */
export function decodeTerrain(mod, gltf, bin) {
  const terrain = [];
  const nodes = gltf.nodes || [];
  const meshes = gltf.meshes || [];
  const TERRAIN = TERRAIN_NAME;

  function walk(i, parent) {
    const n = nodes[i];
    const world = mul(parent, fromTRS(n));
    if (n.mesh !== undefined && TERRAIN.test(n.name || meshes[n.mesh].name || '')) {
      for (const p of meshes[n.mesh].primitives || []) {
        if (p.attributes?.POSITION === undefined) continue;
        terrain.push(...decodePrimitive(mod, gltf, bin, p, world));
      }
    }
    for (const c of n.children || []) walk(c, world);
  }
  for (const r of gltf.scenes?.[gltf.scene ?? 0]?.nodes || []) walk(r, IDENT);
  return terrain;
}

/**
 * Highest terrain height at (x, z), or null when the point is off the mesh.
 *
 * Highest rather than nearest: the ground mesh has cliffs and overhangs, and a
 * prop standing on the upper shelf must not be measured against the beach
 * underneath it.
 *
 * Triangles are bucketed into a 2 m grid first. A twenty-two-thousand-triangle
 * linear scan is fine for one query and hopeless for the thousand an audit
 * makes: the map below turns every lookup into a handful of candidate tests.
 */
export function makeSampler(terrain) {
  const CELL = 2;
  const buckets = new Map();
  const key = (ix, iz) => ix * 100003 + iz;

  terrain.forEach((tri, i) => {
    const xs = [tri[0][0], tri[1][0], tri[2][0]];
    const zs = [tri[0][2], tri[1][2], tri[2][2]];
    const x0 = Math.floor(Math.min(...xs) / CELL);
    const x1 = Math.floor(Math.max(...xs) / CELL);
    const z0 = Math.floor(Math.min(...zs) / CELL);
    const z1 = Math.floor(Math.max(...zs) / CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iz = z0; iz <= z1; iz++) {
        const k = key(ix, iz);
        const list = buckets.get(k);
        if (list) list.push(i);
        else buckets.set(k, [i]);
      }
  });

  return (x, z) => {
    const list = buckets.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return null;
    let best = null;
    for (const i of list) {
      const [a, b, c] = terrain[i];
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(d) < 1e-9) continue;
      const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
      if (l1 < -1e-6) continue;
      const l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
      if (l2 < -1e-6) continue;
      const l3 = 1 - l1 - l2;
      if (l3 < -1e-6) continue;
      const y = l1 * a[1] + l2 * b[1] + l3 * c[1];
      if (best === null || y > best) best = y;
    }
    return best;
  };
}
