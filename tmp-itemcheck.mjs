// Is every object actually resting on something?
//
// A hidden object that floats a metre above the floor is the kind of thing a
// player notices immediately and cannot unsee: the whole premise is that these
// things were left here by someone. The bounding box says where the object ends;
// the collision geometry says where the surface is. The difference should be a
// couple of centimetres.
//
// Usage: node tmp-itemcheck.mjs [map-id ...]
import { launch } from './tmp-cdp.mjs';

const MAPS = [
  'campground-lake', 'chrome-arcology-transit', 'chronos-hearth', 'construction-site',
  'coral-reef', 'countryside-railway', 'cozy-farm', 'dia-de-muertos', 'frontier-town',
  'hospital', 'japanese-suburban-city-street', 'medieval-village', 'modern-restaurant-cafe',
  'neighborhood-pathways', 'nyc-city', 'office', 'pirate-cove', 'skatepark', 'space-base',
  'stadium', 'symphony-stagecraft',
];
const maps = process.argv.length > 2 ? process.argv.slice(2) : MAPS;

const cdp = await launch({ url: 'about:blank', port: 9417 });
let bad = 0;
let total = 0;

for (const mapId of maps) {
  await cdp.send('Page.navigate', { url: `http://localhost:1420/?debug=1&map=${mapId}` });
  for (let i = 0; i < 300; i++) {
    const ready = await cdp
      .evaluate(`!!window.__hunt && window.__hunt.game.map?.id === ${JSON.stringify(mapId)}`)
      .catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await cdp.evaluate('window.__hunt.game.startNewRound()');
  await new Promise((r) => setTimeout(r, 400));

  const items = await cdp.evaluate(`(() => {
    const h = window.__hunt;
    const col = h.collision;
    const bounds = h.hiddenItems.getBounds();
    return h.hiddenItems.getItems().map((it, n) => {
      const b = bounds[n];
      const c = it.centre;
      // groundAt, not supportHeight: the latter is private and takes a capsule,
      // so passing a step height there yields NaN and every answer becomes the
      // highest roof in the map.
      const ground = col.groundAt(c.x, c.z, b.min.y + 0.05);
      return {
        id: it.placement.id,
        name: it.placement.name,
        minY: +b.min.y.toFixed(2),
        maxY: +b.max.y.toFixed(2),
        ground: Number.isFinite(ground) ? +ground.toFixed(2) : null,
        gap: Number.isFinite(ground) ? +(b.min.y - ground).toFixed(2) : null,
      };
    });
  })()`);

  const problems = [];
  for (const it of items) {
    total++;
    if (it.ground === null) {
      problems.push(`${it.id}: NO SURFACE UNDER IT`);
    } else if (it.gap > 0.25) {
      problems.push(`${it.id}: floats ${it.gap} m (bottom ${it.minY}, surface ${it.ground})`);
    } else if (it.gap < -0.45) {
      problems.push(`${it.id}: sunk ${Math.abs(it.gap)} m into the surface`);
    }
  }
  if (problems.length) {
    bad += problems.length;
    console.log(`${mapId}:`);
    for (const p of problems) console.log('   ' + p);
  }
}

console.log(`\n${total - bad}/${total} objects sit on a surface`);
await cdp.close();
