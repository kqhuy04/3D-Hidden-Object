import { launch, waitForGame } from './tmp-cdp.mjs';
const [mapId, cx, cz] = process.argv.slice(2);
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9333 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const c = window.__hunt.collision;
  const g = window.__hunt.geometry;
  const cap = c.getCapsule();
  const rows = [];
  for (let dz = -3; dz <= 3; dz++) {
    const line = [];
    for (let dx = -3; dx <= 3; dx++) {
      const x = ${cx} + dx, z = ${cz} + dz;
      const has = c.hasGround(x, z);
      const terr = c.getGroundHeight(x, z);
      const sup = g.supportHeight(x, z, ${'null'} ?? terr, cap.stepHeight);
      line.push((has ? 'G' : '.') + ' t' + terr.toFixed(1) + (sup !== null ? ' s' + sup.toFixed(1) : ''));
    }
    rows.push(line.join('  '));
  }
  return rows;
})()`);
console.log(mapId, 'around', cx, cz, '(G = has ground, t = terrain, s = prop support)');
for (const r of out) console.log(' ', r);
await cdp.close();
