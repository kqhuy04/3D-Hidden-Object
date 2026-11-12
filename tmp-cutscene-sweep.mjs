// Which maps can fly the establishing shot, and from where?
//
// The start pose is chosen against the collider, and a map whose spawn is under
// a roof has nowhere to fly from. This says which maps those are, so the
// fallback is a known list rather than a surprise.
import { launch, waitForGame } from './tmp-cdp.mjs';

const MAPS = [
  'campground-lake', 'alpine-and-snow', 'chrome-arcology-transit', 'chronos-hearth',
  'construction-site', 'coral-reef', 'countryside-railway', 'cozy-farm',
  'dia-de-muertos', 'frontier-town', 'hospital', 'japanese-suburban-city-street',
  'medieval-village', 'modern-restaurant-cafe', 'neighborhood-pathways', 'nyc-city',
  'office', 'pirate-cove', 'skatepark', 'space-base', 'stadium', 'symphony-stagecraft',
];

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${MAPS[0]}`, port: 9496 });
await waitForGame(cdp);

let refused = 0;
for (const id of MAPS) {
  const row = await cdp.evaluate(`(async () => {
    const h = window.__hunt;
    // Same-map selectMap already starts a round; asking again would end the
    // shot through the double-start guard and report a false negative.
    if (h.game.map.id !== '${id}') await h.game.selectMap('${id}');
    if (!h.game.cutscene.isRunning) await h.game.startNewRound();
    const c = h.game.cutscene;
    return {
      running: c.isRunning,
      yaw: +c.startYaw.toFixed(2),
      pitch: +c.startPitch.toFixed(2),
      distance: +c.startDistance.toFixed(1),
      spawnY: +h.player.getPosition().y.toFixed(1),
    };
  })()`);
  if (!row.running) refused++;
  console.log(`${id.padEnd(30)} ${row.running ? 'flies' : 'REFUSED'} from ${row.distance}m pitch ${row.pitch} yaw ${row.yaw}`);
}

console.log(`\n${MAPS.length - refused}/${MAPS.length} maps fly the shot, ${refused} refused`);
await cdp.close();
