// Capture a small clipped region, so a 20-pixel reticle is actually inspectable.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';
const [x, y, w, h, out] = process.argv.slice(2).map((v, i) => (i === 4 ? v : Number(v)));
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9363, width: 1440, height: 900 });
await waitForGame(cdp);
await cdp.evaluate('window.__hunt.game.startNewRound()');
await new Promise((r) => setTimeout(r, 1800));
const png = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale: 4 } });
fs.writeFileSync(out, Buffer.from(png.data, 'base64'));
console.log('->', out);
await cdp.close();
