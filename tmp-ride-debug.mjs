// Why is the horse not under the rider? Report the animal, the rider and the
// clip, and take a close-up.
import { launch, waitForGame } from './tmp-cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const map = process.argv[2] ?? 'frontier-town';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${map}`, port: 9482 });
await waitForGame(cdp);
const dir = `${process.env.TEMP}/hunt-shots`;
mkdirSync(dir, { recursive: true });

const info = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  const V3 = h.player.getPosition().constructor;
  await h.game.selectMap('${map}');
  await h.game.startNewRound();
  h.game.loop.stop();
  document.getElementById('debug-overlay')?.remove();

  const clip = h.player.getAnimator().actions.get('Driving');
  const mount = h.mounts.actions[0];
  const unit = mount.object;
  const p = unit.getWorldPosition(new V3());

  // What is in the unit, and how big is it?
  let meshes = 0, skinned = 0, bones = 0, legBones = [];
  unit.traverse((o) => {
    if (o.isMesh) meshes++;
    if (o.isSkinnedMesh) skinned++;
    if (o.isBone) { bones++; if (/UpLeg/i.test(o.name)) legBones.push(o.name); }
  });
  const Box3 = h.geometry.worldBounds.constructor;
  const box = new Box3().setFromObject(unit);

  h.player.setPosition(p.x + 1.6, p.y, p.z + 1.6);
  h.cameraController.snap(h.player.getPosition(), p.y);
  for (let f = 0; f < 5; f++) h.game.update(1 / 60);
  mount.use();
  for (let f = 0; f < 5; f++) h.game.update(1 / 60);

  h.cameraController.targetDistance = 6;
  h.cameraController.currentDistance = 6;
  h.game.input.getMovementVector = () => ({ x: 0, y: 1, length: () => 1 });
  const legBefore = legBones.map((n) => { let q = null; unit.traverse((o) => { if (o.isBone && o.name === n) q = o.quaternion.toArray(); }); return q; });
  for (let f = 0; f < 90; f++) h.game.update(1 / 60);
  const legAfter = legBones.map((n) => { let q = null; unit.traverse((o) => { if (o.isBone && o.name === n) q = o.quaternion.toArray(); }); return q; });
  const legDelta = Math.max(...legBefore.map((q, i) => Math.max(...q.map((v, k) => Math.abs(v - legAfter[i][k])))));

  h.game.render();
  const rider = h.player.getPosition();
  return {
    clipTracks: clip ? clip.getClip().tracks.length : 'no Driving action',
    clipNames: clip ? clip.getClip().tracks.slice(0, 3).map((t) => t.name) : [],
    unitName: unit.name,
    unitPos: p.toArray().map((v) => +v.toFixed(2)),
    unitBox: { min: box.min.toArray().map((v) => +v.toFixed(2)), max: box.max.toArray().map((v) => +v.toFixed(2)) },
    meshes, skinned, bones, legBones: legBones.slice(0, 4),
    legDelta: +legDelta.toFixed(3),
    rider: rider.toArray().map((v) => +v.toFixed(2)),
    riding: h.mounts.isRiding(),
    seated: h.player.getAnimator().getCurrentActionName(),
  };
})()`);
console.log(JSON.stringify(info, null, 1));

const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${dir}/ride-close.png`, Buffer.from(shot.data, 'base64'));
await cdp.close();
