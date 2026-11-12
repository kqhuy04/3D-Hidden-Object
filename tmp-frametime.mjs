// How long does one rendered frame take in this headless (SwiftShader) browser?
import { launch, waitForGame } from './tmp-cdp.mjs';
const mapId = process.argv[2] || 'frontier-town';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9333 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  const times = [];
  await new Promise((res) => {
    let n = 0, last = performance.now();
    const tick = () => { const now = performance.now(); times.push(Math.round(now - last)); last = now;
      if (++n < 6) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  return { frameMs: times.slice(1), renderer: h.game.renderer?.info?.render };
})()`);
console.log(`=== ${mapId} frame times (ms):`, JSON.stringify(out.frameMs));
console.log('  render info', JSON.stringify(out.renderer));
await cdp.close();
