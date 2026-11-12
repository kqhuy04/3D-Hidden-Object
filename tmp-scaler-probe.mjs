import { launch, waitForGame } from './tmp-cdp.mjs';

const cdp = await launch({ url: 'http://localhost:1420/?debug=1&map=chrome-arcology-transit', port: 9453, width: 1280, height: 800 });
await waitForGame(cdp);
await new Promise((r) => setTimeout(r, 1000));
await cdp.evaluate('(async () => { await window.__hunt.game.startNewRound(); return true; })()');
await new Promise((r) => setTimeout(r, 3000));

const probe = await cdp.evaluate(`(() => {
  const q = window.__hunt.quality;
  const keys = Object.keys(q);
  const out = {};
  for (const k of keys) {
    const v = q[k];
    if (typeof v !== 'object') out[k] = v;
  }
  // Call tick by hand and see what it does.
  const before = { scale: q.getScale(), sinceDecision: q.sinceDecision, frameMs: q.frameMs };
  q.tick(80);
  const after1 = { scale: q.getScale(), sinceDecision: q.sinceDecision, frameMs: q.frameMs };
  for (let i = 0; i < 40; i++) q.tick(80);
  const after40 = { scale: q.getScale(), sinceDecision: q.sinceDecision, frameMs: q.frameMs };
  return { fields: out, before, after1, after40 };
})()`);
console.log(JSON.stringify(probe, null, 1));

await cdp.close();
