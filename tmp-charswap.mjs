// Play -> picker -> round, with a character chosen on the start screen.
//
// Choosing the map that is already loaded exercises the path that has no world
// load in it: the branch where the picker closes and the round simply starts.
// That is the branch most likely to be forgotten, because it used to mean "you
// are already here, go back".
//
// Usage: node tmp-charswap.mjs
import { launch, waitForGame } from './tmp-cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await launch({ url: 'http://localhost:1420/?debug=1', port: 9343, width: 1440, height: 860 });
await waitForGame(cdp);
await sleep(1500);

const before = await cdp.evaluate(`({
  id: window.__hunt.characterId,
  h: window.__hunt.characterHeight,
  state: window.__hunt.game.state,
})`);
console.log('at boot:', JSON.stringify(before));

// Page to the third character, then Play, then pick the map we are already in.
await cdp.evaluate(`document.querySelector('#btn-char-next').click(), true`);
await sleep(400);
await cdp.evaluate(`document.querySelector('#btn-char-next').click(), true`);
await sleep(600);
const picked = await cdp.evaluate(`document.querySelector('#char-name').textContent`);
await cdp.evaluate(`document.querySelector('#btn-play').click(), true`);
await sleep(800);

const open = await cdp.evaluate(
  `!document.querySelector('#map-select-screen').classList.contains('hidden')`
);
console.log('picker open after Play:', open, '| picked on screen:', picked);

const currentId = await cdp.evaluate(`window.__hunt.game.map.id`);
await cdp.evaluate(`document.querySelector('[data-map-id="${currentId}"]').click(), true`);
await sleep(4000);

const after = await cdp.evaluate(`({
  id: window.__hunt.characterId,
  h: window.__hunt.characterHeight,
  state: window.__hunt.game.state,
  pickerOpen: !document.querySelector('#map-select-screen').classList.contains('hidden'),
  menuOpen: !document.querySelector('#main-menu-screen').classList.contains('hidden'),
  hudOpen: !document.querySelector('#game-hud').classList.contains('hidden'),
  saved: window.__hunt.save.settings.character,
  bodyPos: window.__hunt.player.getPosition().toArray().map((n) => +n.toFixed(2)),
})`);
console.log('after picking the current map:', JSON.stringify(after));

const errors = cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l));
console.log('console errors:', errors.length ? errors.slice(0, 6) : 'none');

await cdp.close();
