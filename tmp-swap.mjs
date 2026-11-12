// Where does the second go when you press "next"?
//
// Clicks the arrow four times — two unseen characters, then back to one already
// seen — and prints the `[stage]` timing line each swap emits. The headless GPU
// is software, so the absolute numbers are not a desktop's; the split between
// GLB load and clip build is.
//
// Usage: node tmp-swap.mjs
import { launch } from './tmp-cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = await launch({ url: 'http://localhost:1420/', port: 9351, width: 1440, height: 860 });

for (let i = 0; i < 400; i++) {
  const ready = await cdp.evaluate(
    `!!document.querySelector('.char-stage-canvas') && !document.querySelector('#loading-screen')`
  );
  if (ready) break;
  await sleep(250);
}
await sleep(2500);

for (let i = 0; i < 5; i++) {
  await cdp.evaluate(`document.querySelector('#btn-char-next').click(), true`);
  await sleep(2000);
}
// Back to one already seen: the last one but one.
for (let i = 0; i < 2; i++) {
  await cdp.evaluate(`document.querySelector('#btn-char-prev').click(), true`);
  await sleep(2000);
}

console.log(
  cdp.consoleLines.filter((l) => l.includes('[stage]')).join('\n') || '(no [stage] lines)'
);
const errors = cdp.consoleLines.filter((l) => /error|EXCEPTION/i.test(l));
console.log('console errors:', errors.length ? errors.slice(0, 4) : 'none');
await cdp.close();
