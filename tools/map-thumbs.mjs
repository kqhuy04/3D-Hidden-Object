// Captures one still per map, for the picker's cards.
//
// The map browser shows a picture of each place above its name, which means
// those pictures have to exist. Hand-picking twenty-one screenshots goes stale
// the moment a map is re-prepared, so they are captured from the game itself:
// the same renderer, the same lighting, the same spawn the player lands on.
//
// One browser, twenty-one map swaps. `selectMap` is the game's own path, so the
// capture exercises the swap code as a side effect — a map that cannot be
// loaded is a map whose card has no picture, and the picker says so.
//
// Usage: node tools/map-thumbs.mjs [--only <id>] [--scale 0.375]
import fs from 'node:fs';
import path from 'node:path';
import { launch, waitForGame } from './cdp.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const scaleArg = args.includes('--scale') ? Number(args[args.indexOf('--scale') + 1]) : 0.375;

const ROOT = process.cwd();
// Captures go in their own folder. `public/maps/<id>.jpg` is the Polyfork kit
// cover the picker shows; these are the fallback, and a map whose cover is
// missing still gets a real picture of the place rather than a blank plate.
const OUT_DIR = path.join(ROOT, 'public', 'maps', 'shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Read the ids out of the generated registry rather than duplicating them: a
// map added by `prepare-maps.mjs` should get a card without editing this file.
const registry = fs.readFileSync(path.join(ROOT, 'src', 'data', 'mapRegistry.ts'), 'utf8');
const ids = Array.from(registry.matchAll(/"id":\s*"([^"]+)"/g), (m) => m[1]);
if (ids.length === 0) throw new Error('no map ids found in mapRegistry.ts');

const targets = only ? ids.filter((id) => id === only) : ids;
console.log(`capturing ${targets.length} of ${ids.length} maps`);

const cdp = await launch({ url: 'http://localhost:1420/?debug=1', port: 9488, width: 1280, height: 800 });
await waitForGame(cdp);

// `--window-size` is the window, not the viewport, and anything the clip asks
// for beyond the viewport is filled with the page background — which is ink, so
// every thumbnail arrived with black bars top and bottom. The canvas is sized
// from `window.innerWidth/innerHeight`, so asking the page for the same two
// numbers gives a clip that matches the drawing exactly.
const { VW, VH } = await cdp.evaluate(
  '({ VW: window.innerWidth, VH: window.innerHeight })'
);
console.log(`viewport ${VW}x${VH}`);

// The UI is not part of the picture: a thumbnail with a timer in the corner
// looks like a screenshot of a game, not like the place.
const HIDE_UI = `(() => {
  const app = document.getElementById('app');
  let hidden = 0;
  if (app) {
    for (const el of Array.from(app.children)) {
      if (el.tagName === 'CANVAS') continue;
      el.style.display = 'none';
      hidden++;
    }
  }
  // These two are attached to <body>, not to #app: the boot screen is in
  // index.html and the debug panel appends itself to the document. Hiding only
  // #app's children left a green readout in the corner of every thumbnail.
  for (const id of ['loading-screen', 'debug-overlay']) {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; hidden++; }
  }
  return hidden;
})()`;

const captured = [];
const failed = [];

for (let i = 0; i < targets.length; i++) {
  const id = targets[i];
  const yaw = (i * 0.9) % (Math.PI * 2);

  try {
    await cdp.evaluate(`(async () => {
      const g = window.__hunt.game;
      await g.selectMap(${JSON.stringify(id)});
      await g.startNewRound();
      return true;
    })()`);

    // Drive the follow camera by hand. Under SwiftShader the live loop runs at
    // one or two frames a second, so waiting for the boom to settle would take
    // a minute per map; fifty fixed steps settle it in one call.
    const framed = await cdp.evaluate(`(() => {
      const h = window.__hunt;
      const g = h.game;
      g.loop.stop();
      ${HIDE_UI};
      const p = h.player.getPosition();
      h.cameraController.targetYaw = ${yaw};
      h.cameraController.snap(p, p.y);
      for (let f = 0; f < 50; f++) g.update(1 / 60);
      g.render();
      return { map: g.getMapId ? g.getMapId() : null, x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) };
    })()`);

    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 84,
      clip: { x: 0, y: 0, width: VW, height: VH, scale: scaleArg },
    });

    const file = path.join(OUT_DIR, `${id}.jpg`);
    const bytes = Buffer.from(shot.data, 'base64');
    fs.writeFileSync(file, bytes);
    captured.push({ id, kb: Math.round(bytes.length / 1024), ...framed });
    console.log(`  ${id}  ${Math.round(bytes.length / 1024)} kB  at ${framed.x},${framed.y},${framed.z}`);
  } catch (err) {
    failed.push({ id, error: String(err && err.message ? err.message : err) });
    console.log(`  ${id}  FAILED: ${err && err.message ? err.message : err}`);
  }
}

fs.writeFileSync(
  path.join(OUT_DIR, 'index.json'),
  JSON.stringify({ captured: captured.map((c) => c.id), failed: failed.map((f) => f.id) }, null, 2)
);

console.log(`\ndone: ${captured.length} captured, ${failed.length} failed`);
if (failed.length > 0) console.log(JSON.stringify(failed, null, 1));
await cdp.close();
