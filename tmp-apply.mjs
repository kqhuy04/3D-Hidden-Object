// Writes the coordinates the placement solver found back into the data file.
//
// One pass, id-matched, so nothing else in the file moves.
//
// Usage: node tmp-apply.mjs
import fs from 'node:fs';

const SRC = 'src/data/hiddenItems.ts';
let src = fs.readFileSync(SRC, 'utf8');

const files = fs.readdirSync('.').filter((f) => /^tmp-place-.*\.json$/.test(f));
let applied = 0;

for (const f of files) {
  for (const row of JSON.parse(fs.readFileSync(f, 'utf8'))) {
    const s = row.spot;
    if (!s) continue;
    const x = s.x ?? s[0];
    const y = s.y ?? s[1];
    const z = s.z ?? s[2];
    const re = new RegExp(
      `(id: '${row.id}',[\\s\\S]{0,700}?spot: \\{ x: )(-?[\\d.]+)(, y: )(-?[\\d.]+)(, z: )(-?[\\d.]+)`
    );
    const m = re.exec(src);
    if (!m) {
      console.log(`  MISS ${row.id}`);
      continue;
    }
    const before = `${m[2]}, ${m[4]}, ${m[6]}`;
    const after = `${x}, ${y}, ${z}`;
    src = src.replace(re, `$1${x}$3${y}$5${z}`);
    applied++;
    if (before !== after) console.log(`  ${row.id.padEnd(20)} ${before} -> ${after}`);
  }
}

fs.writeFileSync(SRC, src);
console.log(`\n${applied} spots written to ${SRC}`);
