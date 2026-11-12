// Prints the prop vocabulary of one or more maps from their sidecar reports:
// the names a placement can be anchored to, biggest first.
//
// Usage: node tmp-keys.mjs cozy-farm office stadium
import fs from 'node:fs';

const maps = process.argv.slice(2);
for (const id of maps) {
  const r = JSON.parse(fs.readFileSync(`maps/reports/${id}.json`, 'utf8'));
  const keys = (r.keys ?? [])
    .filter((k) => k.maxExtent >= 0.5)
    .sort((a, b) => b.maxExtent - a.maxExtent)
    .slice(0, 28);
  console.log(`\n# ${id}  (${r.totals.objects} objects, ${Math.round(r.totals.triangles / 1000)}k tris)`);
  console.log('  ' + keys.map((k) => `${k.key}[${k.instances}]`).join('  '));
}
