import { launch } from './tmp-cdp.mjs';
const cdp = await launch({ port: 9471 });
await cdp.send('Page.navigate', { url: 'http://localhost:1420/?debug=1' });
await new Promise((r) => setTimeout(r, 9000));
const info = await cdp.evaluate(`({ href: location.href, ready: document.readyState, htmlLen: document.documentElement.outerHTML.length, root: (document.getElementById('app')||{}).innerHTML?.length ?? -1, hunt: !!window.__hunt })`).catch((e) => ({ err: String(e) }));
console.log(JSON.stringify(info));
console.log('--- console ---');
console.log(cdp.consoleLines.slice(0, 30).join('\n'));
await cdp.close();
