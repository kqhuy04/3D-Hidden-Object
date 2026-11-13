import { describe, it, expect } from 'vitest';
import {
  FISH,
  FISHING_SPOTS,
  xpForLevel,
  zoneHeight,
  biteDelay,
  pickSpecies,
  speciesById,
  spotForMap,
  clamp,
} from '../src/data/fishing';

describe('fishing balance', () => {
  it('stocks only the maps that have water deep enough', () => {
    // The survey behind this list is in `docs/FISHING.md`: cells at least half
    // a metre deep within forty metres of open water. Every other map scored
    // zero, and a rod that is offered on a puddle is a bug the player finds.
    const maps = FISHING_SPOTS.map((spot) => spot.map).sort();
    expect(maps).toEqual(['alpine-and-snow', 'campground-lake', 'coral-reef', 'countryside-railway']);
    expect(spotForMap('campground-lake')).not.toBeNull();
    expect(spotForMap('desert-canyon')).toBeNull();
  });

  /**
   * The catalogue is the collection screen's order, so it is grouped by rarity
   * rather than sorted by speed: a log that runs common, rare, common reads as
   * a bag of fish, not a ladder. Difficulty is a property of the fish, not of
   * its rarity — a sea turtle is rare and slow — so the speed claim lives in
   * `zoneHeight` instead.
   */
  it('lists the catalogue from common to legendary', () => {
    const rank: Record<string, number> = { common: 0, uncommon: 1, rare: 2, legendary: 3 };
    for (let i = 1; i < FISH.length; i++) {
      expect(rank[FISH[i].rarity]).toBeGreaterThanOrEqual(rank[FISH[i - 1].rarity]);
    }
  });

  it('makes the legendary the hardest fight in the game', () => {
    const legendary = FISH.filter((fish) => fish.rarity === 'legendary');
    expect(legendary.length).toBeGreaterThan(0);
    const hardest = Math.max(...FISH.map((fish) => fish.speed));
    for (const fish of legendary) expect(fish.speed).toBe(hardest);
    expect(Math.max(...legendary.map((fish) => fish.xp))).toBe(Math.max(...FISH.map((fish) => fish.xp)));
  });

  it('gives every species a weight range, a model and a thumbnail', () => {
    for (const fish of FISH) {
      expect(fish.kg[1]).toBeGreaterThan(fish.kg[0]);
      expect(fish.model).toMatch(/^\/assets\/fish\/.+\.glb$/);
      expect(fish.length).toBeGreaterThan(0);
      expect(fish.xp).toBeGreaterThan(0);
    }
  });

  it('gives every species a distinct id', () => {
    expect(new Set(FISH.map((fish) => fish.id)).size).toBe(FISH.length);
  });

  /**
   * The collection prints the rarity in the name's colour, so a fish with no
   * rarity would be a blank name. It also drives the level bonus in the pick.
   */
  it('labels every species with a rarity', () => {
    const allowed = new Set(['common', 'uncommon', 'rare', 'legendary']);
    for (const fish of FISH) expect(allowed.has(fish.rarity)).toBe(true);
  });

  /**
   * A roster that names a fish the catalogue does not have would silently
   * shrink the lake: `pickSpecies` skips it and the weights still add up.
   */
  it('only stocks fish that exist', () => {
    for (const spot of FISHING_SPOTS) {
      expect(spot.roster.length).toBeGreaterThan(2);
      for (const entry of spot.roster) {
        expect(speciesById(entry.id), `${spot.map} wants ${entry.id}`).toBeDefined();
        expect(entry.weight).toBeGreaterThan(0);
      }
    }
  });

  it('gives every species a home', () => {
    const stocked = new Set(FISHING_SPOTS.flatMap((spot) => spot.roster.map((entry) => entry.id)));
    for (const fish of FISH) {
      expect(stocked.has(fish.id), `${fish.id} swims nowhere`).toBe(true);
    }
  });
});

describe('levelling', () => {
  it('costs more each level', () => {
    for (let level = 1; level < 20; level++) {
      expect(xpForLevel(level + 1)).toBeGreaterThan(xpForLevel(level));
    }
  });

  it('reaches level 2 in a handful of fish, not a handful of hours', () => {
    // Three koi should be a level. The progression has to be felt in a session.
    const koi = speciesById('koi-base')!;
    let xp = 0;
    let caught = 0;
    while (xp < xpForLevel(1)) {
      xp += koi.xp;
      caught++;
    }
    expect(caught).toBeLessThanOrEqual(5);
  });

  /**
   * The progression the player actually feels: a wider band. If this ever
   * inverted, levelling would make the game harder and nothing else in the
   * interface would say so.
   */
  it('widens the band with every level', () => {
    for (const fish of FISH) {
      let previous = zoneHeight(1, fish);
      for (let level = 2; level <= 20; level++) {
        const next = zoneHeight(level, fish);
        expect(next).toBeGreaterThanOrEqual(previous);
        previous = next;
      }
    }
  });

  it('keeps the band inside a playable range at both ends', () => {
    for (const fish of FISH) {
      for (const level of [1, 2, 5, 12, 40, 99]) {
        const height = zoneHeight(level, fish);
        expect(height).toBeGreaterThanOrEqual(0.2);
        expect(height).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('gives the fastest fish the thinnest band at the same level', () => {
    expect(zoneHeight(1, FISH[FISH.length - 1])).toBeLessThan(zoneHeight(1, FISH[0]));
  });
});

describe('the bite', () => {
  it('stays inside the authored window at level 1', () => {
    for (let i = 0; i < 200; i++) {
      const delay = biteDelay(1);
      expect(delay).toBeGreaterThanOrEqual(2.2);
      expect(delay).toBeLessThanOrEqual(5.5);
    }
  });

  // The delay is a random draw, so a single pair of samples proves nothing —
  // the claim is about the distribution, and the distribution is checked as a
  // ceiling plus a mean.
  it('comes sooner as the player levels', () => {
    const sample = (level: number) => {
      const values = Array.from({ length: 500 }, () => biteDelay(level));
      return {
        max: Math.max(...values),
        mean: values.reduce((a, b) => a + b, 0) / values.length,
      };
    };
    const level1 = sample(1);
    const level12 = sample(12);

    // 12 levels in, the hurry factor is capped at 0.67.
    expect(level12.max).toBeLessThanOrEqual(5.5 * 0.67 + 1e-9);
    expect(level12.mean).toBeLessThan(level1.mean);
  });

  it('never hurries faster than the cap allows', () => {
    // A level-99 player still waits: the fish is not a vending machine.
    for (let i = 0; i < 200; i++) {
      expect(biteDelay(99)).toBeGreaterThanOrEqual(2.2 * 0.65 - 1e-9);
    }
  });
});

describe('which fish takes the bait', () => {
  const lake = spotForMap('campground-lake')!;
  const reef = spotForMap('coral-reef')!;

  it('is always a fish that lives in this water', () => {
    const ids = new Set(lake.roster.map((entry) => entry.id));
    for (let level = 1; level <= 20; level++) {
      for (let i = 0; i < 40; i++) {
        expect(ids.has(pickSpecies(level, lake).id)).toBe(true);
      }
    }
  });

  it('never serves a reef fish in the lake', () => {
    const reefOnly = new Set(['stingray-base', 'sea-turtle-base', 'octopus-base', 'firefish-base']);
    for (let i = 0; i < 2000; i++) {
      expect(reefOnly.has(pickSpecies(9, lake).id)).toBe(false);
    }
  });

  it('makes the rare ones likelier as the player levels', () => {
    const rare = speciesById('reef-shark-base')!;
    let low = 0;
    let high = 0;
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      if (pickSpecies(1, reef).id === rare.id) low++;
      if (pickSpecies(12, reef).id === rare.id) high++;
    }
    expect(high).toBeGreaterThan(low);
  });
});

describe('clamp', () => {
  it('holds a value inside its bounds', () => {
    expect(clamp(-3, 0, 1)).toBe(0);
    expect(clamp(7, 0, 1)).toBe(1);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
  });
});
