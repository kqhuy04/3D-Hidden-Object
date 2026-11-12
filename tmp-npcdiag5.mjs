import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=frontier-town', port: 9468 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.selectMap('frontier-town');
  await h.game.startNewRound();
  h.game.loop.stop();
  const before = h.npcs.positions().map((p) => [+p.x.toFixed(1), +p.y.toFixed(2), +p.z.toFixed(1)]);
  for (let f = 0; f < 300; f++) h.game.update(1 / 60);
  const after = h.npcs.positions().map((p) => [+p.x.toFixed(1), +p.y.toFixed(2), +p.z.toFixed(1)]);
  return { before, after };
})()`);
console.log(JSON.stringify(out));
await cdp.close();
