// Where does the stair gait fire on a slope? Find the steepest ground, walk
// down it, and log every frame's (travelled, rise, gradient, gait, falling).
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'frontier-town';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9451 });
await waitForGame(cdp);

const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.startNewRound();
  const c = h.player.getController();
  const mk = (a, b) => ({ x: a, y: b, length() { return Math.hypot(this.x, this.y); },
    clone() { return mk(this.x, this.y); },
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } });
  h.game.loop.stop();

  // 1. Steepest walkable ground within 60 m of the spawn, by central difference.
  const p0 = c.getPosition();
  const steep = [];
  for (let dx = -60; dx <= 60; dx += 1) {
    for (let dz = -60; dz <= 60; dz += 1) {
      const x = p0.x + dx, z = p0.z + dz;
      const gx = (h.collision.getGroundHeight(x + 0.5, z) - h.collision.getGroundHeight(x - 0.5, z));
      const gz = (h.collision.getGroundHeight(x, z + 0.5) - h.collision.getGroundHeight(x, z - 0.5));
      const grad = Math.hypot(gx, gz);
      if (!Number.isFinite(grad)) continue;
      steep.push({ x, z, grad: +grad.toFixed(2) });
    }
  }
  steep.sort((a, b) => b.grad - a.grad);
  const top = steep.slice(0, 5);

  // 2. Walk downhill from the steepest point and record the gait decisions.
  const spot = top[0];
  const ground = h.collision.getGroundHeight(spot.x, spot.z);
  // Downhill is the negated gradient direction; find it by probing.
  let bestYaw = 0, bestDrop = -Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const drop = h.collision.getGroundHeight(spot.x + Math.sin(a) * 1.5, spot.z + Math.cos(a) * 1.5);
    if (ground - drop > bestDrop) { bestDrop = ground - drop; bestYaw = a; }
  }
  h.player.setPosition(spot.x, ground, spot.z);
  for (let f = 0; f < 20; f++) c.update(mk(0, 0), bestYaw, 1 / 60);

  const rows = [];
  let prevY = c.getGroundY();
  for (let f = 0; f < 160; f++) {
    const beforeX = c.getPosition().x, beforeZ = c.getPosition().z;
    c.update(mk(0, 1), bestYaw, 1 / 60);
    const p = c.getPosition();
    const travelled = Math.hypot(p.x - beforeX, p.z - beforeZ);
    const rise = c.getGroundY() - prevY;
    prevY = c.getGroundY();
    const grad = travelled > 1e-4 ? rise / travelled : 0;
    if (c.getGait() !== 'flat' || Math.abs(grad) > 0.45) {
      rows.push([f, +travelled.toFixed(3), +rise.toFixed(3), +grad.toFixed(2), c.getGait(),
        c.feetY.toFixed(2), +p.y.toFixed(2)]);
    }
  }
  h.game.loop.start();
  return { steepest: top, drop: +bestDrop.toFixed(2), rows: rows.slice(0, 40) };
})()`);

console.log('steepest:', JSON.stringify(out.steepest));
console.log('drop over 1.5 m:', out.drop);
console.log('f    trav  rise   grad  gait      feetY  y');
for (const r of out.rows) console.log(r.map((v) => String(v).padEnd(7)).join(' '));
await cdp.close();
