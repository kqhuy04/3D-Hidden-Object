// Camera occlusion test: put the body in many places, swing the camera all the
// way round, and check that the lens never ends up behind geometry.
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2];
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
  const ZERO = mk(0, 0);

  let seed = 77;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  const spots = [];
  for (let i = 0; i < 10; i++) {
    const dx = Math.sin(rnd() * 6.283), dz = Math.cos(rnd() * 6.283);
    const b = { x: c.getPosition().x, z: c.getPosition().z };
    for (let f = 0; f < 90; f++) c.update(mk(dx, dz), 0, 1 / 60);
    c.falling = true; c.fallSpeed = 0;
    for (let f = 0; f < 200; f++) { c.update(ZERO, 0, 1 / 60); if (!c.falling) break; }
    spots.push(new V(c.getPosition().x, c.feetY, c.getPosition().z));
  }

  let checks = 0, bad = 0, worst = 0;
  const samples = [];
  for (const spot of spots) {
    for (let i = 0; i < 12; i++) {
      h.cameraController.targetYaw = (i / 12) * Math.PI * 2;
      h.cameraController.targetPitch = 0.25 + (i % 3) * 0.1;
      for (let f = 0; f < 30; f++) h.cameraController.update(spot, 1 / 60, spot.y);
      const look = h.cameraController.currentLookAt;
      const cam = h.camera.position;
      const want = look.distanceTo(cam);
      if (want < 1.0) continue; // jammed against a wall: nothing to test
      checks++;
      const got = coll.cameraDistance(look, cam);
      if (got < want - 0.3) {
        bad++;
        worst = Math.max(worst, want - got);
        if (samples.length < 3) samples.push({ at: [+spot.x.toFixed(1), +spot.y.toFixed(1), +spot.z.toFixed(1)], want: +want.toFixed(2), got: +got.toFixed(2) });
      }
    }
  }
  return { checks, bad, worst: +worst.toFixed(2), samples };
})()`);

console.log(mapId.padEnd(30), `blocked ${out.bad}/${out.checks}`, 'worst', out.worst, out.samples.length ? JSON.stringify(out.samples[0]) : '');
await cdp.close();
