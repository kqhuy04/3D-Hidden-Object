// All 22 maps in one browser: spawn grounded, body mobile, five objects, no errors.
import { launch, waitForGame } from './tmp-cdp.mjs';

const MAPS = [
  'campground-lake', 'alpine-and-snow', 'chrome-arcology-transit', 'chronos-hearth',
  'construction-site', 'coral-reef', 'countryside-railway', 'cozy-farm',
  'dia-de-muertos', 'frontier-town', 'hospital', 'japanese-suburban-city-street',
  'medieval-village', 'modern-restaurant-cafe', 'neighborhood-pathways', 'nyc-city',
  'office', 'pirate-cove', 'skatepark', 'space-base', 'stadium', 'symphony-stagecraft',
];

const cdp = await launch({ url: `http://localhost:1420/?debug=1&map=${MAPS[0]}`, port: 9449 });
await waitForGame(cdp);

const rows = [];
for (const id of MAPS) {
  const errorsBefore = cdp.consoleLines.filter((l) => /error/i.test(l)).length;
  let row;
  try {
    row = await cdp.evaluate(`(async () => {
      const h = window.__hunt;
      await h.game.selectMap('${id}');
      await h.game.startNewRound();
      const c = h.player.getController();
      const mk = (a, b) => ({ x: a, y: b, length() { return Math.hypot(this.x, this.y); },
        clone() { return mk(this.x, this.y); },
        normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; return this; } });
      h.game.loop.stop();

      const p0 = c.getPosition().clone();
      const ground0 = h.collision.groundAt(p0.x, p0.z, p0.y);
      const spawnGap = +(p0.y - ground0).toFixed(2);

      let minY = Infinity, maxY = -Infinity, nan = false;
      for (let f = 0; f < 120; f++) {
        c.update(mk(0, 1), 0, 1 / 60);
        const p = c.getPosition();
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) nan = true;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const p1 = c.getPosition().clone();
      const travelled = +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2);
      const items = h.hiddenItems.getItems().length;
      h.game.loop.start();
      return {
        spawnGap, travelled, nan,
        yRange: [+minY.toFixed(2), +maxY.toFixed(2)],
        endY: +p1.y.toFixed(2),
        items,
      };
    })()`);
  } catch (err) {
    row = { failed: String(err).slice(0, 80) };
  }
  const errors = cdp.consoleLines.filter((l) => /error/i.test(l)).length - errorsBefore;
  rows.push({ id, ...row, errors });
  console.log(`${id.padEnd(30)} ${JSON.stringify(row)} errors=${errors}`);
}

const bad = rows.filter((r) => r.failed || r.nan || r.spawnGap > 0.15 || Math.abs(r.spawnGap) > 0.15 || r.travelled < 0.5 || r.items !== 5 || r.errors > 0);
console.log('\nSUMMARY', rows.length, 'maps,', bad.length, 'flagged');
for (const r of bad) console.log('  !', r.id, JSON.stringify(r));
await cdp.close();
