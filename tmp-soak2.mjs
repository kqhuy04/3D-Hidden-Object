// Frame time before and after ten map switches — a real leak shows up as slowdown.
import { launch, waitForGame } from './tmp-cdp.mjs';

const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=stadium', port: 9333 });
await waitForGame(cdp);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (sel) => cdp.evaluate(`document.querySelector('${sel}').click(); true`);

const frames = () => cdp.evaluate(`(async () => {
  const t = [];
  await new Promise((res) => {
    let n = 0, last = performance.now();
    const tick = () => {
      const now = performance.now();
      t.push(Math.round(now - last));
      last = now;
      if (++n < 8) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });
  const s = t.slice(1).sort((a, b) => a - b);
  return { median: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
})()`);

const probe = () => cdp.evaluate(`(() => {
  const h = window.__hunt, i = h.game.renderer.info.memory;
  let meshes = 0, lights = 0;
  h.game.scene.traverse((o) => { if (o.isMesh) meshes++; if (o.isLight) lights++; });
  return { map: h.game.map.id, meshes, lights, geo: i.geometries, tex: i.textures,
    heap: +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) };
})()`);

await click('#btn-play');
await wait(1200);
const base = await frames();
console.log('0  baseline', JSON.stringify(await probe()), 'frame', JSON.stringify(base));

const maps = ['campground-lake', 'stadium'];
for (let i = 1; i <= 10; i++) {
  const target = maps[i % 2];
  const st = await cdp.evaluate('window.__hunt.game.state');
  if (st === 'PLAYING') {
    await cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true })); true`);
    await wait(250);
    await click('#btn-pause-map');
  } else {
    await click('#btn-map');
  }
  await wait(350);
  await click(`[data-map-id="${target}"]`);
  for (let k = 0; k < 300; k++) {
    const id = await cdp.evaluate('window.__hunt.game.map.id');
    const state = await cdp.evaluate('window.__hunt.game.state');
    if (id === target && state === 'PLAYING') break;
    await wait(400);
  }
  await wait(1200);
  const f = await frames();
  console.log(String(i).padStart(2), JSON.stringify(await probe()), 'frame', JSON.stringify(f));
}

console.log('errors:', cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l)).slice(0, 4));
await cdp.close();
