// "Đi loanh quanh": walk a map at random for a while and report anything that
// looks wrong — stuck spots, falls out of the world, frame-to-frame jerks, and
// a camera that ends up behind a wall.
//
// Deterministic: the render loop is stopped and the controller is stepped by
// hand, so a run is reproducible and costs no rendering time.
//
// Pass several map ids to reuse one browser session: relaunching Chrome costs
// 50-90 s per map because the character loads behind software-rendered frames,
// which made a 21-map sweep take half an hour. Swapping maps in place is the
// same code path the in-game picker uses, so it is also the honest test.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';

const args = process.argv.slice(2);
const segments = Number(args.find((a) => /^\d+$/.test(a)) ?? 28);
const shot = args.find((a) => a.endsWith('.png'));
const maps = args.filter((a) => !/^\d+$/.test(a) && !a.endsWith('.png'));
if (maps.length === 0) maps.push('campground');

const cdp = await launch({ url: `http://localhost:1420/?debug=1`, port: 9333 });
await waitForGame(cdp);

const walk = (mapId) => `(async () => {
  const h = window.__hunt;
  await h.game.selectMap(${JSON.stringify(mapId)});
  for (let i = 0; i < 400; i++) {
    if (h.game.isLoaded && h.game.map && h.game.map.id === ${JSON.stringify(mapId)}) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 600));

  const c = h.player.getController();
  const coll = h.collision;
  const V = h.game.scene.position.constructor;

  h.game.startNewRound();
  h.game.loop.stop();

  const mk = (x, z) => ({ x, y: z, length() { return Math.hypot(this.x, this.y); },
    clone() { return mk(this.x, this.y); },
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } });
  const ZERO = mk(0, 0);

  const settle = () => {
    c.falling = true; c.fallSpeed = 0;
    let still = 0, prev = c.feetY;
    for (let f = 0; f < 600; f++) {
      c.update(ZERO, 0, 1 / 60);
      if (Math.abs(c.feetY - prev) < 1e-6 && !c.falling) still++; else still = 0;
      prev = c.feetY;
      if (still >= 3) return true;
    }
    return false;
  };

  // A seeded generator, so a bad run can be repeated exactly.
  let seed = 20261110;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  settle();

  const report = {
    map: h.game.map.id,
    start: [+c.getPosition().x.toFixed(2), +c.feetY.toFixed(2), +c.getPosition().z.toFixed(2)],
    segments: 0, distance: 0, stuck: [], jerks: [], outOfWorld: 0,
    minY: Infinity, maxY: -Infinity, cameraBlocked: 0, cameraChecks: 0,
    nan: 0, unlanded: 0,
  };

  let heading = rnd() * Math.PI * 2;

  for (let s = 0; s < ${segments}; s++) {
    // Uniform, not a random walk: a drifting heading clusters on one side of
    // the compass and then every segment walks into the same wall, which reads
    // as "stuck" when the body simply was never asked to turn around.
    heading = rnd() * Math.PI * 2;
    const dx = Math.sin(heading), dz = Math.cos(heading);
    const jump = rnd() < 0.12;
    const before = { x: c.getPosition().x, z: c.getPosition().z };
    let prevY = c.feetY;
    let segmentDistance = 0;

    for (let f = 0; f < 42; f++) {
      c.update(mk(dx, dz), 0, 1 / 60, jump && f === 0);
      const x = c.getPosition().x, y = c.feetY, z = c.getPosition().z;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { report.nan++; break; }
      report.minY = Math.min(report.minY, y);
      report.maxY = Math.max(report.maxY, y);
      if (y < -30) report.outOfWorld++;
      const dy = y - prevY;
      // A drop of more than half a metre in one frame is a teleport, not a fall:
      // gravity moves the body 0.3 m at most in 1/60 s.
      if (dy < -0.5) report.jerks.push({ s, f, from: +prevY.toFixed(2), to: +y.toFixed(2) });
      prevY = y;
    }

    const moved = Math.hypot(c.getPosition().x - before.x, c.getPosition().z - before.z);
    segmentDistance += moved;
    report.distance += moved;
    if (moved < 0.05) {
      // Not every blocked segment is a bug: pressing into a wall for 0.7 s is
      // supposed to move nothing. What matters is whether the body can leave at
      // all. So probe eight directions from where it ended up; a body that can
      // still walk in five or more is merely facing a wall, and one with two or
      // fewer is genuinely trapped.
      const hx = c.getPosition().x, hz = c.getPosition().z, hy = c.feetY;
      let free = 0;
      for (let d = 0; d < 8; d++) {
        const a = (d / 8) * Math.PI * 2;
        const ox = c.getPosition().x, oz = c.getPosition().z;
        for (let f = 0; f < 24; f++) c.update(mk(Math.sin(a), Math.cos(a)), 0, 1 / 60);
        if (Math.hypot(c.getPosition().x - ox, c.getPosition().z - oz) > 0.2) free++;
        c.setPosition(hx, hy, hz);
        if (c.falling) settle();
      }
      report.stuck.push({
        s, at: [+hx.toFixed(1), +c.feetY.toFixed(1), +hz.toFixed(1)],
        heading: +heading.toFixed(2), free,
      });
    }

    // Camera: settle it the way the loop would, then ask whether anything is
    // between the body and the lens. The look-at point comes from the
    // controller, not from a hand-built offset — a guessed one sits a few
    // centimetres off, which is enough to make the segment graze a wall and
    // report a false block.
    const pos = new V(c.getPosition().x, c.feetY, c.getPosition().z);
    for (let i = 0; i < 40; i++) h.cameraController.update(pos, 1 / 60, c.getGroundY());
    const look = h.cameraController.currentLookAt;
    const cam = h.camera.position;
    const want = look.distanceTo(cam);
    if (want > 1.0) {
      report.cameraChecks++;
      const got = coll.cameraDistance(look, cam);
      if (got < want - 0.3) report.cameraBlocked++;
    }

    if (c.falling) { if (!settle()) report.unlanded++; }
    report.segments++;
  }

  report.distance = +report.distance.toFixed(1);
  report.minY = +report.minY.toFixed(2);
  report.maxY = +report.maxY.toFixed(2);
  report.end = [+c.getPosition().x.toFixed(2), +c.feetY.toFixed(2), +c.getPosition().z.toFixed(2)];
  return report;
})()`;

for (const mapId of maps) {
  const out = await cdp.evaluate(walk(mapId));
  console.log(JSON.stringify(out));
}

if (shot) {
  await cdp.evaluate(`window.__hunt.game.loop.start()`);
  await new Promise((r) => setTimeout(r, 4000));
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(shot, Buffer.from(png.data, 'base64'));
}
console.log('errors:', cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l)).slice(0, 3));
await cdp.close();
