// Does the decoy system work end to end?
//
// 1. every small prop in the map is a candidate
// 2. standing next to one, the prompt appears and something is outlined
// 3. Tab moves the selection
// 4. E on a decoy costs a strike and strikes that prop off
// 5. three strikes end the round
// 6. E on a real object still picks it up
//
// Usage: node tmp-decoys.mjs [map-id]
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'campground-lake';

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9397 });
await waitForGame(cdp);

const errors = [];

await cdp.evaluate(`(() => { window.__hunt.game.startNewRound(); return true; })()`);
await new Promise((r) => setTimeout(r, 700));

const props = await cdp.evaluate(`window.__hunt.game.selector.getProps().length`);
console.log(`decoy props: ${props}`);

const items = await cdp.evaluate(`window.__hunt.hiddenItems.getItems().map((i) => ({
  id: i.placement.id, c: [+i.centre.x.toFixed(2), +i.centre.y.toFixed(2), +i.centre.z.toFixed(2)]
}))`);

// Stand next to a decoy that is reachable, and check the selection.
const setup = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const sel = h.game.selector;
  const props = sel.getProps();
  // Pick a prop with a clear spot next to it.
  for (const p of props) {
    for (const a of [0, 1.57, 3.14, 4.71]) {
      const sx = p.centre.x + Math.sin(a) * 1.6;
      const sz = p.centre.z + Math.cos(a) * 1.6;
      const g = h.collision.getGroundHeight(sx, sz);
      const spawn = h.collision.findSpawn({ x: sx, y: g + 0.5, z: sz }, 2.5);
      if (!spawn) continue;
      if (Math.hypot(spawn.x - sx, spawn.z - sz) > 1.8) continue;
      return { name: p.name, at: [+p.centre.x.toFixed(2), +p.centre.z.toFixed(2)],
               stand: [+spawn.x.toFixed(2), +spawn.y.toFixed(2), +spawn.z.toFixed(2)],
               yaw: Math.atan2(spawn.x - p.centre.x, spawn.z - p.centre.z) };
    }
  }
  return null;
})()`);

if (!setup) {
  console.log('no reachable decoy found — cannot test');
  await cdp.close();
  process.exit(1);
}
console.log(`decoy: ${setup.name} at ${setup.at.join(',')} stand ${setup.stand.join(',')}`);

await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const cx = ${setup.at[0]}, cz = ${setup.at[1]}, cy = ${setup.stand[1]};
  h.player.setPosition(${setup.stand[0]}, ${setup.stand[1]} + 0.05, ${setup.stand[2]});
  h.cameraController.targetYaw = ${setup.yaw};
  h.cameraController.snap(h.player.getPosition(), ${setup.stand[1]});
  // Aim down at the prop the way a player would; a campfire ring on the ground
  // sits below the crosshair at the default pitch.
  for (let i = 0; i < 6; i++) {
    const cam = h.camera.position;
    const dx = cx - cam.x, dy = cy - cam.y, dz = cz - cam.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const want = Math.asin(Math.max(-1, Math.min(1, -dy / len)));
    const clamped = Math.max(0.05, Math.min(1.35, want));
    if (Math.abs(clamped - h.cameraController.targetPitch) < 1e-4) break;
    h.cameraController.targetPitch = clamped;
    h.cameraController.snap(h.player.getPosition(), ${setup.stand[1]});
  }
  return true;
})()`);

// Let the boom settle: its look-at point lerps for about a second, and reading
// the selection mid-ease measures a camera the player never sees.
await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  let prev = h.camera.position.clone();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const now = h.camera.position;
    if (now.distanceTo(prev) < 0.004) return true;
    prev = now.clone();
  }
  return false;
})()`);

const before = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const s = h.game.selector.getSelected();
  return {
    prompt: !document.querySelector('#hud-pickup-prompt').classList.contains('hidden'),
    cycleHint: !document.querySelector('#hud-pickup-cycle').classList.contains('hidden'),
    selectedKind: s ? s.kind : null,
    candidates: h.game.selector.getCandidates().length,
    outlined: h.game.highlight ? true : false,
    outlineCount: h.game.highlight ? h.game.highlight.outline.selectedObjects.length : -1,
    outlineName: h.game.highlight && h.game.highlight.outline.selectedObjects[0]
      ? (h.game.highlight.outline.selectedObjects[0].name || '(group)')
      : null,
  };
})()`);
console.log('selection:', JSON.stringify(before));

if (process.argv[3]) {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync(process.argv[3], Buffer.from(png.data, 'base64'));
  console.log(`wrote ${process.argv[3]}`);
}

// Tab: the selection must change.
const tab = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const before = h.game.selector.getSelected()?.key ?? null;
  h.game.input.triggerCycle();
  const after = h.game.selector.getSelected()?.key ?? null;
  return { before, after, changed: before !== after };
})()`);
console.log('tab:', JSON.stringify(tab));

// E on a decoy: a strike, and the prop leaves the list.
const strike = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const sel = h.game.selector;
  const decoy = sel.getCandidates().find((c) => c.kind === 'decoy');
  if (!decoy) return { error: 'no decoy candidate' };
  sel.selectedKey = decoy.key;
  const key = decoy.key;
  h.game.input.triggerInteract();
  return {
    key,
    kind: decoy.kind,
    strikes: h.game.roundManager.getStrikes(),
    stillCandidate: sel.getCandidates().some((c) => c.key === key),
    status: h.game.roundManager.getStatus(),
    banner: document.querySelector('#feedback-text')?.textContent ?? null,
    pipsSpent: document.querySelectorAll('.strike-pip.spent').length,
  };
})()`);
console.log('E on decoy:', JSON.stringify(strike));

// E on a real object must still pick it up.
const pickup = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const sel = h.game.selector;
  const item = sel.getCandidates().find((c) => c.kind === 'item');
  if (!item) return { error: 'no item candidate' };
  sel.selectedKey = item.key;
  h.game.input.triggerInteract();
  return {
    found: h.hiddenItems.getFoundCount(),
    strikes: h.game.roundManager.getStrikes(),
    banner: document.querySelector('#feedback-text')?.textContent ?? null,
  };
})()`);
console.log('E on real object:', JSON.stringify(pickup));

// Two more wrong guesses must end the round.
const finish = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const sel = h.game.selector;
  for (let i = 0; i < 8 && h.game.roundManager.getStatus() === 'playing'; i++) {
    const decoy = sel.getCandidates().find((c) => c.kind === 'decoy');
    if (!decoy) break;
    sel.selectedKey = decoy.key;
    h.game.input.triggerInteract();
  }
  return {
    strikes: h.game.roundManager.getStrikes(),
    status: h.game.roundManager.getStatus(),
    resultsShown: !document.querySelector('#results-screen')?.classList.contains('hidden'),
    title: document.querySelector('#results-title')?.textContent ?? null,
  };
})()`);
console.log('to three strikes:', JSON.stringify(finish));

const exceptions = cdp.consoleLines.filter((l) => l.startsWith('EXCEPTION'));
console.log(`exceptions: ${exceptions.length}`);
if (exceptions.length) console.log(exceptions.slice(0, 4).join('\n'));

await cdp.close();
