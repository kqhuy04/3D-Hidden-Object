// Did the start screen talk the game into its lowest quality preset?
//
// Sits on the menu for ten seconds — long enough for the adaptive scaler to make
// ten decisions — then starts a round and reads what the scaler actually chose.
// Before the fix this came back at the bottom of the ladder with shadows off and
// the resolution at its floor, which is the "360p" the player saw.
//
// Usage: node tmp-quality.mjs
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.env.TEMP, 'hunt-shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdp = await launch({ url: 'http://localhost:1420/?debug=1', port: 9353, width: 1440, height: 860 });
await waitForGame(cdp);
await sleep(1500);

const read = () => cdp.evaluate(`(() => {
  const q = window.__hunt.quality;
  const r = window.__hunt.renderer;
  return {
    scale: +q.getScale().toFixed(3),
    autoStep: q.getAutoStep(),
    shadows: q.getPreset().shadows,
    pixelCap: q.getPreset().pixelCap,
    pixelRatio: +r.getPixelRatio().toFixed(3),
    frameMs: +q.getFrameMs().toFixed(1),
    state: window.__hunt.game.state,
  };
})()`);

console.log('at boot        ', JSON.stringify(await read()));

// Ten seconds of start screen. This is the window that used to poison it.
await sleep(10000);
console.log('after 10s menu ', JSON.stringify(await read()));

await cdp.evaluate(`document.querySelector('#btn-play').click(), true`);
await sleep(900);
const mapId = await cdp.evaluate(`window.__hunt.game.map.id`);
await cdp.evaluate(`document.querySelector('[data-map-id="${mapId}"]').click(), true`);
await sleep(5000);
console.log('in a round     ', JSON.stringify(await read()));

const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(OUT, 'quality-ingame.png'), Buffer.from(data, 'base64'));
console.log('shot quality-ingame.png');

const errors = cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l));
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none');
await cdp.close();
