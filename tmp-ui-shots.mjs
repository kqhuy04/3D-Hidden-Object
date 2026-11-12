// Screenshot every UI state, for a before/after of the redesign.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';

const cdp = await launch({ url: 'http://localhost:1420/?debug=1', port: 9561, width: 1440, height: 900 });

// `waitForGame` also demands an animator, which only exists once a map has been
// built. On the menu the world is still loading, so wait for the handle alone.
for (let i = 0; i < 200; i++) {
  const ok = await cdp.evaluate('!!window.__hunt');
  if (ok) break;
  await new Promise((r) => setTimeout(r, 250));
}
await new Promise((r) => setTimeout(r, 2500));

const shot = async (name) => {
  await new Promise((r) => setTimeout(r, 700));
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(name, Buffer.from(png.data, 'base64'));
  console.log('->', name);
};

await shot('ui-1-menu.png');

// How to play
await cdp.evaluate(`document.querySelector('#btn-controls').click()`);
await shot('ui-2-howto.png');
await cdp.evaluate(`document.querySelector('#btn-close-controls').click()`);

// Map picker
await cdp.evaluate(`document.querySelector('#btn-map').click()`);
await shot('ui-3-maps.png');
await cdp.evaluate(`document.querySelector('#map-select-screen .btn-back, #btn-close-maps, .map-select-close')?.click()`);

// Start the hunt
await cdp.evaluate(`(async () => { await window.__hunt.game.startNewRound(); await new Promise(r=>setTimeout(r,600)); return true; })()`);
await shot('ui-4-hud.png');

// Pause
await cdp.evaluate(`window.__hunt.game.togglePause?.()`);
await shot('ui-5-pause.png');
await cdp.evaluate(`window.__hunt.game.togglePause?.()`);

// Results — a won round, forced so the card can be judged without playing.
await cdp.evaluate(`(() => {
  const g = window.__hunt.game;
  const rm = g.roundManager;
  const items = rm.getItems().map((i, n) => ({ ...i, found: n < 4 }));
  g.ui.showResults(true, 4, items.length, '4:18', items);
  return true;
})()`);
await shot('ui-6-results.png');
await cdp.close();
