// Screenshots of the new shell: main menu, settings sheet, and the game behind
// the new render path. Written outside the Vite root so the dev server does not
// reload mid-run.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.join(process.env.TEMP || '/tmp', 'hunt-shots');
fs.mkdirSync(outDir, { recursive: true });

const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=cozy-farm', port: 9445, width: 1280, height: 800 });
await waitForGame(cdp);
await new Promise((r) => setTimeout(r, 2500));

const shot = async (name) => {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
  console.log(name, '->', file);
};

await shot('ui-mainmenu');

// Open the options sheet exactly the way a player does.
await cdp.evaluate(`(() => { document.querySelector('#btn-settings').click(); return true; })()`);
await new Promise((r) => setTimeout(r, 500));
await shot('ui-settings');

// Nudge a couple of controls so the active states are visible.
await cdp.evaluate(`(() => {
  document.querySelector('.seg[data-quality="high"]').click();
  document.querySelector('#settings-shadows').click();
  const fov = document.querySelector('#settings-fov');
  fov.value = '74';
  fov.dispatchEvent(new Event('input', { bubbles: true }));
  fov.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#settings-fps').click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 600));
await shot('ui-settings-touched');

const state = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  return {
    settings: h.save.settings,
    level: h.quality.getLevel(),
    preset: h.quality.getPreset(),
    pixelRatio: +h.renderer.getPixelRatio().toFixed(3),
    shadowMap: h.sun.sun.shadow.mapSize.width,
    shadowType: h.renderer.shadowMap.type,
    fov: +h.camera.fov.toFixed(1),
    saved: JSON.parse(localStorage.getItem('odd-objects:v1') || 'null'),
  };
})()`);
console.log(JSON.stringify(state, null, 1));

// Back out and start a round, so the gameplay HUD (with the FPS chip) is shown.
await cdp.evaluate(`(() => { document.querySelector('#btn-settings-back').click(); return true; })()`);
await new Promise((r) => setTimeout(r, 400));
await cdp.evaluate('(async () => { await window.__hunt.game.startNewRound(); return true; })()');
await new Promise((r) => setTimeout(r, 3500));
await shot('ui-gameplay');

await cdp.close();
