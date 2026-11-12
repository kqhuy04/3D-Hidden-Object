import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=frontier-town', port: 9484 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.selectMap('frontier-town');
  await h.game.startNewRound();
  h.game.loop.stop();
  const m = h.mounts.mounts[0];
  const a = m.animator;
  let leg = null, hips = null;
  m.unit.traverse((o) => { if (o.isBone && /^LeftFrontUpLeg/.test(o.name)) leg = o; if (o.isBone && /^Hips/.test(o.name)) hips = o; });
  const q0 = leg.quaternion.toArray();
  a.locomotion(3.4);
  for (let i = 0; i < 40; i++) a.update(1 / 60);
  const q1 = leg.quaternion.toArray();
  return {
    legName: leg.name,
    delta: +Math.max(...q0.map((v, i) => Math.abs(v - q1[i]))).toFixed(3),
    height: +a.height.toFixed(2),
    hasLocomotion: typeof a.locomotion,
  };
})()`);
console.log(JSON.stringify(out));
await cdp.close();
