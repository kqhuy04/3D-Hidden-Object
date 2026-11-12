// A map with no hunt authored yet must still be walkable: free roam, no crash,
// no console errors. Also captures the final HUD for the report.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';

const mapId = process.argv[2] ?? 'office';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9337 });
await waitForGame(cdp);

const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  h.game.startNewRound();
  await new Promise((r) => setTimeout(r, 800));
  return {
    map: h.game.map.id,
    items: h.hiddenItems.getItems().length,
    freeRoam: h.game.roundManager.isFreeRoam(),
    timer: document.querySelector('#hud-timer-display')?.textContent,
    list: [...document.querySelectorAll('#hud-objectives-list li')].map((li) => li.textContent.trim()),
    brief: document.querySelector('#hud-brief')?.textContent,
    state: h.game.roundManager.getStatus(),
  };
})()`);

console.log(JSON.stringify(out));
console.log('console:', cdp.consoleLines.filter((l) => /error|exception/i.test(l)).slice(0, 5));

if (process.argv[3]) {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(process.argv[3], Buffer.from(png.data, 'base64'));
}

await cdp.close();
