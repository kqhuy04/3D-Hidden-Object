import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=frontier-town', port: 9485 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.selectMap('frontier-town');
  await h.game.startNewRound();
  h.game.loop.stop();
  const entry = h.interactions.actions.find((a) => a.family === 'hinge');
  // Ancestor chain of the door, and whether any of them is a part node.
  const chain = [];
  let n = entry.object;
  while (n && chain.length < 6) { chain.push(n.name || '(unnamed)'); n = n.parent; }
  const parts = h.geometry.parts.map((p) => p.name);
  let owner = null, s = entry.object;
  while (s && !owner) { const p = h.geometry.parts.find((q) => q.node === s); if (p) owner = p.name; s = s.parent; }
  const tri = owner ? h.geometry.parts.find((p) => p.name === owner).triangles : null;
  const ok = h.geometry.rebakePart(entry.object);
  return { chain, partsSample: parts.slice(0, 6), owner, tri, rebake: ok, partCount: parts.length };
})()`);
console.log(JSON.stringify(out));
await cdp.close();
