import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9423 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const rows = [];
  let lowest = { y: 99 };
  for (let x = -45; x <= 45; x += 3) {
    for (let z = -45; z <= 45; z += 3) {
      const t = h.collision.terrainHeight(x, z);
      if (t === null) continue;
      if (t < lowest.y) lowest = { x, z, y: +t.toFixed(2) };
      if (t < -0.6 && rows.length < 40) rows.push([x, z, +t.toFixed(2)]);
    }
  }
  return { lowest, below: rows };
})()`);
console.log(JSON.stringify(out));
await cdp.close();
