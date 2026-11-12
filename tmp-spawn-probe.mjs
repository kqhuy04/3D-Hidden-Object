// Why is a spot not walkable? Mirrors WorldCollision.findSpawn step by step.
import { launch, waitForGame } from './tmp-cdp.mjs';
const mapId = process.argv[2];
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9333 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const c = h.collision, g = h.geometry, cap = c.getCapsule();
  const s = h.game.map.spawn;
  const floorAt = (x, z) => {
    let ref = c.getGroundHeight(x, z);
    for (let i = 0; i < 6; i++) {
      const sup = g.supportHeight(x, z, ref, cap.stepHeight);
      if (sup === null || sup <= ref + 1e-3) break;
      ref = sup;
    }
    return ref;
  };
  const why = (x, z) => {
    if (!c.hasGround(x, z)) return 'no-ground';
    const ground = floorAt(x, z);
    const p = cap.radius;
    for (const [dx, dz] of [[p,0],[-p,0],[0,p],[0,-p]]) {
      if (Math.abs(floorAt(x+dx, z+dz) - ground) > 0.4) return 'slope';
    }
    const feet = ground + 0.02;
    const hit = g.deepestContact(x, z, cap.radius + 0.45, feet, feet + cap.height, cap.stepHeight,
      { nx:0,nz:0,penetration:0,point:new (h.game.scene.position.constructor)(), partName:'' });
    if (hit) return 'wall:' + hit.partName.slice(0, 14);
    return 'OK ' + ground.toFixed(2);
  };
  const rows = [];
  for (let dz = -9; dz <= 9; dz += 3) {
    const line = [];
    for (let dx = -9; dx <= 9; dx += 3) line.push(why(s.x + dx, s.z + dz));
    rows.push({ dz, line });
  }
  return { hint: s, rows };
})()`);
console.log(`=== ${mapId} hint ${JSON.stringify(out.hint)}`);
for (const r of out.rows) console.log(`  z${String(r.dz).padStart(5)}  ${r.line.map((s) => s.padEnd(18)).join('|')}`);
await cdp.close();
