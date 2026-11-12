// Minimal CDP driver for the headless Chromium at LOCALAPPDATA/ms-playwright.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const CHROME = path.join(
  process.env.LOCALAPPDATA,
  'ms-playwright/chromium-1243/chrome-win64/chrome.exe'
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, url, width = 1280, height = 800 } = {}) {
  const proc = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--window-size=${width},${height}`,
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--no-sandbox',
    '--no-first-run',
    '--disable-gpu-vsync',
    '--user-data-dir=' + path.join(process.cwd(), 'tmp-chrome-profile'),
    'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
      if (res.ok) { target = await res.json(); break; }
    } catch { /* not up yet */ }
    await sleep(150);
  }
  if (!target) throw new Error('chrome did not start');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');

  const consoleLines = [];
  listeners.push((msg) => {
    if (msg.method === 'Log.entryAdded') consoleLines.push(`${msg.params.entry.level}: ${msg.params.entry.text}`);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
      consoleLines.push(`${msg.params.type}: ${text}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') consoleLines.push('EXCEPTION: ' + msg.params.exceptionDetails.text);
  });

  if (url) await send('Page.navigate', { url });

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (res.exceptionDetails) {
      throw new Error('eval failed: ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    }
    return res.result.value;
  };

  // Windows: `proc.kill()` reaps the launcher and leaves every renderer, GPU
  // and utility process behind. Those orphans keep the profile directory
  // locked, so the next launch silently attaches to a browser whose page is
  // already gone and every `Runtime.evaluate` hangs until the timeout. Kill the
  // tree, and kill it on the way out of the process as well.
  const killTree = () => {
    if (proc.killed) return;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try { proc.kill('SIGKILL'); } catch {}
    }
    proc.killed = true;
  };

  const close = async () => {
    try { ws.close(); } catch {}
    killTree();
  };

  process.once('exit', killTree);
  process.once('SIGINT', () => { killTree(); process.exit(130); });
  // SIGTERM too: a harness run that is killed by `timeout` would otherwise
  // leave the browser holding the profile directory, and every later run
  // attaches to a page that no longer exists and hangs.
  process.once('SIGTERM', () => { killTree(); process.exit(143); });

  return { send, evaluate, close, consoleLines, ws };
}

// 480 × 250 ms = two minutes. A map on this machine takes about 37 s to build
// (12 s of GLB processing, 7 s of collision), and the budget has to clear that
// with room for a cold profile — the old 60 s failed on a machine that was
// simply busy, which reads as "the game is broken" rather than "wait longer".
export async function waitForGame(cdp, tries = 480) {
  for (let i = 0; i < tries; i++) {
    const ok = await cdp.evaluate('!!window.__hunt && !!window.__hunt.player.getAnimator()');
    if (ok) return true;
    await sleep(250);
  }
  throw new Error('__hunt never appeared');
}
