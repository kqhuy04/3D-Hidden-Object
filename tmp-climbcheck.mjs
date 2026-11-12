// Ladder acceptance for one map. Usage: node tmp-climbcheck.mjs <map> <cx> <cz>
import { launch, waitForGame } from './tmp-cdp.mjs';

const [mapId, cxArg, czArg] = process.argv.slice(2);
const CX = Number(cxArg), CZ = Number(czArg);

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9448 });
await waitForGame(cdp);

const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.startNewRound();
  const c = h.player.getController();
  const mk = (a, b) => ({ x: a, y: b, length() { return Math.hypot(this.x, this.y); },
    clone() { return mk(this.x, this.y); },
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } });
  h.game.loop.stop();

  const CX = ${CX}, CZ = ${CZ};
  const ground = h.collision.getGroundHeight(CX, CZ);
  const run = (sx, sz, yaw, frames) => {
    h.player.setPosition(sx, ground, sz);
    for (let f = 0; f < 20; f++) c.update(mk(0, 0), yaw, 1 / 60);
    const y0 = c.feetY;
    let peak = -99, maxOff = 0, grabbed = false, jumpOnGrab = 0, firstY = null;
    for (let f = 0; f < frames; f++) {
      const before = c.isClimbing();
      const yBefore = c.feetY;
      c.update(mk(0, 1), yaw, 1 / 60);
      if (!before && c.isClimbing()) {
        // The frame the grab happened: how far did the body move vertically?
        jumpOnGrab = Math.max(jumpOnGrab, Math.abs(c.feetY - yBefore));
        firstY = +c.feetY.toFixed(2);
      }
      const p = c.getPosition();
      if (c.isClimbing()) {
        grabbed = true;
        const off = Math.hypot(p.x - CX, p.z - CZ);
        if (off > maxOff) maxOff = off;
      }
      if (c.feetY > peak) peak = c.feetY;
    }
    return { grabbed, startY: +y0.toFixed(2), firstY, jumpOnGrab: +jumpOnGrab.toFixed(2),
      peak: +peak.toFixed(2), maxOff: +maxOff.toFixed(2) };
  };

  const runs = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((yaw) => {
    const angle = Math.PI + yaw;
    return { yaw: +yaw.toFixed(2), ...run(CX - Math.sin(angle) * 2.2, CZ - Math.cos(angle) * 2.2, yaw, 420) };
  });
  h.game.loop.start();
  return { ground: +ground.toFixed(2), runs };
})()`);

console.log(`${mapId} @ ${CX},${CZ}  ground ${out.ground}`);
for (const r of out.runs) {
  console.log(`  yaw ${String(r.yaw).padEnd(6)} grabbed=${r.grabbed} start=${r.startY} firstClimbY=${r.firstY} jumpOnGrab=${r.jumpOnGrab} peak=${r.peak} maxOff=${r.maxOff}`);
}
await cdp.close();
