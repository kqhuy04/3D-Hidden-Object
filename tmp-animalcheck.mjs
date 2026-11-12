// Per map: how many rigged humanoids, and which animal-ish nodes exist (and
// whether they are skinned, i.e. animatable at all).
import { readFileSync, readdirSync } from 'node:fs';

const DIR = 'public/assets/maps';
const ANIMAL = /horse|cow|dog|bird|cat|sheep|deer|animal|turtle|fish|gull|seagull|goat|pig|chicken|duck|rabbit|bear|pigeon|parrot|crab/i;

for (const f of readdirSync(DIR).filter((n) => n.endsWith('.glb'))) {
  const buf = readFileSync(`${DIR}/${f}`);
  const gltf = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  const nodes = gltf.nodes ?? [];
  const names = nodes.map((n) => n.name ?? '');
  const humans = names.filter((n) => n === 'LeftForeArm').length;
  const hips = names.filter((n) => n === 'Hips').length;
  const animals = [...new Set(names.filter((n) => ANIMAL.test(n)))];
  const skinnedAnimals = nodes.filter((n, i) => n.skin !== undefined && ANIMAL.test(names[i])).length;
  console.log(
    `${f.replace('.glb', '').padEnd(32)} humans=${String(humans).padStart(2)} hips=${String(hips).padStart(2)} ` +
    `animalNodes=${String(animals.length).padStart(2)} skinnedAnimalNodes=${skinnedAnimals} ${animals.slice(0, 3).join(',')}`
  );
}
