// Frame one interactive prop and take a before/after shot, plus a checksum of
// the collider that owns it. Manual camera, because the boom camera points at
// the player and the player is not what we are looking at.
import { launch, waitForGame } from './tmp-cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const map = process.argv[2] ?? 'frontier-town';
const want = process.argv[3] ?? 'hinge';
const port = Number(process.argv[4] ?? 9486);
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${map}`, port });
await waitForGame(cdp);
const dir = `${process.env.TEMP}/hunt-shots`;
mkdirSync(dir, { recursive: true });

const pick = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.selectMap('${map}');
  await h.game.startNewRound();
  h.game.loop.stop();
  document.getElementById('debug-overlay')?.remove();
  h.player.getGroup().visible = false;
  const entry = h.interactions.actions.find((a) => a.family === '${want}');
  if (!entry) return { error: 'nothing of that family' };
  return { key: entry.key, name: entry.object.name, centre: entry.centre.toArray(), label: entry.label() };
})()`);
console.log('target', JSON.stringify(pick));
if (pick.error) {
  await cdp.close();
  process.exit(0);
}

const frame = async (file, action) => {
  const info = await cdp.evaluate(`(async () => {
    const h = window.__hunt;
    const entry = h.interactions.actions.find((a) => a.key === '${pick.key}');
    ${action}
    const c = entry.centre;
    // Stand square in front of the panel: a kit door is drawn in its own XY
    // plane, so its local Z is the normal, and that is where a camera has to be.
    const e = entry.object.matrixWorld.elements;
    const n = [e[8], 0, e[10]];
    const len = Math.hypot(n[0], n[2]) || 1;
    n[0] /= len;
    n[2] /= len;
    let cam = null;
    for (const sign of [1, -1, 0.7071, -0.7071]) {
      const x = c.x + n[0] * 3.2 * sign + n[2] * 1.2 * (Math.abs(sign) === 1 ? 0 : 1);
      const z = c.z + n[2] * 3.2 * sign - n[0] * 1.2 * (Math.abs(sign) === 1 ? 0 : 1);
      const y = c.y + 0.6;
      const free = h.collision.findSpawn({ x, y, z }, 1.2);
      if (!free || Math.hypot(free.x - x, free.z - z) > 0.5) continue;
      const blocked = h.collision.getCollisionGeometry()?.raycastSegment(x, y, z, c.x, c.y, c.z);
      if (blocked === null || blocked === undefined) { cam = [x, y, z]; break; }
    }
    if (!cam) cam = [c.x + n[0] * 3.2, c.y + 0.6, c.z + n[2] * 3.2];
    h.camera.position.set(cam[0], cam[1], cam[2]);
    h.camera.lookAt(c.x, c.y, c.z);
    h.game.render();
    window.__cam = cam.map((v) => +v.toFixed(2));
    // Checksum of the collider that owns the prop: a door that swings has to
    // move its triangles, and a bounding box would not notice — the door swings
    // inside the building's own box.
    let owner = null, s = entry.object;
    while (s && !owner) { const p = h.geometry.parts.find((q) => q.node === s); if (p) owner = p; s = s.parent; }
    let sum = 0;
    if (owner) for (let i = 0; i < owner.vertices.length; i += 37) sum += owner.vertices[i];
    return {
      label: entry.label(),
      angle: +entry.angle.toFixed(2),
      part: owner ? owner.name : null,
      tris: owner ? owner.triangles : null,
      sum: +sum.toFixed(2),
      cam: window.__cam,
    };
  })()`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${dir}/${file}.png`, Buffer.from(shot.data, 'base64'));
  console.log(file, JSON.stringify(info));
};

await frame(`look-${want}-before`, `for (let i = 0; i < 20; i++) h.interactions.update(1 / 60);`);
await frame(
  `look-${want}-after`,
  `entry.use(); for (let i = 0; i < 90; i++) h.interactions.update(1 / 60);`
);
await cdp.close();
