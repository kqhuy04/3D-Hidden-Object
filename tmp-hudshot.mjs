import { launch, waitForGame } from './tmp-cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=cozy-farm', port: 9471 });
await waitForGame(cdp);
const dir = `${process.env.TEMP}/hunt-shots`;
mkdirSync(dir, { recursive: true });

const info = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.selectMap('cozy-farm');
  await h.game.startNewRound();
  h.game.loop.stop();
  document.getElementById('debug-overlay')?.remove();
  for (let f = 0; f < 60; f++) h.game.update(1 / 60);
  h.game.render();
  const hud = h.game.ui.hud;
  return { collapsed: hud.isObjectivesCollapsed(), timer: document.querySelector('#hud-timer-display') };
})()`);
const a = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${dir}/hud-collapsed.png`, Buffer.from(a.data, 'base64'));

await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  h.game.ui.hud.setObjectivesCollapsed(false);
  h.game.render();
})()`);
const b = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${dir}/hud-open.png`, Buffer.from(b.data, 'base64'));
console.log(JSON.stringify(info));
await cdp.close();
