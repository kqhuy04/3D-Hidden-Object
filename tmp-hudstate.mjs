// The HUD in its "mid-hunt" state: two found, one mistake spent, a hint showing.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9369, width: 1440, height: 900 });
await waitForGame(cdp);
await cdp.evaluate('window.__hunt.game.startNewRound()');
await sleep(1200);
await cdp.evaluate(`(() => {
  const g = window.__hunt.game;
  const rm = g.roundManager;
  const items = rm.getItems().map((i, n) => ({ ...i, found: n < 2 }));
  g.ui.hud.updateItems(items);
  g.ui.hud.setStrikes(1, 3);
  g.ui.hud.showHint(items[2].placement.hint);
  g.ui.hud.showFeedback('FOUND — 3 LEFT', true);
  return true;
})()`);
await sleep(700);
const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('ui-7-hudstate.png', Buffer.from(png.data, 'base64'));
console.log('-> ui-7-hudstate.png');
await cdp.close();
