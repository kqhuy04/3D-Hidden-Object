import { launch, waitForGame } from './tmp-cdp.mjs';
const [mapId, sx, sy, sz] = process.argv.slice(2);
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9333 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const c = h.player.getController();
  const V = h.game.scene.position.constructor;
  h.game.startNewRound();
  h.game.loop.stop();
  const mk = (x, z) => ({ x, y: z, length() { return Math.hypot(this.x, this.y); },
    clone() { return mk(this.x, this.y); },
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } });
  h.player.setPosition(${sx}, ${sy}, ${sz});
  c.falling = true; c.fallSpeed = 0;
  for (let f = 0; f < 400; f++) { c.update(mk(0,0), 0, 1/60); if (!c.falling && f > 60) break; }

  const rows = [];
  for (const hdg of [0.5, 0.92, 1.25, 1.57]) {
    const dx = Math.sin(hdg), dz = Math.cos(hdg);
    const b = { x: c.getPosition().x, z: c.getPosition().z };
    const trace = [];
    for (let f = 0; f < 60; f++) {
      c.update(mk(dx, dz), 0, 1/60);
      if (f % 15 === 0) trace.push({ f, x: +c.getPosition().x.toFixed(2), z: +c.getPosition().z.toFixed(2),
        scale: +c.animator.getMoveScale().toFixed(2), jumping: c.animator.isJumping(), falling: c.falling });
    }
    rows.push({ hdg, moved: +Math.hypot(c.getPosition().x-b.x, c.getPosition().z-b.z).toFixed(2), trace });
  }
  return { home: [+c.getPosition().x.toFixed(2), +c.feetY.toFixed(2), +c.getPosition().z.toFixed(2)], rows };
})()`);
console.log(JSON.stringify(out, null, 1));
await cdp.close();
