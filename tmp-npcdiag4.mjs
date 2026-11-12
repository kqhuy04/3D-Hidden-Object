import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=frontier-town', port: 9467 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.selectMap('frontier-town');
  await h.game.startNewRound();
  h.game.loop.stop();

  const crowd = h.npcs;
  for (let f = 0; f < 300; f++) h.game.update(1 / 60);

  const rows = [];
  const positions = crowd.positions();
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const groundHere = h.collision.groundAt(p.x, p.z, p.y);
    const probes = [];
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const x = p.x + Math.cos(ang) * 2.5;
      const z = p.z + Math.sin(ang) * 2.5;
      const g = h.collision.groundAt(x, z, p.y);
      probes.push({
        g: +(g - p.y).toFixed(2),
        blocked: h.collision.isBlocked(x, z, 0.3) ?? '-',
      });
    }
    rows.push({
      y: +p.y.toFixed(2),
      gap: +(p.y - groundHere).toFixed(2),
      probes: probes.map((q) => q.g + (q.blocked === '-' ? '' : '(' + q.blocked + ')')).join(' '),
    });
  }
  return rows;
})()`);
console.log(JSON.stringify(out, null, 1));
await cdp.close();
