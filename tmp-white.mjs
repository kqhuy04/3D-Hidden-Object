// "Lúc lại gần vật bấm E thì màn hình trắng."
//
// The composer is entered the moment something is selected, so this forces a
// selection on real props and reads the actual framebuffer. A white screen shows
// up as a mean brightness near 255.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const mapId = process.argv[2] ?? 'campground-lake';
const outDir = path.join(process.env.TEMP || '/tmp', 'hunt-shots');
fs.mkdirSync(outDir, { recursive: true });

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9460, width: 1280, height: 800 });
await waitForGame(cdp);
await cdp.evaluate(`(() => { localStorage.clear(); return true; })()`);
await cdp.send('Page.navigate', { url: `http://localhost:1420/?debug=1&map=${mapId}` });
for (let i = 0; i < 200; i++) {
  const ready = await cdp.evaluate(`!!window.__hunt`).catch(() => false);
  if (ready) break;
  await new Promise((r) => setTimeout(r, 250));
}
await cdp.evaluate('(async () => { await window.__hunt.game.startNewRound(); return true; })()');
await new Promise((r) => setTimeout(r, 2500));

const result = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.game;
  g.loop.stop();
  const gl = g.renderer.getContext();
  const W = 64, H = 64;
  const bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight;

  const sample = () => {
    const buf = new Uint8Array(4 * W * H);
    gl.readPixels((bw - W) >> 1, (bh - H) >> 1, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let sum = 0, white = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const v = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
      sum += v;
      if (v > 245) white++;
    }
    return { mean: +(sum / (W * H)).toFixed(1), whitePct: +(100 * white / (W * H)).toFixed(1) };
  };

  const render = () => { g.render(); };

  // Warm both paths.
  g.highlight.setTarget(null);
  render(); render();
  const baseline = sample();

  // Every mesh in the world, skinned or not — a prop is a SkinnedMesh here.
  const meshes = [];
  g.scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    if (!o.geometry) return;
    meshes.push(o);
  });

  const bad = [];
  let worst = { mean: 0, name: '' };
  const step = Math.max(1, Math.floor(meshes.length / 24));
  for (let i = 0; i < meshes.length; i += step) {
    const m = meshes[i];
    g.highlight.setTarget(m);
    render();
    const s = sample();
    if (s.mean > worst.mean) worst = { mean: s.mean, whitePct: s.whitePct, name: m.name || '(unnamed)', skinned: !!m.isSkinnedMesh };
    if (s.mean > 235 || s.mean < 8) bad.push({ name: m.name || '(unnamed)', skinned: !!m.isSkinnedMesh, ...s });
  }
  g.highlight.setTarget(null);
  render();

  return {
    meshes: meshes.length,
    sampled: Math.ceil(meshes.length / step),
    baseline,
    worst,
    bad: bad.slice(0, 10),
    badCount: bad.length,
    targets: (() => {
      const list = h.hiddenItems.getItems().map((it) => ({
        id: it.placement.id,
        objectName: it.object?.name || '(unnamed)',
        skinned: !!it.object?.isSkinnedMesh,
      }));
      return list;
    })(),
  };
})()`);

console.log(JSON.stringify(result, null, 1));

// Now the real path: select an actual hidden object and screenshot it.
await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const it = h.hiddenItems.getItems()[0];
  h.highlight.setTarget(it.object);
  h.game.render();
  return true;
})()`);
const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
const file = path.join(outDir, `white-${mapId}.png`);
fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
console.log('shot ->', file);

await cdp.close();
