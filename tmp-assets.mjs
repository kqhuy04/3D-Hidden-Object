// Catalogue search helper: prints compact rows for a list of queries so the
// item shortlist can be built without opening the website.
const queries = process.argv.slice(2);

for (const q of queries) {
  const r = await fetch(
    `https://polyfork.dev/api/assets?q=${encodeURIComponent(q)}&fields=compact&per_page=6`
  );
  const j = await r.json();
  console.log(`\n### ${q}  (total ${j.total})`);
  for (const a of j.assets ?? []) {
    const s = a.size_m ?? {};
    const size = `${s.x ?? '?'}x${s.y ?? '?'}x${s.z ?? '?'}`;
    console.log(
      `  ${String(a.id).padEnd(36)} ${String(a.triangles).padStart(5)}t ${size.padEnd(17)} ${a.kit ?? '-'}`
    );
  }
}
