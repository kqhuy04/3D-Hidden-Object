// Why can't the body move here? Steps in eight directions from a point and
// names the part that blocks each one.
import { launch, waitForGame } from './tmp-cdp.mjs';

const [mapId, sx, sy, sz] = process.argv.slice(2);
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9333 });
await waitForGame(cdp);

const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const c = h.player.getController();
  const coll = h.collision, geo = h.geometry;
  const V = h.game.scene.position.constructor;

  h.game.startNewRound();
  h.game.loop.stop();

  const mk = (x, z) => ({ x, y: z, length() { return Math.hypot(this.x, this.y); },
    clone() { return mk(this.x, this.y); },
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } });

  h.player.setPosition(${sx}, ${sy}, ${sz});
  c.falling = true; c.fallSpeed = 0;
  for (let f = 0; f < 400; f++) { c.update(mk(0, 0), 0, 1 / 60); if (!c.falling && f > 60) break; }

  const home = { x: c.getPosition().x, y: c.feetY, z: c.getPosition().z };

  // What is around the body right now?
  const probe = (x, z, y) => {
    const cap = coll.getCapsule();
    const hit = geo.deepestContact(x, z, cap.radius + 0.05, y + 0.02, y + cap.height, cap.stepHeight,
      { nx: 0, nz: 0, penetration: 0, point: new V(), partName: '' });
    return hit ? hit.partName + ' @' + hit.penetration.toFixed(2) : null;
  };

  const rows = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const dx = Math.sin(a), dz = Math.cos(a);
    h.player.setPosition(home.x, home.y + 0.2, home.z);
    c.falling = true; c.fallSpeed = 0;
    for (let f = 0; f < 120; f++) { c.update(mk(0, 0), 0, 1 / 60); if (!c.falling) break; }
    const b = { x: c.getPosition().x, z: c.getPosition().z };
    for (let f = 0; f < 40; f++) c.update(mk(dx, dz), 0, 1 / 60);
    const moved = Math.hypot(c.getPosition().x - b.x, c.getPosition().z - b.z);
    rows.push({
      angle: Math.round((a * 180) / Math.PI),
      moved: +moved.toFixed(2),
      y: +c.feetY.toFixed(2),
      ahead: probe(c.getPosition().x + dx * 0.5, c.getPosition().z + dz * 0.5, c.feetY),
      here: probe(home.x, home.z, home.y),
    });
  }

  return { home: [+home.x.toFixed(2), +home.y.toFixed(2), +home.z.toFixed(2)],
    ground: +c.getGroundY().toFixed(2), rows };
})()`);

console.log(`=== ${mapId} home ${JSON.stringify(out.home)} groundY ${out.ground}`);
for (const r of out.rows) {
  console.log(`  ${String(r.angle).padStart(3)}°  moved ${String(r.moved).padStart(5)} m  y ${String(r.y).padStart(6)}  ahead=${r.ahead ?? '-'}  here=${r.here ?? '-'}`);
}
await cdp.close();
