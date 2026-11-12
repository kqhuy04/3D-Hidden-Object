import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9435 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const tower = h.game.scene.getObjectByName('tower');
  tower.updateMatrixWorld(true);
  const small = [];
  tower.traverse((n) => {
    if (!n.isMesh || !n.geometry) return;
    const g = n.geometry, pos = g.getAttribute('position'), idx = g.index;
    const count = idx ? idx.count : pos.count;
    const get = (i) => { const k = idx ? idx.getX(i) : i; return [pos.getX(k), pos.getY(k), pos.getZ(k)]; };
    const e = n.matrixWorld.elements;
    const w = (p) => [e[0]*p[0]+e[4]*p[1]+e[8]*p[2]+e[12], e[1]*p[0]+e[5]*p[1]+e[9]*p[2]+e[13], e[2]*p[0]+e[6]*p[1]+e[10]*p[2]+e[14]];
    for (let i = 0; i + 2 < count; i += 3) {
      const a = w(get(i)), b = w(get(i+1)), c = w(get(i+2));
      const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
      const nx = u[1]*v[2]-u[2]*v[1], ny = u[2]*v[0]-u[0]*v[2], nz = u[0]*v[1]-u[1]*v[0];
      const L = Math.hypot(nx, ny, nz) || 1;
      if (Math.abs(ny / L) < 0.85) continue;
      const area = L / 2;
      if (area > 0.35) continue;
      small.push([(a[0]+b[0]+c[0])/3, (a[1]+b[1]+c[1])/3, (a[2]+b[2]+c[2])/3, +area.toFixed(2)]);
    }
  });
  // greedy clustering by x,z
  const groups = [];
  for (const f of small) {
    let g = groups.find((g) => Math.abs(g.x - f[0]) < 0.3 && Math.abs(g.z - f[2]) < 0.3);
    if (!g) { g = { x: f[0], z: f[2], ys: [] }; groups.push(g); }
    g.ys.push(f[1]);
  }
  const good = groups
    .map((g) => ({ x: +g.x.toFixed(2), z: +g.z.toFixed(2), levels: [...new Set(g.ys.map((y) => Math.round(y * 20) / 20))].sort((a,b)=>a-b) }))
    .filter((g) => g.levels.length >= 4)
    .sort((a, b) => b.levels.length - a.levels.length);
  return { small: small.length, good: good.slice(0, 6) };
})()`);
console.log(JSON.stringify(out, null, 1).slice(0, 2500));
await cdp.close();
