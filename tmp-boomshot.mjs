// What the player sees when the boom is at its shortest, and at full length,
// from the same spot — the "backed into a fence" case.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';

const [mapId, x, y, z] = process.argv.slice(2);
const cdp = await launch({ url: 'http://localhost:1420/?debug=1', port: 9333 });
await waitForGame(cdp);

const res = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.selectMap(${JSON.stringify(mapId)});
  await new Promise((r) => setTimeout(r, 900));
  const c = h.player.getController();
  h.game.loop.stop();
  const mk = (a, b) => ({ x: a, y: b, length() { return Math.hypot(this.x, this.y); },
    clone() { return mk(this.x, this.y); },
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } });
  h.player.setPosition(${x}, ${y}, ${z});
  c.falling = true; c.fallSpeed = 0;
  for (let f = 0; f < 300; f++) { c.update(mk(0, 0), 0, 1 / 60); if (!c.falling && f > 60) break; }
  for (let f = 0; f < 90; f++) h.cameraController.update(c.getPosition(), 1 / 60, c.getGroundY());
  h.game.loop.start();
  return {
    body: [+c.getPosition().x.toFixed(2), +c.feetY.toFixed(2), +c.getPosition().z.toFixed(2)],
    boom: +h.camera.position.distanceTo(h.cameraController.currentLookAt).toFixed(2),
  };
})()`);

await new Promise((r) => setTimeout(r, 3500));
const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
const out = process.argv[6];
fs.writeFileSync(out, Buffer.from(png.data, 'base64'));
console.log(JSON.stringify(res), '->', out);
await cdp.close();
