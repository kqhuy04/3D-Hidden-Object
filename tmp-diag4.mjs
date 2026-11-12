import fs from 'node:fs';
import { launch } from './tools/cdp.mjs';
const log = (s) => fs.appendFileSync('tmp-out.txt', s + '\n');
fs.writeFileSync('tmp-out.txt', '');
const cdp = await launch({ url: 'http://localhost:1420/?debug=1', port: 9492 });
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 6000));
  const st = await cdp.evaluate(`({ prog: (document.getElementById('loading-progress')||{}).textContent, hunt: !!window.__hunt })`).catch((e) => ({ err: String(e).slice(0, 120) }));
  log(`${(i + 1) * 6}s ${JSON.stringify(st)}`);
  if (st.hunt) break;
}
log('console: ' + cdp.consoleLines.join(' | '));
await cdp.close();
