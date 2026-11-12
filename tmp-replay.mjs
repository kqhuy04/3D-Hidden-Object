// Replay / retry / map-switch checks.
//
// The hunt removes objects from the scene as they are found, so the interesting
// question is what happens *after* a win: does PLAY AGAIN put the five back, does
// RETRY, and does switching maps leave the previous map's objects behind?
import { launch, waitForGame } from './tmp-cdp.mjs';

const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9336 });
await waitForGame(cdp);

const key = (type, code, keyChar, vk) =>
  cdp.send('Input.dispatchKeyEvent', {
    type,
    code,
    key: keyChar,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  });

const snap = () =>
  cdp.evaluate(`(() => {
    const h = window.__hunt;
    const vis = (sel) => {
      const el = document.querySelector(sel);
      return !!el && !el.classList.contains('hidden');
    };
    return {
      map: h.game.map.id,
      found: h.hiddenItems.getFoundCount(),
      total: h.hiddenItems.getItems().length,
      inScene: h.hiddenItems.getItems().filter((i) => i.object.parent).length,
      ids: h.hiddenItems.getItems().map((i) => i.placement.id),
      counter: document.querySelector('#hud-counter')?.textContent,
      results: vis('#results-screen'),
      pause: vis('#pause-menu-screen'),
      hint: vis('#hud-hint'),
    };
  })()`);

// Win the map: aim at each object in turn and press E for real.
const win = async () => {
  const items = await cdp.evaluate(`window.__hunt.hiddenItems.getItems().map((i) => ({
    c: [i.centre.x, i.centre.y, i.centre.z]
  }))`);
  for (const item of items) {
    const [cx, cy, cz] = item.c;
    await cdp.evaluate(`(() => {
      const h = window.__hunt;
      h.cameraController.update = () => {};
      const cam = h.camera;
      cam.position.set(${cx}, ${cy} + 1.35, ${cz} + 2.0);
      cam.lookAt(${cx}, ${cy}, ${cz});
      cam.updateMatrixWorld(true);
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 250));
    await key('keyDown', 'KeyE', 'e', 69);
    await key('keyUp', 'KeyE', 'e', 69);
    await new Promise((r) => setTimeout(r, 250));
  }
};

await cdp.evaluate(`(() => {
  const h = window.__hunt;
  h.game.startNewRound();
  if (!h.__origUpdate) h.__origUpdate = h.cameraController.update.bind(h.cameraController);
  return true;
})()`);
await new Promise((r) => setTimeout(r, 400));
console.log('fresh        ', JSON.stringify(await snap()));

await win();
await new Promise((r) => setTimeout(r, 500));
console.log('after win    ', JSON.stringify(await snap()));

// PLAY AGAIN — a real click on the results card.
await cdp.evaluate(`document.querySelector('#btn-results-next').click(); true`);
await new Promise((r) => setTimeout(r, 1500));
console.log('play again   ', JSON.stringify(await snap()));

// Take two objects, then RETRY from the pause menu.
await win();
await cdp.evaluate(`document.querySelector('#btn-results-next').click(); true`);
await new Promise((r) => setTimeout(r, 1500));
const two = await cdp.evaluate(`window.__hunt.hiddenItems.getItems().slice(0, 2).map((i) => ({
  c: [i.centre.x, i.centre.y, i.centre.z]
}))`);
for (const item of two) {
  const [cx, cy, cz] = item.c;
  await cdp.evaluate(`(() => {
    const h = window.__hunt;
    const cam = h.camera;
    cam.position.set(${cx}, ${cy} + 1.35, ${cz} + 2.0);
    cam.lookAt(${cx}, ${cy}, ${cz});
    cam.updateMatrixWorld(true);
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 250));
  await key('keyDown', 'KeyE', 'e', 69);
  await key('keyUp', 'KeyE', 'e', 69);
  await new Promise((r) => setTimeout(r, 250));
}
console.log('two taken    ', JSON.stringify(await snap()));

await key('keyDown', 'Escape', 'Escape', 27);
await key('keyUp', 'Escape', 'Escape', 27);
await new Promise((r) => setTimeout(r, 400));
console.log('paused       ', JSON.stringify(await snap()));

await cdp.evaluate(`document.querySelector('#btn-pause-retry')?.click(); true`);
await new Promise((r) => setTimeout(r, 1500));
console.log('after retry  ', JSON.stringify(await snap()));

// Switch map — the previous map's objects must not survive the swap.
await cdp.evaluate(`window.__hunt.game.selectMap('chronos-hearth'); true`);
// The map itself takes tens of seconds on software rendering, so wait for the
// objects rather than guessing at a delay.
for (let i = 0; i < 90; i++) {
  const ready = await cdp.evaluate(
    `(() => { const h = window.__hunt;
       return h.game.isLoaded === true && h.hiddenItems.getItems().length > 0; })()`
  );
  if (ready) break;
  await new Promise((r) => setTimeout(r, 1000));
}
await new Promise((r) => setTimeout(r, 800));
console.log('map switch   ', JSON.stringify(await snap()));

await cdp.evaluate(`(() => {
  const h = window.__hunt;
  if (h.__origUpdate) h.cameraController.update = h.__origUpdate;
})()`);
await cdp.close();
