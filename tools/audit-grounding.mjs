// Audits every map for props that do not stand on the ground.
//
// Why this exists: on map 1 the last two metres of a fence hang 0.75 m above a
// bank that falls away under them, because each two-metre segment was placed at
// one Y and the terrain under its far end is lower. The same authoring pattern
// exists in every kit, and it is invisible until someone walks up to it — so it
// has to be measured, not eyeballed.
//
// Everything happens here: the archives are Draco-compressed, so the terrain is
// decoded with three's own decoder and the props are measured against it. No
// browser, no GPU, roughly two seconds a map.
//
//   node tools/audit-grounding.mjs                 # all maps
//   node tools/audit-grounding.mjs --map office    # one map
//   node tools/audit-grounding.mjs --limit 0.3     # floaters above 30 cm
import path from 'node:path';
import { readdirSync } from 'node:fs';
import { loadDraco, readGlb, decodeTerrain, makeSampler, fromTRS, xf, TERRAIN_NAME } from './terrain.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const ONLY = opt('map', null);
const LIMIT = Number(opt('limit', 0.3));
/** Terrain meshes: anything named like the ground surface. One definition. */
const TERRAIN = TERRAIN_NAME;

// Read from disk, not from a hand-kept list. The list was a literal array of
// map ids, so a newly prepared map was silently not audited until someone
// remembered to add it — which is exactly the kind of omission an audit is
// supposed to catch.
const MAPS = [
  ['campground-lake', 'public/assets/environment/scene.glb'],
  ...readdirSync(path.join('public', 'assets', 'maps'))
    .filter((f) => f.endsWith('.glb'))
    .map((f) => [f.replace(/\.glb$/, ''), path.join('public', 'assets', 'maps', f)])
    .sort((a, b) => a[0].localeCompare(b[0])),
].filter(([id]) => !ONLY || id === ONLY);

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

/** World-space bounding box of one mesh, from the accessor's declared bounds. */
function meshBox(gltf, mesh, world) {
  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.primitives || []) {
    const a = gltf.accessors[p.attributes?.POSITION];
    if (!a?.min) continue;
    for (let k = 0; k < 8; k++) {
      const c = [
        k & 1 ? a.max[0] : a.min[0],
        k & 2 ? a.max[1] : a.min[1],
        k & 4 ? a.max[2] : a.min[2],
      ];
      const v = xf(world, c);
      for (let d = 0; d < 3; d++) {
        mn[d] = Math.min(mn[d], v[d]);
        mx[d] = Math.max(mx[d], v[d]);
      }
    }
  }
  return mn[0] === Infinity ? null : { min: mn, max: mx };
}

const mod = await loadDraco();

for (const [id, file] of MAPS) {
  const t0 = Date.now();
  let gltf;
  let bin;
  try {
    ({ gltf, bin } = readGlb(file));
  } catch (err) {
    console.log(`\n${id}: SKIP (${err.message})`);
    continue;
  }

  const terrain = decodeTerrain(mod, gltf, bin);
  if (!terrain.length) {
    console.log(`\n${id}: no terrain mesh found (names: ${gltf.nodes.slice(0, 6).map((n) => n.name).join(', ')})`);
    continue;
  }
  const ground = makeSampler(terrain);

  // Only top-level props are audited. A lantern on a table is a child of the
  // table and is *supposed* to be off the ground; measuring it against the
  // terrain would report a hundred correct props as broken.
  const props = [];
  const walk = (i, parent, underMesh) => {
    const n = gltf.nodes[i];
    const world = mul(parent, fromTRS(n));
    const name = n.name || '';
    const isTerrain = TERRAIN.test(name);
    let box = null;
    if (n.mesh !== undefined && !isTerrain) box = meshBox(gltf, gltf.meshes[n.mesh], world);
    if (box && !underMesh) props.push({ name, box, index: i });
    const childUnderMesh = underMesh || (n.mesh !== undefined && !isTerrain);
    for (const c of n.children || []) walk(c, world, childUnderMesh);
  };
  for (const r of gltf.scenes?.[gltf.scene ?? 0]?.nodes || []) walk(r, IDENT, false);

  const floaters = [];
  const suspended = [];
  for (const p of props) {
    const { min, max } = p.box;
    // Footprint corners, inset 5 cm so a rounded prop is sampled where it
    // actually meets the ground rather than at the tangent of its outline.
    const ix = Math.min(0.05, (max[0] - min[0]) / 4);
    const iz = Math.min(0.05, (max[2] - min[2]) / 4);
    const gaps = [];
    for (const x of [min[0] + ix, max[0] - ix])
      for (const z of [min[2] + iz, max[2] - iz]) {
        const g = ground(x, z);
        if (g !== null) gaps.push(min[1] - g);
      }
    if (!gaps.length) continue;
    const maxGap = Math.max(...gaps);
    const minGap = Math.min(...gaps);
    // Three kinds of prop, and only one of them is a bug.
    //
    // *Suspended* — every corner the same height above the terrain. A door on a
    // truck, a pennant on a mast, a lantern on a table: they hang off something
    // else and are supposed to be off the ground. Two hundred of them on map 1.
    //
    // *Canopy* — the base is well above the terrain at its own centre, because
    // the thing holding it up is a different mesh (a tree crown over its trunk,
    // a lamp over its post). Also correct.
    //
    // *Standing but tilted* — the base is at ground level at the centre, yet one
    // corner is planted and the opposite corner is in the air. That is a prop
    // placed at a single Y on ground that slopes, and it is the fault the player
    // actually sees. This is the only one reported.
    const tilt = maxGap - minGap;
    const centreGap = min[1] - (ground((min[0] + max[0]) / 2, (min[2] + max[2]) / 2) ?? min[1]);
    // `minGap` above -0.35 rules out props that are *meant* to sink: a tree
    // stand, a pebble cluster and a dock pile all bury their base in the
    // terrain, so their far corner being high says nothing.
    if (Math.abs(centreGap) <= 0.35 && minGap > -0.35 && maxGap > LIMIT) {
      floaters.push({ ...p, maxGap, minGap, tilt, centreGap });
    } else if (maxGap > LIMIT) {
      suspended.push({ ...p, maxGap, minGap, tilt });
    }
  }

  floaters.sort((a, b) => b.maxGap - a.maxGap);
  const worst = floaters[0];
  console.log(
    `\n${id}: ${props.length} props — ${floaters.length} standing but tilted > ${LIMIT} m, ` +
      `${suspended.length} elevated (expected)` +
      (worst ? `\n  worst: ${worst.name || '#' + worst.index} ${worst.maxGap.toFixed(2)} m of air under one end` : '') +
      `  [${Date.now() - t0} ms]`
  );
  for (const f of floaters.slice(0, 14)) {
    const cx = ((f.box.min[0] + f.box.max[0]) / 2).toFixed(2);
    const cy = f.box.min[1].toFixed(2);
    const cz = ((f.box.min[2] + f.box.max[2]) / 2).toFixed(2);
    console.log(
      `  ${(f.name || '#' + f.index).padEnd(24)} air ${f.maxGap.toFixed(2)}  ` +
        `buried ${f.minGap.toFixed(2)}  at ${cx},${cy},${cz}  ` +
        `size ${(f.box.max[0] - f.box.min[0]).toFixed(1)}x${(f.box.max[1] - f.box.min[1]).toFixed(1)}x${(f.box.max[2] - f.box.min[2]).toFixed(1)}`
    );
  }
}
