import { launch, waitForGame } from './tmp-cdp.mjs';
const mapId = process.argv[2] ?? 'chronos-hearth';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9413 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const props = h.game.selector.getProps().filter((p) => /stair/i.test(p.name));
  const res = [];
  for (const p of props.slice(0, 3)) {
    const c = p.centre;
    const rows = [];
    for (const a of [0, 1.57, 3.14, 4.71]) {
      const dx = Math.sin(a), dz = Math.cos(a);
      const prof = [];
      for (let d = -3; d <= 3; d += 0.3) {
        prof.push(+h.collision.getGroundHeight(c.x + dx * d, c.z + dz * d).toFixed(2));
      }
      rows.push(prof.join(' '));
    }
    res.push({ name: p.name, c: [+c.x.toFixed(1), +c.y.toFixed(2), +c.z.toFixed(1)], r: +p.radius.toFixed(2), rows });
  }
  return res;
})()`);
for (const r of out) {
  console.log(`${r.name} at ${r.c.join(',')} r=${r.r}`);
  for (const row of r.rows) console.log('  ' + row);
}
await cdp.close();
