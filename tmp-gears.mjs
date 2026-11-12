// What the three gears actually feel like: ground speed, clip, playback rate.
//
// Driven through Game.update at a fixed 60 Hz (see tmp-crawl3.mjs for why the
// live loop cannot be trusted on SwiftShader).
import { launch, waitForGame } from './tmp-cdp.mjs';

const KEYS = {
  KeyW: { key: 'w', vk: 87 },
  KeyC: { key: 'c', vk: 67 },
  ShiftLeft: { key: 'Shift', vk: 16 },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9365 });
await waitForGame(cdp);
await cdp.evaluate('window.__hunt.game.loop.stop()');

const key = async (code, down) => {
  const k = KEYS[code];
  await cdp.send('Input.dispatchKeyEvent', {
    type: down ? 'keyDown' : 'keyUp', code, key: k.key,
    windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk,
  });
};

const run = (frames) =>
  cdp.evaluate(`(() => {
    const h = window.__hunt;
    const g = h.game;
    const c = h.player.getController();
    const a = h.player.getAnimator();
    const p0 = h.player.getPosition().clone();
    for (let i = 0; i < ${frames}; i++) g.update(1 / 60);
    const p1 = h.player.getPosition();
    const cur = a.currentAction;
    return {
      speed: +(p0.distanceTo(p1) / (${frames} / 60)).toFixed(2),
      clip: cur ? cur.getClip().name : null,
      rate: cur ? +cur.getEffectiveTimeScale().toFixed(2) : null,
      gait: c.getGait(),
    };
  })()`);

await cdp.evaluate('window.__hunt.game.startNewRound()');
await sleep(600);

await key('KeyW', true);
await sleep(120);
console.log('walk ', JSON.stringify(await run(60)));

await key('ShiftLeft', true);
await key('ShiftLeft', false);
await sleep(120);
console.log('run  ', JSON.stringify(await run(60)));

await key('ShiftLeft', true);
await key('ShiftLeft', false);
await key('KeyC', true);
await key('KeyC', false);
await sleep(120);
console.log('crawl', JSON.stringify(await run(60)));
await key('KeyW', false);
await cdp.close();
