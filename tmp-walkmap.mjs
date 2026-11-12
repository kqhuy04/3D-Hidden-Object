// Standable-surface map: what height can the body stand at, per (x, z)?
// node tmp-walkmap.mjs <map> <x0> <x1> <z0> <z1> <step> [baseY]
import { launch, waitForGame } from './tmp-cdp.mjs';
const [mapId, x0, x1, z0, z1, stepArg, baseArg] = process.argv.slice(2);
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9501 });
await waitForGame(cdp);
const r = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.startNewRound();
  const cap = h.collision.getCapsule();
  const rows = [];
  for (let z = +${z1}; z >= +${z0}; z -= +${stepArg}) {
    const cells = [];
    for (let x = +${x0}; x <= +${x1}; x += +${stepArg}) {
      const base = ${baseArg ? `+${baseArg}` : 'h.collision.terrainHeight(x, z)'};
      const s = h.collision.supportHeight(x, z, base, cap);
      cells.push(s === null ? '  .' : String(Math.round(s * 10)).padStart(3));
    }
    rows.push('z' + z.toFixed(1).padStart(6) + ' ' + cells.join(''));
  }
  return rows;
})()`);
console.log(r.join('\n'));
await cdp.close();
