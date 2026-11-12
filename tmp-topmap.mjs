// Top of the climbable stack at each (x, z): what the body reaches by stepping up.
import { launch, waitForGame } from './tmp-cdp.mjs';
const [mapId, x0, x1, z0, z1, stepArg] = process.argv.slice(2);
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9505 });
await waitForGame(cdp);
const r = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.startNewRound();
  const cap = h.collision.getCapsule();
  const rows = [];
  for (let z = +${z1}; z >= +${z0}; z -= +${stepArg}) {
    const cells = [];
    for (let x = +${x0}; x <= +${x1}; x += +${stepArg}) {
      let y = h.collision.terrainHeight(x, z);
      for (let i = 0; i < 24; i++) {
        const s = h.collision.supportHeight(x, z, y, cap);
        if (s === null || s <= y + 0.005) break;
        y = s;
      }
      cells.push(String(Math.round(y * 10)).padStart(3));
    }
    rows.push('z' + z.toFixed(1).padStart(6) + ' ' + cells.join(''));
  }
  return rows;
})()`);
console.log('x ' + x0 + '..' + x1 + ' step ' + stepArg + '  (values = top height x10)');
console.log(r.join('\n'));
await cdp.close();
