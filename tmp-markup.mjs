// The rim, the found-caption, and the stars on the map cards.
import { launch, waitForGame } from './tmp-cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const map = process.argv[2] ?? 'frontier-town';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${map}`, port: 9504 });
await waitForGame(cdp);
const dir = `${process.env.TEMP}/hunt-shots`;
mkdirSync(dir, { recursive: true });

const shot = async (file) => {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${dir}/${file}.png`, Buffer.from(png.data, 'base64'));
};

// 1. Stand next to a hidden object and let the real selector pick it.
const select = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  h.game.startNewRound();
  h.game.loop.stop();
  document.getElementById('debug-overlay')?.remove();
  // The establishing shot owns the camera for three seconds; this is about the
  // rim on a prop, so land it first.
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
  for (let i = 0; i < 6 && selected?.item !== item; i++) {
    h.selector.cycle();
    h.game.refreshPickupPrompt();
    selected = h.selector.getSelected();
  }
  h.game.render();

  let hulls = 0;
  let thickness = null;
  item.object.traverse((n) => {
    if (!n.isMesh) return;
    for (const child of n.children) {
      if (child.isMesh && child.material?.uniforms?.thickness) {
        hulls++;
        if (thickness === null) thickness = +child.material.uniforms.thickness.value.toFixed(3);
      }
    }
  });
  return {
    name: item.placement.name,
    selectedIsItem: selected?.item === item,
    outlined: h.outline.getTarget() === item.object,
    hulls,
    thickness,
  };
})()`);
console.log('select', JSON.stringify(select));
await shot('outline-target');

// 2. Take it. The caption should appear under where the object was.
const found = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  // Re-selected in the same tick as the press: a Tab choice only outranks
  // "nearest" for three seconds, and a SwiftShader screenshot takes longer than
  // that, so cycling in an earlier evaluate lands on a decoy instead.
  const item = h.hiddenItems.getItems()[0];
  h.game.refreshPickupPrompt();
  let sel = h.selector.getSelected();
  for (let i = 0; i < 6 && sel?.item !== item; i++) {
    h.selector.cycle();
    h.game.refreshPickupPrompt();
    sel = h.selector.getSelected();
  }
  const picked = sel?.kind ?? null;
  h.game.handlePickup();
  for (let i = 0; i < 40; i++) h.game.update(1 / 60);
  h.game.render();
  const label = h.foundLabel;
  const group = label.group;
  return {
    picked,
    showing: label.isShowing,
    rotationY: group ? +group.rotation.y.toFixed(2) : null,
    position: group ? group.position.toArray().map((v) => +v.toFixed(2)) : null,
    planes: group ? group.children.length : 0,
    foundCount: h.game.roundManager.getFoundCount(),
  };
})()`);
console.log('found', JSON.stringify(found));
await shot('found-label');

// 3. The caption turns: half a second later it is at a different angle.
const spin = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const before = h.foundLabel.group?.rotation.y ?? null;
  for (let i = 0; i < 30; i++) h.game.update(1 / 60);
  h.game.render();
  return {
    from: before === null ? null : +before.toFixed(2),
    to: +(h.foundLabel.group?.rotation.y ?? 0).toFixed(2),
    opacity: h.foundLabel.group?.children[0]?.material.opacity ?? null,
  };
})()`);
console.log('spin', JSON.stringify(spin));
await shot('found-label-turn');

// 4. The picker, with a mix of records so the stars have something to say.
const picker = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const records = {
    'frontier-town': { found: 5, bestSeconds: 214 },
    'cozy-farm': { found: 4, bestSeconds: 301 },
    'nyc-city': { found: 3, bestSeconds: null },
    'office': { found: 1, bestSeconds: null },
    'hospital': { found: 2, bestSeconds: 640 },
  };
  h.game.ui.showMapSelect('${map}', records);
  return [...document.querySelectorAll('.map-card')].map((card) => ({
    id: card.dataset.mapId,
    lit: card.querySelectorAll('.map-star.is-on').length,
    total: card.querySelectorAll('.map-star').length,
    time: card.querySelector('.map-card-time')?.textContent ?? null,
  }));
})()`);
console.log('picker', JSON.stringify(picker));
await new Promise((r) => setTimeout(r, 700));
await shot('picker-stars');

await cdp.close();
