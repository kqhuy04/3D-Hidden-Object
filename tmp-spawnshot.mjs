// The first thing the player sees: spawn, no camera meddling.
//
// Earlier spawn shots used cameraController.snap(), which teleports the boom and
// skips its collision pass, so a body next to a hoarding produced a screenshot
// of the inside of the hoarding. This one starts the round and then does nothing
// at all — whatever the camera settles on is what a player gets.
//
// Usage: node tmp-spawnshot.mjs <map-id> [map-id ...]
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const maps = process.argv.slice(2);
// Outside the Vite root: writing into the project makes the dev server reload
// the page, which is exactly what a screenshot harness must not cause.
const outDir = path.join(process.env.TEMP || '/tmp', 'hunt-shots');
fs.mkdirSync(outDir, { recursive: true });

const cdp = await launch({ url: 'about:blank', port: 9411, width: 1280, height: 800 });

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
  // Long enough for the boom to finish its opening lerp on a slow renderer.
  await new Promise((r) => setTimeout(r, 4000));

  const info = await cdp.evaluate(`(() => {
    const h = window.__hunt;
    const p = h.player.getPosition();
    return {
      pos: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)],
      boom: +h.camera.position.distanceTo(p).toFixed(1),
    };
  })()`);

  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(outDir, `spawn-${mapId}.png`);
  fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
  console.log(`${mapId.padEnd(32)} body ${JSON.stringify(info.pos)}  boom ${info.boom}m  -> ${file}`);
}

await cdp.close();
