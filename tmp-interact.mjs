// Does the world answer? Count the interactive props, open a door and check the
// collider followed it, then get on the horse and ride it.
import { launch, waitForGame } from './tmp-cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const map = process.argv[2] ?? 'frontier-town';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${map}`, port: 9481 });
await waitForGame(cdp);
const dir = `${process.env.TEMP}/hunt-shots`;
mkdirSync(dir, { recursive: true });

const counts = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.selectMap('${map}');
  await h.game.startNewRound();
  h.game.loop.stop();
  document.getElementById('debug-overlay')?.remove();
  for (let f = 0; f < 30; f++) h.game.update(1 / 60);
  const acts = h.interactions.actions;
  const byFamily = {};
  for (const a of acts) byFamily[a.family] = (byFamily[a.family] ?? 0) + 1;
  return {
    interactions: h.interactions.count,
    mounts: h.mounts.count,
    byFamily,
    names: acts.slice(0, 6).map((a) => a.object.name + ' / ' + a.label()),
  };
})()`);
console.log('counts', JSON.stringify(counts));

// --- a door: open it, and check the collider went with it -------------------
const door = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  const V3 = h.player.getPosition().constructor;
  const acts = h.interactions.actions;
  const entry = acts.find((a) => a.family === 'hinge' && /door|gate|shutter/i.test(a.object.name));
  if (!entry) return { error: 'no door' };

  const snap = () => h.geometry.partStats.map((p) => ({ name: p.name, min: p.bounds.min.toArray(), max: p.bounds.max.toArray() }));
  const before = snap();

  const p = entry.object.getWorldPosition(new V3());
  // Stand two metres away on the -Z side and look at it.
  h.player.setPosition(p.x, p.y, p.z + 2.2);
  h.cameraController.snap(h.player.getPosition(), p.y);
  h.game.update(1 / 60);

  entry.use();
  for (let f = 0; f < 60; f++) h.game.update(1 / 60);

  const after = snap();
  let moved = 0, movedName = null;
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    const d = Math.max(...[0, 1, 2].map((k) => Math.abs(after[i].min[k] - before[i].min[k])));
    if (d > moved) { moved = d; movedName = after[i].name; }
  }

  return {
    name: entry.object.name,
    angle: +entry.angle.toFixed(3),
    target: +entry.target.toFixed(3),
    label: entry.label(),
    colliderMoved: +moved.toFixed(3),
    movedPart: movedName,
  };
})()`);
console.log('door', JSON.stringify(door));

const a = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${dir}/interact-door.png`, Buffer.from(a.data, 'base64'));

// --- the horse -------------------------------------------------------------
const ride = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  const V3 = h.player.getPosition().constructor;
  const mount = h.mounts.actions[0];
  if (!mount) return { error: 'no mount' };
  const unit = mount.object;
  const p = unit.getWorldPosition(new V3());

  h.player.setPosition(p.x + 1.6, p.y, p.z + 1.6);
  h.cameraController.snap(h.player.getPosition(), p.y);
  for (let f = 0; f < 5; f++) h.game.update(1 / 60);

  mount.use();
  // Drive forward for three seconds of game time.
  h.game.input.getMovementVector = () => ({ x: 0, y: 1, length: () => 1 });
  const start = unit.getWorldPosition(new V3());
  const legBone = (() => { let b = null; unit.traverse((o) => { if (!b && o.isBone && /LeftFrontUpLeg/.test(o.name)) b = o; }); return b; })();
  const q0 = legBone ? legBone.quaternion.toArray() : null;
  for (let f = 0; f < 180; f++) h.game.update(1 / 60);
  const end = unit.getWorldPosition(new V3());
  const q1 = legBone ? legBone.quaternion.toArray() : null;
  const rider = h.player.getPosition();
  const seatGap = +Math.hypot(rider.x - end.x, rider.z - end.z).toFixed(2);

  return {
    riding: h.mounts.isRiding(),
    travelled: +start.distanceTo(end).toFixed(2),
    legMoved: q0 && q1 ? +Math.max(...q0.map((v, i) => Math.abs(v - q1[i]))).toFixed(3) : null,
    riderToHorse: seatGap,
    riderY: +rider.y.toFixed(2),
    horseY: +end.y.toFixed(2),
    clip: h.player.getAnimator().getCurrentActionName(),
  };
})()`);
console.log('ride', JSON.stringify(ride));

const b = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${dir}/interact-ride.png`, Buffer.from(b.data, 'base64'));

const errors = cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l)).slice(0, 8);
console.log('console errors', JSON.stringify(errors));
await cdp.close();
