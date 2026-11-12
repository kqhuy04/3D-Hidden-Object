import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9455 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const ground = h.game.scene.getObjectByName('ground');
  const meshes = [];
  ground.traverse((n) => { if (n.isMesh && n.geometry) meshes.push(n); });
  const near = [];
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    const e = m.matrixWorld.elements;
    let count = 0, sum = 0, min = 99;
    for (let i = 0; i < pos.count; i++) {
      const x = e[0]*pos.getX(i)+e[4]*pos.getY(i)+e[8]*pos.getZ(i)+e[12];
      const y = e[1]*pos.getX(i)+e[5]*pos.getY(i)+e[9]*pos.getZ(i)+e[13];
      const z = e[2]*pos.getX(i)+e[6]*pos.getY(i)+e[10]*pos.getZ(i)+e[14];
      if (Math.hypot(x + 26, z - 26) > 3) continue;
      count++; sum += y; if (y < min) min = y;
    }
    near.push({ name: m.name, type: m.type, verts: pos.count, near: count, avg: count ? +(sum/count).toFixed(2) : null, min: count ? +min.toFixed(2) : null });
  }
  return { meshes: near, terrainHeight: h.collision.terrainHeight(-26, 26) };
})()`);
console.log(JSON.stringify(out, null, 1));
await cdp.close();
