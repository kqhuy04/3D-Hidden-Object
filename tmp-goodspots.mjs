// Prints, per map, the spots that are actually usable: a top surface with a
// body-sized gap beside it, or open ground. The first scan listed any flat top
// between knee and chest height, which includes container roofs nobody can
// reach — those came back NOT PICKABLE, and this is the filter that explains it.
//
// Usage: node tmp-goodspots.mjs <map-id> [minD] [maxD]
import fs from 'node:fs';

const mapId = process.argv[2];
const MIN_D = Number(process.argv[3] ?? 8);
const MAX_D = Number(process.argv[4] ?? 34);

const lines = fs.readFileSync(`tmp-spots-${mapId}.txt`, 'utf8').split('\n');
const good = [];
for (const l of lines) {
  const t = /^  T  x\s+(-?[\d.]+)\s+z\s+(-?[\d.]+)\s+top\s+(-?[\d.]+)\s+d\s+([\d.]+).*gap ([\d.]+)/.exec(l);
  if (t) {
    const [, x, z, top, d, gap] = t;
    if (Number(d) < MIN_D || Number(d) > MAX_D) continue;
    if (Number(gap) > 1.5) continue;
    good.push({ kind: 'T', x, z, y: top, d: Number(d), gap: Number(gap) });
    continue;
  }
  const g = /^  G  x\s+(-?[\d.]+)\s+z\s+(-?[\d.]+)\s+y\s+(-?[\d.]+)\s+d\s+([\d.]+)/.exec(l);
  if (g) {
    const [, x, z, y, d] = g;
    if (Number(d) < MIN_D || Number(d) > MAX_D) continue;
    good.push({ kind: 'G', x, z, y, d: Number(d), gap: 0 });
  }
}

good.sort((a, b) => a.d - b.d);
console.log(`# ${mapId}: ${good.length} usable spots`);
for (const s of good) {
  console.log(`  ${s.kind}  x ${String(s.x).padStart(7)}  z ${String(s.z).padStart(7)}  y ${String(s.y).padStart(6)}  d ${String(s.d).padStart(5)}`);
}
