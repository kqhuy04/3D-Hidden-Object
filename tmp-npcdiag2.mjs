import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=frontier-town', port: 9465 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.selectMap('frontier-town');
  await h.game.startNewRound();
  h.game.loop.stop();
  const scene = h.sun.sun.parent;
  const spawn = h.player.getPosition().clone();

  // Which child of the scene holds the people?
  const kids = scene.children.map((c) => {
    let skinned = 0;
    c.traverse((o) => { if (o.isSkinnedMesh) skinned++; });
    return { name: c.name || c.type, skinned, kids: c.children.length };
  }).filter((k) => k.skinned > 0);

  const before = h.npcs.count;
  await h.npcs.attach(scene, spawn);
  const after = h.npcs.count;

  return { kids, before, after, actors: h.npcs.positions().length };
})()`);
console.log(JSON.stringify(out, null, 1));
await cdp.close();
