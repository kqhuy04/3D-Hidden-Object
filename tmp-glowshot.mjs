// Close-up of the in-scene glow, so a human can judge whether it reads.
//
// Poses the body around the first unfound item and keeps the pose where that
// item — not a decoy standing in front of it — is what the selector picked.
// The loop is stopped for a stable frame, so every pose has to be drawn
// explicitly; without `game.render()` the capture is the pre-pose frame.
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'cozy-farm';
const out = process.argv[3] ?? 'glow-close.png';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9454 });
await waitForGame(cdp);

const info = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.startNewRound();
  h.game.loop.stop();
  document.getElementById('debug-overlay')?.remove();

  const target = h.hiddenItems.getItems().filter((i) => !i.found)[0];
  const wanted = target.placement ? target.placement.name : null;
  const c = target.centre;
  const cc = h.cameraController;

  // Four approaches around the item. The selector runs the same gate the game
  // does, so a pose only counts when the item itself comes back.
  let best = null;
  for (const [dx, dz] of [[1.8, 0], [-1.8, 0], [0, 1.8], [0, -1.8]]) {
    const px = c.x + dx;
    const pz = c.z + dz;
    const ground = h.collision.groundAt(px, pz, c.y);
    h.player.setPosition(px, ground, pz);
    // Camera behind the body, looking from the body towards the item.
    const yaw = Math.atan2(-dx, -dz);
    cc.targetYaw = yaw; cc.currentYaw = yaw;
    cc.targetDistance = 5.0; cc.currentDistance = 5.0;
    cc.snap(h.player.getPosition(), ground);
    for (let f = 0; f < 20; f++) h.game.update(1 / 60);
    if (h.game.pickupTarget === target) { best = { dx, dz }; break; }
  }

  // Run to the brightest point of the pulse, then draw.
  let peak = 0;
  for (let f = 0; f < 400; f++) {
    h.game.update(1 / 60);
    const g = h.glow.getTarget();
    if (!g) continue;
    let e = 0;
    g.traverse((m) => {
      if (m.isMesh && m.material && m.material.emissiveIntensity !== undefined) {
        e = Math.max(e, m.material.emissiveIntensity);
      }
    });
    peak = Math.max(peak, e);
    if (e > 0.6) break;
  }
  h.game.render();

  return {
    item: wanted,
    pose: best,
    peak: +peak.toFixed(2),
    picked: h.game.pickupTarget ? h.game.pickupTarget.placement.name : null,
    glowTarget: h.glow.getTarget() ? h.glow.getTarget().name : null,
  };
})()`);

console.log(mapId, JSON.stringify(info));
const fs = await import('node:fs');
fs.mkdirSync(`${process.env.TEMP}/hunt-shots`, { recursive: true });

const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
const path = `${process.env.TEMP}/hunt-shots/${out}`;
fs.writeFileSync(path, Buffer.from(shot.data, 'base64'));
console.log('shot', path);

// And a 2x crop of the middle, where the object is, so the glow can be judged
// without squinting at a 1088 px frame.
const crop = await cdp.send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: 330, y: 190, width: 400, height: 350, scale: 2 },
});
const cropPath = `${process.env.TEMP}/hunt-shots/${out.replace(/\.png$/, '-crop.png')}`;
fs.writeFileSync(cropPath, Buffer.from(crop.data, 'base64'));
console.log('crop', cropPath);
await cdp.close();
