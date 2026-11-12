// Does a real staircase still play the stair cycle? Find a 0.3-0.5 m riser with
// a tread behind it, walk down it, and log the gait.
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'hospital';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9452 });
await waitForGame(cdp);

const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.startNewRound();
  const c = h.player.getController();
  const mk = (a, b) => ({ x: a, y: b, length() { return Math.hypot(this.x, this.y); },
    clone() { return mk(this.x, this.y); },
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } });
  h.game.loop.stop();
  // Stairs are props, so the terrain heightfield does not see them: ask the
  // collision geometry for the highest surface within 5 m of the terrain.
  const g = (x, z) => {
    const terrain = h.collision.getGroundHeight(x, z);
    const geo = h.geometry;
    if (!geo || !Number.isFinite(terrain)) return terrain;
    const s = geo.supportHeight(x, z, terrain - 0.5, 5);
    return s === null ? terrain : s;
  };

  // A riser: 0.3-0.5 m drop over 0.6 m, with a tread (flat) behind it.
  const p0 = c.getPosition();
  let found = null;
  for (let dx = -45; dx <= 45 && !found; dx += 0.5) {
    for (let dz = -45; dz <= 45 && !found; dz += 0.5) {
      const x = p0.x + dx, z = p0.z + dz;
      const a = g(x, z), b = g(x + 0.6, z), t = g(x + 1.4, z);
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(t)) continue;
      const riser = a - b;
      if (riser < 0.3 || riser > 0.5) continue;
      if (Math.abs(t - b) > 0.06) continue;      // tread
      found = { x, z, a, b, riser: +riser.toFixed(2) };
    }
  }
  if (!found) { h.game.loop.start(); return { found: null }; }

  // Walk in -x, i.e. down the riser.
  h.player.setPosition(found.x, found.a, found.z);
  const yaw = -Math.PI / 2; // +x, down the riser
  for (let f = 0; f < 20; f++) c.update(mk(0, 0), yaw, 1 / 60);
  const rows = [];
  let prev = c.getGroundY();
  for (let f = 0; f < 60; f++) {
    c.update(mk(0, 1), yaw, 1 / 60);
    const rise = c.getGroundY() - prev;
    prev = c.getGroundY();
    if (f % 4 === 0 || Math.abs(rise) > 0.02) {
      rows.push([f, +c.getPosition().x.toFixed(2), +rise.toFixed(3), c.getGait(), +c.feetY.toFixed(2)]);
    }
  }
  h.game.loop.start();
  return { found, rows: rows.slice(0, 12) };
})()`);

console.log(mapId, JSON.stringify(out.found));
for (const r of out.rows ?? []) console.log('  f', r.join('  '));
await cdp.close();
