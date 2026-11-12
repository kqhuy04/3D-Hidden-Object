// Two maps report `npcs: 0`, which means no hints there — the rule is "ask a
// person". Is the cast missing, or just out of the 45 m radius?
import { launch, waitForGame } from './tmp-cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const dir = `${process.env.TEMP}/hunt-shots`;
mkdirSync(dir, { recursive: true });

const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=frontier-town', port: 9498 });
await waitForGame(cdp);

// 1. The caption without its second line.
await cdp.evaluate(`(() => {
  const h = window.__hunt;
  h.game.startNewRound();
  h.game.loop.stop();
  document.getElementById('debug-overlay')?.remove();
  for (let i = 0; i < 24; i++) h.game.update(1 / 60);
  h.game.render();
})()`);
const card = await cdp.evaluate(`(() => {
  const el = document.getElementById('map-title-card');
  return {
    children: el ? el.children.length : null,
    html: el ? el.innerHTML.replace(/\\s+/g, ' ').trim() : null,
    note: el?.querySelector('.map-title-note') ? 'present' : 'gone',
  };
})()`);
console.log('title card', JSON.stringify(card));
const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(`${dir}/title-nonote.png`, Buffer.from(png.data, 'base64'));

// 2. Who is on the two quiet maps?
for (const id of ['chronos-hearth', 'japanese-suburban-city-street', 'nyc-city']) {
  const row = await cdp.evaluate(`(async () => {
    const h = window.__hunt;
    if (h.game.map.id !== '${id}') await h.game.selectMap('${id}');
    if (!h.game.cutscene.isRunning && h.npcs.count === 0) await h.game.startNewRound();
    h.game.loop.stop();
    const spawn = h.player.getPosition();
    const people = h.npcs.characters;
    const nearest = [...people].map((unit) => {
      const p = unit.getWorldPosition(h.camera.position.clone());
      return +Math.hypot(p.x - spawn.x, p.z - spawn.z).toFixed(1);
    }).sort((a, b) => a - b);
    return {
      peopleInMap: people.size,
      animated: h.npcs.count,
      askable: h.npcs.actions.length,
      nearestPeople: nearest.slice(0, 5),
    };
  })()`);
  console.log(id.padEnd(30), JSON.stringify(row));
}

await cdp.close();
