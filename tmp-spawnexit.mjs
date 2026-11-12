// Where does the body actually spawn, and how many ways out does it have?
// A spawn with one free direction is not stuck, but it reads as stuck: the
// player presses a key, nothing happens, and there is no room to turn around.
import { launch, waitForGame } from './tmp-cdp.mjs';

const maps = process.argv.slice(2);
const cdp = await launch({ url: 'http://localhost:1420/?debug=1', port: 9333 });
await waitForGame(cdp);

for (const mapId of maps) {
  const out = await cdp.evaluate(`(async () => {
    const h = window.__hunt;
    await h.game.selectMap(${JSON.stringify(mapId)});
    await new Promise((r) => setTimeout(r, 1200));
    const c = h.player.getController();
    const coll = h.collision;
    const V = h.game.scene.position.constructor;
    h.game.loop.stop();
    const mk = (x, z) => ({ x, y: z, length() { return Math.hypot(this.x, this.y); },
      clone() { return mk(this.x, this.y); },
      normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } });
    c.falling = true; c.fallSpeed = 0;
    for (let f = 0; f < 400; f++) { c.update(mk(0, 0), 0, 1 / 60); if (!c.falling && f > 60) break; }

    const hx = c.getPosition().x, hz = c.getPosition().z, hy = c.feetY;
    const dirs = [];
    for (let d = 0; d < 8; d++) {
      const a = (d / 8) * Math.PI * 2;
      const ox = c.getPosition().x, oz = c.getPosition().z;
      for (let f = 0; f < 30; f++) c.update(mk(Math.sin(a), Math.cos(a)), 0, 1 / 60);
      dirs.push(+Math.hypot(c.getPosition().x - ox, c.getPosition().z - oz).toFixed(2));
      c.setPosition(hx, hy, hz);
      if (c.falling) { for (let f = 0; f < 300; f++) { c.update(mk(0, 0), 0, 1 / 60); if (!c.falling) break; } }
    }
    return {
      map: h.game.map.id,
      at: [+hx.toFixed(2), +hy.toFixed(2), +hz.toFixed(2)],
      hint: h.game.map.spawn,
      dirs,
      free: dirs.filter((d) => d > 0.3).length,
    };
  })()`);
  console.log(
    out.map.padEnd(30),
    `at ${JSON.stringify(out.at)}`.padEnd(28),
    `free ${out.free}/8`,
    out.dirs.map((d) => String(d).padStart(5)).join('')
  );
}
await cdp.close();
