// Contact sheet: many screenshots on one page, so fourteen maps can be looked at
// in one glance instead of fourteen.
//
// Usage: node tmp-montage.mjs <out.png> <cols> <file> [file ...]
import { launch } from './tmp-cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const [out, colsArg, ...files] = process.argv.slice(2);
const cols = Number(colsArg) || 4;

const cells = files
  .map((f) => {
    const abs = path.resolve(f).replace(/\\/g, '/');
    const label = path.basename(f).replace(/^sweep-/, '').replace(/\.png$/, '');
    return `<figure><img src="file:///${abs}"><figcaption>${label}</figcaption></figure>`;
  })
  .join('\n');

const html = `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; background: #222; font: 12px/1.3 monospace; }
  main { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 4px; padding: 4px; }
  figure { margin: 0; position: relative; }
  img { display: block; width: 100%; }
  figcaption { position: absolute; left: 0; bottom: 0; padding: 2px 6px; background: #000; color: #fff; }
</style>
<main>${cells}</main>`;

// Written to TEMP: a file in the project root makes Vite reload the page.
const page = path.join(process.env.TEMP || '/tmp', 'hunt-montage.html');
fs.writeFileSync(page, html);
const cdp = await launch({ url: 'file:///' + page.replace(/\\/g, '/'), port: 9403, width: 1600, height: 900 });
await new Promise((r) => setTimeout(r, 1500));
const metrics = await cdp.evaluate('({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth })');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: metrics.w, height: metrics.h, deviceScaleFactor: 1, mobile: false });
await new Promise((r) => setTimeout(r, 600));
const png = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: metrics.w, height: metrics.h, scale: 1 } });
fs.writeFileSync(out, Buffer.from(png.data, 'base64'));
console.log(`-> ${out}  ${metrics.w}x${metrics.h}`);
await cdp.close();
