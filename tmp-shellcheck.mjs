// The map picker with progress records, and the pause menu with the new
// Settings entry.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.join(process.env.TEMP || '/tmp', 'hunt-shots');
fs.mkdirSync(outDir, { recursive: true });

const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=cozy-farm', port: 9449, width: 1280, height: 800 });
await waitForGame(cdp);
await new Promise((r) => setTimeout(r, 2200));

// Two records: one cleared, one partly found.
await cdp.evaluate(`(() => {
  const s = window.__hunt.save;
  s.recordMap('cozy-farm', 5, 5, 134);
  s.recordMap('coral-reef', 3, 5, 400);
  return true;
})()`);

const shot = async (name) => {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
  console.log(name, '->', file);
};

await cdp.evaluate(`(() => { document.querySelector('#btn-map').click(); return true; })()`);
await new Promise((r) => setTimeout(r, 700));
await shot('ui-mapselect-records');

const cards = await cdp.evaluate(`(() => [...document.querySelectorAll('.map-card')]
  .filter((c) => c.querySelector('.map-card-record'))
  .map((c) => c.querySelector('.map-card-name').textContent + ' :: ' + c.querySelector('.map-card-record').textContent.trim()))()`);
console.log('records shown:', JSON.stringify(cards, null, 1));

// Back out, start a round, then open the pause menu.
await cdp.evaluate(`(() => { document.querySelector('#btn-map-close').click(); return true; })()`);
await new Promise((r) => setTimeout(r, 400));
await cdp.evaluate('(async () => { await window.__hunt.game.startNewRound(); return true; })()');
await new Promise((r) => setTimeout(r, 1500));
await cdp.evaluate(`(() => { window.__hunt.game.togglePause(); return true; })()`);
await new Promise((r) => setTimeout(r, 600));
await shot('ui-pause');

// Settings from the pause menu must pause the clock and come back to pause.
const before = await cdp.evaluate(`window.__hunt.game.roundManager.getElapsed()`);
await cdp.evaluate(`(() => { document.querySelector('#btn-pause-settings').click(); return true; })()`);
await new Promise((r) => setTimeout(r, 1500));
const state = await cdp.evaluate(`(() => ({
  open: window.__hunt.game.ui.settings.isOpen,
  gameState: window.__hunt.game.state,
  paused: window.__hunt.game.roundManager.getStatus(),
}))()`);
console.log('settings from pause', JSON.stringify(state), 'elapsed before', before);

// Escape closes it and returns to the pause menu.
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await new Promise((r) => setTimeout(r, 600));
const after = await cdp.evaluate(`(() => ({
  settingsOpen: window.__hunt.game.ui.settings.isOpen,
  pauseOpen: !document.querySelector('#pause-menu-screen').classList.contains('hidden'),
  gameState: window.__hunt.game.state,
}))()`);
console.log('after escape', JSON.stringify(after));
await shot('ui-pause-again');

await cdp.close();
