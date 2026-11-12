// A portrait of one person in the map, to check the body is whole.
import { launch, waitForGame } from './tmp-cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const map = process.argv[2] ?? 'alpine-and-snow';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${map}`, port: 9546 });
await waitForGame(cdp);
const dir = `${process.env.TEMP}/hunt-shots`;
mkdirSync(dir, { recursive: true });

await cdp.evaluate(`(() => {
  const h = window.__hunt;
  h.game.startNewRound();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 5000));

const info = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  h.game.loop.stop();
  document.getElementById('debug-overlay')?.remove();
  h.game.cutscene.skip(h.camera);
  h.game.endCutscene();

  const p = h.player.getPosition();
  const V = p.constructor;
  const actors = h.npcs?.actors ?? [];
  const near = actors
    .map((a) => ({ a, d: a.unit.getWorldPosition(new V()).distanceTo(p) }))
    .sort((x, y) => x.d - y.d)[0];
  const home = near.a.unit.getWorldPosition(new V());

  h.camera.position.set(home.x + 3.2, home.y + 1.6, home.z + 3.2);
  h.camera.lookAt(new V(home.x, home.y + 0.9, home.z));
  h.camera.updateMatrixWorld(true);
  h.game.render();

  let parts = 0;
  let culled = 0;
  let rootBone = null;
  near.a.unit.traverse((n) => { if (!rootBone && n.isSkinnedMesh) rootBone = n.skeleton.bones[0]; });
  h.game.scene.traverse((o) => {
    if (!o.isSkinnedMesh || o.skeleton?.bones?.[0] !== rootBone) return;
    parts++;
    if (o.frustumCulled) culled++;
  });
  return { distance: +near.d.toFixed(1), parts, culled, home: home.toArray().map((v) => +v.toFixed(1)) };
})()`);
console.log('person', JSON.stringify(info));

const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${dir}/npc-whole.png`, Buffer.from(png.data, 'base64'));
console.log('errors:', cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l)).slice(0, 4));
await cdp.close();
