import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=frontier-town', port: 9464 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.selectMap('frontier-town');
  await h.game.startNewRound();
  h.game.loop.stop();
  const scene = h.sun.sun.parent;
  const spawn = h.player.getPosition().clone();

  const bySkel = new Map();
  scene.traverse((o) => {
    if (!o.isSkinnedMesh || !o.skeleton) return;
    if (!bySkel.has(o.skeleton)) bySkel.set(o.skeleton, []);
    bySkel.get(o.skeleton).push(o);
  });

  const REQUIRED = ['Hips', 'Spine2', 'LeftForeArm', 'RightUpLeg'];
  let humanoids = 0, near = 0;
  const sample = [];
  for (const skel of bySkel.keys()) {
    const names = new Set(skel.bones.map((b) => b.name));
    if (!REQUIRED.every((n) => names.has(n))) continue;
    humanoids++;
    const d = skel.bones[0].getWorldPosition(new (spawn.constructor)()).distanceTo(spawn);
    if (d <= 45) near++;
    if (sample.length < 5) sample.push(+d.toFixed(1));
  }
  return {
    skeletons: bySkel.size, humanoids, near, sampleDistances: sample,
    npcCount: h.npcs ? h.npcs.count : 'no handle',
    spawn: [+spawn.x.toFixed(1), +spawn.y.toFixed(1), +spawn.z.toFixed(1)],
    boneNameSample: (() => { const s = [...bySkel.keys()][0]; return s ? s.bones.slice(0, 6).map((b) => b.name) : []; })(),
  };
})()`);
console.log(JSON.stringify(out, null, 1));
await cdp.close();
