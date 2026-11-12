// Two things a screenshot of a static menu cannot prove: that the portrait
// turns when dragged, and that paging the roster never shows a T-pose.
//
// The drag is measured as a pixel difference over the left half — black box,
// because the point is what the player sees, not what the holder's rotation
// reads. The T-pose is caught by shooting the panel at three points during the
// swap; a T-pose is a silhouette twice as wide at the shoulders and is obvious
// in any of them.
//
// Usage: node tmp-drag.mjs
import { launch } from './tmp-cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const OUT = path.join(process.env.TEMP, 'hunt-shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdp = await launch({ url: 'http://localhost:1420/', port: 9349, width: 1440, height: 860 });
const waitFor = async (expr, tries = 400) => {
  for (let i = 0; i < tries; i++) {
    if (await cdp.evaluate(expr)) return true;
    await sleep(250);
  }
  throw new Error(`timed out: ${expr}`);
};
await waitFor(`!!document.querySelector('.char-stage-canvas') && !document.querySelector('#loading-screen')`);
await sleep(2500);

const grab = async () => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  return Buffer.from(data, 'base64');
};

// --- 1. drag turns the character -----------------------------------------
const before = await grab();
const box = await cdp.evaluate(`(() => {
  const r = document.querySelector('.char-stage-canvas').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
})()`);

const cx = box.x + box.w / 2;
const cy = box.y + box.h / 2;
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
for (let i = 1; i <= 12; i++) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + i * 18, y: cy, button: 'left', buttons: 1 });
  await sleep(16);
}
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + 216, y: cy, button: 'left', clickCount: 1 });
await sleep(1200);
const after = await grab();
fs.writeFileSync(path.join(OUT, 'drag-after.png'), after);

// The screenshot is in device pixels and the input events are in CSS pixels,
// so the crop has to be scaled rather than assumed to match the viewport.
const meta = await sharp(before).metadata();
const view = await cdp.evaluate(`({ w: window.innerWidth, h: window.innerHeight })`);
const scale = meta.width / view.w;
const left = {
  left: 0,
  top: 0,
  width: Math.min(meta.width - 1, Math.round((box.x + box.w) * scale)),
  height: meta.height,
};
const a = await sharp(before).extract(left).raw().toBuffer();
const b = await sharp(after).extract(left).raw().toBuffer();
let diff = 0;
for (let i = 0; i < a.length; i += 3) diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
const meanDiff = diff / (a.length / 3) / 3;
console.log(`drag: mean pixel change over the portrait = ${meanDiff.toFixed(1)} / 255`);

// --- 2. no T-pose during the swap ----------------------------------------
await cdp.evaluate(`document.querySelector('#btn-char-next').click(), true`);
for (const [i, delay] of [90, 220, 420].entries()) {
  await sleep(delay - (i === 0 ? 0 : [90, 220, 420][i - 1]));
  fs.writeFileSync(path.join(OUT, `swap-${i}.png`), await grab());
}
console.log('swap frames written: swap-0/1/2.png');

const errors = cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l));
console.log('console errors:', errors.length ? errors.slice(0, 6) : 'none');
await cdp.close();
