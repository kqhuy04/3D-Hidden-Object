// Pause-menu path: CHANGE MAP, Escape returns to pause (not resume), pick works.
import { launch, waitForGame } from './tmp-cdp.mjs';

const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=stadium', port: 9333 });
await waitForGame(cdp);

const snap = () => cdp.evaluate(`(() => {
  const h = window.__hunt;
  const vis = (id) => { const el = document.querySelector(id); return el ? !el.classList.contains('hidden') : false; };
  return { map: h.game.map.id, state: h.game.state,
    pause: vis('#pause-menu-screen'), picker: vis('#map-select-screen'),
    menu: vis('#main-menu-screen'), hud: vis('#game-hud'),
    loading: vis('#map-loading-screen') };
})()`);

const esc = () => cdp.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true })); true`);
const click = (sel) => cdp.evaluate(`document.querySelector('${sel}').click(); true`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await click('#btn-play');
await wait(900);
console.log('1 playing        ', JSON.stringify(await snap()));

await esc();
await wait(500);
console.log('2 escape->pause  ', JSON.stringify(await snap()));

await click('#btn-pause-map');
await wait(500);
console.log('3 pause->picker  ', JSON.stringify(await snap()));

await esc();
await wait(500);
console.log('4 escape->pause  ', JSON.stringify(await snap()));

await click('#btn-pause-map');
await wait(400);
await click('#btn-map-close');
await wait(400);
console.log('5 back->pause    ', JSON.stringify(await snap()));

// Now actually change the map from the pause menu.
await click('#btn-pause-map');
await wait(400);
const t0 = Date.now();
await click('[data-map-id="hospital"]');
for (let i = 0; i < 400; i++) {
  const s = await snap();
  if (s.map === 'hospital' && s.state === 'PLAYING' && !s.picker && !s.loading) break;
  await wait(500);
}
console.log(`6 switched ${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(await snap()));
console.log('errors:', cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l)).slice(0, 4));
await cdp.close();
