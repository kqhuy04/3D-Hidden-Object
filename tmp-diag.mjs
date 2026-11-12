// Why is this object not pickable? Repeats the game's own three gates — reach,
// screen position, line of sight — and says which one fails, from each of eight
// approach angles, with the follow camera settling naturally.
//
// Usage: node tmp-diag.mjs <map-id> <item-id>
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2];
const itemId = process.argv[3];

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9381 });
await waitForGame(cdp);
await cdp.evaluate(`(() => { window.__hunt.game.startNewRound(); return true; })()`);
await new Promise((r) => setTimeout(r, 600));

const item = await cdp.evaluate(`(() => {
  const i = window.__hunt.hiddenItems.getItems().find((x) => x.placement.id === '${itemId}');
  if (!i) return null;
  return { c: [i.centre.x, i.centre.y, i.centre.z], r: i.radius, spot: i.placement.spot };
})()`);
if (!item) {
  console.log('no such item');
  await cdp.close();
  process.exit(1);
}

console.log(`# ${mapId}/${itemId} centre ${item.c.map((v) => v.toFixed(2)).join(',')} r=${item.r.toFixed(2)}`);
console.log(`# spot ${JSON.stringify(item.spot)}`);

for (let k = 0; k < 8; k++) {
  const angle = (k / 8) * Math.PI * 2;
  const res = await cdp.evaluate(`(async () => {
    const h = window.__hunt;
    const [cx, cy, cz] = ${JSON.stringify(item.c)};
    const sx = cx + Math.sin(${angle}) * 1.5;
    const sz = cz + Math.cos(${angle}) * 1.5;
    const g = h.collision.getGroundHeight(sx, sz);
    const spawn = h.collision.findSpawn({ x: sx, y: g + 0.5, z: sz }, 3);
    if (!spawn) return { spawn: null, sx: +sx.toFixed(1), sz: +sz.toFixed(1), g: +g.toFixed(2) };

    h.player.setPosition(spawn.x, spawn.y + 0.05, spawn.z);
    h.cameraController.targetYaw = Math.atan2(spawn.x - cx, spawn.z - cz);
    h.cameraController.snap(h.player.getPosition(), spawn.y);
    await new Promise((r) => setTimeout(r, 380));

    const body = h.player.getPosition();
    const reach = body.clone(); reach.y += 1.1;
    const dist = reach.distanceTo(new (h.camera.position.constructor)(cx, cy, cz));

    const proj = new (h.camera.position.constructor)(cx, cy, cz).project(h.camera);
    const offAxis = Math.max(Math.abs(proj.x), Math.abs(proj.y));

    const geom = h.geometry;
    const t = geom ? geom.raycastSegment(h.camera.position.x, h.camera.position.y, h.camera.position.z, cx, cy, cz) : null;
    const sight = h.camera.position.distanceTo(new (h.camera.position.constructor)(cx, cy, cz));

    return {
      spawn: [+spawn.x.toFixed(1), +spawn.z.toFixed(1)],
      gap: +Math.hypot(spawn.x - sx, spawn.z - sz).toFixed(2),
      dist: +dist.toFixed(2),
      offAxis: +offAxis.toFixed(2),
      occluded: t === null ? null : +(t * sight).toFixed(2),
      sight: +sight.toFixed(2),
      reachOK: dist - ${item.r} <= 3.2,
      aimOK: offAxis <= 0.42,
      clearOK: t === null || t * sight >= sight - 0.35,
    };
  })()`);
  console.log(`  a=${angle.toFixed(2)} ${JSON.stringify(res)}`);
}

await cdp.close();
