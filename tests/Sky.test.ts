import { describe, it, expect } from 'vitest';
import { skyAt } from '../src/game/render/skyModel';
import { MAP_MOODS, moodFor, DEFAULT_MOOD } from '../src/data/mapMood';
import { MAPS } from '../src/data/mapRegistry';

/**
 * The sky model is the one part of the atmosphere that can be tested without a
 * renderer, and it is also the part where a wrong number is expensive: a light
 * that dips under the horizon lights the whole map from below, and that is not
 * a subtle bug — it is the first frame of the game looking broken.
 */
describe('skyAt', () => {
  it('keeps the light above the ground at every hour of the day', () => {
    // A directional light below the horizon lights props from underneath and
    // points every shadow up. The clamp in `skyAt` exists for exactly this, so
    // the test walks the clock rather than trusting the clamp was applied.
    for (let hour = 0; hour < 24; hour += 0.25) {
      const sky = skyAt(hour);
      expect(sky.sunDirection.y, `hour ${hour}`).toBeGreaterThan(0.35);
    }
  });

  it('returns a unit vector', () => {
    for (let hour = 0; hour < 24; hour += 1.5) {
      const { sunDirection } = skyAt(hour);
      expect(sunDirection.length()).toBeCloseTo(1, 5);
    }
  });

  it('is brightest at noon and dimmest at midnight', () => {
    const noon = skyAt(12);
    const midnight = skyAt(0);
    expect(noon.sunIntensity).toBeGreaterThan(midnight.sunIntensity * 4);
    expect(noon.ambientIntensity).toBeGreaterThan(midnight.ambientIntensity);
  });

  it('never drops the ambient so low that props stop reading', () => {
    // The hunt is "find five small objects". A scene that is technically
    // moonlit but practically black turns that into a torch search.
    for (let hour = 0; hour < 24; hour += 0.5) {
      expect(skyAt(hour).ambientIntensity, `hour ${hour}`).toBeGreaterThanOrEqual(0.62);
    }
  });

  it('wraps hours outside 0-24', () => {
    const a = skyAt(1.5);
    const b = skyAt(25.5);
    expect(b.sunIntensity).toBeCloseTo(a.sunIntensity, 6);
    expect(b.skyColor.getHex()).toBe(a.skyColor.getHex());

    const c = skyAt(-3);
    const d = skyAt(21);
    expect(c.sunIntensity).toBeCloseTo(d.sunIntensity, 6);
  });

  it('is warm at the horizon and neutral at noon', () => {
    // 07:54, just after sunrise, which is 07:30. The hour has to be *after*
    // sunrise or the sun is still below the horizon and the light is moonlight.
    const sunrise = skyAt(7.9);
    const noon = skyAt(12);
    // Sunrise light is redder than midday light: more red than blue.
    expect(sunrise.sunColor.r).toBeGreaterThan(sunrise.sunColor.b);
    expect(noon.sunColor.b).toBeGreaterThan(0.7);
  });

  it('is cooler before sunrise than after it, at the same height', () => {
    // The morning/evening bias exists so that 07:48 and 20:12 are not the same
    // colour. A pre-dawn sky is blue; a sunset sky at the same elevation is
    // warm. This is the assertion that would fail if the bias were removed.
    const beforeDawn = skyAt(7.2);
    const afterSunset = skyAt(20.8);
    expect(beforeDawn.skyColor.b).toBeGreaterThan(beforeDawn.skyColor.r);
    expect(afterSunset.skyColor.r).toBeGreaterThan(afterSunset.skyColor.b);
  });

  it('reuses the object it is given instead of allocating', () => {
    const out = skyAt(9);
    const again = skyAt(15, out);
    expect(again).toBe(out);
  });
});

describe('map moods', () => {
  it('has an entry for every map in the registry', () => {
    // A new map with no mood is a map at default noon, which is exactly the
    // "every place looks the same" problem the table exists to avoid.
    const missing = MAPS.filter((map) => !MAP_MOODS[map.id]).map((map) => map.id);
    expect(missing).toEqual([]);
  });

  it('has no entries for maps that no longer exist', () => {
    const ids = new Set(MAPS.map((map) => map.id));
    const orphans = Object.keys(MAP_MOODS).filter((id) => !ids.has(id));
    expect(orphans).toEqual([]);
  });

  it('falls back to a default for an unknown map', () => {
    expect(moodFor('not-a-map')).toBe(DEFAULT_MOOD);
  });

  it('keeps every map in a playable hour', () => {
    for (const [id, mood] of Object.entries(MAP_MOODS)) {
      expect(mood.timeOfDay, id).toBeGreaterThanOrEqual(0);
      expect(mood.timeOfDay, id).toBeLessThan(24);
      // Every map stops at dusk except the one that is deliberately a night
      // map. The hunt is "find five small objects", so darkness is a budget:
      // spent once, on the city in the rain, where it is the subject.
      const limit = id === 'nyc-city' ? 22 : 21;
      expect(mood.timeOfDay, id).toBeLessThanOrEqual(limit);
    }
  });

  it('only lets a map cycle its sun when it says how fast', () => {
    for (const [id, mood] of Object.entries(MAP_MOODS)) {
      if (mood.dayLengthSeconds === undefined) continue;
      expect(mood.dayLengthSeconds, id).toBeGreaterThan(60);
    }
  });
});
