import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=frontier-town', port: 9470 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.selectMap('frontier-town');
  await h.game.startNewRound();
  h.game.loop.stop();

  const actors = h.npcs.actors;
  const a = actors[0];
  const legBone = a.animator.actions && Object.keys(a.animator.actions);
  const bone = a.unit.getObjectByName('LeftUpLeg_1') || null;
  let found = null;
  a.unit.traverse((o) => {
    if (o.isBone && /LeftUpLeg/.test(o.name) && !found) found = o;
  });

  const samples = [];
  for (let f = 0; f < 180; f++) {
    h.game.update(1 / 60);
    if (f % 20 === 0) {
      const q = found ? found.quaternion : null;
      samples.push({
        action: a.animator.mixer._actions
          .filter((x) => x.isRunning())
          .map((x) => x._clip.name)
          .join('+'),
        leg: q ? [+q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3)] : null,
        pos: [+a.unit.position.x.toFixed(2), +a.unit.position.z.toFixed(2)],
      });
    }
  }
  return { loadedClips: legBone, boneName: found ? found.name : null, samples };
})()`);
console.log(JSON.stringify(out, null, 1));
await cdp.close();
