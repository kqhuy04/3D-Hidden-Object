import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9425 });
await waitForGame(cdp);
await cdp.evaluate(`(() => { window.__hunt.game.startNewRound(); return true; })()`);
await new Promise((r) => setTimeout(r, 500));
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const parts = h.geometry.partStats.filter((p) => /water|ground|terrain/i.test(p.name));
  const before = h.player.getPosition().clone();
  h.player.setPosition(-24, 0.5, 24);
  const c = h.player.getController();
  const v = new (h.camera.position.constructor)(0, 0);
  for (let i = 0; i < 120; i++) c.update(v, 0, 1 / 60, false);
  const p = h.player.getPosition();
  return {
    parts: parts.map((p) => ({ name: p.name, tris: p.triangles, y: [+p.bounds.min.y.toFixed(2), +p.bounds.max.y.toFixed(2)] })),
    from: [+before.x.toFixed(1), +before.y.toFixed(2), +before.z.toFixed(1)],
    settled: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
    ground: +h.collision.getGroundHeight(-24, 24).toFixed(2),
    terrain: +h.collision.terrainHeight(-24, 24).toFixed(2),
    groundAt: +h.collision.groundAt(-24, 24, p.y).toFixed(2),
  };
})()`);
console.log(JSON.stringify(out, null, 1));
await cdp.close();
