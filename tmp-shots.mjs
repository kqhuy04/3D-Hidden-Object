// Clean captures for review: no `?debug=1`, so no diagnostics panel over the
// corner of the screen. Waits on the DOM instead of `__hunt`, which is the only
// thing the debug flag provides.
//
// Usage: node tmp-shots.mjs
import { launch } from './tmp-cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.env.TEMP, 'hunt-shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdp = await launch({ url: 'http://localhost:1420/', port: 9347, width: 1440, height: 860 });

const waitFor = async (expr, tries = 400) => {
  for (let i = 0; i < tries; i++) {
    if (await cdp.evaluate(expr)) return true;
    await sleep(250);
  }
  throw new Error(`timed out: ${expr}`);
};

// The boot loading screen is removed only after the first world finishes
// loading; the portrait canvas exists long before that.
await waitFor(`!!document.querySelector('.char-stage-canvas') && !document.querySelector('#loading-screen')`);
await sleep(2500);

const shot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log('shot', name);
};

await shot('final-start');

await cdp.evaluate(`document.querySelector('#btn-play').click(), true`);
await sleep(1500);
await shot('final-maps');

await cdp.evaluate(`document.querySelector('#btn-map-close').click(), true`);
await sleep(600);
await cdp.evaluate(`document.querySelector('#btn-credits').click(), true`);
await sleep(500);
await shot('final-credits');

const errors = cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l));
console.log('console errors:', errors.length ? errors.slice(0, 6) : 'none');
await cdp.close();
