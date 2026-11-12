import { launch } from './tmp-cdp.mjs';
const cdp = await launch({ url: 'http://localhost:1420/?debug=1', port: 9470 });
await new Promise((r) => setTimeout(r, 12000));
const state = await cdp.evaluate(`({ hunt: !!window.__hunt, anim: !!(window.__hunt && window.__hunt.player.getAnimator()), body: document.body.innerText.slice(0,120) })`).catch((e) => ({ err: String(e) }));
console.log(JSON.stringify(state));
console.log('--- console ---');
console.log(cdp.consoleLines.slice(0, 40).join('\n'));
await cdp.close();
