// Do the kit's people actually walk, and do they stay on the ground?
//
// Drives `game.update` by hand (the live loop under SwiftShader runs at 1-3 fps,
// which says nothing about a 0.85 m/s stroll) and records every actor's world
// position frame by frame.
import { launch, waitForGame } from './tmp-cdp.mjs';

const maps = process.argv.slice(2);
if (maps.length === 0) maps.push('frontier-town', 'cozy-farm', 'coral-reef', 'stadium');

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${maps[0]}`, port: 9463 });
await waitForGame(cdp);

for (const id of maps) {
  const errorsBefore = cdp.consoleLines.filter((l) => /error|warn/i.test(l)).length;

  const out = await cdp.evaluate(`(async () => {
    const h = window.__hunt;
    await h.game.selectMap('${id}');
    await h.game.startNewRound();
    h.game.loop.stop();

    const crowd = h.npcs;
    const count = crowd.count;
    if (count === 0) return { map: '${id}', count: 0 };

    const start = crowd.positions();
    const home = start.map((p) => p.clone());
    let maxFromHome = 0;
    let worstGround = 0;
    let moved = 0;
    let talkingFrames = 0;
    const speeds = start.map(() => 0);

    for (let f = 0; f < 900; f++) {          // 15 s at 60 Hz
      h.game.update(1 / 60);
      const now = crowd.positions();
      for (let i = 0; i < now.length; i++) {
        const p = now[i];
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
          return { map: '${id}', count, nan: i };
        }
        const ground = h.collision.groundAt(p.x, p.z, p.y);
        worstGround = Math.max(worstGround, Math.abs(p.y - ground));
        maxFromHome = Math.max(maxFromHome, p.distanceTo(home[i]));
      }
    }

    const end = crowd.positions();
    for (let i = 0; i < end.length; i++) {
      const travelled = end[i].distanceTo(start[i]);
      if (travelled > 0.4) moved++;
      speeds[i] = +travelled.toFixed(2);
    }

    return {
      map: '${id}',
      count,
      moved,
      travelled: speeds,
      maxFromHome: +maxFromHome.toFixed(2),
      worstGroundGap: +worstGround.toFixed(3),
    };
  })()`);

  const errorsAfter = cdp.consoleLines.filter((l) => /error|warn/i.test(l)).length;
  if (errorsAfter > errorsBefore) console.log(cdp.consoleLines.slice(-6).join(' | '));
  console.log(JSON.stringify(out), `console=${errorsAfter - errorsBefore}`);
}

await cdp.close();
