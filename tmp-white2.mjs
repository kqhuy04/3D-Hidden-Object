// "Lúc lại gần các vật bấm E thì màn hình bị 1 màn trắng."
//
// tmp-white.mjs forced a selection on arbitrary meshes with the loop stopped and
// found nothing, which only proves the outline shader is well behaved for a
// single still frame. The report is about *approaching* a prop: the composer is
// entered for the first time, its targets are allocated, and the frame after
// that is the one the player sees. So this drives the real loop frame by frame
// from a real standing position and reads the framebuffer every frame.
//
// Usage: node tmp-white2.mjs [map-id] [itemIndex]
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const mapId = process.argv[2] ?? 'campground-lake';
const which = Number(process.argv[3] ?? 0);
const outDir = path.join(process.env.TEMP || '/tmp', 'hunt-shots');
fs.mkdirSync(outDir, { recursive: true });

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9462, width: 1280, height: 800 });
await waitForGame(cdp);
await cdp.evaluate(`(() => { localStorage.clear(); return true; })()`);
await cdp.send('Page.navigate', { url: `http://localhost:1420/?debug=1&map=${mapId}` });
for (let i = 0; i < 200; i++) {
  if (await cdp.evaluate(`!!window.__hunt`).catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 250));
}
await cdp.evaluate('(async () => { await window.__hunt.game.startNewRound(); return true; })()');
await new Promise((r) => setTimeout(r, 2000));

// Stand where a player stands: 1.6 m out, yaw so the boom is on the far side.
const placed = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const it = h.hiddenItems.getItems()[${which}];
  const c = it.centre;
  const px = c.x + 1.6, pz = c.z;
  const ground = h.collision.getGroundHeight(px, pz);
  const spawn = h.collision.findSpawn({ x: px, y: ground + 0.5, z: pz }, 3) || { x: px, y: ground, z: pz };
  h.player.setPosition(spawn.x, spawn.y + 0.05, spawn.z);
  h.cameraController.targetYaw = Math.atan2(spawn.x - c.x, spawn.z - c.z);
  h.cameraController.snap(h.player.getPosition(), spawn.y);
  return { id: it.placement.id, centre: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)], body: [+spawn.x.toFixed(2), +spawn.y.toFixed(2), +spawn.z.toFixed(2)] };
})()`);
console.log('placed', JSON.stringify(placed));

const result = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.game;
  g.loop.stop();
  const gl = g.renderer.getContext();
  const bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight;
  const W = 32, H = 32;

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

  const trace = [];
  const errors = [];
  let worst = { mean: -1 };

  for (let f = 0; f < 60; f++) {
    // Walk in over the last stretch, so the transition from "out of reach" to
    // "in reach" happens while the loop is running — which is when the composer
    // is entered for the first time.
    try {
      g.update(1 / 60);
      g.render();
    } catch (e) {
      errors.push(String(e && e.message || e));
      if (errors.length > 3) break;
    }
    const s = sample();
    const t = { f, ...s, hasTarget: !!(h.highlight && h.highlight.hasTarget()), ctxLost: gl.isContextLost() };
    if (s.mean > worst.mean) worst = t;
    trace.push(t);
  }

  const bad = trace.filter((t) => t.mean > 200 || t.whitePct > 20);
  return {
    frames: trace.length,
    worst,
    badCount: bad.length,
    bad: bad.slice(0, 8),
    firstTargetFrame: trace.find((t) => t.hasTarget)?.f ?? null,
    // The ten frames around the moment the target first appeared.
    around: (() => {
      const i = trace.findIndex((t) => t.hasTarget);
      return i < 0 ? [] : trace.slice(Math.max(0, i - 3), i + 8);
    })(),
    ctxLost: gl.isContextLost(),
    errors,
  };
})()`);

console.log(JSON.stringify(result, null, 1));

const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
const file = path.join(outDir, `white2-${mapId}-${which}.png`);
fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
console.log('shot ->', file);

await cdp.close();
