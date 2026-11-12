import fs from 'node:fs';
import path from 'node:path';
import { launch } from './tools/cdp.mjs';

const out = path.join(process.env.LOCALAPPDATA, 'Temp', 'hunt-shots');
fs.mkdirSync(out, { recursive: true });

const url = 'file:///' + encodeURI(path.resolve('tmp-picker.html').replace(/\\/g, '/'));
const cdp = await launch({ url, port: 9499, width: 1280, height: 800 });
await new Promise((r) => setTimeout(r, 1200));

const info = await cdp.evaluate(`(() => {
  const panel = document.querySelector('.map-panel');
  const grid = document.querySelector('.map-grid');
  const foot = document.querySelector('.map-panel-foot');
  const cards = [...document.querySelectorAll('.map-card')];
  return {
    viewport: [window.innerWidth, window.innerHeight],
    panel: [Math.round(panel.getBoundingClientRect().width), Math.round(panel.getBoundingClientRect().height)],
    grid: { h: Math.round(grid.getBoundingClientRect().height), scroll: grid.scrollHeight },
    footBottom: Math.round(foot.getBoundingClientRect().bottom),
    cards: cards.length,
    rows: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top))).size,
    imgLoaded: [...document.querySelectorAll('.map-card-image')].filter((i) => i.naturalWidth > 0).length,
  };
})()`);
console.log(JSON.stringify(info, null, 1));

const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
const file = path.join(out, 'picker.png');
fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
console.log('saved', file);
await cdp.close();
