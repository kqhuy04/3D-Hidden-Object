// Left click on the world picks up, and a drag does not.
import { launch, waitForGame } from './tmp-cdp.mjs';

const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9339 });
await waitForGame(cdp);
await cdp.evaluate(`(() => { window.__hunt.game.startNewRound(); return true; })()`);
await new Promise((r) => setTimeout(r, 600));

const stand = async (id) => {
  await cdp.evaluate(`(() => {
    const h = window.__hunt;
    const item = h.hiddenItems.getItems().find((i) => i.placement.id === '${id}');
    const c = item.centre;
    const sx = c.x, sz = c.z + 1.5;
    const ground = h.collision.getGroundHeight(sx, sz);
    h.player.setPosition(sx, ground + 0.05, sz);
    h.cameraController.snap(h.player.getPosition(), ground);
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 600));
};

const found = () => cdp.evaluate('window.__hunt.hiddenItems.getFoundCount()');

const click = async (x, y) => {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
};

// A drag of 200 px, the way a player orbits the camera. Must not pick anything up.
await stand('camp-toaster');
const before = await found();
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 400, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 10; i++) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640 + i * 20, y: 400, button: 'left', buttons: 1 });
}
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 840, y: 400, button: 'left', buttons: 0, clickCount: 1 });
await new Promise((r) => setTimeout(r, 300));
const afterDrag = await found();
console.log(`drag  : found ${before} -> ${afterDrag}  ${afterDrag === before ? 'OK (no pickup)' : 'FAIL (picked up on a drag)'}`);

// Now a clean click, back at the object.
await stand('camp-toaster');
await click(640, 400);
await new Promise((r) => setTimeout(r, 400));
const afterClick = await found();
console.log(`click : found ${afterDrag} -> ${afterClick}  ${afterClick === afterDrag + 1 ? 'OK' : 'FAIL'}`);

await cdp.close();
