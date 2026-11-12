// Does the adaptive scaler actually do anything?
//
// SwiftShader runs this game at 20-40 fps, which is exactly the condition the
// scaler exists for. If the scale does not move on this machine it will not move
// on a slow laptop either.
import { launch, waitForGame } from './tmp-cdp.mjs';

const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=chrome-arcology-transit', port: 9452, width: 1280, height: 800 });
await waitForGame(cdp);
await cdp.evaluate(`(() => { localStorage.clear(); return true; })()`);
await cdp.send('Page.navigate', { url: 'http://localhost:1420/?debug=1&map=chrome-arcology-transit' });
for (let i = 0; i < 200; i++) {
  const ready = await cdp.evaluate(`!!window.__hunt`).catch(() => false);
  if (ready) break;
  await new Promise((r) => setTimeout(r, 250));
}
await cdp.evaluate('(async () => { await window.__hunt.game.startNewRound(); return true; })()');

const read = () => cdp.evaluate(`(() => {
  const q = window.__hunt.quality;
  return {
    scale: +q.getScale().toFixed(2),
    level: q.getLevel(),
    autoStep: q.getAutoStep(),
    frameMs: +q.getFrameMs().toFixed(1),
    pixelRatio: +window.__hunt.renderer.getPixelRatio().toFixed(3),
    drawingBuffer: [window.__hunt.renderer.domElement.width, window.__hunt.renderer.domElement.height],
  };
})()`);

for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  console.log(`t+${(i + 1) * 4}s`, JSON.stringify(await read()));
}

// And back up: hand the machine a fast frame time and watch it recover.
const recovered = await cdp.evaluate(`(() => {
  const q = window.__hunt.quality;
  for (let i = 0; i < 400; i++) q.tick(6);
  return { scale: +q.getScale().toFixed(2), level: q.getLevel(), autoStep: q.getAutoStep() };
})()`);
console.log('after 400 fast frames', JSON.stringify(recovered));

await cdp.close();
