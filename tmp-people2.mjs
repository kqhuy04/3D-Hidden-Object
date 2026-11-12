import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=chrome-arcology-transit', port: 9429 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const node = h.game.scene.getObjectByName('city-commuter');
  const res = [];
  node.updateMatrixWorld(true);
  node.traverse((n) => {
    const m = n;
    if (!m.isMesh) { res.push({ name: n.name, type: n.type }); return; }
    const g = m.geometry;
    g.computeBoundingBox();
    const b = g.boundingBox.clone().applyMatrix4(m.matrixWorld);
    res.push({
      name: n.name, type: n.type, tris: g.index ? g.index.count / 3 : g.attributes.position.count / 3,
      min: [+b.min.x.toFixed(2), +b.min.y.toFixed(2), +b.min.z.toFixed(2)],
      max: [+b.max.x.toFixed(2), +b.max.y.toFixed(2), +b.max.z.toFixed(2)],
      mat: m.material && m.material.name,
    });
  });
  return res;
})()`);
console.log(JSON.stringify(out, null, 1).slice(0, 4000));
await cdp.close();
