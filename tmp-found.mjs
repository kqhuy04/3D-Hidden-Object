// The find: white rim, the veil, and the object turning on it.
//
// Usage: node tmp-found.mjs [map]
import { launch, waitForGame } from './tmp-cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const map = process.argv[2] ?? 'frontier-town';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${map}`, port: 9530 });
await waitForGame(cdp);
const dir = `${process.env.TEMP}/hunt-shots`;
mkdirSync(dir, { recursive: true });

const shot = async (file) => {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${dir}/${file}.png`, Buffer.from(png.data, 'base64'));
};

// 1. Stand by an object and let the real selector pick it.
const select = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  h.game.startNewRound();
  h.game.loop.stop();
  document.getElementById('debug-overlay')?.remove();
  h.game.cutscene.skip(h.camera);
  h.game.endCutscene();
  const item = h.hiddenItems.getItems()[0];
  if (!item) return { error: 'no items' };

  const spot = h.collision.findSpawn({ x: item.centre.x + 1.2, y: item.centre.y, z: item.centre.z + 1.2 }, 3);
  if (!spot) return { error: 'nowhere to stand' };
  h.player.setPosition(spot.x, spot.y, spot.z);
  h.cameraController.snap(h.player.getPosition());
  for (let i = 0; i < 3; i++) h.game.update(1 / 60);

  let selected = h.selector.getSelected();
  const steps = h.selector.getCandidates().length + 2;
  for (let i = 0; i < steps && selected?.item !== item; i++) {
    h.selector.cycle();
    h.game.refreshPickupPrompt();
    selected = h.selector.getSelected();
  }
  h.game.render();

  let hulls = 0;
  let colour = null;
  item.object.traverse((n) => {
    if (!n.isMesh) return;
    for (const child of n.children) {
      const u = child.material?.uniforms;
      if (child.isMesh && u?.thickness) {
        hulls++;
        if (!colour) colour = '#' + u.color.value.getHexString();
      }
    }
  });
  return { name: item.placement.name, selectedIsItem: selected?.item === item, hulls, colour };
})()`);
console.log('select', JSON.stringify(select));
await shot('rim-white');

// 2. Take it. The veil should come down with the object on it.
const found = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const item = h.hiddenItems.getItems()[0];
  h.game.refreshPickupPrompt();
  let sel = h.selector.getSelected();
  const steps = h.selector.getCandidates().length + 2;
  for (let i = 0; i < steps && sel?.item !== item; i++) {
    h.selector.cycle();
    h.game.refreshPickupPrompt();
    sel = h.selector.getSelected();
  }
  const picked = sel?.kind ?? null;
  h.game.handlePickup();
  for (let i = 0; i < 20; i++) h.game.update(1 / 60);
  h.game.render();

  const screen = h.game.ui.foundScreen;
  const el = screen.getElement();
  const canvas = el.querySelector('canvas');
  const stage = screen.stage;
  return {
    picked,
    showing: screen.isShowing,
    name: el.querySelector('.found-name')?.textContent,
    count: el.querySelector('.found-count')?.textContent,
    title: el.querySelector('.found-title')?.textContent,
    canvas: canvas ? [canvas.width, canvas.height] : null,
    hasObject: !!stage?.object,
    turn: +(stage?.holder?.rotation?.y ?? 0).toFixed(2),
    foundCount: h.hiddenItems.getFoundCount(),
  };
})()`);
console.log('found', JSON.stringify(found));

// The hold is 2.6 s and a SwiftShader screenshot takes longer than that, so the
// screen would be gone before the camera came back. Stop its own clock here and
// drive the exit by hand at the end; the auto-exit is checked separately below.
await cdp.evaluate(`(() => {
  window.__hunt.game.ui.foundScreen.clearTimers();
  return true;
})()`);

// 3. It turns, and it is still sharp while the world behind it is not.
const spinA = await cdp.evaluate(`(() => {
  const stage = window.__hunt.game.ui.foundScreen.stage;
  return { from: +stage.holder.rotation.y.toFixed(2) };
})()`);
await new Promise((r) => setTimeout(r, 700));
const spinB = await cdp.evaluate(`(() => {
  const stage = window.__hunt.game.ui.foundScreen.stage;
  return {
    to: +stage.holder.rotation.y.toFixed(2),
    blur: getComputedStyle(document.getElementById('found-screen')).backdropFilter,
  };
})()`);
console.log('spin', JSON.stringify({ ...spinA, ...spinB }));
await shot('found-screen');

// 4. Closing it frees the object it owned.
const closed = await cdp.evaluate(`(() => {
  const screen = window.__hunt.game.ui.foundScreen;
  screen.hide();
  return {
    showing: screen.isShowing,
    hasObject: !!screen.stage.object,
    foundCount: window.__hunt.hiddenItems.getFoundCount(),
  };
})()`);
console.log('after hide', JSON.stringify(closed));

console.log('errors:', cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l)).slice(0, 6));
await cdp.close();
