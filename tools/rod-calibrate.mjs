// Rod calibration harness.
//
// The rod comes from Polyfork and the arm that holds it comes from Mixamo, so
// the two only meet if someone looks at them together. A still frame is not
// enough: the cast swings the arm through 180 degrees, and an offset that is
// right at rest puts the rod through the character's head at the top of the
// wind-up. This harness therefore films the *whole* cast from a fixed camera
// and prints the numbers that describe the fit.
//
// Usage:
//   node tools/rod-calibrate.mjs [map] [port] [yawDeg] [pitchDeg] [rollDeg]
//
// Passing the last three sets `ROD_TUNING` live before the filmstrip is taken,
// which is how a candidate is judged: run it, look at the frames, adjust.
// Frames land in %TEMP%/hunt-shots/rod-*.png and are never written into the
// project — Vite watches this directory and would reload the game mid-take.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { launch, waitForGame } from './cdp.mjs';

const mapId = process.argv[2] ?? 'campground-lake';
const PORT = Number(process.argv[3] ?? 9631);
const outDir = path.join(os.tmpdir(), 'hunt-shots');
mkdirSync(outDir, { recursive: true });

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: PORT });
await waitForGame(cdp);
await new Promise((r) => setTimeout(r, 2000));

const evaluate = async (expr) => cdp.evaluate(expr);
const shot = async (name) => {
  await cdp.send('Page.enable');
  const png = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(outDir, `rod-${name}.png`);
  writeFileSync(file, Buffer.from(png.data, 'base64'));
  console.log('shot', file);
};

// --- 1. Stand on the shore, facing the water -------------------------------
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
  if (!lake) return { error: 'no open water' };

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
  const yaw = Math.atan2(best.x - lake.x, best.z - lake.z);
  window.__hunt.cameraController.targetYaw = yaw;
  window.__hunt.cameraController.currentYaw = yaw;
  await new Promise((r) => setTimeout(r, 700));

  // Freeze the boom. Its own update is the only thing that writes the camera
  // during play, so replacing it hands the lens to this harness without
  // touching the game's code.
  window.__hunt.cameraController.update = () => {};

  return { spot: best, yaw: window.__hunt.cameraController.getYaw() };
})()`);
console.log('placement', JSON.stringify(placement));
if (placement.error) {
  console.log('cannot continue:', placement.error);
  process.exit(0);
}

/**
 * Puts the lens on an arc around the body.
 *
 * `azimuth` is measured from the direction the character faces, so 0 is over
 * their shoulder and +90 is their right-hand side — the side the rod is on.
 */
const frame = async (azimuthDeg, distance, height, lookHeight = 0.95) => {
  await evaluate(`(() => {
    const p = window.__hunt.player.getPosition();
    const yaw = window.__hunt.cameraController.getYaw();
    const a = yaw + (${azimuthDeg} * Math.PI / 180);
    const cam = window.__hunt.camera;
    cam.position.set(
      p.x - Math.sin(a) * ${distance},
      p.y + ${height},
      p.z - Math.cos(a) * ${distance},
    );
    cam.lookAt(p.x, p.y + ${lookHeight}, p.z);
    cam.updateMatrixWorld(true);
  })()`);
  // One frame for the renderer to draw the new lens.
  await new Promise((r) => setTimeout(r, 260));
};

/** Everything the fit can be judged by without eyes. */
const measure = async () => {
  return evaluate(`(() => {
    const hunt = window.__hunt;
    // The debug handle exposes no THREE namespace, and it should not: the
    // constructor of any Vector3 the game already hands back is the same class.
    const V = hunt.player.getPosition().constructor;

    let scene = hunt.player.getGroup();
    while (scene.parent) scene = scene.parent;

    const holder = scene.getObjectByName('fishing-rod-holder');
    if (!holder) return { error: 'rod not in scene' };
    // The rod is one mesh, and it is that mesh's own frame the model's numbers
    // are written in — the glTF root sits 1.1 m along +X from it, so measuring
    // in the root's frame shifts every point by a metre and says the butt is
    // where the middle of the rod is.
    const mesh = holder.getObjectByName('rod-mesh');
    if (!mesh) return { error: 'rod-mesh missing' };
    holder.updateWorldMatrix(true, true);

    const butt = new V(0, 0, 0).applyMatrix4(mesh.matrixWorld);
    const tip = new V(2.13, 1.12, 0).applyMatrix4(mesh.matrixWorld);
    const axis = tip.clone().sub(butt).normalize();
    const grip = new V().setFromMatrixPosition(holder.matrixWorld);

    const animator = hunt.game.player.getAnimator();
    const bone = (name) => animator?.findBone?.(name) ?? null;
    const at = (b) => (b ? b.getWorldPosition(new V()) : null);
    const handBone = bone('RightHand');
    const hand = at(handBone);
    const elbow = at(bone('RightForeArm'));
    const head = at(bone('Head'));
    const player = hunt.player.getPosition();

    // A rod is held the way a sword is: it continues the line of the forearm.
    // The angle between the two is the single number that says whether the grip
    // is in the fist or stuck out sideways.
    let forearmAngle = null;
    let forearmLocal = null;
    let rodLocal = null;
    if (hand && elbow && handBone) {
      const fore = hand.clone().sub(elbow).normalize();
      forearmAngle = +(Math.acos(Math.min(1, Math.max(-1, fore.dot(axis)))) * 180 / Math.PI).toFixed(0);

      // Both directions in the hand bone's own frame. If the wrist does not
      // twist, the forearm lands on the same local vector in every pose, and
      // that vector is the answer: rotate the rod's +X onto it and the rod
      // continues the arm for the whole cast instead of in one pose.
      const Q = handBone.quaternion.constructor;
      const inv = handBone.getWorldQuaternion(new Q()).invert();
      const f = fore.clone().applyQuaternion(inv);
      const r = axis.clone().applyQuaternion(inv);
      forearmLocal = [+f.x.toFixed(3), +f.y.toFixed(3), +f.z.toFixed(3)];
      rodLocal = [+r.x.toFixed(3), +r.y.toFixed(3), +r.z.toFixed(3)];
    }

    return {
      axis: [+axis.x.toFixed(2), +axis.y.toFixed(2), +axis.z.toFixed(2)],
      forearmAngle,
      forearmLocal,
      rodLocal,
      tipAboveGround: +(tip.y - player.y).toFixed(2),
      buttAboveGround: +(butt.y - player.y).toFixed(2),
      gripToHand: hand ? +grip.distanceTo(hand).toFixed(3) : null,
      gripToHead: head ? +grip.distanceTo(head).toFixed(2) : null,
    };
  })()`);
};

// --- 2. Rod in hand, at rest ----------------------------------------------
const started = await evaluate('window.__hunt.game.fishing.interact()');
console.log('started', started);
await new Promise((r) => setTimeout(r, 1200));

// A candidate tuning passed on the command line is applied before the first
// frame, so one run answers "is this angle right" instead of two.
const [pitchArg, yawArg, rollArg] = process.argv.slice(4).map(Number);
if (Number.isFinite(pitchArg)) {
  const applied = await evaluate(
    `window.__hunt.game.fishing.tuneRod(${pitchArg || 0}, ${yawArg || 0}, ${rollArg || 0})`
  );
  console.log('tuning', [pitchArg || 0, yawArg || 0, rollArg || 0].join(','), applied);
}

await frame(95, 2.9, 1.5, 1.0);
console.log('measure idle', JSON.stringify(await measure()));
await shot('01-idle-side');

await frame(20, 2.9, 1.5, 1.0);
await shot('02-idle-back');

await frame(180, 2.9, 1.4, 1.0);
await shot('03-idle-front');

// --- 3. The charge: the arm winds up before the throw ----------------------
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 400, button: 'left', clickCount: 1 });
for (const [at, name] of [[0.55, '04-charge-half'], [1.05, '05-charge-full']]) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    const power = await evaluate('window.__hunt.game.fishing.debugState.power');
    if (power >= at) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  console.log(name, JSON.stringify(await measure()));
  await shot(name);
}
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 400, button: 'left', clickCount: 1 });

// --- 4. The cast, pinned frame by frame -------------------------------
// Sampling off the wall clock gives a different frame every run on a machine
// that renders at 2 fps. The clip is pinned instead, so the same still can be
// compared before and after a change to the tuning.
await frame(95, 2.9, 1.5, 1.0);
const CAST_FRAMES = [
  [0.55, 'windup-ready'],
  [1.1, 'windup-mid'],
  [1.55, 'windup-top'],
  [1.95, 'release'],
  [2.2, 'line-out'],
  [2.75, 'settle'],
  [4.35, 'reel-start'],
  [6.0, 'reel-mid'],
  [8.3, 'reel-end'],
];
for (const [t, name] of CAST_FRAMES) {
  await evaluate(`window.__hunt.game.player.getAnimator().scrubCast(${t})`);
  await new Promise((r) => setTimeout(r, 300));
  const m = await measure();
  console.log(`cast ${name} (${t}s)`, JSON.stringify(m));
  await shot(`06-cast-${name}`);
}

// --- 5. Reeling, which is the pose the player stares at the longest --------
await frame(95, 2.9, 1.5, 1.0);
await shot('07-hold-side');
await frame(20, 2.9, 1.5, 1.0);
await shot('08-hold-back');

console.log('done');
process.exit(0);
