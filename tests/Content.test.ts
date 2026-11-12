// The hunt content is data, so it can be wrong without any code being wrong:
// a map added to the registry with no objects, an object pointing at an asset
// that was never shipped, two objects sharing an id. None of that throws, and
// none of it shows up until a player is standing in an empty map.
//
// These are integrity checks, not design checks. The *taste* rules — an object
// must be impossible in its scene, and placed where the player can see it
// without leaving the path — are not testable and live in the data file's
// comments and in docs/HIDDEN_OBJECTS.md.
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { MAPS } from '../src/data/mapRegistry';
import { HIDDEN_ITEMS } from '../src/data/hiddenItems';

const OBJECTS_PER_MAP = 5;

/**
 * A guard against a typo, not a rule.
 *
 * The guideline is "within 20 m of spawn", and most placements are, but the
 * large maps legitimately exceed it — `chrome-arcology-transit` and
 * `chronos-hearth` are tens of metres across and 18 of the 110 objects sit
 * further out. So the number here is deliberately loose: it exists to catch a
 * misplaced decimal point that would put an object 400 m away, where no player
 * would ever walk.
 */
const SANITY_LIMIT = 60;

describe('hunt content', () => {
  it('gives every playable map a hunt', () => {
    const missing = MAPS.filter((m) => !HIDDEN_ITEMS[m.id]).map((m) => m.id);
    expect(missing).toEqual([]);
  });

  it('has no hunt for a map that is not playable', () => {
    const known = new Set(MAPS.map((m) => m.id));
    const orphans = Object.keys(HIDDEN_ITEMS).filter((id) => !known.has(id));
    expect(orphans).toEqual([]);
  });

  it(`gives every map exactly ${OBJECTS_PER_MAP} objects`, () => {
    const wrong = Object.entries(HIDDEN_ITEMS)
      .filter(([, hunt]) => hunt.items.length !== OBJECTS_PER_MAP)
      .map(([id, hunt]) => `${id}: ${hunt.items.length}`);
    expect(wrong).toEqual([]);
  });

  it('gives every map a brief and every object a name and a hint', () => {
    const bad: string[] = [];
    for (const [id, hunt] of Object.entries(HIDDEN_ITEMS)) {
      if (hunt.brief.trim().length < 10) bad.push(`${id}: brief too short`);
      for (const item of hunt.items) {
        if (!item.name.trim()) bad.push(`${id}/${item.id}: no name`);
        if (item.hint.trim().length < 20) bad.push(`${id}/${item.id}: hint too short`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('uses unique object ids within a map', () => {
    const dupes: string[] = [];
    for (const [id, hunt] of Object.entries(HIDDEN_ITEMS)) {
      const seen = new Set<string>();
      for (const item of hunt.items) {
        if (seen.has(item.id)) dupes.push(`${id}/${item.id}`);
        seen.add(item.id);
      }
    }
    expect(dupes).toEqual([]);
  });

  it('points every object at an asset that exists', () => {
    const missing: string[] = [];
    for (const [id, hunt] of Object.entries(HIDDEN_ITEMS)) {
      for (const item of hunt.items) {
        const file = path.join('public', 'assets', 'hidden', `${item.asset}.glb`);
        if (!existsSync(file)) missing.push(`${id}/${item.id}: ${item.asset}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('places every object within walking distance of its spawn', () => {
    const far: string[] = [];
    for (const map of MAPS) {
      const hunt = HIDDEN_ITEMS[map.id];
      if (!hunt) continue;
      for (const item of hunt.items) {
        const d = Math.hypot(item.spot.x - map.spawn.x, item.spot.z - map.spawn.z);
        if (d > SANITY_LIMIT) far.push(`${map.id}/${item.id}: ${d.toFixed(0)} m`);
      }
    }
    expect(far).toEqual([]);
  });

  it('keeps the two rejected example objects out of every map', () => {
    // The user's own calibration for "impossible, not merely unusual": a pizza
    // slice and a flat-screen TV can plausibly turn up almost anywhere, so
    // neither can carry the hunt. Both assets still ship; nothing uses them.
    const banned = ['pizza-slice', 'flat-screen-television'];
    const used: string[] = [];
    for (const [id, hunt] of Object.entries(HIDDEN_ITEMS)) {
      for (const item of hunt.items) {
        if (banned.some((b) => item.asset.startsWith(b))) used.push(`${id}/${item.id}`);
      }
    }
    expect(used).toEqual([]);
  });
});
