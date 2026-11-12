// Shadows, after the rework: are they still there, and do they follow?
//
// The old rig was a ±45 m box pinned to the world origin, so a player who
// walked off the map's middle lost their shadow entirely. This checks the new
// rig both visually and numerically.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const mapId = process.argv[2] ?? 'cozy-farm';
const outDir = path.join(process.env.TEMP || '/tmp', 'hunt-shots');
fs.mkdirSync(outDir, { recursive: true });

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9447, width: 1280, height: 800 });
await waitForGame(cdp);
// Defaults: the previous run may have left a profile behind that turned the
// shadows off and the quality up.
await cdp.evaluate(`(() => { localStorage.clear(); return true; })()`);
await cdp.send('Page.navigate', { url: `http://localhost:1420/?debug=1&map=${mapId}` });
for (let i = 0; i < 200; i++) {
  const ready = await cdp.evaluate(`!!window.__hunt && window.__hunt.game.map?.id === ${JSON.stringify(mapId)}`).catch(() => false);
  if (ready) break;
  await new Promise((r) => setTimeout(r, 250));
}
await cdp.evaluate('(async () => { await window.__hunt.game.startNewRound(); return true; })()');
await new Promise((r) => setTimeout(r, 4000));

const shot = async (name) => {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
  console.log(name, '->', file);
};

const where = async () => cdp.evaluate(`(() => {
  const h = window.__hunt;
  const p = h.player.getPosition();
  const sun = h.sun.sun;
  return {
    body: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)],
    sunPos: [+sun.position.x.toFixed(1), +sun.position.y.toFixed(1), +sun.position.z.toFixed(1)],
    target: [+sun.target.position.x.toFixed(1), +sun.target.position.y.toFixed(1), +sun.target.position.z.toFixed(1)],
    gapToBody: +Math.hypot(sun.target.position.x - p.x, sun.target.position.z - p.z).toFixed(1),
    mapSize: sun.shadow.mapSize.width,
    box: sun.shadow.camera.right * 2,
    enabled: h.renderer.shadowMap.enabled,
    casters: (() => { let n = 0; h.game.scene.traverse((o) => { if (o.isMesh && o.castShadow) n++; }); return n; })(),
  };
})()`);

console.log('spawn', JSON.stringify(await where()));
await shot(`shadow-${mapId}-spawn`);

// Walk the body to the far side of the map and confirm the sun went with it.
const far = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.game;
  const from = h.player.getPosition().clone();
  let best = null, bestD = 0;
  for (let r = 20; r <= 90; r += 5) {
    for (let a = 0; a < 16; a++) {
      const th = (a / 16) * Math.PI * 2;
      const x = from.x + Math.cos(th) * r;
      const z = from.z + Math.sin(th) * r;
      const spot = h.collision.findSpawn({ x, y: from.y, z });
      if (!spot) continue;
      const d = Math.hypot(spot.x - from.x, spot.z - from.z);
      if (d > bestD) { bestD = d; best = spot; }
    }
  }
  if (!best) return { moved: false };
  h.player.setPosition(best.x, best.y + 0.05, best.z);
  h.cameraController.snap(h.player.getPosition());
  g.render();
  return { moved: true, distance: +bestD.toFixed(1) };
})()`);
console.log('walked', JSON.stringify(far));

await new Promise((r) => setTimeout(r, 2500));
console.log('far', JSON.stringify(await where()));
await shot(`shadow-${mapId}-far`);

await cdp.close();
