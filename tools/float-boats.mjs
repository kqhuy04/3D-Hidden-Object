// Float the boats: every craft placed in the lake is moved so its hull sits at a
// believable waterline instead of under (or above) the water plane.
//
// The kit bakes each placement into a node matrix and the hull vertices are in
// local space, so the fix is a Y offset on the placement matrix — no geometry is
// touched and the collision build follows automatically.
//
// Idempotent: the shift is computed from where the hull is now, so running it
// twice does nothing.
//
//   node tools/float-boats.mjs public/assets/environment/scene.glb [--dry]

import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Water surface, world Y. Same constant as `WorldCollision.waterLevel`. */
const WATER = -3.75;

/**
 * How deep each kind of hull sits, in metres.
 *
 * A canoe draws about a hand's width when empty; a board barely a finger. These
 * are the numbers that put the waterline below the floorboards — the point of
 * the exercise is that no water is visible inside the boat.
 */
const DRAFT = [
  [/paddleboard/i, 0.05],
  [/raft/i, 0.08],
  [/kayak/i, 0.10],
  [/canoe/i, 0.12],
  [/skiff/i, 0.14],
];

const draftFor = (name) => DRAFT.find(([re]) => re.test(name))?.[1] ?? 0.12;

const file = process.argv[2];
const dry = process.argv.includes('--dry');
if (!file) {
  console.error('usage: node tools/float-boats.mjs <scene.glb> [--dry]');
  process.exit(1);
}

const buf = readFileSync(file);
if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not a glb');

let off = 12;
let json = null;
let bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  const body = buf.subarray(off + 8, off + 8 + len);
  if (type === CHUNK_JSON) json = JSON.parse(body.toString('utf8'));
  else if (type === CHUNK_BIN) bin = body;
  off += 8 + len + ((4 - (len % 4)) % 4);
}
if (!json) throw new Error('no JSON chunk');

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
};
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const local = (n) => (n.matrix ? n.matrix : IDENTITY);
const parentOf = new Map();
json.nodes.forEach((n, i) => (n.children || []).forEach((c) => parentOf.set(c, i)));
const chainOf = (i) => {
  const p = [];
  for (let k = i; k != null; k = parentOf.get(k)) p.unshift(k);
  return p;
};
const worldOf = (i) => chainOf(i).reduce((m, k) => mul(m, local(json.nodes[k])), IDENTITY);
const apply = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

/** World Y range of every mesh under a node. */
const worldYRange = (root) => {
  let ymin = Infinity;
  let ymax = -Infinity;
  const walk = (i) => {
    const n = json.nodes[i];
    if (n.mesh != null) {
      const m = worldOf(i);
      let mn = [Infinity, Infinity, Infinity];
      let mx = [-Infinity, -Infinity, -Infinity];
      for (const p of json.meshes[n.mesh].primitives || []) {
        const a = json.accessors[p.attributes.POSITION];
        if (!a?.min) continue;
        for (let k = 0; k < 3; k++) {
          mn[k] = Math.min(mn[k], a.min[k]);
          mx[k] = Math.max(mx[k], a.max[k]);
        }
      }
      for (const x of [mn[0], mx[0]]) {
        for (const y of [mn[1], mx[1]]) {
          for (const z of [mn[2], mx[2]]) {
            const w = apply(m, x, y, z);
            ymin = Math.min(ymin, w[1]);
            ymax = Math.max(ymax, w[1]);
          }
        }
      }
    }
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return Number.isFinite(ymin) ? { ymin, ymax } : null;
};

/**
 * Terrain height at (x, z), read from the scene's own ground mesh.
 *
 * Needed to tell a floating hull from a beached one: the kit's `afloat` flag is
 * not reliable (the kayak is tagged afloat and sits on dry sand), and a boat on
 * the beach must not be moved — lowering it would bury it in the sand.
 */
const groundNode = json.nodes.findIndex((n) => n.name === 'ground' && n.mesh != null);
const terrainYAt = (() => {
  if (groundNode < 0) return () => null;
  const node = json.nodes[groundNode];
  const m = worldOf(groundNode);
  const mesh = json.meshes[node.mesh];
  const tris = [];
  for (const p of mesh.primitives || []) {
    const pos = json.accessors[p.attributes.POSITION];
    const idx = p.indices != null ? json.accessors[p.indices] : null;
    const view = pos.bufferView != null ? json.bufferViews[pos.bufferView] : null;
    if (!view) continue;
    const stride = view.byteStride || 12;
    const base = (view.byteOffset || 0) + (pos.byteOffset || 0);
    const count = idx ? idx.count : pos.count;
    const iView = idx && idx.bufferView != null ? json.bufferViews[idx.bufferView] : null;
    const readIndex = (k) => {
      if (!idx) return k;
      const off = (iView.byteOffset || 0) + (idx.byteOffset || 0) + k * (idx.componentType === 5125 ? 4 : 2);
      return idx.componentType === 5125 ? bin.readUInt32LE(off) : bin.readUInt16LE(off);
    };
    for (let k = 0; k + 2 < count; k += 3) {
      const v = [];
      for (let j = 0; j < 3; j++) {
        const o = base + readIndex(k + j) * stride;
        v.push(apply(m, bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)));
      }
      tris.push(v);
    }
  }
  return (x, z) => {
    let best = null;
    for (const [a, b, c] of tris) {
      const area = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
      if (Math.abs(area) < 1e-9) continue;
      const w0 = ((b[0] - x) * (c[2] - z) - (c[0] - x) * (b[2] - z)) / area;
      const w1 = ((c[0] - x) * (a[2] - z) - (a[0] - x) * (c[2] - z)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const y = w0 * a[1] + w1 * b[1] + w2 * c[1];
      if (best === null || y > best) best = y;
    }
    return best;
  };
})();

const CRAFT = /canoe|kayak|raft|paddleboard|skiff/i;
const moves = [];

json.nodes.forEach((n, i) => {
  if (!CRAFT.test(n.name || '')) return;
  if (/rack|trailer/i.test(n.name || '')) return; // a rack full of canoes, on the sand
  if (!n.matrix) return; // placements carry a matrix; their children are parts
  const ancestors = chainOf(i).slice(0, -1);
  if (ancestors.some((k) => /rack/i.test(json.nodes[k].name || ''))) return; // on land
  // Only the outermost craft node moves: `raft` is a child of `swim-raft`, and
  // shifting both would move it twice.
  if (ancestors.some((k) => CRAFT.test(json.nodes[k].name || ''))) return;
  const range = worldYRange(i);
  if (!range) return;

  // On the sand, not in the lake: leave it exactly where the kit put it.
  const centre = apply(worldOf(i), 0, 0, 0);
  const bed = terrainYAt(centre[0], centre[2]);
  if (bed !== null && bed > WATER - 0.02) {
    moves.push({ i, name: n.name, beached: true, bed });
    return;
  }

  const draft = draftFor(n.name);
  const target = WATER - draft;
  const shift = target - range.ymin;
  if (Math.abs(shift) < 0.005) return;

  // Only Y: the matrix is a Y rotation with unit scale, so element 13 is world Y.
  const m = n.matrix.slice();
  m[13] += shift;
  n.matrix = m;
  moves.push({ i, name: n.name, from: range.ymin, to: target, shift, draft });
});

if (!moves.some((m) => !m.beached)) {
  console.log('already afloat — nothing to do');
  process.exit(0);
}

console.log(`water plane ${WATER}`);
console.log('node  craft                 hull bottom   target   shift   draft');
for (const m of moves) {
  if (m.beached) {
    console.log(String(m.i).padStart(4), m.name.padEnd(22), `beached on ${m.bed.toFixed(2)} — left alone`.padStart(36));
    continue;
  }
  console.log(
    String(m.i).padStart(4),
    m.name.padEnd(22),
    m.from.toFixed(2).padStart(11),
    m.to.toFixed(2).padStart(8),
    (m.shift >= 0 ? '+' : '') + m.shift.toFixed(2).padStart(6),
    m.draft.toFixed(2).padStart(6)
  );
}

if (dry) {
  console.log('\n--dry: nothing written');
  process.exit(0);
}

// Rebuild the container: the JSON chunk changes length, so it has to be
// re-padded and the header length rewritten.
const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
const binPad = (4 - (bin.length % 4)) % 4;
const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);

const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(GLB_MAGIC, 0);
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonChunk.length, 12);
out.writeUInt32LE(CHUNK_JSON, 16);
jsonChunk.copy(out, 20);
out.writeUInt32LE(binChunk.length, 20 + jsonChunk.length);
out.writeUInt32LE(CHUNK_BIN, 24 + jsonChunk.length);
binChunk.copy(out, 28 + jsonChunk.length);

const backup = `${file}.orig`;
if (!existsSync(backup)) copyFileSync(file, backup);
writeFileSync(file, out);
console.log(`\nwrote ${file}  ${(total / 1048576).toFixed(2)} MB (backup: ${backup})`);
