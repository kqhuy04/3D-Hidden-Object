// Is the camera inside a wall at spawn?
//
// The boom sits 8 m behind the body. In a room that is a long way: if the boom
// does not shorten when a wall is between the body and the lens, the player
// spawns looking at the outside of the building. This asks the collision
// geometry, at the spawn, with the camera where the game actually puts it.
//
// Usage: node tmp-camcheck.mjs <map-id> [map-id ...]
import { launch, waitForGame } from './tmp-cdp.mjs';

const maps = process.argv.slice(2);
const cdp = await launch({ url: 'about:blank', port: 9409 });
const rows = [];

for (const mapId of maps) {
  await cdp.send('Page.navigate', { url: `http://localhost:1420/?debug=1&map=${mapId}` });
  for (let i = 0; i < 300; i++) {
    const ready = await cdp
      .evaluate(`!!window.__hunt && window.__hunt.game.map?.id === ${JSON.stringify(mapId)}`)
      .catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await cdp.evaluate('window.__hunt.game.startNewRound()');
  await new Promise((r) => setTimeout(r, 1500));

  const r = await cdp.evaluate(`(() => {
    const h = window.__hunt;
    const body = h.player.getPosition();
    const cam = h.camera.position;
    const dist = cam.distanceTo(body);
    const t = h.geometry.raycastSegment(cam.x, cam.y, cam.z, body.x, body.y + 1.1, body.z);
    // t is the fraction of the segment at which it first hits: anything well
    // under 1 means a wall is between the lens and the body.
    return {
      boom: +dist.toFixed(2),
      target: +h.cameraController.targetDistance.toFixed(1),
      blockedAt: t === null ? null : +(t * dist).toFixed(2),
      yaw: +h.cameraController.getYaw().toFixed(2),
      pitch: +h.cameraController.targetPitch.toFixed(2),
    };
  })()`);

  const bad = r.blockedAt !== null && r.blockedAt < r.boom - 0.6;
  console.log(
    `${mapId.padEnd(32)} boom ${String(r.boom).padStart(5)}m (want ${r.target})  ` +
    `wall at ${r.blockedAt === null ? '  none' : r.blockedAt + 'm'}  ${bad ? 'WALL BETWEEN' : 'clear'}`
  );
  rows.push({ mapId, ...r, wall: bad });
}

await cdp.close();
