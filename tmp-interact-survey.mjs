// Which kit props are worth wiring an interaction to? Scan every prepared map
// for node names that look like a verb, and count them per map.
import { readFileSync, readdirSync } from 'node:fs';

const dir = 'public/assets/maps';
const PATTERNS = {
  animal: /horse|pony|cow|bull|sheep|goat|pig|dog|cat|chicken|hen|rooster|duck|goose|deer|doggo|camel|donkey|llama|penguin|seal|turtle|fish|bird|seagull|fox|wolf/i,
  door: /door|gate|shutter|hatch|lid\b/i,
  cabinet: /cabinet|cupboard|drawer|chest\b|trunk\b|wardrobe|locker|fridge|crate-lid|toolbox/i,
  seat: /chair|bench|stool|sofa|couch|seat\b|armchair|hammock|pew\b/i,
  ride: /bike|bicycle|scooter|skateboard|cart\b|wagon|car\b|truck|boat|canoe|kayak|raft|sled|sledge|surfboard|motorbike|motorcycle|tractor|tram|trolley/i,
  play: /piano|drum|guitar|radio|tv\b|television|juke|speaker|bell\b|gramophone|harp|xylophone|accordion/i,
  lamp: /lamp|lantern|light\b|torch|candle|chandelier|streetlight|sign-neon/i,
  lever: /lever|wheel\b|valve|crank|winch|pump\b|tap\b|faucet|switch|button|antenna|telescope|cannon|fountain/i,
  swing: /swing|seesaw|carousel|roundabout|slide\b|trampoline|spring/i,
  climb: /ladder|stair|rope|climb|scaffold|balcony|roof\b|canopy/i,
};

const rows = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.glb'))) {
  const buf = readFileSync(`${dir}/${file}`);
  let json;
  try {
    json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  } catch {
    continue;
  }
  const nodes = json.nodes ?? [];
  const counts = {};
  const examples = {};
  for (const node of nodes) {
    const name = node.name ?? '';
    if (!name) continue;
    for (const [kind, re] of Object.entries(PATTERNS)) {
      if (!re.test(name)) continue;
      counts[kind] = (counts[kind] ?? 0) + 1;
      if (!examples[kind]) examples[kind] = name;
    }
  }
  rows.push({ map: file.replace('.glb', ''), nodes: nodes.length, counts, examples });
}

rows.sort((a, b) => b.nodes - a.nodes);
for (const row of rows) {
  const parts = Object.entries(row.counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}(${row.examples[k]})`);
  console.log(`${row.map.padEnd(30)} ${String(row.nodes).padStart(6)}  ${parts.join(' ')}`);
}
