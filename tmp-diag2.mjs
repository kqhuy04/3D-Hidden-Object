import fs from 'node:fs';
import { launch } from './tools/cdp.mjs';
const log = (s) => fs.appendFileSync('tmp-out.txt', s + '\n');
fs.writeFileSync('tmp-out.txt', '');
try {
  const cdp = await launch({ url: 'http://localhost:1420/?debug=1', port: 9490 });
  log('launched');
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await cdp.evaluate(`({ href: location.href, ready: document.readyState, bodyLen: document.body.innerHTML.length, hunt: !!window.__hunt })`).catch((e) => ({ err: String(e).slice(0, 200) }));
    log(`${(i + 1) * 5}s ${JSON.stringify(st)}`);
    if (st.hunt) break;
  }
  log('console: ' + cdp.consoleLines.slice(0, 20).join(' | '));
  await cdp.close();
} catch (e) {
  log('THROW ' + (e && e.message));
}
