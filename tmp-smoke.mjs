// Real-input smoke test, frame-aware.
//
// Headless Chromium renders this scene through SwiftShader at roughly one frame
// per second, so wall-clock waits are useless: 1.8 s of holding W covers two
// frames, and a 120 ms Space press lands between frames. Everything here waits
// on requestAnimationFrame counts instead, so the assertions mean the same thing
// on a 1 fps software rasteriser as on a 144 Hz desktop.
import { launch, waitForGame } from './tmp-cdp.mjs';

const cdp = await launch({ url: 'http://localhost:1420/?debug=1', port: 9333 });
await waitForGame(cdp);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const frames = (n) => cdp.evaluate(`(async () => {
  await new Promise((res) => {
    let i = 0;
    const tick = () => (++i >= ${n} ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
  return true;
})()`);

const key = (type, code) =>
  cdp.send('Input.dispatchKeyEvent', {
    type,
    code,
    key: code === 'Space' ? ' ' : code.replace('Key', '').toLowerCase(),
    windowsVirtualKeyCode: code === 'Space' ? 32 : code.charCodeAt(3),
  });

const state = () => cdp.evaluate(`(() => {
  const h = window.__hunt, c = h.player.getController();
  return {
    map: h.game.map.id,
    pos: [+c.getPosition().x.toFixed(2), +c.feetY.toFixed(2), +c.getPosition().z.toFixed(2)],
    ground: +c.getGroundY().toFixed(2),
    falling: c.falling,
    picker: !!document.querySelector('#map-select-screen:not(.hidden)'),
    hud: !document.querySelector('#hud')?.classList.contains('hidden'),
  };
})()`);

console.log('after load      ', JSON.stringify(await state()));

await key('keyDown', 'Escape');
await wait(400);
await key('keyUp', 'Escape');
await frames(2);
await cdp.evaluate(`document.querySelector('#btn-pause-map')?.click(); true`);
await wait(600);
await frames(2);
console.log('picker open     ', JSON.stringify(await state()));

await cdp.evaluate(`(() => {
  const card = [...document.querySelectorAll('#map-grid [data-map-id]')]
    .find((el) => el.dataset.mapId === 'japanese-suburban-city-street');
  card.click();
  return true;
})()`);
await wait(6000);
await frames(3);
const afterPick = await state();
console.log('after pick      ', JSON.stringify(afterPick));

// Walk: hold W across eight rendered frames.
const before = await state();
await key('keyDown', 'KeyW');
await frames(8);
await key('keyUp', 'KeyW');
await frames(1);
const walked = await state();
const moved = Math.hypot(walked.pos[0] - before.pos[0], walked.pos[2] - before.pos[2]);
console.log(`W x 8 frames    ${JSON.stringify(walked.pos)}  moved ${moved.toFixed(2)} m`);

// Jump: the latch survives keyup, so a short press still registers.
await key('keyDown', 'Space');
await key('keyUp', 'Space');
let peak = walked.pos[1];
for (let i = 0; i < 14; i++) {
  await frames(1);
  const s = await state();
  peak = Math.max(peak, s.pos[1]);
}
const landed = await state();
console.log(`jump            peak feet ${peak.toFixed(2)} (ground ${landed.ground}), landed ${landed.falling ? 'NO' : 'yes'}`);

// Photo: F goes through input.onCapture -> handleCapturePhoto, which always
// shows a feedback banner (success or "nothing in frame"), so the banner is the
// honest signal that the key reached the system.
await cdp.evaluate(`document.querySelector('#hud-feedback-banner')?.classList.add('hidden'); true`);
await key('keyDown', 'KeyF');
await key('keyUp', 'KeyF');
await frames(3);
const photo = await cdp.evaluate(`(() => {
  const banner = document.querySelector('#hud-feedback-banner');
  const text = document.querySelector('#feedback-text');
  return {
    visible: banner ? !banner.classList.contains('hidden') : null,
    kind: banner ? banner.className.replace('animate-bounce', '').trim() : '',
    message: text ? text.textContent.trim().slice(0, 70) : '',
  };
})()`);
console.log('photo (F)       ', JSON.stringify(photo));

console.log('errors:', cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l)).slice(0, 5));
await cdp.close();
