// Does a prepared map still carry rigs? A merged scene.glb that dropped skins
// cannot host animated NPCs without re-adding the character GLBs.
import { readFileSync } from 'node:fs';
for (const file of process.argv.slice(2)) {
  const buf = readFileSync(file);
  const gltf = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  const skins = gltf.skins?.length ?? 0;
  const anims = gltf.animations?.length ?? 0;
  const skinned = (gltf.nodes ?? []).filter((n) => n.skin !== undefined).length;
  const bones = (gltf.nodes ?? []).filter((n) => /Hips|Spine2|LeftForeArm/.test(n.name ?? '')).length;
  console.log(`${file.split('/').pop()}: skins=${skins} animations=${anims} skinnedNodes=${skinned} mixamoBones=${bones}`);
}
