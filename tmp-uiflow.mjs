// Walks the interface the way a player does: menu -> hunt -> first person ->
// pause -> change map -> back to the menu. Every step asserts the thing the
// player would look at, so a restyle that broke a selector fails here.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await launch({ url: 'http://localhost:1420/?debug=1', port: 9367, width: 1440, height: 900 });
for (let i = 0; i < 200; i++) {
  if (await cdp.evaluate('!!window.__hunt')) break;
  await sleep(250);
}
await sleep(2500);

const shot = async (name) => {
  await sleep(500);
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(name, Buffer.from(png.data, 'base64'));
};
const visible = (sel) =>
  cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return 'MISSING';
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && r.width > 0 ? 'visible' : 'hidden';
  })()`);

const checks = [];
const check = (label, actual, expected) => {
  const ok = actual === expected;
  checks.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (want ${expected})`}`);
};

check('main menu visible', await visible('#main-menu-screen'), 'visible');
check('hud hidden on menu', await visible('#game-hud'), 'hidden');
check('how-to hidden', await visible('#controls-modal'), 'hidden');

await cdp.evaluate(`document.querySelector('#btn-controls').click()`);
check('how-to opens', await visible('#controls-modal'), 'visible');
await shot('flow-1-howto.png');
await cdp.evaluate(`document.querySelector('#btn-close-controls').click()`);
check('how-to closes', await visible('#controls-modal'), 'hidden');

await cdp.evaluate(`document.querySelector('#btn-play').click()`);
await sleep(2500);
check('hud after start', await visible('#game-hud'), 'visible');
check('menu hidden after start', await visible('#main-menu-screen'), 'hidden');
check('objectives rendered', await cdp.evaluate(`document.querySelectorAll('#hud-objectives-list li').length`), 5);
check('counter text', await cdp.evaluate(`document.querySelector('#hud-counter').textContent`), '0 / 5');

// V — first person
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyV', key: 'v', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyV', key: 'v', windowsVirtualKeyCode: 86, nativeVirtualKeyCode: 86 });
await sleep(900);
check('view toggle label', await cdp.evaluate(`document.querySelector('#btn-hud-view').textContent.trim()`), '1P');
await shot('flow-2-firstperson.png');

// Escape -> pause
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(600);
check('pause visible', await visible('#pause-menu-screen'), 'visible');

// Pause -> change map
await cdp.evaluate(`document.querySelector('#btn-pause-map').click()`);
await sleep(600);
check('map picker visible', await visible('#map-select-screen'), 'visible');
check('map cards', await cdp.evaluate(`document.querySelectorAll('.map-card').length`), 21);
const meta = await cdp.evaluate(`document.querySelector('.map-card .map-card-meta').textContent`);
console.log('     card meta:', meta);

await cdp.evaluate(`document.querySelector('.map-card[data-map-id="coral-reef"]').click()`);
// A map build takes as long as it takes on SwiftShader; poll rather than guess.
for (let i = 0; i < 60; i++) {
  if ((await visible('#map-select-screen')) === 'hidden') break;
  await sleep(1000);
}
check('picker closed after pick', await visible('#map-select-screen'), 'hidden');
check('hud back after pick', await visible('#game-hud'), 'visible');
check('brief is the new map', await cdp.evaluate(`document.querySelector('#hud-brief').textContent`).then((t) => t.startsWith('Five things sank here')), true);
await shot('flow-3-coral.png');

// Back to the menu
await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(600);
await cdp.evaluate(`document.querySelector('#btn-pause-menu').click()`);
await sleep(900);
check('menu back', await visible('#main-menu-screen'), 'visible');
check('hud hidden again', await visible('#game-hud'), 'hidden');
check('map label updated', await cdp.evaluate(`document.querySelector('#current-map-name').textContent`), 'Coral Reef');
await shot('flow-4-back.png');

const errs = cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l));
if (errs.length) console.log('console errors:/n' + errs.join('\n'));
console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
await cdp.close();
