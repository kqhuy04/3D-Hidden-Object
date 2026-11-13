// Renders one small PNG per fish, for the collection screen.
//
//   node tools/fish-thumbs.mjs
//
// The collection needs a picture of every fish, including the ones the player
// has not caught — those are drawn as a solid black silhouette, which is the
// same image with `filter: brightness(0)` in the stylesheet, so one file per
// species serves both states.
//
// Why not draw them at runtime: the collection opens inside a map, over a live
// WebGL context, and sixteen more models loaded on the frame the player presses
// the key is a stall in the middle of a hunt. Sixteen 128 px PNGs are 200 kB and
// load with the map.
//
// The render happens in the game's own page so it uses the same three.js build
// and the same tone mapping as the catch card; the data URL comes back over CDP
// and is written here.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { launch, waitForGame } from './cdp.mjs';

const SIZE = 192;
const OUT = path.resolve('public/assets/fish/thumbs');
mkdirSync(OUT, { recursive: true });

const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=campground-lake', port: 9695 });
await waitForGame(cdp);
await new Promise((r) => setTimeout(r, 1200));

const result = await cdp.evaluate(`(async () => {
  const THREE = await import('/node_modules/.vite/deps/three.js').catch(() => import('/node_modules/three/build/three.module.js'));
  const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
  const fishing = await import('/src/data/fishing.ts');
  const { clone: cloneSkinned } = await import('/node_modules/three/examples/jsm/utils/SkeletonUtils.js');

  const SIZE = ${SIZE};
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearAlpha(0);

  const scene = new THREE.Scene();
  const key = new THREE.DirectionalLight(0xfff4e2, 2.8);
  key.position.set(3, 4, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd2dcea, 1.4);
  fill.position.set(-3, 0.5, 2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.2);
  rim.position.set(-1, 2, -3);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xfdf8ec, 0x7d7466, 1.0));

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
  const loader = new GLTFLoader();
  const out = [];

  for (const species of fishing.FISH) {
    try {
      const gltf = await loader.loadAsync(species.model);
      const root = cloneSkinned(gltf.scene);
      root.traverse((n) => {
        const m = n;
        if (m.isMesh) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; }
      });
      scene.add(root);

      // Side profile, nose to the right: the model is authored nose-first
      // along +Z, and a camera on +X puts +Z on the right of the frame.
      const box = new THREE.Box3().setFromObject(root);
      const centre = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      root.position.sub(centre);

      // A three-quarter profile, not a flat side: the model is authored
      // nose-first along +Z, and a camera straight down +X turns a stingray
      // into a sliver and a jellyfish into a smear. Twenty degrees of elevation
      // and twenty-five of azimuth keeps the side-on reading and gives every
      // silhouette some depth.
      const extent = Math.max(size.x, size.y, size.z) * 0.62;
      camera.left = -extent;
      camera.right = extent;
      camera.top = extent;
      camera.bottom = -extent;
      camera.position.set(5.2, 1.9, 2.4);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();

      renderer.clear();
      renderer.render(scene, camera);
      out.push({ id: species.id, png: canvas.toDataURL('image/png') });

      scene.remove(root);
    } catch (err) {
      out.push({ id: species.id, error: String(err) });
    }
  }

  renderer.dispose();
  return out;
})()`);

let written = 0;
for (const entry of result) {
  if (entry.error) {
    console.log('FAILED', entry.id, entry.error);
    continue;
  }
  const base64 = entry.png.replace(/^data:image\/png;base64,/, '');
  const file = path.join(OUT, `${entry.id}.png`);
  writeFileSync(file, Buffer.from(base64, 'base64'));
  console.log(path.relative(process.cwd(), file));
  written++;
}
console.log(`${written} thumbnails`);
process.exit(0);
