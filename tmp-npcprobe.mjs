// How are the kit's people nested in a prepared map?
//
// Before anything can walk, we need the movable unit: the node whose transform
// belongs to one character and to nothing else. A merged scene puts the mesh,
// the armature and the placement group in the same subtree, and moving the
// wrong one drags a fence along with the farmer.
import { launch, waitForGame } from './tmp-cdp.mjs';

const mapId = process.argv[2] ?? 'frontier-town';
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${mapId}`, port: 9462 });
await waitForGame(cdp);

const out = await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.selectMap('${mapId}');
  await h.game.startNewRound();
  h.game.loop.stop();
  const scene = h.sun.sun.parent;

  const HUMAN = ['Hips', 'Spine2', 'LeftForeArm', 'RightUpLeg'];
  const bySkeleton = new Map();
  scene.traverse((o) => {
    if (!o.isSkinnedMesh || !o.skeleton) return;
    const key = o.skeleton;
    if (!bySkeleton.has(key)) bySkeleton.set(key, []);
    bySkeleton.get(key).push(o);
  });

  const rows = [];
  for (const [skeleton, meshes] of bySkeleton) {
    const names = new Set(skeleton.bones.map((b) => b.name));
    const isHuman = HUMAN.every((n) => names.has(n));
    if (!isHuman) continue;

    // Ancestor chain of the first bone, to see where the character ends and
    // the placement group begins.
    const chain = [];
    let node = skeleton.bones[0];
    for (let i = 0; i < 6 && node; i++) {
      let siblings = 0;
      let skinnedBelow = 0;
      const parent = node.parent;
      if (parent) {
        for (const c of parent.children) {
          siblings++;
          c.traverse((n) => { if (n.isSkinnedMesh) skinnedBelow++; });
        }
      }
      chain.push({
        name: node.name || node.type,
        type: node.type,
        siblings,
        skinnedBelow,
      });
      node = parent;
    }

    const world = skeleton.bones[0].getWorldPosition(new (skeleton.bones[0].position.constructor)());
    rows.push({
      meshes: meshes.length,
      bones: skeleton.bones.length,
      chain,
      at: [+world.x.toFixed(1), +world.y.toFixed(1), +world.z.toFixed(1)],
    });
    if (rows.length >= 4) break;
  }

  return { humanoids: rows.length, totalSkeletons: bySkeleton.size, rows };
})()`);

console.log(mapId, JSON.stringify(out, null, 1).slice(0, 4000));
await cdp.close();
