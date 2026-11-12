import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=chrome-arcology-transit', port: 9431 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const node = h.game.scene.getObjectByName('city-commuter');
  let skin = null;
  node.traverse((n) => { if (!skin && n.isSkinnedMesh && n.skeleton) skin = n; });
  if (!skin) return { none: true };
  skin.updateMatrixWorld(true);
  const V = h.camera.position.constructor;
  const rows = [];
  for (const b of skin.skeleton.bones) {
    if (!/Shoulder|Arm|Hand|Spine|Neck|Head|Hips/i.test(b.name)) continue;
    const p = b.getWorldPosition(new V());
    const c = b.children[0] ? b.children[0].getWorldPosition(new V()) : null;
    rows.push({
      name: b.name,
      parent: b.parent ? b.parent.name : '',
      p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
      c: c ? [+c.x.toFixed(2), +c.y.toFixed(2), +c.z.toFixed(2)] : null,
      q: b.quaternion.toArray().map((v) => +v.toFixed(2)),
    });
  }
  return { bones: skin.skeleton.bones.length, rows };
})()`);
console.log(JSON.stringify(out, null, 1).slice(0, 5000));
await cdp.close();
