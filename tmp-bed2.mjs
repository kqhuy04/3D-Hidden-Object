import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9457 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const ground = h.game.scene.getObjectByName('ground');
  let mesh = null;
  ground.traverse((n) => { if (!mesh && n.isMesh) mesh = n; });
  const pos = mesh.geometry.getAttribute('position');
  const e = mesh.matrixWorld.elements;
  const hist = {};
  for (let i = 0; i < pos.count; i++) {
    const x = e[0]*pos.getX(i)+e[4]*pos.getY(i)+e[8]*pos.getZ(i)+e[12];
    const y = e[1]*pos.getX(i)+e[5]*pos.getY(i)+e[9]*pos.getZ(i)+e[13];
    const z = e[2]*pos.getX(i)+e[6]*pos.getY(i)+e[10]*pos.getZ(i)+e[14];
    if (Math.hypot(x + 26, z - 26) > 4) continue;
    const k = (Math.round(y * 5) / 5).toFixed(1);
    hist[k] = (hist[k] || 0) + 1;
  }
  return { hist, terrain: h.collision.terrainHeight(-26, 26) };
})()`);
console.log(JSON.stringify(out, null, 1));
await cdp.close();
