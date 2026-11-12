// Do the four new clips load, and does the controller actually use them?
//
// The movement is stepped directly at a fixed timestep instead of waiting for
// frames. Headless SwiftShader renders this scene at one or two frames a
// second, so a real-time test of "hold W for a second" simulates one frame —
// which is how a working ladder looked broken the first time this was tried.
//
// Usage: node tmp-traverse.mjs [map-id]
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'chronos-hearth';

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9405 });
await waitForGame(cdp);
await cdp.evaluate(`(() => { window.__hunt.game.startNewRound(); return true; })()`);
await new Promise((r) => setTimeout(r, 600));

const clips = await cdp.evaluate(`[...window.__hunt.player.getAnimator().actions.keys()]`);
console.log(`clips: ${clips.join(', ')}`);

const volumes = await cdp.evaluate(`window.__hunt.collision.getClimbVolumes().map((v) => ({
  x: +((v.minX + v.maxX) / 2).toFixed(2),
  z: +((v.minZ + v.maxZ) / 2).toFixed(2),
  bottom: +v.bottom.toFixed(2),
  top: +v.top.toFixed(2),
}))`);
console.log(`climb volumes: ${volumes.length}`);

/**
 * Steps the controller `frames` times at 1/60 s with a held direction, and
 * returns what the gait and the clip were doing along the way.
 */
async function step(direction, frames) {
  return cdp.evaluate(`(() => {
    const h = window.__hunt;
    const c = h.player.getController();
    const v = h.game.input.getMovementVector();
    v.set(${direction[0]}, ${direction[1]});
    const yaw = h.cameraController.getYaw();
    const seen = [];
    const startY = h.player.getPosition().y;
    for (let i = 0; i < ${frames}; i++) {
      c.update(v, yaw, 1 / 60, false);
      if (i % 20 === 0) {
        seen.push(c.getGait() + '/' + h.player.getAnimator().getCurrentActionName());
      }
    }
    return {
      startY: +startY.toFixed(2),
      endY: +h.player.getPosition().y.toFixed(2),
      end: [+h.player.getPosition().x.toFixed(2), +h.player.getPosition().z.toFixed(2)],
      climbing: c.isClimbing(),
      crawling: c.isCrawling(),
      gait: c.getGait(),
      clip: h.player.getAnimator().getCurrentActionName(),
      seen,
    };
  })()`);
}

// --- crawl ---------------------------------------------------------------
const crawl = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  h.game.input.triggerCrawl(true);
  h.player.getController().update(h.game.input.getMovementVector().set(0, 1), 0, 1 / 60, false);
  return {
    height: +h.collision.getCapsule().height.toFixed(2),
    crawling: h.player.getController().isCrawling(),
    clip: h.player.getAnimator().getCurrentActionName(),
  };
})()`);
const crawlWalk = await step([0, 1], 60);
await cdp.evaluate(`(() => {
  const h = window.__hunt;
  h.game.input.triggerCrawl(false);
  h.player.getController().update(h.game.input.getMovementVector().set(0, 0), 0, 1 / 60, false);
  return true;
})()`);
const stand = await cdp.evaluate(`(() => ({
  height: +window.__hunt.collision.getCapsule().height.toFixed(2),
  crawling: window.__hunt.player.getController().isCrawling(),
}))()`);
console.log('crawl:', JSON.stringify({ ...crawl, walkGait: crawlWalk.gait, walkClip: crawlWalk.clip }), '-> stand:', JSON.stringify(stand));

// --- ladder --------------------------------------------------------------
if (volumes.length > 0) {
  const v = volumes.reduce((a, b) => (b.top - b.bottom > a.top - a.bottom ? b : a));
  await cdp.evaluate(`(() => {
    const h = window.__hunt;
    h.player.setPosition(${v.x}, ${v.bottom} + 0.05, ${v.z});
    h.cameraController.targetYaw = 0;
    h.cameraController.snap(h.player.getPosition(), ${v.bottom});
    return true;
  })()`);
  const up = await step([0, 1], 90);
  const down = await step([0, -1], 30);
  console.log('ladder up:', JSON.stringify(up));
  console.log('ladder down:', JSON.stringify({ endY: down.endY, climbing: down.climbing, gait: down.gait, clip: down.clip }));
} else {
  console.log('ladder: none on this map');
}

// --- stairs --------------------------------------------------------------
const stairProp = await cdp.evaluate(`(() => {
  const props = window.__hunt.game.selector.getProps().filter((p) => /stair/i.test(p.name));
  if (!props.length) return null;
  const p = props[0];
  return { name: p.name, c: [p.centre.x, p.centre.y, p.centre.z] };
})()`);

if (stairProp) {
  const placed = await cdp.evaluate(`(() => {
    const h = window.__hunt;
    const [cx, cy, cz] = ${JSON.stringify(stairProp.c)};
    let best = null;
    for (let a = 0; a < 6.28; a += 0.4) {
      for (const r of [2.6, 3.4, 4.2]) {
        const sx = cx + Math.sin(a) * r;
        const sz = cz + Math.cos(a) * r;
        const g = h.collision.getGroundHeight(sx, sz);
        const spawn = h.collision.findSpawn({ x: sx, y: g + 0.5, z: sz }, 2.5);
        if (!spawn) continue;
        if (!best || spawn.y < best.y) best = { x: spawn.x, y: spawn.y, z: spawn.z };
      }
    }
    if (!best) return null;
    h.player.setPosition(best.x, best.y + 0.05, best.z);
    // Face the staircase.
    const yaw = Math.atan2(best.x - cx, best.z - cz);
    h.cameraController.targetYaw = yaw;
    h.cameraController.snap(h.player.getPosition(), best.y);
    return { stand: [+best.x.toFixed(2), +best.y.toFixed(2), +best.z.toFixed(2)], yaw: +yaw.toFixed(2) };
  })()`);

  if (placed) {
    const walk = await step([0, 1], 120);
    console.log(`stairs ${stairProp.name} from ${placed.stand.join(',')}:`, JSON.stringify(walk));
  }
} else {
  console.log('stairs: no stair prop on this map');
}

// --- a sustained ascent ---------------------------------------------------
// The stair prop test depends on that particular staircase being walkable from
// the side the harness happened to pick. This one finds any line on the map
// that climbs steadily and walks up it, which is what the gait is actually
// keyed to.
const slope = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  let best = null;
  for (let x = -40; x <= 40; x += 2) {
    for (let z = -40; z <= 40; z += 2) {
      const g0 = h.collision.getGroundHeight(x, z);
      if (!Number.isFinite(g0)) continue;
      for (let a = 0; a < 6.28; a += 0.6) {
        const dx = Math.sin(a), dz = Math.cos(a);
        let rise = 0, ok = true;
        for (let d = 0.4; d <= 2.4; d += 0.4) {
          const g = h.collision.getGroundHeight(x + dx * d, z + dz * d);
          if (!Number.isFinite(g)) { ok = false; break; }
          rise += g - g0;
        }
        if (!ok) continue;
        // Walkable, not a wall: 0.5-1.2 m over 2 m is a 25-50% grade.
        if (rise < 0.5 || rise > 1.2) continue;
        if (!best || rise > best.rise) best = { x, z, a, rise: +rise.toFixed(2) };
      }
    }
  }
  if (!best) return null;
  const spawn = h.collision.findSpawn({ x: best.x, y: h.collision.getGroundHeight(best.x, best.z) + 0.5, z: best.z }, 2);
  if (!spawn) return null;
  h.player.setPosition(spawn.x, spawn.y + 0.05, spawn.z);
  h.cameraController.targetYaw = best.a;
  h.cameraController.snap(h.player.getPosition(), spawn.y);
  return { rise: best.rise, stand: [+spawn.x.toFixed(1), +spawn.y.toFixed(2), +spawn.z.toFixed(1)] };
})()`);

if (slope) {
  const walk = await step([0, 1], 90);
  console.log(`slope walk (${slope.rise} m rise over 2 m) from ${slope.stand.join(',')}:`, JSON.stringify(walk));
} else {
  console.log('slope walk: no steady climb found on this map');
}

const exceptions = cdp.consoleLines.filter((l) => l.startsWith('EXCEPTION'));
console.log(`exceptions: ${exceptions.length}`);
if (exceptions.length) console.log(exceptions.slice(0, 3).join('\n'));

await cdp.close();
