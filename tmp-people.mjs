import { launch, waitForGame } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=chrome-arcology-transit', port: 9427 });
await waitForGame(cdp);
const out = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const hits = [];
  h.game.scene.traverse((n) => {
    if (!/commuter/i.test(n.name || '')) return;
    const entry = { name: n.name, type: n.type, kids: n.children.length, bones: [] };
    if (n.isSkinnedMesh && n.skeleton) {
      entry.bones = n.skeleton.bones.map((b) => b.name);
    }
    hits.push(entry);
  });
  // one bone hierarchy for the first skinned one
  const first = h.game.scene.getObjectByName(hits.find((x) => x.bones.length)?.name || '');
  let detail = null;
  if (first && first.skeleton) {
    const arm = first.skeleton.bones.find((b) => /^(Left|Right)(Upper)?Arm$/.test(b.name));
    if (arm) {
      first.updateMatrixWorld(true);
      const child = arm.children[0];
      const bp = arm.getWorldPosition(new first.position.constructor());
      const cp = child ? child.getWorldPosition(new first.position.constructor()) : null;
      detail = {
        bone: arm.name,
        child: child ? child.name : null,
        bonePos: [+bp.x.toFixed(2), +bp.y.toFixed(2), +bp.z.toFixed(2)],
        childPos: cp ? [+cp.x.toFixed(2), +cp.y.toFixed(2), +cp.z.toFixed(2)] : null,
        quat: arm.quaternion.toArray().map((v) => +v.toFixed(3)),
      };
    }
  }
  return { count: hits.length, hits: hits.slice(0, 6), detail };
})()`);
console.log(JSON.stringify(out, null, 1).slice(0, 4000));
await cdp.close();
