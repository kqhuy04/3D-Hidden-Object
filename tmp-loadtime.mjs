import { launch, waitForGame } from './tmp-cdp.mjs';
const mapId = process.argv[2];
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9403 });
const t0 = Date.now();
await waitForGame(cdp);
console.log(`${mapId}: ready in ${Date.now() - t0}ms`);
const lines = cdp.consoleLines.filter((l) => /\[hunt\]|\[load\]|\[collision\]|EXCEPTION/.test(l));
console.log(lines.join('\n'));
const timing = await cdp.evaluate(`(() => {
  const t = window.__hunt.game.worldLoader.timings;
  return t;
})()`);
console.log('timings:', JSON.stringify(timing));
await cdp.close();
