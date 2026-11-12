// Walk up a stair/ladder prop and log the height gained each frame.
import { launch, waitForGame } from './tmp-cdp.mjs';
const [mapId, sx, sy, sz, yawArg] = process.argv.slice(2);
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9499 });
await waitForGame(cdp);
const r = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.startNewRound();
  const c = h.player.getController();
  const mk = (a, b) => ({ x: a, y: b, length() { return Math.hypot(this.x, this.y); },
    clone() { return mk(this.x, this.y); },
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } });
  h.game.loop.stop();
  h.player.setPosition(${sx}, ${sy}, ${sz});
  for (let f = 0; f < 20; f++) c.update(mk(0, 0), 0, 1 / 60);
  const yaw = ${yawArg};
  const trail = [];
  let last = c.feetY;
  for (let f = 0; f < 300; f++) {
    c.update(mk(0, 1), yaw, 1 / 60);
    const y = c.feetY;
    if (f % 15 === 0) trail.push([f, +c.getPosition().x.toFixed(2), +y.toFixed(2), +c.getPosition().z.toFixed(2)]);
    last = y;
  }
  const end = [+c.getPosition().x.toFixed(2), +c.feetY.toFixed(2), +c.getPosition().z.toFixed(2)];
  h.game.loop.start();
  return { end, gait: c.getGait(), steps: trail.slice(0, 60) };
})()`);
console.log('end', JSON.stringify(r.end), 'gait', r.gait);
console.log(r.steps.map((s) => s.join(' ')).join('\n'));
await cdp.close();
