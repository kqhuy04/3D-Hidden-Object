// Same question, but through the game's own update path.
//
// tmp-crawl2 showed the controller moves a crawling body 1.8 m in 60 frames, so
// the physics is fine. What it could not show is the frame-to-frame behaviour of
// the live loop: SwiftShader renders at 1.5 fps and `GameLoop` clamps delta to
// 0.1 s, so 400 ms of real time is often *zero* frames and every "it did not
// react" reading is really "it was never asked". This drives `Game.update`
// itself at a fixed 60 Hz, which is the frame rate a player has.
//
// Usage: node tmp-crawl3.mjs [map]
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'campground-lake';
const KEYS = {
  KeyC: { key: 'c', vk: 67 },
  KeyW: { key: 'w', vk: 87 },
  ShiftLeft: { key: 'Shift', vk: 16 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9353 });
await waitForGame(cdp);

// The live loop would fight the manual one; park it.
await cdp.evaluate('window.__hunt.game.loop.stop()');

const key = async (code, down) => {
  const k = KEYS[code];
  await cdp.send('Input.dispatchKeyEvent', {
    type: down ? 'keyDown' : 'keyUp',
    code,
    key: k.key,
    windowsVirtualKeyCode: k.vk,
    nativeVirtualKeyCode: k.vk,
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
    const crawl = a?.actions?.get?.('Crawl') ?? null;
    return {
      moved: +p0.distanceTo(p1).toFixed(3),
      pos: [+p1.x.toFixed(2), +p1.y.toFixed(2), +p1.z.toFixed(2)],
      input: [+g.input.getMovementVector().x.toFixed(2), +g.input.getMovementVector().y.toFixed(2)],
      crawling: c.isCrawling(),
      gait: c.getGait(),
      clip: crawl ? { paused: crawl.paused, t: +crawl.time.toFixed(2) } : null,
      state: g.state,
    };
  })()`);

await cdp.evaluate('window.__hunt.game.startNewRound()');
await sleep(600);
console.log('idle      ', JSON.stringify(await run(30)));

await key('KeyW', true);
await sleep(120);
console.log('W held    ', JSON.stringify(await run(60)));

await key('KeyC', true);
await key('KeyC', false);
await sleep(120);
console.log('C pressed ', JSON.stringify(await run(4)));
console.log('crawl+W   ', JSON.stringify(await run(60)));
console.log('crawl+W   ', JSON.stringify(await run(60)));

await key('KeyW', false);
await sleep(120);
console.log('W up      ', JSON.stringify(await run(30)));

await key('KeyC', true);
await key('KeyC', false);
await sleep(120);
console.log('C again   ', JSON.stringify(await run(30)));

await key('ShiftLeft', true);
await key('ShiftLeft', false);
await sleep(120);
await key('KeyW', true);
await sleep(120);
console.log('run       ', JSON.stringify(await run(60)));
await key('KeyW', false);

const errs = cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l));
if (errs.length) console.log('console errors:\n' + errs.join('\n'));
await cdp.close();
