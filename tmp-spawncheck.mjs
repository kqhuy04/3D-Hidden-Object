// Spawn resolution for every map, after the level gate in findSpawn.
//
// The gate stops the ring search from accepting ground far below the hint, which
// is what put the Day of the Dead spawn at the foot of its own platform. It runs
// on every map, so every map has to be re-checked: a spawn that used to resolve
// at the hint and now walks six metres sideways is a regression.
//
// Usage: node tmp-spawncheck.mjs [map-id ...]
import { launch, waitForGame } from './tmp-cdp.mjs';

const MAPS = [
  'campground-lake', 'chrome-arcology-transit', 'chronos-hearth', 'construction-site',
  'coral-reef', 'countryside-railway', 'cozy-farm', 'dia-de-muertos', 'frontier-town',
  'hospital', 'japanese-suburban-city-street', 'medieval-village', 'modern-restaurant-cafe',
  'neighborhood-pathways', 'nyc-city', 'office', 'pirate-cove', 'skatepark', 'space-base',
  'stadium', 'symphony-stagecraft',
];
const maps = process.argv.length > 2 ? process.argv.slice(2) : MAPS;

const cdp = await launch({ url: 'about:blank', port: 9415 });
const rows = [];

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
  await new Promise((r) => setTimeout(r, 500));

  const r = await cdp.evaluate(`(() => {
    const h = window.__hunt;
    const col = h.collision;
    const cap = col.getCapsule();
    const p = h.player.getPosition().clone();
    const hint = h.game.map.spawn;
    const ground = col.groundAt(p.x, p.z, p.y);
    // Can it leave? Three half-metre steps in each direction, on the capsule.
    let free = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      let q = p.clone();
      for (let s = 0; s < 3; s++) q = col.moveCapsule(q, { x: Math.sin(a) * 0.5, y: 0, z: Math.cos(a) * 0.5 }, cap, q.y).position;
      if (Math.hypot(q.x - p.x, q.z - p.z) > 0.8) free++;
    }
    return {
      hint: [+hint.x.toFixed(2), +hint.y.toFixed(2), +hint.z.toFixed(2)],
      body: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
      moved: +Math.hypot(p.x - hint.x, p.z - hint.z).toFixed(2),
      drop: +(p.y - hint.y).toFixed(2),
      sink: +(p.y - ground).toFixed(2),
      free,
    };
  })()`);

  const flags = [];
  if (r.free < 3) flags.push(`ONLY ${r.free}/8 DIRECTIONS`);
  if (Math.abs(r.sink) > 0.2) flags.push(`SINK ${r.sink}`);
  if (r.moved > 8) flags.push(`MOVED ${r.moved}m`);
  console.log(
    `${mapId.padEnd(32)} hint ${JSON.stringify(r.hint).padEnd(20)} -> body ${JSON.stringify(r.body).padEnd(20)} ` +
    `moved ${String(r.moved).padStart(5)}m  drop ${String(r.drop).padStart(5)}m  free ${r.free}/8  ` +
    (flags.length ? flags.join(' ') : 'ok')
  );
  rows.push({ mapId, ...r, flags });
}

const bad = rows.filter((r) => r.flags.length);
console.log(`\n${rows.length - bad.length}/${rows.length} clean`);
await cdp.close();
