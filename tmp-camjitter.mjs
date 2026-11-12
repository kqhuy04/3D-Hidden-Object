// Camera judder meter.
//
// Walks the body in a straight line and records, per frame, how far the camera
// moved and how long the boom was. At a constant walking speed the camera should
// follow at a near-constant rate, so a judder shows up as a spike in the
// frame-to-frame displacement — or as the boom length stepping, which moves the
// whole view towards or away from the player in one frame.
//
// Deterministic: the render loop is stopped and the controller is stepped by
// hand, exactly as Game.update does.
import { launch, waitForGame } from './tmp-cdp.mjs';

const args = process.argv.slice(2);
const segments = Number(args.find((a) => /^\d+$/.test(a)) ?? 0);
const maps = args.filter((a) => !/^\d+$/.test(a));
if (maps.length === 0) maps.push('campground');

const cdp = await launch({ url: 'http://localhost:1420/?debug=1', port: 9333 });
await waitForGame(cdp);

const probe = (mapId) => `(async () => {
  const h = window.__hunt;
  await h.game.selectMap(${JSON.stringify(mapId)});
  await new Promise((r) => setTimeout(r, 900));
  const c = h.player.getController();
  const cam = h.cameraController;
  const V = h.game.scene.position.constructor;
  h.game.loop.stop();
  const mk = (x, z) => ({ x, y: z, length() { return Math.hypot(this.x, this.y); },
    clone() { return mk(this.x, this.y); },
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } });
  c.falling = true; c.fallSpeed = 0;
  for (let f = 0; f < 300; f++) { c.update(mk(0, 0), 0, 1 / 60); if (!c.falling && f > 40) break; }
  cam.snap(c.getPosition(), c.getGroundY());

  // Walk forward in four headings, 90 frames each, and record the camera path.
  const frames = [];
  const DT = 1 / 60;
  for (let s = 0; s < 4; s++) {
    const a = (s / 4) * Math.PI * 2;
    const dir = mk(Math.sin(a), Math.cos(a));
    for (let f = 0; f < 90; f++) {
      c.update(dir, 0, DT);
      cam.update(c.getPosition(), DT, c.getGroundY());
      const p = cam.getCamera().position;
      const look = cam.currentLookAt;
      // Which layer is limiting the boom — a mesh or the terrain? The boom
      // direction is the same whether or not it was pulled in, so cast along it
      // at full length to see what is actually in the way.
      const g = h.collision.getCollisionGeometry();
      const ux = p.x - look.x, uy = p.y - look.y, uz = p.z - look.z;
      const ul = Math.hypot(ux, uy, uz) || 1;
      const REACH = 9;
      const ex = look.x + (ux / ul) * REACH;
      const ey = look.y + (uy / ul) * REACH;
      const ez = look.z + (uz / ul) * REACH;
      const meshT = g ? g.raycastSegment(look.x, look.y, look.z, ex, ey, ez) : null;
      const groundHere = h.collision.terrainHeight(look.x, look.z);
      frames.push({ x: p.x, y: p.y, z: p.z,
        boom: +p.distanceTo(look).toFixed(3),
        look: [+look.x.toFixed(2), +look.y.toFixed(2), +look.z.toFixed(2)],
        body: [+c.getPosition().x.toFixed(2), +c.feetY.toFixed(2), +c.getPosition().z.toFixed(2)],
        ground: groundHere === null ? null : +groundHere.toFixed(2),
        meshT: meshT === null ? null : +(meshT * REACH).toFixed(2) });
    }
  }

  const step = [];
  for (let i = 1; i < frames.length; i++) {
    step.push(Math.hypot(frames[i].x - frames[i - 1].x, frames[i].y - frames[i - 1].y,
      frames[i].z - frames[i - 1].z));
  }
  const sorted = [...step].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  // Judder = a frame that moves the camera far more than its neighbours. Count
  // frames whose step exceeds three times the median and list the worst few.
  const spikes = [];
  for (let i = 1; i < step.length; i++) {
    if (step[i] > Math.max(0.05, median * 3)) {
      spikes.push({ i, step: +step[i].toFixed(3), prev: +step[i - 1].toFixed(3),
        boom: frames[i + 1].boom, meshT: frames[i + 1].meshT,
        ground: frames[i + 1].ground, look: frames[i + 1].look,
        body: frames[i + 1].body });
    }
  }
  const booms = frames.map((f) => f.boom);
  let boomJumps = 0, boomWorst = 0;
  for (let i = 1; i < booms.length; i++) {
    const d = Math.abs(booms[i] - booms[i - 1]);
    if (d > 0.05) { boomJumps++; boomWorst = Math.max(boomWorst, d); }
  }
  // Pumping, not tracking: the boom changing direction means it went in and
  // came back out, which is the shimmer a player reads as judder. Smooth
  // following of a moving target changes direction rarely.
  let reversals = 0, runDir = 0;
  for (let i = 1; i < booms.length; i++) {
    const d = booms[i] - booms[i - 1];
    if (Math.abs(d) < 0.02) continue;
    const dir = Math.sign(d);
    if (runDir !== 0 && dir !== runDir) reversals++;
    runDir = dir;
  }
  return {
    map: h.game.map.id,
    frames: frames.length,
    median: +median.toFixed(4),
    max: +Math.max(...step).toFixed(3),
    spikes: spikes.length,
    worst: spikes.slice(0, 2),
    boomJumps, boomWorst: +boomWorst.toFixed(3),
    reversals,
    boomMin: Math.min(...booms), boomMax: Math.max(...booms),
  };
})()`;

for (const m of maps) {
  const r = await cdp.evaluate(probe(m));
  console.log(
    String(r.map).padEnd(30),
    `step med ${r.median.toFixed(3)} max ${String(r.max).padStart(6)}`,
    `spikes ${String(r.spikes).padStart(3)}`,
    `boom ${r.boomMin.toFixed(2)}-${r.boomMax.toFixed(2)}`,
    `jumps ${String(r.boomJumps).padStart(3)} (worst ${r.boomWorst})`,
    `reversals ${String(r.reversals).padStart(3)}`
  );
  if (r.spikes) console.log('   worst:', JSON.stringify(r.worst));
}
await cdp.close();
