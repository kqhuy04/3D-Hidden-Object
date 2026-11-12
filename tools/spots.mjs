// Finds candidate hiding spots: places where the world has a flat top surface
// between knee and chest height — a table, a crate, a bench, a dock plank — with
// a spot a body can actually stand next to.
//
// Node names in the exported GLBs are mesh part names ("body", "hull"), not the
// kit's part names, so "put it on the picnic table" cannot be done by name. This
// asks the collision triangles instead, which is what the game itself trusts.
//
// Usage: node tools/spots.mjs <map-id> [maxCandidates]
import { launch, waitForGame } from './cdp.mjs';

const mapId = process.argv[2];
const MAX = Number(process.argv[3] ?? 40);
const PORT = Number(process.argv[4] ?? 9341);

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: PORT });
await waitForGame(cdp);
await new Promise((r) => setTimeout(r, 400));

const res = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const coll = h.collision;
  const geom = h.geometry;
  if (!geom) return { error: 'no geometry' };

  const b = geom.worldBounds;
  const spawn = h.player.getPosition();
  const out = [];
  const STEP = 1.5;

  for (let x = Math.ceil(b.min.x); x <= b.max.x; x += STEP) {
    for (let z = Math.ceil(b.min.z); z <= b.max.z; z += STEP) {
      const ground = coll.getGroundHeight(x, z);
      // First surface under a short drop: the top of whatever stands here.
      const t = geom.raycastSegment(x, ground + 2.2, z, x, ground - 0.4, z);
      if (t === null) continue;
      const top = ground + 2.2 - 2.6 * t;
      const rise = top - ground;
      if (rise < 0.35 || rise > 1.35) continue;

      // Flat enough to be a surface, not the crown of a boulder.
      let flat = 0;
      for (const [dx, dz] of [[0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]]) {
        const t2 = geom.raycastSegment(x + dx, ground + 2.2, z + dz, x + dx, ground - 0.4, z + dz);
        if (t2 !== null) {
          const y2 = ground + 2.2 - 2.6 * t2;
          if (Math.abs(y2 - top) < 0.12) flat++;
        }
      }
      if (flat < 3) continue;

      out.push({ x: +x.toFixed(1), z: +z.toFixed(1), top: +top.toFixed(2), d: +Math.hypot(x - spawn.x, z - spawn.z).toFixed(1) });
    }
  }

  // Thin out: keep one candidate per 4 m, nearest-to-spawn last so the list
  // reads from the far corners inwards.
  const kept = [];
  for (const c of out.sort((a, b) => a.d - b.d)) {
    if (kept.every((k) => Math.hypot(k.x - c.x, k.z - c.z) > 4)) kept.push(c);
  }

  // Can a body stand next to it?
  const withStand = [];
  for (const c of kept) {
    let best = null;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const sx = c.x + Math.sin(a) * 1.3;
      const sz = c.z + Math.cos(a) * 1.3;
      const spot = coll.findSpawn({ x: sx, y: c.top + 0.6, z: sz }, 3);
      if (!spot) continue;
      const gap = Math.hypot(spot.x - c.x, spot.z - c.z);
      if (!best || gap < best.gap) best = { gap: +gap.toFixed(2), sx: +spot.x.toFixed(1), sz: +spot.z.toFixed(1), sy: +spot.y.toFixed(2) };
    }
    if (best) withStand.push({ ...c, stand: best });
  }

  // Open ground: where a capsule fits and nothing is above it. Used for maps
  // with no furniture to sit an object on (a reef, a pitch, a regolith plain).
  const ground = [];
  for (let x = Math.ceil(b.min.x); x <= b.max.x; x += 2.5) {
    for (let z = Math.ceil(b.min.z); z <= b.max.z; z += 2.5) {
      const g = coll.getGroundHeight(x, z);
      const spot = coll.findSpawn({ x, y: g + 0.6, z }, 1.2);
      if (!spot) continue;
      if (Math.hypot(spot.x - x, spot.z - z) > 0.8) continue;
      ground.push({ x: +spot.x.toFixed(1), z: +spot.z.toFixed(1), top: +spot.y.toFixed(2), d: +Math.hypot(spot.x - spawn.x, spot.z - spawn.z).toFixed(1) });
    }
  }
  const groundKept = [];
  for (const c of ground.sort((a, b) => a.d - b.d)) {
    if (groundKept.every((k) => Math.hypot(k.x - c.x, k.z - c.z) > 6)) groundKept.push(c);
  }

  return {
    bounds: [b.min.toArray(), b.max.toArray()],
    spawn: [+spawn.x.toFixed(1), +spawn.z.toFixed(1)],
    total: out.length,
    kept: withStand.length,
    spots: withStand,
    ground: groundKept,
  };
})()`);

if (res.error) {
  console.log(res.error);
  await cdp.close();
  process.exit(1);
}

console.log(`# ${mapId}  bounds ${res.bounds[0].map((v) => v.toFixed(0)).join(',')} .. ${res.bounds[1].map((v) => v.toFixed(0)).join(',')}  spawn ${res.spawn.join(',')}`);
console.log(`# ${res.total} surfaces, ${res.kept} spread, showing ${Math.min(MAX, res.spots.length)}`);
for (const s of res.spots.slice(0, MAX)) {
  console.log(`  T  x ${String(s.x).padStart(7)}  z ${String(s.z).padStart(7)}  top ${String(s.top).padStart(6)}  d ${String(s.d).padStart(5)}  stand (${s.stand.sx}, ${s.stand.sz}) gap ${s.stand.gap}`);
}
console.log(`# ${res.ground.length} open ground spots`);
for (const s of res.ground.slice(0, MAX)) {
  console.log(`  G  x ${String(s.x).padStart(7)}  z ${String(s.z).padStart(7)}  y ${String(s.top).padStart(6)}  d ${String(s.d).padStart(5)}`);
}

await cdp.close();
