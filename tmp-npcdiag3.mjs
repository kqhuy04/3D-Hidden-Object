import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=frontier-town', port: 9466 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.selectMap('frontier-town');
  await h.game.startNewRound();
  h.game.loop.stop();
  const scene = h.sun.sun.parent;
  const world = scene.children.find((c) => c.name === 'world-root');

  const skels = new Set();
  world.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) skels.add(o.skeleton); });

  let withArm = 0;
  const samples = [];
  for (const s of skels) {
    const names = s.bones.map((b) => b.name);
    if (names.includes('LeftForeArm')) {
      withArm++;
      if (samples.length < 3) samples.push(names.slice(0, 14));
    }
  }

  // Also: the most common bone-name signature, to see what the cast really is.
  const sig = new Map();
  for (const s of skels) {
    const key = s.bones.slice(0, 5).map((b) => b.name).join('/');
    sig.set(key, (sig.get(key) ?? 0) + 1);
  }
  const common = [...sig.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return { worldSkeletons: skels.size, withArm, samples, common };
})()`);
console.log(JSON.stringify(out, null, 1));
await cdp.close();
