import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=chronos-hearth', port: 9445 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const rows = [];
  for (let x = 4.3; x <= 6.2; x += 0.1) {
    rows.push([
      +x.toFixed(1),
      +h.collision.groundAt(x, 0.26, 0).toFixed(2),
      +h.collision.groundAt(x, 0.26, 0.5).toFixed(2),
      +h.collision.groundAt(x, 0.26, 1.5).toFixed(2),
    ]);
  }
  return rows;
})()`);
for (const r of out) console.log(r.join('  '));
await cdp.close();
