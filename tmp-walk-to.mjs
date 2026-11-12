// Can a player walk from the spawn to each object, uphill, with the real
// controller? The grid flood-fill used by tmp-sweep is one metre per cell, so a
// smooth 40-degree dune reads as a wall even though a capsule can climb it: the
// body moves in 0.1 m sub-steps and only has to clear the step height over its
// own radius. This walks instead of guessing.
//
// Usage: node tmp-walk-to.mjs <map-id> [frames]
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2];
const frames = Number(process.argv[3]) || 900;
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9407 });
await waitForGame(cdp);
await cdp.evaluate('window.__hunt.game.startNewRound()');
await new Promise((r) => setTimeout(r, 500));

const key = async (down) => {
  await cdp.send('Input.dispatchKeyEvent', {
    type: down ? 'keyDown' : 'keyUp',
    code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87,
  });
};

const items = await cdp.evaluate(
  `window.__hunt.hiddenItems.getItems().map((i) => ({
     id: i.placement.id,
     name: i.placement.name,
     c: [+i.centre.x.toFixed(2), +i.centre.y.toFixed(2), +i.centre.z.toFixed(2)],
   }))`
);
const spawn = await cdp.evaluate(
  '(() => { const p = window.__hunt.player.getPosition(); return [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]; })()'
);
console.log(`${mapId} spawn ${JSON.stringify(spawn)}\n`);

// The live loop renders at about one frame a second under SwiftShader, which
// would make this take fifteen minutes and change nothing: the controller only
// needs its delta. Stop it and step the game by hand.
await cdp.evaluate('window.__hunt.game.loop.stop()');

for (const item of items) {
  const [cx, cy, cz] = item.c;

  await cdp.evaluate(`(() => {
    const h = window.__hunt;
    h.player.setPosition(${spawn[0]}, ${spawn[1]} + 0.05, ${spawn[2]});
    h.cameraController.targetYaw = Math.atan2(${cx} - ${spawn[0]}, ${cz} - ${spawn[2]});
    h.cameraController.snap(h.player.getPosition(), ${spawn[1]});
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 120));

  await key(true);
  await new Promise((r) => setTimeout(r, 80));
  const res = await cdp.evaluate(`(() => {
    const h = window.__hunt;
    const g = h.game;
    const start = h.player.getPosition().clone();
    let closest = 1e9;
    let bestY = start.y;
    const samples = [];
    for (let i = 0; i < ${frames}; i++) {
      // Steer, the way a player does: keep the object in front and keep walking.
      // A fixed bearing walks past it, which measures the harness, not the map.
      const p0 = h.player.getPosition();
      h.cameraController.targetYaw = Math.atan2(${cx} - p0.x, ${cz} - p0.z);
      g.update(1 / 60);
      const p = h.player.getPosition();
      const d = Math.hypot(p.x - ${cx}, p.z - ${cz});
      if (d < closest) closest = d;
      if (p.y > bestY) bestY = p.y;
      if (i % 150 === 0) samples.push([+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)]);
    }
    const end = h.player.getPosition();
    return {
      closest: +closest.toFixed(2),
      gainedY: +(bestY - start.y).toFixed(2),
      travelled: +Math.hypot(end.x - start.x, end.z - start.z).toFixed(1),
      endY: +end.y.toFixed(2),
      samples,
    };
  })()`);
  await key(false);

  const reached = res.closest <= 3.2;
  console.log(
    `  ${item.id.padEnd(18)} closest ${String(res.closest).padStart(5)}m  ` +
    `climb +${String(res.gainedY).padStart(5)}m  walked ${String(res.travelled).padStart(5)}m  ` +
    (reached ? 'REACHED' : 'NOT REACHED')
  );
  if (!reached) console.log('      path: ' + res.samples.map((s) => `(${s.join(',')})`).join(' '));
}

await cdp.close();
