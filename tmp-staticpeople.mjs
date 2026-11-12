// Do the two quiet maps have *static* people the crowd cannot rig?
import { launch, waitForGame } from './tmp-cdp.mjs';

const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=chronos-hearth', port: 9500 });
await waitForGame(cdp);

for (const id of ['chronos-hearth', 'japanese-suburban-city-street']) {
  const row = await cdp.evaluate(`(async () => {
    const h = window.__hunt;
    if (h.game.map.id !== '${id}') await h.game.selectMap('${id}');
    h.game.loop.stop();
    const root = h.game.worldGroup;
    let skinned = 0;
    const names = new Map();
    root.traverse((n) => {
      const m = n;
      if (m.isSkinnedMesh) skinned++;
      if (!n.name) return;
      if (!/person|people|man\\b|woman|citizen|human|character|figure|kid|child|crowd|npc|villager|worker|patron|guest|student/i.test(n.name)) return;
      const key = n.name.replace(/_\\d+$/, '');
      const entry = names.get(key) ?? { count: 0, skinned: 0 };
      entry.count++;
      if (m.isSkinnedMesh) entry.skinned++;
      names.set(key, entry);
    });
    return { skinnedMeshes: skinned, candidates: [...names.entries()].slice(0, 12) };
  })()`);
  console.log(id, JSON.stringify(row));
}

await cdp.close();
