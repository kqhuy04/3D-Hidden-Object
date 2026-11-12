// Close-ups of the settings controls, at 2x, to judge the details.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.join(process.env.TEMP || '/tmp', 'hunt-shots');
fs.mkdirSync(outDir, { recursive: true });

const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=cozy-farm', port: 9446, width: 1280, height: 800 });
await waitForGame(cdp);
await new Promise((r) => setTimeout(r, 2200));

await cdp.evaluate(`(() => { document.querySelector('#btn-settings').click(); return true; })()`);
await new Promise((r) => setTimeout(r, 400));
// Quality = high, so the segment state and the note must agree.
await cdp.evaluate(`(() => { document.querySelector('.seg[data-quality="high"]').click(); return true; })()`);
await new Promise((r) => setTimeout(r, 400));

const shot = async (name, clip) => {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
  console.log(name, '->', file);
};

const box = await cdp.evaluate(`(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  };
  return {
    quality: r('.settings-row'),
    card: r('.settings-card'),
    switchRow: r('#settings-shadows'),
  };
})()`);
console.log(JSON.stringify(box));

await shot('crop-quality', { x: box.quality.x - 8, y: box.quality.y - 8, width: box.quality.width + 16, height: 150 });
await shot('crop-card-top', { x: box.card.x - 6, y: box.card.y - 6, width: box.card.width + 12, height: 320 });

await cdp.close();
