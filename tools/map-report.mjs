#!/usr/bin/env node
/**
 * Bounding-box report for a kit map.
 *
 * The game builds collision parts from the map's own placement nodes: one part
 * per child of the "part container" (see `findPartContainer` in
 * CollisionGeometry). That is also the right granularity for the photo targets —
 * one AABB per placed object — so this tool walks the glTF directly and reports
 * exactly what the runtime will see, without needing three.js or a browser.
 *
 * It runs on the *uncompressed* map: Draco drops the accessor min/max that make
 * this a cheap walk, and the source is what we keep anyway.
 *
 *   node tools/map-report.mjs <map.glb> [--out report.json] [--quiet]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export function readGlb(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${file}: not a GLB`);
  let off = 12;
  let json = null;
  let bin = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const start = off + 8;
    if (type === CHUNK_JSON) json = JSON.parse(buf.subarray(start, start + len).toString('utf8'));
    else if (type === CHUNK_BIN) bin = buf.subarray(start, start + len);
    off = start + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error(`${file}: no JSON chunk`);
  return { json, bin, bytes: buf.length };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major 4x4 multiply, same convention as glTF. */
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

/** TRS or matrix, whichever the node carries. */
function localMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation ?? [0, 0, 0];
  const q = n.rotation ?? [0, 0, 0, 1];
  const s = n.scale ?? [1, 1, 1];
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

const applyPoint = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

/** World AABB of an accessor box transformed by `m` (conservative: all 8 corners). */
function transformedBox(m, min, max) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const p = applyPoint(
      m,
      i & 1 ? max[0] : min[0],
      i & 2 ? max[1] : min[1],
      i & 4 ? max[2] : min[2]
    );
    for (let k = 0; k < 3; k++) {
      if (p[k] < lo[k]) lo[k] = p[k];
      if (p[k] > hi[k]) hi[k] = p[k];
    }
  }
  return { min: lo, max: hi };
}

/** Instance suffix stripping: `camp-canoe_3`, `camp-canoe.001` -> `camp-canoe`. */
export function assetKeyOf(name) {
  return String(name || '')
    .replace(/([._])\d+$/, '')
    .trim();
}

/**
 * The deepest single-child chain whose child holds mesh grandchildren — the same
 * walk `findPartContainer` does at runtime, so the parts reported here are the
 * parts the collision builder will produce.
 */
function findPartContainer(json, rootIndex) {
  let idx = rootIndex;
  for (let depth = 0; depth < 8; depth++) {
    const node = json.nodes[idx];
    const kids = node.children || [];
    if (kids.length !== 1) break;
    const only = json.nodes[kids[0]];
    if (only.mesh !== undefined) break;
    if (!only.children || only.children.length === 0) break;
    if (only.children.some((c) => json.nodes[c].mesh !== undefined)) break;
    idx = kids[0];
  }
  return idx;
}

/** Triangle count of a primitive, tolerating Draco (falls back to the accessor count). */
function primitiveTriangles(json, prim) {
  if (prim.indices !== undefined) {
    const acc = json.accessors[prim.indices];
    if (acc?.count) return acc.count / 3;
  }
  const pos = prim.attributes?.POSITION;
  if (pos !== undefined) {
    const acc = json.accessors[pos];
    if (acc?.count) return acc.count / 3;
  }
  return 0;
}

export function reportMap(file) {
  const { json, bytes } = readGlb(file);

  // scene -> root node -> ... -> part container
  const scene = json.scenes?.[json.scene ?? 0] ?? json.scenes?.[0];
  const roots = scene?.nodes ?? [];
  const rootIndex = roots[0] ?? 0;
  const containerIndex = findPartContainer(json, rootIndex);

  // World matrix for every node, memoised down from the scene root.
  const world = new Map();
  const walk = (idx, parentMatrix) => {
    const node = json.nodes[idx];
    const m = mul(parentMatrix, localMatrix(node));
    world.set(idx, m);
    for (const c of node.children || []) walk(c, m);
  };
  for (const r of roots) walk(r, IDENTITY);

  const objects = [];
  const container = json.nodes[containerIndex];
  for (const childIdx of container.children || []) {
    const child = json.nodes[childIdx];
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    let tris = 0;
    let meshCount = 0;

    const collect = (idx) => {
      const node = json.nodes[idx];
      if (node.mesh !== undefined) {
        const mesh = json.meshes[node.mesh];
        const m = world.get(idx) ?? IDENTITY;
        for (const prim of mesh.primitives || []) {
          const acc = json.accessors[prim.attributes?.POSITION];
          if (!acc?.min || !acc?.max) continue;
          const box = transformedBox(m, acc.min, acc.max);
          for (let k = 0; k < 3; k++) {
            if (box.min[k] < min[k]) min[k] = box.min[k];
            if (box.max[k] > max[k]) max[k] = box.max[k];
          }
          tris += primitiveTriangles(json, prim);
          meshCount++;
        }
      }
      for (const c of node.children || []) collect(c);
    };
    collect(childIdx);

    const valid = Number.isFinite(min[0]);
    objects.push({
      index: childIdx,
      name: child.name || `(node ${childIdx})`,
      key: assetKeyOf(child.name),
      meshes: meshCount,
      triangles: Math.round(tris),
      aabb: valid
        ? { min: min.map((v) => +v.toFixed(3)), max: max.map((v) => +v.toFixed(3)) }
        : null,
      size: valid
        ? max.map((v, i) => +(v - min[i]).toFixed(3))
        : null,
    });
  }

  // Group instances by asset key, which is what a target catalog is authored against.
  const byKey = new Map();
  for (const o of objects) {
    if (!byKey.has(o.key)) byKey.set(o.key, []);
    byKey.get(o.key).push(o);
  }
  const keys = [...byKey.entries()]
    .map(([key, list]) => ({
      key,
      instances: list.length,
      triangles: list.reduce((s, o) => s + o.triangles, 0),
      // Largest instance, which is the one a photo target would be framed on.
      maxExtent: Math.max(
        ...list.map((o) => (o.size ? Math.max(o.size[0], o.size[1], o.size[2]) : 0))
      ),
      hasBounds: list.every((o) => o.aabb),
    }))
    .sort((a, b) => b.instances - a.instances || a.key.localeCompare(b.key));

  const totalTris = objects.reduce((s, o) => s + o.triangles, 0);

  return {
    file: path.basename(file),
    bytes,
    generatedAt: new Date().toISOString(),
    structure: {
      nodes: json.nodes.length,
      meshes: json.meshes?.length ?? 0,
      materials: json.materials?.length ?? 0,
      images: json.images?.length ?? 0,
      partContainer: json.nodes[containerIndex]?.name || `(node ${containerIndex})`,
      extensions: json.extensionsUsed ?? [],
    },
    totals: {
      objects: objects.length,
      keys: keys.length,
      triangles: totalTris,
      meshes: objects.reduce((s, o) => s + o.meshes, 0),
      withoutBounds: objects.filter((o) => !o.aabb).length,
    },
    keys,
    objects,
  };
}

// ---- CLI ----
// Compare as file URLs: on Windows the path has backslashes and a space, so a
// naive string compare against import.meta.url never matches.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: node tools/map-report.mjs <map.glb> [--out report.json] [--quiet]');
    process.exit(1);
  }
  const outIdx = args.indexOf('--out');
  const quiet = args.includes('--quiet');
  const report = reportMap(file);

  if (outIdx !== -1 && args[outIdx + 1]) {
    writeFileSync(args[outIdx + 1], JSON.stringify(report, null, 1));
  }

  if (!quiet) {
    const mb = (n) => (n / 1048576).toFixed(2);
    console.log(`${report.file}  ${mb(report.bytes)} MB  ${report.structure.extensions.length ? `[${report.structure.extensions.join(', ')}]` : '[uncompressed]'}`);
    console.log(
      `  ${report.structure.nodes} nodes  ${report.structure.meshes} meshes  ` +
        `${report.structure.materials} materials  ${report.structure.images} images`
    );
    console.log(
      `  container "${report.structure.partContainer}": ${report.totals.objects} objects, ` +
        `${report.totals.triangles.toLocaleString()} triangles, ${report.totals.keys} distinct keys`
    );
    if (report.totals.withoutBounds) {
      console.log(`  WARNING: ${report.totals.withoutBounds} object(s) have no POSITION min/max`);
    }
    console.log('\n  key                              inst   tris   largest side');
    for (const k of report.keys.slice(0, 30)) {
      console.log(
        `  ${k.key.padEnd(32)} ${String(k.instances).padStart(4)} ${String(k.triangles).padStart(7)}` +
          `   ${k.maxExtent.toFixed(1)} m${k.hasBounds ? '' : '  (no bounds)'}`
      );
    }
    if (report.keys.length > 30) console.log(`  ... ${report.keys.length - 30} more keys`);
  }
}
