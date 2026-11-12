// The production path: no ?debug=1, so no debug overlay and no __hunt handle.
import { launch } from './tmp-cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.join(process.env.TEMP || '/tmp', 'hunt-shots');
fs.mkdirSync(outDir, { recursive: true });

const cdp = await launch({ url: 'http://localhost:1420/?map=medieval-village', port: 9454, width: 1280, height: 800 });
await new Promise((r) => setTimeout(r, 9000));

const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
const file = path.join(outDir, 'prod-menu.png');
fs.writeFileSync(file, Buffer.from(png.data, 'base64'));
console.log('->', file);

const errors = cdp.consoleLines.filter((l) => /error|exception/i.test(l.text ?? ''));
console.log('errors:', errors.length);
for (const e of errors.slice(0, 8)) console.log('  !', e.text);

await cdp.close();
