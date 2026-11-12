// The results card, after a win: does it show the best time, and does the
// record survive a reload?
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const mapId = process.argv[2] ?? 'cozy-farm';
const outDir = path.join(process.env.TEMP || '/tmp', 'hunt-shots');
fs.mkdirSync(outDir, { recursive: true });

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9448, width: 1280, height: 800 });
await waitForGame(cdp);
await cdp.evaluate(`(() => { localStorage.clear(); return true; })()`);
await cdp.send('Page.navigate', { url: `http://localhost:1420/?debug=1&map=${mapId}` });
for (let i = 0; i < 200; i++) {
  const ready = await cdp.evaluate(`!!window.__hunt && window.__hunt.game.map?.id === ${JSON.stringify(mapId)}`).catch(() => false);
  if (ready) break;
  await new Promise((r) => setTimeout(r, 250));
}
await cdp.evaluate('(async () => { await window.__hunt.game.startNewRound(); return true; })()');
await new Promise((r) => setTimeout(r, 1500));

const shot = async (name) => {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
  console.log(name, '->', file);
};

// Win the round the way the game does it: complete all five.
const won = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const rm = h.game.roundManager;
  for (const item of rm.getItems()) rm.complete(item.placement.id);
  return { status: rm.getStatus(), found: rm.getFoundCount() };
})()`);
console.log('win', JSON.stringify(won));
await new Promise((r) => setTimeout(r, 900));
await shot('results-first-clear');

const card = await cdp.evaluate(`(() => ({
  time: document.querySelector('#stat-time')?.textContent,
  best: document.querySelector('#stat-best')?.textContent,
  chipVisible: !document.querySelector('#results-best-chip')?.classList.contains('hidden'),
  record: window.__hunt.save.recordFor(${JSON.stringify(mapId)}),
}))()`);
console.log('card', JSON.stringify(card));

// Second clear: the best should now be reported as an existing record, and the
// chip should not appear unless the time actually improved.
await cdp.evaluate(`(() => { document.querySelector('#btn-results-retry').click(); return true; })()`);
await new Promise((r) => setTimeout(r, 2500));
const second = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const rm = h.game.roundManager;
  for (const item of rm.getItems()) rm.complete(item.placement.id);
  return { status: rm.getStatus() };
})()`);
await new Promise((r) => setTimeout(r, 900));
const card2 = await cdp.evaluate(`(() => ({
  time: document.querySelector('#stat-time')?.textContent,
  best: document.querySelector('#stat-best')?.textContent,
  chipVisible: !document.querySelector('#results-best-chip')?.classList.contains('hidden'),
  record: window.__hunt.save.recordFor(${JSON.stringify(mapId)}),
}))()`);
console.log('second', JSON.stringify(second), JSON.stringify(card2));
await shot('results-second-clear');

await cdp.close();
