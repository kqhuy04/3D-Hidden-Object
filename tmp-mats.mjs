// What are the materials called in a built map, and do any match the kit's
// night zone names (glass, lamp, window, bulb...)?
import { readFileSync } from 'node:fs';
for (const file of process.argv.slice(2)) {
  const buf = readFileSync(file);
  const gltf = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  const names = (gltf.materials ?? []).map((m) => m.name ?? '');
  const lit = names.filter((n) => /glass|lamp|light|window|bulb|glow|fire|flame|neon|sign/i.test(n));
  console.log(`\n== ${file.split('/').pop()} — ${names.length} materials`);
  console.log('   lit-ish:', lit.length ? [...new Set(lit)].slice(0, 12).join(', ') : '(none)');
  console.log('   sample:', names.slice(0, 8).join(', '));
}
