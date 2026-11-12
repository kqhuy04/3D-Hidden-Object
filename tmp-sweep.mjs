// A player's first minute on a map, measured instead of eyeballed.
//
// For each map: does the body land on ground, can it walk away from spawn in all
// eight directions, how much of the map is actually reachable on foot, and are
// all five objects inside that reachable area and within the 20 m the placement
// rules promise. Two screenshots per map so the geometry can be looked at too.
//
// Usage: node tmp-sweep.mjs <map-id> [map-id ...]
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';

const maps = process.argv.slice(2);
if (maps.length === 0) {
  console.error('usage: node tmp-sweep.mjs <map-id> [map-id ...]');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await launch({ url: 'about:blank', port: 9401, width: 1280, height: 800 });
const results = [];

for (const mapId of maps) {
  const t0 = Date.now();
  let loadS = 0;
  try {
    await cdp.send('Page.navigate', { url: `http://localhost:1420/?debug=1&map=${mapId}` });
    // Navigation destroys the old context, so `window.__hunt` is gone until the
    // new world finishes building. Poll for this map's id, not just for the
    // handle: otherwise the previous map answers for the new one.
    for (let i = 0; i < 300; i++) {
      const ready = await cdp.evaluate(
        `!!window.__hunt && !!window.__hunt.player.getAnimator() && window.__hunt.game.map?.id === ${JSON.stringify(mapId)}`
      ).catch(() => false);
      if (ready) break;
      await sleep(250);
    }
    loadS = (Date.now() - t0) / 1000;
    await cdp.evaluate('window.__hunt.game.startNewRound()');
    await sleep(400);

    const data = await cdp.evaluate(`(() => {
      const h = window.__hunt;
      const col = h.collision;
      const cap = col.getCapsule();
      const body = h.player.getPosition().clone();
      const ground = col.groundAt(body.x, body.z, body.y);
      const spawnHint = h.game.map.spawn;

      // --- can the capsule leave the spawn point? -----------------------
      const dirs = [];
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const dx = Math.sin(a), dz = Math.cos(a);
        let p = body.clone();
        for (let s = 0; s < 3; s++) {
          const r = col.moveCapsule(p, { x: dx * 0.5, y: 0, z: dz * 0.5 }, cap, p.y);
          p = r.position;
        }
        dirs.push(+Math.hypot(p.x - body.x, p.z - body.z).toFixed(2));
      }

      // --- how much of the map can be walked to? ------------------------
      // Breadth-first over a 1 m grid. A cell is entered when the step up is
      // inside the capsule's step height; drops are allowed (you can walk down
      // a ledge) but only 4 m, so the fill cannot leak off a cliff into a void.
      // Radius 45, not 22: an object 26 m from spawn is already a content
      // problem, but calling it "unreachable" from a disc that stops at 22 m is
      // measuring the harness, not the map.
      const STEP = 1.0, R = 45, STEP_UP = cap.stepHeight, DROP = 4.0;
      const key = (i, j) => i + ',' + j;
      const seen = new Map();
      const si = Math.round(body.x / STEP), sj = Math.round(body.z / STEP);
      const queue = [[si, sj, body.y]];
      seen.set(key(si, sj), body.y);
      let maxReach = 0;
      while (queue.length) {
        const [i, j, y] = queue.pop();
        for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const ni = i + di, nj = j + dj;
          const k = key(ni, nj);
          if (seen.has(k)) continue;
          const nx = ni * STEP, nz = nj * STEP;
          if (Math.hypot(nx - body.x, nz - body.z) > R) continue;
          const v = col.groundAt(nx, nz, y);
          if (!Number.isFinite(v)) continue;
          const up = v - y;
          if (up > STEP_UP + 0.02) continue;
          if (up < -DROP) continue;
          seen.set(k, v);
          maxReach = Math.max(maxReach, Math.hypot(nx - body.x, nz - body.z));
          queue.push([ni, nj, v]);
        }
      }

      // --- are the objects inside that walkable area? --------------------
      const items = h.hiddenItems.getItems().map((it) => {
        const c = it.centre;
        let best = Infinity;
        for (const [k, y] of seen) {
          const [i, j] = k.split(',').map(Number);
          const d = Math.hypot(i * STEP - c.x, j * STEP - c.z);
          if (d < best) best = d;
        }
        return {
          id: it.placement.id,
          name: it.placement.name,
          fromSpawn: +Math.hypot(c.x - body.x, c.z - body.z).toFixed(1),
          toWalkable: +best.toFixed(1),
          y: +c.y.toFixed(2),
          groundUnder: +col.groundAt(c.x, c.z, c.y).toFixed(2),
        };
      });

      let parts = 0, tris = 0;
      h.game.scene.traverse((o) => { if (o.isMesh) { parts++; const p = o.geometry.attributes.position; const ix = o.geometry.index; tris += ix ? ix.count / 3 : (p ? p.count / 3 : 0); } });

      return {
        parts: h.geometry.parts.length,
        collisionTris: h.geometry.parts.reduce((s, p) => s + p.triangles, 0),
        meshes: parts,
        sceneTris: Math.round(tris),
        body: [+body.x.toFixed(2), +body.y.toFixed(2), +body.z.toFixed(2)],
        groundUnder: +ground.toFixed(2),
        sink: +(body.y - ground).toFixed(2),
        spawnHint: [+spawnHint.x.toFixed(2), +spawnHint.y.toFixed(2), +spawnHint.z.toFixed(2)],
        hintToBody: +Math.hypot(body.x - spawnHint.x, body.z - spawnHint.z).toFixed(1),
        dirs,
        walkable: seen.size,
        maxReach: +maxReach.toFixed(1),
        items,
      };
    })()`);

    // Spawn view, third person, as the game presents it.
    await cdp.evaluate(`(() => {
      const h = window.__hunt;
      h.cameraController.targetYaw = 0;
      h.cameraController.targetPitch = 0.18;
      h.cameraController.targetDistance = 8;
      h.cameraController.snap(h.player.getPosition(), h.player.getPosition().y);
      return true;
    })()`);
    await sleep(900);
    let png = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`sweep-${mapId}-a.png`, Buffer.from(png.data, 'base64'));

    // Pulled back and tilted down, to show the shape of the place.
    await cdp.evaluate(`(() => {
      const h = window.__hunt;
      h.cameraController.targetYaw = 0.9;
      h.cameraController.targetPitch = 0.62;
      h.cameraController.targetDistance = 14;
      h.cameraController.snap(h.player.getPosition(), h.player.getPosition().y);
      return true;
    })()`);
    await sleep(900);
    png = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`sweep-${mapId}-b.png`, Buffer.from(png.data, 'base64'));

    results.push({ mapId, loadS: +loadS.toFixed(1), ...data });
    console.log(
      `${mapId.padEnd(32)} load ${loadS.toFixed(1)}s  ` +
      `sink ${data.sink >= -0.05 && data.sink <= 0.15 ? 'ok' : data.sink}  ` +
      `walk ${data.walkable}c/${data.maxReach}m  ` +
      `dirs [${data.dirs.join(' ')}]  ` +
      `items ${data.items.filter((i) => i.toWalkable <= 3.2 && i.fromSpawn <= 20).length}/5`
    );
    for (const it of data.items) {
      const flags = [];
      if (it.toWalkable > 3.2) flags.push(`UNREACHABLE (${it.toWalkable}m from walkable ground)`);
      if (it.fromSpawn > 20) flags.push(`FAR (${it.fromSpawn}m from spawn)`);
      if (it.y - it.groundUnder > 3.5) flags.push(`HIGH (+${(it.y - it.groundUnder).toFixed(1)}m above ground)`);
      if (flags.length) console.log(`    ${it.id}: ${flags.join(', ')}`);
    }
    const errs = cdp.consoleLines.filter((l) => /EXCEPTION|error:/i.test(l));
    if (errs.length) console.log('    console: ' + errs.slice(-3).join(' | '));
    cdp.consoleLines.length = 0;
  } catch (e) {
    console.log(`${mapId.padEnd(32)} FAILED: ${e.message}`);
    results.push({ mapId, error: e.message });
  }
}

// Merge into whatever is already there, so a sweep can be run in batches
// without the last batch erasing the first.
const merged = new Map();
try {
  for (const row of JSON.parse(fs.readFileSync('tmp-sweep.json', 'utf8'))) merged.set(row.mapId, row);
} catch { /* first run */ }
for (const row of results) merged.set(row.mapId, row);
fs.writeFileSync('tmp-sweep.json', JSON.stringify([...merged.values()], null, 2));
await cdp.close();
