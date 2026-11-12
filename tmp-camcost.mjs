import { launch, waitForGame } from './tmp-cdp.mjs';
const mapId = process.argv[2] || 'symphony-stagecraft';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9333 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const c = h.collision;
  const V = h.game.scene.position.constructor;
  const from = new V(0, 1.5, 0);
  const to = new V(4, 3, 0);
  // warm up
  for (let i = 0; i < 20; i++) c.cameraDistance(from, to);
  const N = 200;
  const t0 = performance.now();
  let hits = 0;
  for (let i = 0; i < N; i++) {
    to.set(Math.cos(i) * 5, 2 + (i % 3), Math.sin(i) * 5);
    if (c.cameraDistance(from, to) < 4.9) hits++;
  }
  const ms = performance.now() - t0;
  return { perCall: +(ms / N).toFixed(3), hits, parts: h.geometry.parts.length };
})()`);
console.log(mapId, JSON.stringify(out));
await cdp.close();
