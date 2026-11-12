import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9433 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const tower = h.game.scene.getObjectByName('tower');
  if (!tower) return { none: true };
  tower.updateMatrixWorld(true);
  const faces = [];
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
      faces.push([(a[0]+b[0]+c[0])/3, (a[1]+b[1]+c[1])/3, (a[2]+b[2]+c[2])/3]);
    }
  });
  // cluster by (x,z) rounded to 0.2
  const map = new Map();
  for (const f of faces) {
    const k = Math.round(f[0]/0.2) + ':' + Math.round(f[2]/0.2);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(f);
  }
  const clusters = [];
  for (const [k, list] of map) {
    const ys = [...new Set(list.map((f) => Math.round(f[1]*20)/20))].sort((a,b)=>a-b);
    if (ys.length < 4) continue;
    clusters.push({ k, n: list.length, ys: ys.slice(0, 20), x: list[0][0], z: list[0][2] });
  }
  clusters.sort((a,b)=>b.n-a.n);
  return { faces: faces.length, clusters: clusters.slice(0, 8) };
})()`);
console.log(JSON.stringify(out, null, 1).slice(0, 3000));
await cdp.close();
