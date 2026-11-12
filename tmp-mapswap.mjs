// Boot, swap maps twice, and report anything the console complained about.
// The lights moved out of the loaded map and into the scene, so a map swap is
// now the interesting case: it must not take the sun with it.
import { launch, waitForGame } from './tmp-cdp.mjs';

const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=cozy-farm', port: 9451, width: 1280, height: 800 });
await waitForGame(cdp);
await new Promise((r) => setTimeout(r, 1500));

const probe = () => cdp.evaluate(`(() => {
  const h = window.__hunt;
  const g = h.game;
  let meshes = 0;
  g.scene.traverse((o) => { if (o.isMesh) meshes++; });
  return {
    map: g.map.id,
    meshes,
    sunInScene: !!g.sun.sun.parent,
    targetInScene: !!g.sun.sun.target.parent,
    ambientInScene: !!g.sun.ambient.parent,
    shadowEnabled: g.renderer.shadowMap.enabled,
    casters: (() => { let n = 0; g.scene.traverse((o) => { if (o.isMesh && o.castShadow) n++; }); return n; })(),
    lightCount: (() => { let n = 0; g.scene.traverse((o) => { if (o.isLight) n++; }); return n; })(),
    loading: !document.querySelector('#map-loading-screen').classList.contains('hidden'),
    menu: !document.querySelector('#main-menu-screen').classList.contains('hidden'),
  };
})()`);

console.log('boot      ', JSON.stringify(await probe()));

for (const id of ['coral-reef', 'chrome-arcology-transit', 'cozy-farm']) {
  await cdp.evaluate(`(async () => { await window.__hunt.game.selectMap(${JSON.stringify(id)}); return true; })()`);
  await new Promise((r) => setTimeout(r, 2500));
  console.log(`after ${id.padEnd(24)}`, JSON.stringify(await probe()));
}

// Any console errors or warnings since boot.
const noisy = cdp.consoleLines
  .filter((l) => /error|warn|exception|failed/i.test(l.text ?? ''))
  .filter((l) => !/collision\]|\[hunt\]|\[load\]|DevTools|Autofill/i.test(l.text ?? ''));
console.log('console noise:', noisy.length);
for (const line of noisy.slice(0, 12)) console.log('  !', line.text);

await cdp.close();
