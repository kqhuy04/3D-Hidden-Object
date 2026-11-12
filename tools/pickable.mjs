// Can a player actually pick this up?
//
// The old harness (the old hunt harness) parked the camera two metres from each object
// and asked the game. That passed while the real game could not pick up
// anything, because the reach test was measured from a camera that normally
// sits eight metres behind the body. This one never touches the camera: it puts
// the body next to the object and lets the follow camera settle on its own, so
// it measures the game the player actually gets.
//
// Usage: node tools/pickable.mjs <map-id> [outDir]
import { launch, waitForGame } from './cdp.mjs';
import fs from 'node:fs';

const mapId = process.argv[2];
const outDir = process.argv[3] ?? null;
if (outDir) fs.mkdirSync(outDir, { recursive: true });

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9337 });
await waitForGame(cdp);

await cdp.evaluate(`(() => { window.__hunt.game.startNewRound(); return true; })()`);
await new Promise((r) => setTimeout(r, 600));

const items = await cdp.evaluate(`window.__hunt.hiddenItems.getItems().map((i) => ({
  id: i.placement.id,
  name: i.placement.name,
  c: [+i.centre.x.toFixed(2), +i.centre.y.toFixed(2), +i.centre.z.toFixed(2)],
  r: +i.radius.toFixed(2)
}))`);

console.log(`${mapId}: ${items.length} objects`);

let pass = 0;
const rows = [];

for (const item of items) {
  const [cx, cy, cz] = item.c;
  const tried = [];

  angleLoop: for (const angle of [0, 0.79, 1.57, 2.36, 3.14, 3.93, 4.71, 5.5]) {
    // Stand off by the object's own size. A wide thing at 1.5 m puts the body
    // inside its footprint and the camera can never frame it; a small thing at
    // 3 m is a speck. Three rings, sized from the bounding radius — the first is
    // simply "walk up to it", which is what a player does before anything else.
    for (const ring of [1.5, Math.max(1.3, item.r + 0.9), Math.max(2.2, item.r + 2.1)]) {
    const placed = await cdp.evaluate(`(() => {
      const h = window.__hunt;
      const sx = ${cx} + Math.sin(${angle}) * ${ring};
      const sz = ${cz} + Math.cos(${angle}) * ${ring};
      const ground = h.collision.getGroundHeight(sx, sz);
      // Radius 3, not the default 28: a spawn search that may walk seven metres
      // is not "standing next to the object", and treating its answer as one
      // made half the maps look unpickable.
      const spawn = h.collision.findSpawn({ x: sx, y: ground + 0.5, z: sz }, 3);
      if (!spawn) return null;
      if (Math.hypot(spawn.x - sx, spawn.z - sz) > 2.2) return null;
      const px = spawn.x;
      const pz = spawn.z;
      const py = spawn.y;
      h.player.setPosition(px, py + 0.05, pz);

      // Aim the way a player would: drag until the object is in front of the
      // camera. Yaw puts the boom on the far side of the body from the object.
      h.cameraController.targetYaw = Math.atan2(px - ${cx}, pz - ${cz});
      h.cameraController.snap(h.player.getPosition(), py);

      // ...and pitch matters just as much. The camera sits above the body and
      // looks *down* along the boom, so a low object — a straw bale, a coffin —
      // projects below the crosshair and the 0.42 off-axis gate fails no matter
      // how close the player stands. A real player tilts the camera down; this
      // harness used to leave pitch at its default and then report the object as
      // unpickable. Solve for the pitch that points the lens at the object, and
      // iterate because moving the pitch moves the camera. The player's own
      // clamp (0.05 … 1.35) still applies, so this cannot cheat past the limit.
      for (let it = 0; it < 6; it++) {
        const cam = h.camera.position;
        const dx = ${cx} - cam.x;
        const dy = ${cy} - cam.y;
        const dz = ${cz} - cam.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        // Boom direction is the negative of the look direction; dir.y = sin(pitch).
        const want = Math.asin(Math.max(-1, Math.min(1, -dy / len)));
        const clamped = Math.max(0.05, Math.min(1.35, want));
        if (Math.abs(clamped - h.cameraController.targetPitch) < 1e-4) break;
        h.cameraController.targetPitch = clamped;
        h.cameraController.snap(h.player.getPosition(), py);
      }
      return { px: +px.toFixed(2), pz: +pz.toFixed(2), pitch: +h.cameraController.targetPitch.toFixed(2) };
    })()`);

    if (!placed) {
      tried.push({ angle: +angle.toFixed(2), bodyToItem: 99, hit: null });
      continue;
    }

    // Real frames: the follow camera, the player controller and the prompt all
    // have to run for this to be the same path a player takes. The boom lerps
    // its look-at point over about a second, so a fixed sleep is a coin flip:
    // the object is in reach one frame and the camera has drifted past it the
    // next, and the reading then disagrees with itself. Wait for the camera to
    // actually stop moving instead.
    await new Promise((r) => setTimeout(r, 260));
    await cdp.evaluate(`(async () => {
      const h = window.__hunt;
      let prev = h.camera.position.clone();
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = h.camera.position;
        if (now.distanceTo(prev) < 0.004) return true;
        prev = now.clone();
      }
      return false;
    })()`);

    // One eval, one instant: hit and prompt describe the same frame, so a
    // reachable object can no longer be reported as "OK but prompt=false".
    const probe = await cdp.evaluate(`(() => {
      const h = window.__hunt;
      const item = h.hiddenItems.getItems().find((i) => i.placement.id === '${item.id}');
      const body = h.player.getPosition();
      const reach = h.player.getPosition().clone();
      reach.y += 1.1;
      const t = h.hiddenItems.findTarget(h.camera, h.camera.position, reach, h.collision);
      return {
        hit: t ? t.placement.id : null,
        bodyToItem: +Math.hypot(body.x - ${cx}, body.y + 1.1 - ${cy}, body.z - ${cz}).toFixed(2),
        camToItem: +h.camera.position.distanceTo(item.centre).toFixed(2),
        prompt: !document.querySelector('#hud-pickup-prompt')?.classList.contains('hidden'),
      };
    })()`);

    tried.push({ angle: +angle.toFixed(2), ...placed, ...probe });

    if (probe.hit === item.id) {
      if (outDir) {
        const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(`${outDir}/${mapId}-${item.id}.png`, Buffer.from(png.data, 'base64'));
      }
      break angleLoop;
    }
    }
  }

  const good = tried.find((t) => t.hit === item.id);
  if (good) pass++;
  rows.push({ id: item.id, name: item.name, centre: item.c, ok: !!good, from: good ?? null });

  console.log(
    `  ${item.id.padEnd(18)} r=${String(item.r).padStart(5)}  ` +
      (good
        ? `OK  body=${good.bodyToItem}m cam=${good.camToItem}m prompt=${good.prompt}`
        : `NOT PICKABLE  (best body=${Math.min(...tried.map((t) => t.bodyToItem))}m)`)
  );
}

console.log(`\n${pass}/${items.length} pickable on ${mapId}`);
fs.writeFileSync(`tmp-pickable-${mapId}.json`, JSON.stringify(rows, null, 2));

await cdp.close();
