import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Atmosphere } from '../src/game/render/Atmosphere';
import { SunShadows } from '../src/game/render/SunShadows';
import { MAP_MOODS, moodFor } from '../src/data/mapMood';

/**
 * `SunShadows` only touches `renderer.shadowMap.enabled` while it is being
 * built; everything this file exercises is lights and colours. A stub is
 * enough, and it keeps the suite free of a GL context.
 */
function build(): { scene: THREE.Scene; atmosphere: Atmosphere; sun: SunShadows } {
  const scene = new THREE.Scene();
  const renderer = { shadowMap: {} } as unknown as THREE.WebGLRenderer;
  const sun = new SunShadows(renderer, scene);
  return { scene, atmosphere: new Atmosphere(scene, sun), sun };
}

describe('Atmosphere', () => {
  it('replaces the sky with the sea on a map that is under water', () => {
    const { scene, atmosphere, sun } = build();

    atmosphere.apply({ timeOfDay: 12, weather: 'motes', submerged: true });

    const water = scene.background as THREE.Color;
    // A teal, not the pale blue of a noon sky: green and blue both well clear
    // of the red channel.
    expect(water.r).toBeLessThan(0.45);
    expect(water.g).toBeGreaterThan(water.r);
    expect(water.b).toBeGreaterThanOrEqual(water.g);
    // Visibility of about twenty metres, which is the whole point.
    expect((scene.fog as THREE.FogExp2).density).toBeGreaterThan(0.03);
    // The sun has been through metres of water before it gets here.
    expect(sun.sun.color.getHexString()).toBe('9fe4e0');
  });

  it('gives the sky back when the next map is above water', () => {
    const { scene, atmosphere, sun } = build();

    atmosphere.apply({ timeOfDay: 12, weather: 'motes', submerged: true });
    const underWater = (scene.background as THREE.Color).getHex();

    atmosphere.apply({ timeOfDay: 12, weather: 'clear' });

    expect((scene.background as THREE.Color).getHex()).not.toBe(underWater);
    expect((scene.fog as THREE.FogExp2).density).toBeLessThan(0.02);
    expect(sun.sun.color.getHexString()).not.toBe('9fe4e0');
  });

  it('carries a weather for every map in the table', () => {
    const { atmosphere } = build();

    for (const [id, mood] of Object.entries(MAP_MOODS)) {
      expect(() => atmosphere.apply(mood)).not.toThrow();
      expect(atmosphere.getWeather(), id).toBe(mood.weather);
    }
  });

  it('snows on the snowy map and is under water on the reef', () => {
    // The two the player actually reported. Pinned so a later tidy-up of the
    // table cannot quietly put them back to "clear" — the ski map had no snow
    // in it and the reef was a sand desert under a blue sky.
    expect(moodFor('alpine-and-snow').weather).toBe('snow');
    expect(moodFor('coral-reef').submerged).toBe(true);

    const submerged = Object.entries(MAP_MOODS)
      .filter(([, mood]) => mood.submerged)
      .map(([id]) => id);
    expect(submerged).toEqual(['coral-reef']);
  });
});
