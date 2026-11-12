// The establishing shot, and asking a local for a hint.
//
// Driven by `Game.update(1/60)` with the loop stopped: SwiftShader renders at
// 1-3 fps, so a three-second descent would take half a minute of wall clock and
// the delta clamp would make the timing a lie.
import { launch, waitForGame } from './tmp-cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const map = process.argv[2] ?? 'frontier-town';
const port = Number(process.argv[3] ?? 9492);
const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${map}`, port });
await waitForGame(cdp);
const dir = `${process.env.TEMP}/hunt-shots`;
mkdirSync(dir, { recursive: true });

const shot = async (file, note) => {
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${dir}/${file}.png`, Buffer.from(png.data, 'base64'));
  if (note) console.log(`  ${file}: ${note}`);
};

const state = () =>
  cdp.evaluate(`(() => {
    const h = window.__hunt;
    const title = document.getElementById('map-title-card');
    const hud = document.getElementById('game-hud');
    return {
      running: h.game.cutscene.isRunning,
      title: title ? (title.classList.contains('hidden') ? 'hidden' : title.className) : 'missing',
      titleName: title?.querySelector('.map-title-name')?.textContent ?? null,
      titleNote: title?.querySelector('.map-title-note')?.textContent ?? null,
      hud: hud ? !hud.classList.contains('hidden') : null,
      camY: +h.camera.position.y.toFixed(2),
      dist: +h.camera.position.distanceTo(h.player.getPosition()).toFixed(2),
      // Which start the collider allowed: distance 0 means "no shot at all".
      start: [+h.game.cutscene.startYaw.toFixed(2), +h.game.cutscene.startPitch.toFixed(2), +h.game.cutscene.startDistance.toFixed(1)],
    };
  })()`);

// 1. Load and start. `startNewRound` starts the shot on frame one. No
//    `selectMap` here: the URL already chose the map, and calling it again
//    starts the round a second time, which ends the shot before it flies.
console.log('load', map);
await cdp.evaluate(`(async () => {
  const h = window.__hunt;
  await h.game.startNewRound();
  h.game.loop.stop();
  document.getElementById('debug-overlay')?.remove();
})()`);
console.log('frame 0', JSON.stringify(await state()));

// 2. A third of a second in: still in the air, caption just up.
await cdp.evaluate(`(() => {
  const h = window.__hunt;
  for (let i = 0; i < 20; i++) h.game.update(1 / 60);
  h.game.render();
})()`);
console.log('frame 20', JSON.stringify(await state()));
await shot('cutscene-early');

// 3. Half way: the lens is falling toward the body.
await cdp.evaluate(`(() => {
  const h = window.__hunt;
  for (let i = 0; i < 70; i++) h.game.update(1 / 60);
  h.game.render();
})()`);
console.log('frame 90', JSON.stringify(await state()));
await shot('cutscene-mid');

// 4. Past the end: the shot has handed over and the dashboard is back.
await cdp.evaluate(`(() => {
  const h = window.__hunt;
  for (let i = 0; i < 100; i++) h.game.update(1 / 60);
  h.game.render();
})()`);
const end = await state();
console.log('frame 190', JSON.stringify(end));
await shot('cutscene-end');

// 5. Ask somebody. The body is placed next to a person the crowd is driving and
//    the camera is snapped the way a spawn snaps it, so what the selector sees
//    is the same view the player would have. The reach rule is "nearest thing
//    wins", and a crate may well be nearer than the person, so the selection is
//    walked with the same call Tab makes until it lands on them.
const ask = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const people = h.npcs.positions();
  if (people.length === 0) return { error: 'no animated people' };
  const talk = h.npcs.actions;
  if (talk.length === 0) return { error: 'nobody to ask' };

  const target = talk[0];
  const centre = target.centre;
  const spot = h.collision.findSpawn({ x: centre.x + 0.9, y: centre.y, z: centre.z + 0.9 }, 2.5);
  if (!spot) return { error: 'nowhere to stand next to them' };
  h.player.setPosition(spot.x, spot.y, spot.z);
  h.cameraController.snap(h.player.getPosition());
  for (let i = 0; i < 3; i++) h.game.update(1 / 60);

  const reachable = h.selector.getCandidates().map((c) => c.key);
  let selected = h.selector.getSelected();
  for (let i = 0; i < 6 && selected && !selected.key.startsWith('talk:'); i++) {
    h.selector.cycle();
    h.game.refreshPickupPrompt();
    selected = h.selector.getSelected();
  }

  const prompt = document.getElementById('hud-pickup-prompt');
  const label = document.getElementById('hud-pickup-label');
  const before = {
    reachable: reachable.length,
    personInReach: reachable.some((k) => k.startsWith('talk:')),
    prompt: prompt ? !prompt.classList.contains('hidden') : null,
    label: label?.textContent ?? null,
    selectedKind: selected?.kind ?? null,
    isTalk: selected ? selected.key.startsWith('talk:') : false,
    distance: selected ? +selected.distance.toFixed(2) : null,
  };

  target.use();
  h.game.update(1 / 60);
  h.game.render();

  const hint = document.getElementById('hud-hint');
  return {
    ...before,
    hintShown: hint ? !hint.classList.contains('hidden') : null,
    hintText: document.getElementById('hud-hint-text')?.textContent ?? null,
  };
})()`);
console.log('ask', JSON.stringify(ask));
await shot('cutscene-ask');

// 6. A second ask must describe a different object; a fifth must say so.
const more = await cdp.evaluate(`(() => {
  const h = window.__hunt;
  const out = [];
  for (let i = 0; i < 5; i++) {
    h.npcs.actions[0].use();
    out.push(document.getElementById('hud-hint-text')?.textContent ?? null);
  }
  return out;
})()`);
console.log('successive hints', JSON.stringify(more, null, 0));

await cdp.close();
