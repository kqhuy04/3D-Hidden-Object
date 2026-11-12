import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9439 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const water = h.game.scene.getObjectByName('water');
  water.updateMatrixWorld(true);
  const pts = [];
  water.traverse((n) => {
    if (!n.isMesh || !n.geometry) return;
    const pos = n.geometry.getAttribute('position');
    const e = n.matrixWorld.elements;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      pts.push([e[0]*x+e[4]*y+e[8]*z+e[12], e[1]*x+e[5]*y+e[9]*z+e[13], e[2]*x+e[6]*y+e[10]*z+e[14]]);
    }
  });
  const at = (x, z, r) => {
    const ys = pts.filter((p) => Math.hypot(p[0]-x, p[2]-z) < r).map((p) => p[1]);
    if (!ys.length) return null;
    return [+Math.min(...ys).toFixed(2), +Math.max(...ys).toFixed(2), ys.length];
  };
  return {
    total: pts.length,
    nearShore: at(-12, 22, 4),
    river: at(-18, 22, 4),
    lake: at(-24, 24, 5),
    spawn: at(0, -2, 4),
  };
})()`);
console.log(JSON.stringify(out));
await cdp.close();
