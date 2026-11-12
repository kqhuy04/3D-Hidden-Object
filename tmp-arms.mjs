// Which props still have their arms out, by name and by place.
//
// The first version climbed to `parent.parent`, which on a kit map is the world
// root, so every skeleton in the scene was reported under one name — including
// the player's, whose arms are moved by a clip and therefore look "horizontal" in
// the rest pose. This one skips the player, names the nearest hyphenated
// ancestor (the kit's prop name), and reports where the prop stands so it can be
// photographed.
//
// Usage: node tmp-arms.mjs <map-id> [map-id ...]
import { launch } from './tmp-cdp.mjs';

const maps = process.argv.slice(2);
const cdp = await launch({ url: 'about:blank', port: 9429 });

for (const mapId of maps) {
  await cdp.send('Page.navigate', { url: `http://localhost:1420/?debug=1&map=${mapId}` });
  for (let i = 0; i < 300; i++) {
    const ready = await cdp
      .evaluate(`!!window.__hunt && window.__hunt.game.map?.id === ${JSON.stringify(mapId)}`)
      .catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 300));

  const found = await cdp.evaluate(`(() => {
    const h = window.__hunt;
    const armRe = /^(Left|Right)(Upper)?Arm(_\\d+)?$/;
    const out = [];
    h.game.scene.traverse((node) => {
      if (!node.isSkinnedMesh || !node.skeleton) return;
      // Skip anything that is part of the player's own rig.
      let p = node;
      while (p) {
        if (/^player/i.test(p.name || '')) return;
        p = p.parent;
      }
      // Nearest ancestor whose name looks like a kit prop name.
      let prop = '(unnamed)', q = node;
      while (q) {
        if (/^[a-z0-9]+(-[a-z0-9]+)+$/i.test(q.name || '')) { prop = q.name; break; }
        q = q.parent;
      }
      let posed = 0, total = 0;
      let anchor = null;
      for (const bone of node.skeleton.bones) {
        if (!armRe.test(bone.name)) continue;
        total++;
        const next = bone.children.find((c) => c.isBone);
        if (!next) continue;
        bone.updateWorldMatrix(true, false);
        next.updateWorldMatrix(true, false);
        const a = bone.getWorldPosition(h.camera.position.clone());
        const b = next.getWorldPosition(h.camera.position.clone());
        if (!anchor) anchor = a;
        const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1;
        if ((b.y - a.y) / len > -0.35) posed++;
      }
      if (posed > 0) {
        out.push({
          prop, posed, total,
          at: anchor ? [+anchor.x.toFixed(1), +anchor.y.toFixed(1), +anchor.z.toFixed(1)] : null,
        });
      }
    });
    return out;
  })()`);

  console.log(`${mapId}: ${found.length} skeletons with arms out`);
  const byProp = new Map();
  for (const f of found) {
    const k = `${f.prop.padEnd(28)} ${JSON.stringify(f.at)}  ${f.posed}/${f.total} arms`;
    byProp.set(k, (byProp.get(k) || 0) + 1);
  }
  for (const [k, n] of byProp) console.log(`   ${k}  x${n}`);
}

await cdp.close();
