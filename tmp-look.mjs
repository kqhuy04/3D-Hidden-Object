// Teleport the body to a spot on a map and take a screenshot, plus the ground
// height the collision geometry reports there. Used to look at reported
// geometry problems (floating props, gaps in the floor) without guessing.
//
// Usage: node tmp-look.mjs <map-id> <x> <z> [yawDeg] [out.png] [pitch]
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';

const mapId = process.argv[2];
const x = Number(process.argv[3]);
const z = Number(process.argv[4]);
const yawDeg = Number(process.argv[5] ?? 0);
const out = process.argv[6] ?? `tmp-look-${mapId}.png`;
const pitch = Number(process.argv[7] ?? 0.35);

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9391 });
await waitForGame(cdp);
await cdp.evaluate(`(() => { window.__hunt.game.startNewRound(); return true; })()`);
await new Promise((r) => setTimeout(r, 500));

const info = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.collision.getGroundHeight(${x}, ${z});
  const spawn = h.collision.findSpawn({ x: ${x}, y: g + 0.5, z: ${z} }, 6);
  const px = spawn ? spawn.x : ${x};
  const pz = spawn ? spawn.z : ${z};
  const py = spawn ? spawn.y : g;
  h.player.setPosition(px, py + 0.05, pz);
  h.cameraController.targetYaw = ${(yawDeg * Math.PI) / 180};
  h.cameraController.targetPitch = ${pitch};
  h.cameraController.snap(h.player.getPosition(), py);
  return { ground: +g.toFixed(2), body: [+px.toFixed(2), +py.toFixed(2), +pz.toFixed(2)] };
})()`);

console.log(`ground at (${x}, ${z}) = ${info.ground}`);
console.log(`body placed at ${info.body.join(', ')}`);

await new Promise((r) => setTimeout(r, 900));
const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(png.data, 'base64'));
console.log(`wrote ${out}`);

await cdp.close();
