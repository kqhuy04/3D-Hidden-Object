import fs from 'node:fs';
import path from 'node:path';
import { launch } from './tools/cdp.mjs';

const out = path.join(process.env.LOCALAPPDATA, 'Temp', 'hunt-shots');
fs.mkdirSync(out, { recursive: true });
const url = 'file:///' + encodeURI(path.resolve('tmp-moods.html').replace(/\\/g, '/'));
const cdp = await launch({ url, port: 9502, width: 1180, height: 900 });
await new Promise((r) => setTimeout(r, 900));
const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
const file = path.join(out, 'moods.png');
fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
console.log('saved', file);
await cdp.close();
