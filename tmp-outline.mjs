// Close-up of the outline, so it can be judged rather than assumed.
//
// Places the body beside a prop, aims at it, pulls the boom in to 3.5 m and
// screenshots. Also prints the OutlinePass state, because "the outline is not
// drawn" and "the outline is drawn but the prop is four pixels wide" look the
// same in a full-scene screenshot.
//
// Usage: node tmp-outline.mjs [map-id] [out.png] [edgeStrength]
import { launch, waitForGame } from './tmp-cdp.mjs';
import fs from 'node:fs';

const mapId = process.argv[2] ?? 'campground-lake';
const out = process.argv[3] ?? 'tmp-outline-close.png';
const strength = Number(process.argv[4] ?? 6);

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9399 });
await waitForGame(cdp);
await cdp.evaluate(`(() => { window.__hunt.game.startNewRound(); return true; })()`);
await new Promise((r) => setTimeout(r, 700));

const picked = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const sel = h.game.selector;
  const props = sel.getProps().filter((p) => p.radius > 1.1 && !/fire|stone/i.test(p.name));
  for (const p of props) {
    for (const a of [0, 1.57, 3.14, 4.71]) {
      const sx = p.centre.x + Math.sin(a) * 2.2;
      const sz = p.centre.z + Math.cos(a) * 2.2;
      const g = h.collision.getGroundHeight(sx, sz);
      const spawn = h.collision.findSpawn({ x: sx, y: g + 0.5, z: sz }, 2.5);
      if (!spawn || Math.hypot(spawn.x - sx, spawn.z - sz) > 1.8) continue;
      return {
        name: p.name,
        c: [p.centre.x, p.centre.y, p.centre.z],
        stand: [spawn.x, spawn.y, spawn.z],
        yaw: Math.atan2(spawn.x - p.centre.x, spawn.z - p.centre.z),
      };
    }
  }
  return null;
})()`);

if (!picked) {
  console.log('no prop with a clear standing spot');
  await cdp.close();
  process.exit(1);
}
console.log(`prop ${picked.name} at ${picked.c.join(',')}`);

await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const [cx, cy, cz] = ${JSON.stringify(picked.c)};
  const [sx, sy, sz] = ${JSON.stringify(picked.stand)};
  h.player.setPosition(sx, sy + 0.05, sz);
  h.cameraController.targetDistance = 3.5;
  h.cameraController.currentDistance = 3.5;
  h.cameraController.targetYaw = ${picked.yaw};
  h.cameraController.snap(h.player.getPosition(), sy);
  for (let i = 0; i < 6; i++) {
    const cam = h.camera.position;
    const dx = cx - cam.x, dy = cy - cam.y, dz = cz - cam.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const want = Math.asin(Math.max(-1, Math.min(1, -dy / len)));
    const clamped = Math.max(0.05, Math.min(1.35, want));
    if (Math.abs(clamped - h.cameraController.targetPitch) < 1e-4) break;
    h.cameraController.targetPitch = clamped;
    h.cameraController.snap(h.player.getPosition(), sy);
  }
  if (h.game.highlight) h.game.highlight.outline.edgeStrength = ${strength};
  // The body sits between the camera and the prop — that is what a centred
  // third-person aim means — so hide it for the screenshot. The outline is
  // about the prop, and a character in front of it makes the test ambiguous.
  h.player.getGroup().visible = false;
  return true;
})()`);

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

const state = await cdp.evaluate(`(() => {
  const o = window.__hunt.game.highlight.outline;
  const s = window.__hunt.game.selector.getSelected();
  const obj = o.selectedObjects[0];
  const box = obj ? new (window.__hunt.camera.position.constructor === Object ? Object : Object)() : null;
  let meshes = 0;
  if (obj) obj.traverse((n) => { if (n.isMesh) meshes++; });
  return {
    selected: s ? s.kind + ':' + (s.key.split(':')[1] || '').slice(0, 8) : null,
    outlineObjects: o.selectedObjects.length,
    outlineName: obj ? obj.name : null,
    outlineType: obj ? obj.type : null,
    outlinePos: obj ? [+obj.position.x.toFixed(2), +obj.position.y.toFixed(2), +obj.position.z.toFixed(2)] : null,
    outlineMeshes: meshes,
    visibleColour: o.visibleEdgeColor.getHexString(),
    strength: o.edgeStrength,
    prompt: !document.querySelector('#hud-pickup-prompt').classList.contains('hidden'),
  };
})()`);
console.log(JSON.stringify(state));

const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(out, Buffer.from(png.data, 'base64'));
console.log(`wrote ${out}`);

await cdp.close();
