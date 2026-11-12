// A look at the kit's people mid-stride, from a normal playing distance.
import { launch, waitForGame } from './tmp-cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const maps = process.argv.slice(2);
if (maps.length === 0) maps.push('frontier-town');

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${maps[0]}`, port: 9469 });
await waitForGame(cdp);
const dir = `${process.env.TEMP}/hunt-shots`;
mkdirSync(dir, { recursive: true });

for (const id of maps) {
  const info = await cdp.evaluate(`(async () => {
    const h = window.__hunt;
    await h.game.selectMap('${id}');
    await h.game.startNewRound();
    h.game.loop.stop();
    document.getElementById('debug-overlay')?.remove();

    // Let them get moving before looking.
    for (let f = 0; f < 240; f++) h.game.update(1 / 60);

    const crowd = h.npcs;
    const all = crowd.positions();
    if (all.length === 0) return { count: 0 };

    // Stand back from the first one and look at them.
    const target = all[0];
    const cc = h.cameraController;
    const px = target.x + 2.6;
    const pz = target.z + 2.6;
    const ground = h.collision.groundAt(px, pz, target.y);
    h.player.setPosition(px, ground + 0.05, pz);
    const yaw = Math.atan2(target.x - px, target.z - pz);
    cc.targetYaw = yaw; cc.currentYaw = yaw;
    cc.targetPitch = 0.12; cc.currentPitch = 0.12;
    cc.targetDistance = 5.5; cc.currentDistance = 5.5;
    cc.snap(h.player.getPosition(), ground);

    for (let f = 0; f < 90; f++) h.game.update(1 / 60);

    // Photo camera, not the gameplay boom: the point is to inspect the pose,
    // and the boom puts the player's back between the lens and the subject.
    const cam = h.camera;
    cam.position.set(target.x + 2.2, target.y + 1.5, target.z + 2.2);
    cam.lookAt(target.x, target.y + 0.95, target.z);
    h.game.render();

    return { count: crowd.count, at: [+target.x.toFixed(1), +target.y.toFixed(1), +target.z.toFixed(1)] };
  })()`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${dir}/npc-${id}.png`, Buffer.from(shot.data, 'base64'));
  console.log(id, JSON.stringify(info));
}
await cdp.close();
