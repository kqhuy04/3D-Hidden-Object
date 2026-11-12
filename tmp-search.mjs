// Searches the Polyfork catalogue and prints one compact line per hit, so a
// shortlist of candidate "wrong objects" can be built without reading JSON.
//
// Usage: node tmp-search.mjs "fire hydrant" "washing machine" ...
import fs from 'node:fs';

const KEY = process.env.POLYFORK_KEY ?? 'pf_e44a2372179cf2158746f88a7a31c9a94e264723';
const queries = process.argv.slice(2);
const out = {};

for (const q of queries) {
  const url = `https://polyfork.dev/api/assets?q=${encodeURIComponent(q)}&fields=compact&per_page=8&sort=tris`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
  if (!res.ok) {
    console.log(`## ${q}  HTTP ${res.status}`);
    continue;
  }
  const data = await res.json();
  console.log(`## ${q}  (total ${data.total}, coverage ${data.coverage ?? '?'}, strong ${data.strong_matches ?? '?'})`);
  out[q] = [];
  for (const a of data.assets ?? []) {
    const s = a.size_m;
    const dim = s ? `${s.x}x${s.y}x${s.z}` : '?';
    console.log(`   ${a.id.padEnd(34)} ${a.title.slice(0, 28).padEnd(29)} ${String(a.triangles).padStart(5)}t ${dim}`);
    out[q].push({ id: a.id, title: a.title, tris: a.triangles, size: s, kit: a.kit });
  }
}

fs.writeFileSync('tmp-search.json', JSON.stringify(out, null, 2));
