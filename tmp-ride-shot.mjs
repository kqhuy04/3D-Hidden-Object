// Get on the horse, drive it, and photograph it from the side at three points
// in the stride.
import { launch, waitForGame } from './tmp-cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const map = process.argv[2] ?? 'frontier-town';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${map}`, port: 9492 });
await waitForGame(cdp);
const dir = `${process.env.TEMP}/hunt-shots`;
mkdirSync(dir, { recursive: true });

const setup = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  const V3 = h.player.getPosition().constructor;
  await h.game.selectMap('${map}');
  await h.game.startNewRound();
  h.game.loop.stop();
  document.getElementById('debug-overlay')?.remove();

  const m = h.mounts.mounts[0];
  const p = m.unit.getWorldPosition(new V3());
  h.player.setPosition(p.x + 1.4, p.y, p.z + 1.4);
  for (let f = 0; f < 4; f++) h.game.update(1 / 60);
  // Hide the other animals: three horses standing on the same patch of sand
  // make it impossible to see the one being ridden.
  h.mounts.mounts.slice(1).forEach((o) => { o.unit.visible = false; });
  h.mounts.actions[0].use();
  h.game.input.getMovementVector = () => ({ x: 0, y: 1, length: () => 1 });
  for (let f = 0; f < 45; f++) h.game.update(1 / 60);
  return { riding: h.mounts.isRiding(), yaw: +m.yaw.toFixed(2) };
})()`);
console.log('setup', JSON.stringify(setup));

for (let i = 0; i < 3; i++) {
  const info = await cdp.evaluate(`(() => {
    const h = window.__hunt;
    const V3 = h.player.getPosition().constructor;
    const m = h.mounts.mounts[0];
    for (let f = 0; f < 7; f++) h.game.update(1 / 60);
    const p = m.unit.getWorldPosition(new V3());
    // Square on to the animal's left side, a little above its back.
    const rx = Math.cos(m.yaw), rz = -Math.sin(m.yaw);
    h.camera.position.set(p.x + rx * 3.4, p.y + 1.6, p.z + rz * 3.4);
    h.camera.lookAt(p.x, p.y + 1.2, p.z);
    h.game.render();
    const rider = h.player.getPosition();
    return {
      horse: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
      rider: [+rider.x.toFixed(2), +rider.y.toFixed(2), +rider.z.toFixed(2)],
      clip: h.player.getAnimator().getCurrentActionName(),
    };
  })()`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${dir}/ride-stride-${i}.png`, Buffer.from(shot.data, 'base64'));
  console.log(i, JSON.stringify(info));
}
await cdp.close();
