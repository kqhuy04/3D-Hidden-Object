import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9441 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const water = h.game.scene.getObjectByName('water');
  water.updateMatrixWorld(true);
  const high = [];
  water.traverse((n) => {
    if (!n.isMesh || !n.geometry) return;
    const pos = n.geometry.getAttribute('position');
    const e = n.matrixWorld.elements;
    for (let i = 0; i < pos.count; i += 3) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const wy = e[1]*x+e[5]*y+e[9]*z+e[13];
      if (wy < -1.5) continue;
      high.push([
        +(e[0]*x+e[4]*y+e[8]*z+e[12]).toFixed(1),
        +wy.toFixed(2),
        +(e[2]*x+e[6]*y+e[10]*z+e[14]).toFixed(1),
      ]);
    }
  });
  const seen = new Set();
  const uniq = [];
  for (const p of high) {
    const k = p[0] + ',' + p[2];
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
  }
  const withGround = uniq.slice(0, 25).map((p) => ({
    x: p[0], waterY: p[1], z: p[2],
    terrain: +(h.collision.terrainHeight(p[0], p[2]) ?? NaN).toFixed(2),
  }));
  return { highCount: high.length, uniq: uniq.length, sample: withGround };
})()`);
console.log(JSON.stringify(out, null, 1).slice(0, 3000));
await cdp.close();
