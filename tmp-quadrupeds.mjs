// Which maps ship a rigged quadruped, and what is it called?
import { readFileSync, readdirSync } from 'node:fs';

const dir = 'public/assets/maps';
for (const file of readdirSync(dir).filter((f) => f.endsWith('.glb'))) {
  const buf = readFileSync(`${dir}/${file}`);
  let g;
  try {
    g = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  } catch {
    continue;
  }
  const nodes = g.nodes ?? [];
  const skins = g.skins ?? [];
  const found = new Map();
  for (const [i, node] of nodes.entries()) {
    if (node.skin === undefined) continue;
    const skin = skins[node.skin];
    if (!skin) continue;
    const names = skin.joints.map((j) => (nodes[j].name ?? '').replace(/_\d+$/, ''));
    const set = new Set(names);
    if (set.has('LeftForeArm')) continue; // humanoid
    if (!names.some((b) => /FrontUpLeg|HindUpLeg/i.test(b))) continue;
    // Owner label: nearest named ancestor
    let p = i;
    let label = node.name;
    for (let d = 0; d < 4 && p !== undefined; d++) {
      const nm = nodes[p]?.name;
      if (nm && !/^(body|mesh|scene|node)/i.test(nm)) label = nm;
      p = nodes.findIndex((n) => (n.children ?? []).includes(p));
    }
    const key = `${label}`;
    const prev = found.get(key);
    if (!prev || names.length > prev.joints) {
      found.set(key, { joints: names.length, legs: names.filter((n) => /UpLeg|ForeLeg|HindLeg/i.test(n)).length });
    }
  }
  if (found.size === 0) continue;
  console.log(
    `${file.replace('.glb', '').padEnd(30)} ` +
      [...found.entries()].map(([k, v]) => `${k}(${v.joints}j)`).join(' ')
  );
}
