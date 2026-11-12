// One screenshot per map, from the spawn point, with the weather actually
// advanced (a stopped loop does not draw — `game.render()` is what puts the
// posed frame on the canvas).
import { launch, waitForGame } from './tmp-cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const maps = process.argv.slice(2);
if (maps.length === 0) maps.push('coral-reef', 'alpine-and-snow', 'pirate-cove');

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${maps[0]}`, port: 9461 });
await waitForGame(cdp);

const outDir = `${process.env.TEMP}/hunt-shots`;
mkdirSync(outDir, { recursive: true });

for (const id of maps) {
  const info = await cdp.evaluate(`(async () => {
    const h = window.__hunt;
    await h.game.selectMap('${id}');
    await h.game.startNewRound();
    h.game.loop.stop();
    document.getElementById('debug-overlay')?.remove();

    const cc = h.cameraController;
    const scene = h.sun.sun.parent;
    const p = h.player.getPosition().clone();
    cc.snap(p, p.y);
    // Two seconds of frames: long enough for the weather to be in motion and
    // for the sun to settle on the new map.
    for (let f = 0; f < 120; f++) h.game.update(1 / 60);
    h.game.render();

    return {
      weather: h.atmosphere ? h.atmosphere.getWeather() : null,
      sun: +h.sun.sun.intensity.toFixed(2),
      sunColor: h.sun.sun.color.getHexString(),
      fog: scene.fog ? scene.fog.constructor.name : null,
      sky: scene.background && scene.background.getHexString ? scene.background.getHexString() : null,
      weatherNodes: scene.children.filter((c) => c.name.startsWith('weather-')).map((c) => c.name),
    };
  })()`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${outDir}/w-${id}.png`, Buffer.from(shot.data, 'base64'));
  console.log(id, JSON.stringify(info));
}
console.log('done');
await cdp.close();
