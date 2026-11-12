// Photograph a prop: stands the body a few metres from it, points the boom at it,
// and lets the camera settle over real frames before capturing.
//
// tmp-shot's 900 ms sleep is about one frame under SwiftShader, so the boom never
// arrives and the picture shows wherever the camera was before.
//
// Usage: node tmp-photo.mjs <map> <tx> <ty> <tz> [dist] [out.png]
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';

const [mapId, tx, ty, tz, distArg, out] = process.argv.slice(2);
const dist = Number(distArg) || 4.5;
const file = out ?? `tmp-photo-${mapId}.png`;

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9431 });
await waitForGame(cdp);
await cdp.evaluate(`(async () => { await window.__hunt.game.startNewRound(); return true; })()`);
await new Promise((r) => setTimeout(r, 400));

const info = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const T = { x: ${tx}, y: ${ty}, z: ${tz} };
  // Stand on the +z side of the subject, as close as the ground allows.
  let bx = T.x, bz = T.z + ${dist};
  const spawn = h.collision.findSpawn({ x: bx, y: T.y, z: bz }, 3);
  if (spawn) { bx = spawn.x; bz = spawn.z; }
  const ground = h.collision.groundAt(bx, bz, T.y);
  h.player.setPosition(bx, ground + 0.05, bz);

  // Boom sits opposite the subject: offset direction = (sin yaw, cos yaw).
  const yaw = Math.atan2(bx - T.x, bz - T.z);
  h.cameraController.targetYaw = yaw;
  h.cameraController.targetPitch = Math.atan2(T.y - (ground + 1.1), Math.hypot(bx - T.x, bz - T.z));
  h.cameraController.targetDistance = ${dist};
  h.cameraController.snap(h.player.getPosition(), ground);
  // Real frames, stepped by hand: the boom lerps, and the live loop is far too
  // slow here to do it in wall-clock time.
  for (let i = 0; i < 40; i++) h.game.update(1 / 60);
  return { body: [+bx.toFixed(1), +ground.toFixed(1), +bz.toFixed(1)], yaw: +yaw.toFixed(2) };
})()`);

await new Promise((r) => setTimeout(r, 700));
const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
console.log(`body ${JSON.stringify(info.body)} yaw ${info.yaw} -> ${file}`);
await cdp.close();
