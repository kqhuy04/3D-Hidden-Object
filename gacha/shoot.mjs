// Drives the gacha game in headless Chromium and captures each state.
// Usage: node gacha/shoot.mjs
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from '../tools/cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, 'shots');
mkdirSync(shots, { recursive: true });

const URL = 'http://127.0.0.1:5180/';
const cdp = await launch({ url: URL, width: 1100, height: 820 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name) {
  const image = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(shots, `${name}.png`), Buffer.from(image.data, 'base64'));
  console.log('shot:', name);
}

async function mouse(type, x, y, buttons = 0) {
  await cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', clickCount: 1, buttons,
  });
}

const phase = () => cdp.evaluate('window.__gacha.phase()');

/**
 * Headless SwiftShader renders at a few frames a second and the delivery runs on
 * a clamped physics step, so a fixed sleep is a coin flip. Poll instead.
 */
async function waitForPhase(target, timeoutMs = 60000) {
  const start = Date.now();
  for (;;) {
    if ((await phase()) === target) return true;
    if (Date.now() - start > timeoutMs) return false;
    await sleep(250);
  }
}

try {
  await sleep(1200);
  // The software renderer needs a moment to fetch and parse the model before
  // the game exposes its test hook.
  for (let i = 0; i < 240; i += 1) {
    if ((await cdp.evaluate('typeof window.__gacha')) === 'object') break;
    await sleep(250);
  }
  await shot('01-boot');
  console.log('state:', await phase());

  // 1. Insert the coin.
  await cdp.evaluate("document.getElementById('btn-coin').click()");
  await waitForPhase('need-press');
  await sleep(400);
  await shot('02-coin-in');

  // 2. Press the start button — a plain click on the dome.
  const button = JSON.parse(await cdp.evaluate('JSON.stringify(window.__gacha.buttonScreen())'));
  console.log('button at', button);
  await mouse('mousePressed', button.x, button.y, 1);
  await sleep(40);
  await mouse('mouseReleased', button.x, button.y, 0);

  // Tweens advance on a clamped clock, so at a few frames a second the hatch
  // opens long after the wall clock says it should. Poll for it, tightly and
  // *before* taking any screenshot: a capture here costs a second or two, and
  // the hatch is only open for about that long.
  let hatch = 0;
  for (let i = 0; i < 300; i += 1) {
    hatch = await cdp.evaluate('window.__gacha.hatch()');
    if (hatch > 1.2) break;
    await sleep(50);
  }
  console.log('hatch open at', hatch.toFixed(2), 'rad');
  await shot('03-hatch-open');

  // 3. Watch the capsule fall out of the arch.
  await sleep(1800);
  await shot('04-dispensed');

  const ok = await waitForPhase('await');
  console.log('reached await:', ok);
  console.log('hatch closed again:', await cdp.evaluate('window.__gacha.hatch().toFixed(2)'));
  await shot('05-landed');

  // 4. Click the capsule where it actually landed.
  const click = await cdp.evaluate(`(() => {
    const g = window.__gacha;
    const p = g.capsule();
    if (!p) return 'no-capsule';
    const v = p.clone().project(g.camera);
    return JSON.stringify({ x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight });
  })()`);
  console.log('capsule at:', click);

  if (click.startsWith('{')) {
    const { x, y } = JSON.parse(click);
    await mouse('mousePressed', x, y, 1);
    await mouse('mouseReleased', x, y, 0);
    // The capsule flies to the middle of the screen and cracks open. The whole
    // choreography runs 0.62 + 0.50 + 0.55 s, but dispatching the click and
    // asking for a frame costs a few hundred milliseconds of its own, so this
    // sleep is short on purpose: 1.6 s lands on the finished reveal, 0.45 s
    // lands on the crack with the creature still in the shell.
    await sleep(450);
    await shot('06-opening');
  }

  // 5. The prize is on screen. Turn it over with the mouse.
  console.log('revealed:', await waitForPhase('revealed'));
  await sleep(600);
  await shot('07-reveal');

  const centre = JSON.parse(await cdp.evaluate('JSON.stringify(window.__gacha.prizeScreen())'));
  await mouse('mousePressed', centre.x, centre.y, 1);
  for (let i = 1; i <= 10; i += 1) {
    await mouse('mouseMoved', centre.x + i * 14, centre.y - i * 6, 1);
    await sleep(40);
  }
  await mouse('mouseReleased', centre.x + 140, centre.y - 60, 0);
  await sleep(400);
  await shot('08-turned');

  // 6. The prize goes home and the next pull starts.
  await cdp.evaluate("document.getElementById('btn-coin').click()");
  console.log('next pull:', await waitForPhase('need-press'));
  await sleep(400);
  await shot('09-home');

  await cdp.evaluate("document.getElementById('btn-collection').click()");
  await sleep(600);
  await shot('10-collection');

  console.log('--- console ---');
  for (const line of cdp.consoleLines) console.log(line);
} finally {
  await cdp.close();
}
