// Does the object under the reticle actually glow, through the real selection path?
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'cozy-farm';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9453 });
await waitForGame(cdp);

const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.startNewRound();
  h.game.loop.stop();

  const items = h.hiddenItems.getItems().filter((i) => !i.found);
  const target = items[0];
  const c = target.centre;

  // Stand 1.4 m away, with the boom behind the body on the far side of the
  // item, so the item is dead ahead of the camera.
  const ground = h.collision.groundAt(c.x + 1.4, c.z, c.y);
  h.player.setPosition(c.x + 1.4, ground, c.z);
  const yaw = Math.atan2(1, 0);
  h.cameraController.targetYaw = yaw;
  h.cameraController.currentYaw = yaw;
  h.cameraController.snap(h.player.getPosition(), ground);

  let seen = null;
  for (let f = 0; f < 40; f++) {
    h.game.update(1 / 60);
    if (h.glow.getTarget()) { seen = h.glow.getTarget(); }
  }

  let emissive = null, intensity = null, meshCount = 0;
  if (seen) {
    seen.traverse((m) => {
      if (!m.isMesh || !m.material) return;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      if (!mat.emissive) return;
      meshCount++;
      emissive = mat.emissive.getHex();
      intensity = mat.emissiveIntensity;
    });
  }

  return {
    item: target.placement ? target.placement.name : null,
    targetName: seen ? seen.name : null,
    meshCount, emissive, intensity: intensity === null ? null : +intensity.toFixed(2),
    pickupPrompt: !!h.game.pickupTarget,
  };
})()`);

console.log(mapId, JSON.stringify(out, null, 1));
await cdp.send('Page.captureScreenshot', { format: 'png' }).then(async (r) => {
  const fs = await import('node:fs');
  const path = `${process.env.TEMP}/hunt-shots/glow.png`;
  fs.mkdirSync(`${process.env.TEMP}/hunt-shots`, { recursive: true });
  fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
  console.log('shot', path);
});
await cdp.close();
