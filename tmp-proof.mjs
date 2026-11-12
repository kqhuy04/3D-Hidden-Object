// Stand the body exactly where it used to be trapped, start the real render
// loop, and take a screenshot. The walk test proves it numerically; this is the
// frame the player would actually see.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';

const spots = [
  ['cozy-farm', 3.4, 0, 9.7, 'docs/wander/fix-cozy-farm.png'],
  ['japanese-suburban-city-street', 4.4, 0, 6.3, 'docs/wander/fix-japanese-bicycle.png'],
  ['coral-reef', 7.5, -1.5, 24, 'docs/wander/fix-coral-reef-edge.png'],
  ['space-base', 6.6, 0, -1.5, 'docs/wander/fix-space-base.png'],
];

const cdp = await launch({ url: 'http://localhost:1420/?debug=1', port: 9333 });
await waitForGame(cdp);

for (const [mapId, x, y, z, out] of spots) {
  const res = await cdp.evaluate(`(async () => {
    const h = window.__hunt;
    await h.game.selectMap(${JSON.stringify(mapId)});
    await new Promise((r) => setTimeout(r, 900));
    const c = h.player.getController();
    h.game.loop.stop();
    const mk = (a, b) => ({ x: a, y: b, length() { return Math.hypot(this.x, this.y); },
      clone() { return mk(this.x, this.y); },
      normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } });
    h.player.setPosition(${x}, ${y}, ${z});
    c.falling = true; c.fallSpeed = 0;
    for (let f = 0; f < 300; f++) { c.update(mk(0, 0), 0, 1 / 60); if (!c.falling && f > 60) break; }
    const hx = c.getPosition().x, hz = c.getPosition().z, hy = c.feetY;
    let free = 0;
    for (let d = 0; d < 8; d++) {
      const a = (d / 8) * Math.PI * 2;
      const ox = c.getPosition().x, oz = c.getPosition().z;
      for (let f = 0; f < 30; f++) c.update(mk(Math.sin(a), Math.cos(a)), 0, 1 / 60);
      if (Math.hypot(c.getPosition().x - ox, c.getPosition().z - oz) > 0.3) free++;
      c.setPosition(hx, hy, hz);
      if (c.falling) { for (let f = 0; f < 300; f++) { c.update(mk(0, 0), 0, 1 / 60); if (!c.falling) break; } }
    }
    h.game.loop.start();
    return { map: h.game.map.id, at: [+hx.toFixed(2), +hy.toFixed(2), +hz.toFixed(2)], free };
  })()`);
  await new Promise((r) => setTimeout(r, 3500));
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(png.data, 'base64'));
  console.log(res.map.padEnd(30), `at ${JSON.stringify(res.at)}`.padEnd(26), `free ${res.free}/8`, '->', out);
}

console.log('errors:', cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l)).slice(0, 3));
await cdp.close();
