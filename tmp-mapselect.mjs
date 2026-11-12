// Map picker end-to-end: open from the main menu, click a card, land in the map.
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';

const from = process.argv[2] || 'campground-lake';
const to = process.argv[3] || 'stadium';
const shotDir = process.argv[4] || 'docs';

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${from}`, port: 9333 });
await waitForGame(cdp);

const state = () => cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.geometry;
  const c = h.player.getController();
  return {
    map: h.game.map.id,
    state: h.game.state,
    parts: g.parts.length,
    terrain: h.collision.getTerrainMeshes().length,
    body: c ? [+c.getPosition().x.toFixed(2), +c.feetY.toFixed(2), +c.getPosition().z.toFixed(2)] : null,
    menuLabel: document.querySelector('#current-map-name')?.textContent ?? null,
    pickerOpen: !document.querySelector('#map-select-screen')?.classList.contains('hidden'),
    hudVisible: !document.querySelector('#game-hud')?.classList.contains('hidden'),
    sceneChildren: h.game.scene.children.length,
    worldChildren: h.game.worldLoader.sceneGroup.children.length,
  };
})()`);

console.log('before:', JSON.stringify(await state()));

// 1. Open the picker the way a player does.
await cdp.evaluate(`document.querySelector('#btn-map').click()`);
await new Promise((r) => setTimeout(r, 600));
const opened = await state();
const cards = await cdp.evaluate(`(() => {
  const cards = [...document.querySelectorAll('.map-card')];
  return { count: cards.length, names: cards.map((c) => c.querySelector('.map-card-name').textContent), current: cards.filter((c) => c.classList.contains('is-current')).length };
})()`);
console.log('picker open:', opened.pickerOpen, 'cards:', JSON.stringify(cards));
let shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(`${shotDir}/map-select.png`, Buffer.from(shot.data, 'base64'));

// 2. Pick the target map.
const t0 = Date.now();
await cdp.evaluate(`document.querySelector('[data-map-id="${to}"]').click()`);
for (let i = 0; i < 400; i++) {
  const s = await state();
  if (s.map === to && s.state === 'PLAYING' && !s.pickerOpen) break;
  await new Promise((r) => setTimeout(r, 500));
}
const after = await state();
console.log(`switched in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, JSON.stringify(after));

// 3. Does the new map actually hold the body up, and does it walk?
const walk = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const c = h.player.getController();
  h.game.loop.stop();
  const mk = (x, y) => ({ x, y, length() { return Math.hypot(this.x, this.y); },
    clone() { return mk(this.x, this.y); },
    normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } });
  const ZERO = mk(0, 0);
  c.falling = true; c.fallSpeed = 0;
  let p = c.feetY, s = 0;
  for (let f = 0; f < 500; f++) { c.update(ZERO, 0, 1/60); if (Math.abs(c.feetY - p) < 1e-6 && !c.falling) s++; else s = 0; p = c.feetY; if (s >= 3) break; }
  const home = { x: c.getPosition().x, y: c.feetY, z: c.getPosition().z };
  const out = [];
  for (const [label, wx, wz] of [['+x', 1, 0], ['-z', 0, -1]]) {
    h.player.setPosition(home.x, home.y + 0.4, home.z);
    c.falling = true; c.fallSpeed = 0;
    for (let f = 0; f < 200; f++) { c.update(ZERO, 0, 1/60); if (!c.falling) break; }
    let blocked = 0;
    for (let f = 0; f < 120; f++) {
      const b = { x: c.getPosition().x, z: c.getPosition().z };
      c.update(mk(wx, -wz), 0, 1 / 60);
      if (Math.hypot(c.getPosition().x - b.x, c.getPosition().z - b.z) < 0.002) blocked++;
    }
    out.push({ label, blocked, y: +c.feetY.toFixed(2) });
  }
  h.game.loop.start();
  return { home: [+home.x.toFixed(2), +home.y.toFixed(2), +home.z.toFixed(2)], out };
})()`);
console.log('walk:', JSON.stringify(walk));

await new Promise((r) => setTimeout(r, 2500));
shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(`${shotDir}/map-select-after.png`, Buffer.from(shot.data, 'base64'));

console.log('errors:', cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l)).slice(0, 4));
await cdp.close();
