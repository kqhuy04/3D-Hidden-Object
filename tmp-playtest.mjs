// End-to-end play test for the hunt, driven by real key events.
//
// The camera is composed by hand (there is no mouse in headless Chrome), but
// everything after that is the real chain: a keydown on window, the input
// controller, the pickup resolver, the round manager and the HUD. If any link is
// broken the counter below stops moving.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';

const mapId = process.argv[2] ?? 'campground-lake';

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9335 });
await waitForGame(cdp);

// Trusted, browser-level key events. A synthetic KeyboardEvent dispatched from
// page script looks identical to the listener but is not the same path the
// player's keyboard takes, so it proves less.
const key = (type, code, keyChar, vk) =>
  cdp.send('Input.dispatchKeyEvent', {
    type,
    code,
    key: keyChar,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });

const state = () =>
  cdp.evaluate(`(() => {
    const h = window.__hunt;
    return {
      found: h.hiddenItems.getFoundCount(),
      total: h.hiddenItems.getItems().length,
      inScene: h.hiddenItems.getItems().filter((i) => i.object.parent).length,
      hud: [...document.querySelectorAll('#hud-objectives-list .objective-item')]
        .map((li) => li.textContent.trim().replace(/\\s+/g, ' ')),
      counter: document.querySelector('#hud-counter')?.textContent,
      timer: document.querySelector('#hud-timer-display')?.textContent,
      prompt: !document.querySelector('#hud-pickup-prompt')?.classList.contains('hidden'),
      hint: document.querySelector('#hud-hint')?.classList.contains('hidden')
        ? null
        : document.querySelector('#hud-hint-text')?.textContent,
      results: !document.querySelector('#results-screen')?.classList.contains('hidden'),
      title: document.querySelector('#results-title')?.textContent,
      summary: document.querySelector('#results-summary')?.textContent,
      feedback: document.querySelector('#feedback-text')?.textContent,
    };
  })()`);

// Start the hunt the way the menu does.
await cdp.evaluate(`(() => {
  const h = window.__hunt;
  h.game.startNewRound();
  if (!h.__origUpdate) h.__origUpdate = h.cameraController.update.bind(h.cameraController);
  return true;
})()`);
await new Promise((r) => setTimeout(r, 500));

console.log('start:', JSON.stringify(await state()));

// --- walk: real W presses, so movement is exercised too --------------------
await key('keyDown', 'KeyW', 'w', 87);
await new Promise((r) => setTimeout(r, 1200));
await key('keyUp', 'KeyW', 'w', 87);

const items = await cdp.evaluate(`window.__hunt.hiddenItems.getItems().map((i) => ({
  id: i.placement.id, name: i.placement.name,
  c: [i.centre.x, i.centre.y, i.centre.z]
}))`);

for (const item of items) {
  const [cx, cy, cz] = item.c;

  // Walk the body up to the object and aim the way a player would. This used to
  // move only the camera, which left the body ten metres away: the pickup
  // resolver measures reach from the body, so every press failed and the run
  // reported "prompt shown, nothing picked up" on objects that were fine.
  await cdp.evaluate(`(() => {
    const h = window.__hunt;
    const stand = h.collision.findSpawn({ x: ${cx}, y: ${cy}, z: ${cz} + 2.2 }, 2.5);
    if (!stand) return false;
    h.player.setPosition(stand.x, stand.y + 0.05, stand.z);
    h.cameraController.targetYaw = Math.atan2(stand.x - ${cx}, stand.z - ${cz});
    h.cameraController.snap(h.player.getPosition(), stand.y);
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 900));

  const before = await state();
  await key('keyDown', 'KeyE', 'e', 69);
  await key('keyUp', 'KeyE', 'e', 69);
  await new Promise((r) => setTimeout(r, 500));
  const after = await state();

  console.log(
    `  E on ${item.id.padEnd(18)} prompt=${before.prompt ? 'yes' : 'no '} ` +
      `found ${before.found}->${after.found} ` +
      `inScene ${before.inScene}->${after.inScene} ` +
      `toast="${(after.feedback ?? '').trim()}"`
  );
}

const won = await state();
console.log('end:', JSON.stringify(won));

// --- the five-minute hint --------------------------------------------------
// Same map, fresh round, clock pushed past the threshold. The hint is revealed
// by the update loop, so this also proves it is wired into the frame, not just
// into a getter.
await cdp.evaluate(`(() => {
  const h = window.__hunt;
  h.game.returnToMainMenu();
  h.game.startNewRound();
  h.game.roundManager.update(301);
  return true;
})()`);
await new Promise((r) => setTimeout(r, 700));
const hinted = await state();
console.log('hint after 5:01:', JSON.stringify({ hint: hinted.hint, timer: hinted.timer }));

const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(`docs/hunt/hint-${mapId}.png`, Buffer.from(png.data, 'base64'));

await cdp.evaluate(`(() => {
  const h = window.__hunt;
  if (h.__origUpdate) h.cameraController.update = h.__origUpdate;
})()`);
await cdp.close();
