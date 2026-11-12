import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const log = (s) => fs.appendFileSync('tmp-out.txt', s + '\n');
const CHROME = path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1243/chrome-win64/chrome.exe');
log('exe exists: ' + fs.existsSync(CHROME));
const proc = spawn(CHROME, ['--headless=new','--remote-debugging-port=9480','--enable-unsafe-swiftshader','--use-angle=swiftshader','--no-sandbox','--no-first-run','--user-data-dir=' + path.join(process.cwd(),'tmp-chrome-profile'),'about:blank'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch('http://127.0.0.1:9480/json/version');
    if (res.ok) { log('up at try ' + i); up = true; break; }
  } catch (e) { /* retry */ }
  await new Promise((r) => setTimeout(r, 300));
}
log('done up=' + up);
proc.kill();
