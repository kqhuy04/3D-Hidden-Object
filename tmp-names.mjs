import fs from 'node:fs';
const s = fs.readFileSync('src/data/hiddenItems.ts', 'utf8');
const blocks = s.split(/\n  '([a-z0-9-]+)': \{/);
for (let i = 1; i < blocks.length; i += 2) {
  const id = blocks[i];
  const body = blocks[i + 1];
  const names = [...body.matchAll(/name:\s*'([^']+)'/g)].map((x) => x[1]);
  console.log(`${id} :: ${names.join(' / ')}`);
}
