// Fishing probe: puts the body on the lake shore, casts, and photographs every
// phase of the trip.
//
// Usage:
//   node tools/fishing-probe.mjs [map] [port] [outPrefix]
//
// It drives the game through its own debug handle and steps real frames, so the
// thing it measures is the thing the player gets. What it does *not* do is fake
// the state machine: the cast is released by holding the button over real
// frames, the bite is waited out on the game clock, and the bar is won or lost
// by holding the button the way a player would.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { launch, waitForGame } from './cdp.mjs';

const mapId = process.argv[2] ?? 'campground-lake';
const PORT = Number(process.argv[3] ?? 9621);
const prefix = process.argv[4] ?? 'fishing';
const outDir = path.join(os.tmpdir(), 'hunt-shots');
mkdirSync(outDir, { recursive: true });

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: PORT });
await waitForGame(cdp);
await new Promise((r) => setTimeout(r, 2000));

const shot = async (name) => {
  await cdp.send('Page.enable');
  const png = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(outDir, `${prefix}-${name}.png`);
  writeFileSync(file, Buffer.from(png.data, 'base64'));
  console.log('shot', file);
};

const evaluate = async (expr) => cdp.evaluate(expr);

// --- 1. Find the shore and stand on it -------------------------------------
const placement = await evaluate(`(async () => {
  const g = window.__hunt.game;
  g.startNewRound();
  await new Promise((r) => setTimeout(r, 400));
  g.cutscene.skip(window.__hunt.camera);
  g.endCutscene();
  await new Promise((r) => setTimeout(r, 400));

  const water = window.__hunt.worldLoader.getWater();
  if (!water) return { error: 'no water on this map' };

  const body = window.__hunt.player.getPosition();
  const lake = water.nearestOpenWater(body.x, body.z, 160, 0.6);
  if (!lake) return { error: 'no open water found' };

  // Walk in from the lake towards the spawn until the ground is dry: that is
  // the shore, and the last dry metre of it is where a person would stand.
  let best = null;
  for (let i = 0; i < 40; i++) {
    const k = i / 40;
    const x = lake.x + (body.x - lake.x) * k;
    const z = lake.z + (body.z - lake.z) * k;
    if (water.depthAt(x, z) > 0.25) continue;
    const spot = g.collision.findSpawn({ x, y: lake.y + 1.5, z });
    if (!spot) continue;
    const ground = g.collision.groundAt(spot.x, spot.z, spot.y);
    if (ground < lake.y - 0.4) continue;
    best = { x: spot.x, y: ground + 0.05, z: spot.z };
    break;
  }
  if (!best) return { error: 'no shore spot' };

  window.__hunt.player.setPosition(best.x, best.y, best.z);
  window.__hunt.cameraController.snap(window.__hunt.player.getPosition(), best.y - 0.05);
  // Face the water.
  const yaw = Math.atan2(best.x - lake.x, best.z - lake.z);
  window.__hunt.cameraController.targetYaw = yaw;
  window.__hunt.cameraController.currentYaw = yaw;
  await new Promise((r) => setTimeout(r, 700));
  const yaw2 = window.__hunt.cameraController.getYaw();
  const dir = { x: -Math.sin(yaw2), z: -Math.cos(yaw2) };
  const ray = [];
  for (let d = 1; d <= 9; d += 1) {
    ray.push([d, +water.depthAt(best.x + dir.x * d, best.z + dir.z * d).toFixed(2)]);
  }

  return {
    lake,
    spot: best,
    yaw: yaw2,
    dir,
    ray,
    distance: Math.hypot(best.x - lake.x, best.z - lake.z),
    prompt: document.querySelector('#hud-pickup-label')?.textContent ?? null,
    canFish: g.fishing.canFishHere(),
    fish: g.fishing.debugState,
  };
})()`);
console.log('placement', JSON.stringify(placement));
await shot('01-shore');

if (placement.error) {
  console.log('cannot continue:', placement.error);
  process.exit(0);
}

// --- 2. Start fishing ------------------------------------------------------
const started = await evaluate(`(() => {
  const g = window.__hunt.game;
  const ok = g.fishing.interact();
  return { ok, phase: g.fishing.debugState.phase };
})()`);
console.log('interact', JSON.stringify(started));
await new Promise((r) => setTimeout(r, 900));
console.log('after start', JSON.stringify(await evaluate('window.__hunt.game.fishing.debugState')));
await shot('02-rod-out');

// --- 3. Charge and release -------------------------------------------------
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 400, button: 'left', clickCount: 1 });
await new Promise((r) => setTimeout(r, 900));
console.log('charging', JSON.stringify(await evaluate('window.__hunt.game.fishing.debugState')));
await shot('03-charge');
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 400, button: 'left', clickCount: 1 });

// Let the throw play out and the float land.
for (let i = 0; i < 8; i++) {
  await new Promise((r) => setTimeout(r, 350));
  const state = await evaluate('window.__hunt.game.fishing.debugState');
  console.log('t+' + (i * 350), JSON.stringify(state));
  if (state.phase === 'wait') break;
}
await shot('04-float-out');

// --- 4. Wait for the bite --------------------------------------------------
// Headless SwiftShader runs at 1-3 fps and `GameLoop` clamps delta at 0.1 s, so
// one second of game time costs several seconds of wall clock. The wait is
// therefore measured against the game's own phase, not against a guess.
const waitStarted = Date.now();
let bite = null;
while (Date.now() - waitStarted < 90_000) {
  bite = await evaluate('window.__hunt.game.fishing.debugState');
  if (bite.phase === 'bite' || bite.phase !== 'wait') break;
  await new Promise((r) => setTimeout(r, 120));
}
console.log('bite', JSON.stringify(bite), 'after', ((Date.now() - waitStarted) / 1000).toFixed(1) + 's');
await shot('05-bite');
if (bite.phase !== 'bite') {
  console.log('no bite — stopping');
  process.exit(0);
}

// --- 5. Strike, then win the bar by holding while the fish is in the zone ---
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 400, button: 'left', clickCount: 1 });
await new Promise((r) => setTimeout(r, 120));
console.log('reel', JSON.stringify(await evaluate('window.__hunt.game.fishing.debugState')));
await shot('06-reel');

// A crude autopilot: hold when the fish is above the zone, release when below.
// It is what a player does, just faster. The loop is bounded by the game's own
// phase rather than by a frame count, because frames are slow and irregular
// here and a count would be a guess about how fast the machine is.
let reel = null;
const reelStarted = Date.now();
const samples = [];
while (Date.now() - reelStarted < 120_000) {
  const state = await evaluate(`(() => {
    const f = window.__hunt.game.fishing;
    const d = f.debugState;
    return { phase: d.phase, fish: d.fish, zone: d.zone, progress: d.progress };
  })()`);
  reel = state;
  if (state.phase !== 'reel') break;
  samples.push(state.progress);
  const zoneMid = state.zone[0] + state.zone[1] / 2;
  if (state.fish > zoneMid + 0.01) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 400, button: 'left', clickCount: 1 });
  } else if (state.fish < zoneMid - 0.01) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 400, button: 'left', clickCount: 1 });
  }
  await new Promise((r) => setTimeout(r, 60));
}
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 400, button: 'left', clickCount: 1 });
console.log('reel end', JSON.stringify(reel), 'samples', samples.length,
  'progress', samples.length ? `${samples[0].toFixed(2)} -> ${samples[samples.length - 1].toFixed(2)}` : 'n/a');
await new Promise((r) => setTimeout(r, 400));
await shot('07-result');

const result = await evaluate(`(() => {
  const s = window.__hunt.save;
  return { fishing: s.fishing, card: document.querySelector('#fishing-card')?.textContent ?? null,
           cardVisible: !document.querySelector('#fishing-card')?.classList.contains('hidden'),
           state: window.__hunt.game.fishing.debugState };
})()`);
console.log('result', JSON.stringify(result));
await shot('08-card');

process.exit(0);
