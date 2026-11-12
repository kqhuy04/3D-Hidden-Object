// The start screen and the map picker, photographed in the real browser.
//
// It loads one map (the game will not show its menu before a world exists) and
// then drives the two screens with real clicks, so what lands in the PNGs is
// what a player sees rather than what the CSS was supposed to say.
//
// Usage: node tmp-menu.mjs
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.env.TEMP, 'hunt-shots');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await launch({ url: 'http://localhost:1420/?debug=1', port: 9341, width: 1440, height: 860 });
await waitForGame(cdp);

const shot = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`shot ${name}`);
};

// The portrait loads its GLB asynchronously after the menu appears.
await sleep(3000);
await shot('start-1');

const state = await cdp.evaluate(`(() => {
  const q = (s) => document.querySelector(s);
  return {
    menuVisible: !q('#main-menu-screen').classList.contains('hidden'),
    character: window.__hunt.save.settings.character,
    backdrop: getComputedStyle(q('#start-backdrop')).backgroundImage,
    map: q('#current-map-name')?.textContent,
    canvas: (() => { const c = q('.char-stage-canvas'); return c ? [c.width, c.height] : null; })(),
    stage: (() => { const s = q('.char-stage'); return s ? [s.clientWidth, s.clientHeight] : null; })(),
  };
})()`);
console.log('menu:', JSON.stringify(state));

// Next character twice, then back once. With the caption gone, the model is the
// only feedback — so the assertion is on the id the game saved.
const who = () => cdp.evaluate(`window.__hunt.save.settings.character`);
const start = await who();
await cdp.evaluate(`document.querySelector('#btn-char-next').click(), true`);
await sleep(1800);
await shot('start-2');
console.log('paged forward:', start, '->', await who());
await cdp.evaluate(`document.querySelector('#btn-char-prev').click(), true`);
await sleep(900);
console.log('paged back:   ', await who(), '(expected', start + ')');

// Credits sheet.
await cdp.evaluate(`document.querySelector('#btn-credits').click(), true`);
await sleep(400);
await shot('credits');
await cdp.evaluate(`document.querySelector('#btn-close-credits').click(), true`);
await sleep(300);

// Play -> map picker.
await cdp.evaluate(`document.querySelector('#btn-play').click(), true`);
await sleep(1200);
await shot('maps-1');
console.log('picker:', await cdp.evaluate(`(() => {
  const g = document.querySelector('#map-grid');
  const cards = [...g.querySelectorAll('.map-card')];
  const first = cards[0];
  const img = first?.querySelector('.map-card-image');
  return {
    open: !document.querySelector('#map-select-screen').classList.contains('hidden'),
    cards: cards.length,
    rows: getComputedStyle(g).gridTemplateRows,
    pager: document.querySelector('#map-pager-label').textContent,
    foot: document.querySelector('#map-foot-note').textContent,
    cardBox: first ? [Math.round(first.getBoundingClientRect().width), Math.round(first.getBoundingClientRect().height)] : null,
    imgSrc: img?.getAttribute('src'),
    imgLoaded: img ? img.complete && img.naturalWidth > 0 : null,
    scrolls: g.scrollHeight > g.clientHeight + 1,
  };
})()`));

await cdp.evaluate(`document.querySelector('#btn-map-next').click(), true`);
await sleep(900);
await shot('maps-2');
console.log('page 2:', await cdp.evaluate(`document.querySelector('#map-pager-label').textContent`));

const errors = cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l));
console.log('console errors:', errors.length ? errors.slice(0, 8) : 'none');

await cdp.close();
