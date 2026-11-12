// Look at a spot: node tmp-shot.mjs <map> <x> <y> <z> <yaw> <pitch> <dist> <out>
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';
const [mapId, x, y, z, yaw, pitch, dist, out] = process.argv.slice(2);
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9497 });
await waitForGame(cdp);
await cdp.evaluate(`(async () => { await window.__hunt.game.startNewRound(); await new Promise(r=>setTimeout(r,300)); return true; })()`);
const r = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  h.player.setPosition(${x}, ${y}, ${z});
  h.cameraController.targetDistance = ${dist};
  h.cameraController.targetPitch = ${pitch};
  h.cameraController.targetYaw = ${yaw};
  await new Promise((r) => setTimeout(r, 900));
  return h.camera.position.toArray().map((n) => +n.toFixed(1));
})()`);
await new Promise((r) => setTimeout(r, 1200));
const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(png.data, 'base64'));
console.log('cam', JSON.stringify(r), '->', out);
await cdp.close();
