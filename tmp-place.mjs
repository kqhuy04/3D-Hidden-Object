// Finds a spot that actually works, for every object on a map.
//
// Guessing a coordinate and re-running the whole pickable check costs a browser
// launch per attempt. This moves the object inside the live scene instead and
// asks the game's own `findTarget` from eight approaches at two stand-off
// distances, so one session tests hundreds of placements.
//
// Candidate spots come from the map's scan (`tmp-spots-<map>.txt`): open ground
// and reachable top surfaces, filtered to sane heights and distances.
//
// Usage: node tmp-place.mjs <map-id> [outFile]
import fs from 'node:fs';
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2];
const outFile = process.argv[3] ?? `tmp-place-${mapId}.json`;

const lines = fs.readFileSync(`tmp-spots-${mapId}.txt`, 'utf8').split('\n');
const cands = [];
for (const l of lines) {
  const t = /^  T  x\s+(-?[\d.]+)\s+z\s+(-?[\d.]+)\s+top\s+(-?[\d.]+)\s+d\s+([\d.]+).*gap ([\d.]+)/.exec(l);
  if (t && Number(t[5]) <= 1.5) {
    const d = Number(t[4]);
    if (d >= 6 && d <= 40) cands.push({ x: +t[1], z: +t[2], y: +t[3], d, kind: 'T' });
    continue;
  }
  const g = /^  G  x\s+(-?[\d.]+)\s+z\s+(-?[\d.]+)\s+y\s+(-?[\d.]+)\s+d\s+([\d.]+)/.exec(l);
  if (g) {
    const d = Number(g[4]);
    if (d >= 6 && d <= 40) cands.push({ x: +g[1], z: +g[2], y: +g[3], d, kind: 'G' });
  }
}
cands.sort((a, b) => a.d - b.d);

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9382 });
await waitForGame(cdp);
await cdp.evaluate(`(() => { window.__hunt.game.startNewRound(); return true; })()`);
await new Promise((r) => setTimeout(r, 600));

const items = await cdp.evaluate(`window.__hunt.hiddenItems.getItems().map((i) => ({
  id: i.placement.id, r: +i.radius.toFixed(2),
  c: [i.centre.x, i.centre.y, i.centre.z],
  p: [i.object.position.x, i.object.position.y, i.object.position.z]
}))`);

const results = [];
const used = [];

for (const item of items) {
  const tried = [];
  let found = null;

  // First: does it already work where it is? Most do, and moving a good
  // placement just to "fix" it is how a working map gets worse.
  const current = await cdp.evaluate(`(async () => {
    const h = window.__hunt;
    const it = h.hiddenItems.getItems().find((i) => i.placement.id === '${item.id}');
    const cx = it.centre.x, cy = it.centre.y, cz = it.centre.z;
    const rings = [Math.max(1.3, it.radius + 0.9), Math.max(2.3, it.radius + 2.2)];
    for (const ring of rings) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const sx = cx + Math.sin(a) * ring;
        const sz = cz + Math.cos(a) * ring;
        const g = h.collision.getGroundHeight(sx, sz);
        const spawn = h.collision.findSpawn({ x: sx, y: g + 0.5, z: sz }, 3);
        if (!spawn) continue;
        if (Math.hypot(spawn.x - sx, spawn.z - sz) > 2.2) continue;
        h.player.setPosition(spawn.x, spawn.y + 0.05, spawn.z);
        h.cameraController.targetYaw = Math.atan2(spawn.x - cx, spawn.z - cz);
        h.cameraController.snap(h.player.getPosition(), spawn.y);
        await new Promise((r) => setTimeout(r, 130));
        const reach = h.player.getPosition().clone();
        reach.y += 1.1;
        const t = h.hiddenItems.findTarget(h.camera, h.camera.position, reach, h.collision);
        if (t && t.placement.id === '${item.id}') return { ok: true, ring: +ring.toFixed(1), angle: +a.toFixed(2) };
      }
    }
    return { ok: false };
  })()`);

  const clashes = used.some((u) => Math.hypot(u.x - item.p[0], u.z - item.p[2]) < 4);
  if (current.ok && !clashes) {
    // A spot already good still counts as taken, or the next object lands on
    // top of it and two hunts share one hiding place.
    used.push({ x: item.p[0], z: item.p[2] });
    results.push({ id: item.id, ok: true, spot: { ...item.p, kind: 'KEEP', d: 0, best: current }, triedCount: 0 });
    console.log(`  ${item.id.padEnd(20)} KEEP  (${item.p.map((v) => +v.toFixed(2)).join(', ')})`);
    continue;
  }

  // Nearer spots first would put every object in the same corner, so the far
  // ones are tried first and a spot already taken is skipped outright.
  const ordered = [...cands.filter((c) => c.d >= 9), ...cands.filter((c) => c.d < 9)];
  for (const cand of ordered) {
    if (found) break;
    if (used.some((u) => Math.hypot(u.x - cand.x, u.z - cand.z) < 5)) continue;
    const res = await cdp.evaluate(`(async () => {
      const h = window.__hunt;
      const it = h.hiddenItems.getItems().find((i) => i.placement.id === '${item.id}');
      const old = it.object.position.clone();
      const next = { x: ${cand.x}, y: ${cand.y}, z: ${cand.z} };
      it.object.position.set(next.x, next.y, next.z);
      it.object.updateMatrixWorld(true);
      it.centre.set(
        it.centre.x + (next.x - old.x),
        it.centre.y + (next.y - old.y),
        it.centre.z + (next.z - old.z)
      );

      const cx = it.centre.x, cy = it.centre.y, cz = it.centre.z;
      const rings = [Math.max(1.3, it.radius + 0.9), Math.max(2.3, it.radius + 2.2)];
      let best = null;

      for (const ring of rings) {
        for (let k = 0; k < 8 && !best; k++) {
          const a = (k / 8) * Math.PI * 2;
          const sx = cx + Math.sin(a) * ring;
          const sz = cz + Math.cos(a) * ring;
          const g = h.collision.getGroundHeight(sx, sz);
          const spawn = h.collision.findSpawn({ x: sx, y: g + 0.5, z: sz }, 3);
          if (!spawn) continue;
          if (Math.hypot(spawn.x - sx, spawn.z - sz) > 2.2) continue;

          h.player.setPosition(spawn.x, spawn.y + 0.05, spawn.z);
          h.cameraController.targetYaw = Math.atan2(spawn.x - cx, spawn.z - cz);
          h.cameraController.snap(h.player.getPosition(), spawn.y);
          await new Promise((r) => setTimeout(r, 130));

          const reach = h.player.getPosition().clone();
          reach.y += 1.1;
          const t = h.hiddenItems.findTarget(h.camera, h.camera.position, reach, h.collision);
          if (t && t.placement.id === '${item.id}') best = { ring: +ring.toFixed(1), angle: +a.toFixed(2) };
        }
      }

      // Put it back; the caller decides what to keep.
      it.object.position.set(old.x, old.y, old.z);
      it.object.updateMatrixWorld(true);
      it.centre.set(cx - (next.x - old.x), cy - (next.y - old.y), cz - (next.z - old.z));

      return { ok: !!best, best };
    })()`);

    tried.push({ ...cand, ...res });
    if (res.ok) found = { ...cand, ...res };
  }

  if (found) used.push(found);
  results.push({ id: item.id, ok: !!found, spot: found, triedCount: tried.length });
  console.log(
    `  ${item.id.padEnd(20)} ` +
      (found
        ? `OK  (${found.x}, ${found.y}, ${found.z})  d=${found.d}  ${found.kind}  ring=${found.best.ring}`
        : `NO SPOT  (${tried.length} candidates tried)`)
  );
}

fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} placed on ${mapId} -> ${outFile}`);
await cdp.close();
