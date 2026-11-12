import { launch, waitForGame } from './tmp-cdp.mjs';
const mapId = process.argv[2] ?? 'chronos-hearth';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9443 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const parts = h.geometry.partStats.filter((p) => /stair/i.test(p.name));
  const res = [];
  for (const p of parts) {
    const b = p.bounds;
    res.push({
      name: p.name, tris: p.triangles,
      min: [+b.min.x.toFixed(1), +b.min.y.toFixed(2), +b.min.z.toFixed(1)],
      max: [+b.max.x.toFixed(1), +b.max.y.toFixed(2), +b.max.z.toFixed(1)],
    });
  }
  // walk up the biggest one
  const p = parts[0];
  let info = null;
  if (p) {
    const b = p.bounds;
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    const c = h.player.getController();
    const V = h.camera.position.constructor;
    // start just outside the low end and walk toward the centre
    const start = new V(cx, 0, cz);
    const g = h.collision.getGroundHeight(b.min.x - 1, cz);
    h.player.setPosition(b.min.x - 1, g + 0.1, cz);
    const dir = new V(0, 1);
    const log = [];
    for (let i = 0; i < 120; i++) {
      c.update(dir, -Math.PI / 2, 1 / 60, false);
      if (i % 12 === 0) {
        const q = h.player.getPosition();
        log.push([+q.x.toFixed(2), +q.y.toFixed(2), +q.z.toFixed(2), c.getGait()]);
      }
    }
    info = log;
  }
  return { parts: res, walk: info };
})()`);
console.log(JSON.stringify(out, null, 1).slice(0, 3000));
await cdp.close();
