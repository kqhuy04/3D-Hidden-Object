// Captures the results card after a clean win, for the report.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';

const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9338 });
await waitForGame(cdp);

await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  h.game.startNewRound();
  h.cameraController.update = () => {};
  await new Promise((r) => setTimeout(r, 400));
  // Time has to be added while the round is still running: update() is a no-op
  // once it is won.
  h.game.roundManager.update(214);
  for (const item of [...h.hiddenItems.getItems()]) {
    const c = item.centre;
    h.camera.position.set(c.x, c.y + 1.35, c.z + 2);
    h.camera.lookAt(c);
    h.camera.updateMatrixWorld(true);
    h.game.handlePickup();
    await new Promise((r) => setTimeout(r, 120));
  }
  return true;
})()`);
await new Promise((r) => setTimeout(r, 1200));
const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('docs/hunt/results-card.png', Buffer.from(png.data, 'base64'));
console.log(await cdp.evaluate(`document.querySelector('#results-summary')?.textContent`));
await cdp.close();
