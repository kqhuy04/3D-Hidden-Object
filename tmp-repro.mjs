// Reproduction for "stand next to an object, press E, nothing happens".
//
// Unlike tmp-playtest.mjs this does NOT touch the camera: the player is placed
// next to the object and the real follow camera is allowed to settle where it
// would in play. If the reach test is measured from the camera rather than the
// body, this is where it shows.
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'campground-lake';
const itemId = process.argv[3] ?? 'camp-toaster';

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9336 });
await waitForGame(cdp);

const key = (type, code, keyChar, vk) =>
  cdp.send('Input.dispatchKeyEvent', {
    type, code, key: keyChar,
    windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
  });

await cdp.evaluate(`(() => { window.__hunt.game.startNewRound(); return true; })()`);
await new Promise((r) => setTimeout(r, 600));

const before = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const item = h.hiddenItems.getItems().find((i) => i.placement.id === '${itemId}');
  if (!item) return { error: 'no such item' };

  // Stand 1.2 m away from it, on the ground, facing it.
  const c = item.centre;
  const sx = c.x, sz = c.z + 2.0;
  const ground = h.collision.getGroundHeight(sx, sz);
  const spawn = h.collision.findSpawn({ x: sx, y: ground + 0.5, z: sz }, 3) ?? { x: sx, y: ground, z: sz };
  h.player.setPosition(spawn.x, spawn.y + 0.05, spawn.z);
  // Aim the way a player would: the camera sits on the far side of the body.
  h.cameraController.targetYaw = Math.atan2(spawn.x - c.x, spawn.z - c.z);
  h.cameraController.snap(h.player.getPosition(), spawn.y);
  return { centre: [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)] };
})()`);

// Let a few real frames run so the follow camera settles by itself.
await new Promise((r) => setTimeout(r, 1200));

const probe = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const item = h.hiddenItems.getItems().find((i) => i.placement.id === '${itemId}');
  const camPos = h.camera.position;
  const body = h.player.getPosition();
  const target = h.hiddenItems.findTarget(h.camera, camPos, h.player.getPosition(), h.collision);
  return {
    cameraToItem: +camPos.distanceTo(item.centre).toFixed(2),
    bodyToItem: +body.distanceTo(item.centre).toFixed(2),
    cameraToBody: +camPos.distanceTo(body).toFixed(2),
    target: target ? target.placement.id : null,
    promptShown: !document.querySelector('#hud-pickup-prompt')?.classList.contains('hidden'),
    found: h.hiddenItems.getFoundCount(),
  };
})()`);

await key('keyDown', 'KeyE', 'e', 69);
await key('keyUp', 'KeyE', 'e', 69);
await new Promise((r) => setTimeout(r, 400));

const after = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  return {
    found: h.hiddenItems.getFoundCount(),
    feedback: (document.querySelector('#feedback-text')?.textContent ?? '').trim(),
  };
})()`);

console.log('before :', JSON.stringify(before));
console.log('probe  :', JSON.stringify(probe));
console.log('after E:', JSON.stringify(after));

await cdp.close();
