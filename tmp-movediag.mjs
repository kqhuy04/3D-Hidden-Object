import { launch, waitForGame } from './tmp-cdp.mjs';
const [mapId, sx, sy, sz] = process.argv.slice(2);
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9333 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const c = h.player.getController();
  const coll = h.collision;
  const V = h.game.scene.position.constructor;
  h.game.startNewRound();
  h.game.loop.stop();
  const mk = (x, z) => ({ x, y: z, length() { return Math.hypot(this.x, this.y); },
    clone() { return mk(this.x, this.y); },
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } });
  h.player.setPosition(${sx}, ${sy}, ${sz});
  c.falling = true; c.fallSpeed = 0;
  for (let f = 0; f < 300; f++) { c.update(mk(0,0), 0, 1/60); if (!c.falling && f > 40) break; }

  const x = c.getPosition().x, z = c.getPosition().z;
  const rows = [];
  for (const deg of [0, 45, 90, 135, 180, 270, 315]) {
    const a = deg * Math.PI / 180;
    const probe = new V(x, c.groundY, z);
    const r = coll.moveCapsule(probe, new V(Math.sin(a) * 0.1, 0, Math.cos(a) * 0.1), undefined, c.feetY);
    rows.push({ deg, moved: +Math.hypot(r.position.x - x, r.position.z - z).toFixed(3),
      blocked: r.blocked, y: +r.position.y.toFixed(2),
      contacts: r.contacts.slice(0, 3).map((k) => k.partName + ' n=' + k.nx.toFixed(2) + ',' + k.nz.toFixed(2) + ' p=' + k.penetration.toFixed(2)) });
  }
  return { at: [+x.toFixed(2), +c.feetY.toFixed(2), +z.toFixed(2)], groundY: +c.groundY.toFixed(2),
    support: coll.getCollisionGeometry() ? 'yes' : 'no', rows };
})()`);
console.log(`${mapId} at ${JSON.stringify(out.at)} groundY ${out.groundY}`);
for (const r of out.rows) console.log(`  ${String(r.deg).padStart(3)}° moved ${String(r.moved).padStart(5)} blocked=${r.blocked} y=${r.y} ${r.contacts.join(' | ')}`);
await cdp.close();
