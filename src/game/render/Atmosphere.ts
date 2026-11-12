import * as THREE from 'three';
import { SunShadows } from './SunShadows';
import { Weather } from './Weather';
import { WaterSurface } from './WaterSurface';
import { skyAt, createSkyState } from './skyModel';
import { MapMood, WeatherKind, DEFAULT_MOOD } from '../../data/mapMood';

/**
 * The sky, the fog and the weather, for one map.
 *
 * Owns three things that used to be hard-coded on the scene: the background
 * colour, the exponential fog, and the two lights in `SunShadows`. It exists
 * because those four are one decision — the hour — and splitting them across
 * the map loader is how you end up with a dusk sky lit by a noon sun.
 *
 * ## Weather is a modifier, not a second preset
 *
 * Each kind of weather is a small multiplier applied to whatever the hour
 * produced: overcast cuts the sun to a third and thickens the fog, rain does
 * the same and adds the particle field. That way a rainy map at 19:00 is a dim
 * warm-grey evening rather than a fixed "rain" look that ignores the clock.
 *
 * ## The ambient floor
 *
 * `MIN_AMBIENT` is the whole reason night maps are playable. The player is
 * looking for five small objects; a scene that is technically moonlit but
 * practically black turns a hunt into a torch search. The floor is high enough
 * that every prop stays readable and low enough that the hour still reads.
 */

interface Tint {
  /**
   * How far to drain the colour out of the hour's own sky, 0…1.
   *
   * Draining rather than mixing toward a fixed grey is the whole trick. The
   * first version of this mixed every overcast sky toward the same #c9c9c4,
   * which made the four overcast maps identical — a noon overcast and a four
   * o'clock overcast came out as the same flat blue-grey, and the hours may as
   * well not have been set. Desaturating keeps each hour's own warmth or chill
   * and only takes the blue out of it.
   */
  grey: number;
  /** Multiplier on the sky's brightness. Below 1 darkens it. */
  dim: number;
  /** Multiplier on the sun. */
  sun: number;
  /** Multiplier on the ambient. */
  ambient: number;
  /** Multiplier on the fog density. */
  fog: number;
}

const TINTS: Record<WeatherKind, Tint> = {
  clear: { grey: 0.0, dim: 1.0, sun: 1.0, ambient: 1.0, fog: 1.0 },
  overcast: { grey: 0.72, dim: 0.94, sun: 0.32, ambient: 1.0, fog: 1.7 },
  mist: { grey: 0.5, dim: 1.0, sun: 0.5, ambient: 1.02, fog: 3.4 },
  rain: { grey: 0.74, dim: 0.74, sun: 0.26, ambient: 0.98, fog: 2.8 },
  // Snow is the one weather that makes the sky *brighter*: a snowfield throws
  // light back up, and a grey lid over a white ground looks wrong. The sun is
  // kept higher than rain's on purpose — a snowfield is read almost entirely by
  // the shadows its drifts cast, and the first version dimmed them away.
  snow: { grey: 0.58, dim: 1.06, sun: 0.58, ambient: 1.05, fog: 2.3 },
  // Silt. The tint only matters for the moment before `refresh` replaces it
  // with the sea's own colour; it is here so the table stays total.
  motes: { grey: 0.15, dim: 0.9, sun: 0.55, ambient: 1.0, fog: 1.0 },
};

/** Fog density at the clear-weather baseline. Matches the pre-atmosphere look. */
const BASE_FOG = 0.012;

/**
 * Never let the fill light fall below this.
 *
 * 0.62 is the value the darkest keyframe in `skyModel` already uses; the floor
 * is here for the weather multipliers, which can take a night map's ambient
 * down to 0.45 and make the props unreadable.
 */
const MIN_AMBIENT = 0.62;

/**
 * Lightness floors for the fill light's two colours.
 *
 * The fill was being coloured by the sky itself, which is right at noon and
 * badly wrong at night: a night sky is a dark navy, so the hemisphere light was
 * a dark navy light, and a prop lit only by it came out almost black. The fill
 * is a *light source*, not a paint colour — the sky is dark, the light that
 * stands in for it is not. Lifting the lightness keeps the hour's hue and makes
 * a night map readable, which is the whole point of `MIN_AMBIENT`.
 */
const MIN_AMBIENT_SKY_LIGHTNESS = 0.58;
const MIN_AMBIENT_GROUND_LIGHTNESS = 0.3;

/**
 * Colour that haze pulls the sky toward.
 *
 * Dust is warm. Without this, the two "dust and heat" maps came out the same
 * cool grey as the hospital corridor, because haze only ever changed the fog
 * *density* and never its colour.
 */
const HAZE_COLOR = 0xd8c3a4;

/**
 * Water, for the maps that are under it.
 *
 * `SEA_FOG` is a visibility of about 22 m — far enough to pick a shape out of
 * the blue, short enough that the far edge of the reef fades out instead of
 * ending on a horizon line drawn against a sky that is not there.
 */
const SEA_COLOR = 0x14606a;
const SEA_FOG = 0.045;
/** Sunlight that has already been through metres of water: cool and weak. */
const SEA_SUN = 0x9fe4e0;
const SEA_AMBIENT_SKY = 0x3f8f96;
const SEA_AMBIENT_GROUND = 0x2b5a4e;

export class Atmosphere {
  private sky = createSkyState();
  private mood: MapMood = DEFAULT_MOOD;
  private hour = DEFAULT_MOOD.timeOfDay;
  private weather: Weather;
  private water: WaterSurface;

  /** The hour the light was last built for, so a still sun is free. */
  private appliedHour = Number.NaN;

  private readonly background = new THREE.Color(0xd6eaf8);
  private readonly fog = new THREE.FogExp2(0xd6eaf8, BASE_FOG);
  private readonly ambientSky = new THREE.Color(0xd6eaf8);
  private readonly ambientGround = new THREE.Color(0x6e8858);
  private readonly haze = new THREE.Color(HAZE_COLOR);
  private readonly sea = new THREE.Color(SEA_COLOR);
  private readonly seaSun = new THREE.Color(SEA_SUN);
  private readonly seaSky = new THREE.Color(SEA_AMBIENT_SKY);
  private readonly seaGround = new THREE.Color(SEA_AMBIENT_GROUND);
  private readonly hsl = { h: 0, s: 0, l: 0 };

  constructor(private scene: THREE.Scene, private sun: SunShadows) {
    this.weather = new Weather(scene);
    this.water = new WaterSurface(scene);
    this.scene.background = this.background;
    this.scene.fog = this.fog;
  }

  public getWeather(): WeatherKind {
    return this.mood.weather;
  }

  /** Applies a map's mood. Called on every map load. */
  public apply(mood: MapMood): void {
    this.mood = mood;
    this.hour = mood.timeOfDay;
    this.weather.setKind(mood.weather);
    this.appliedHour = Number.NaN;
    this.refresh();
  }

  /**
   * One frame.
   *
   * Only the maps that asked for a moving sun pay for one; for everything else
   * this is a weather-uniform update and nothing else.
   */
  public update(deltaSeconds: number, playerPosition: THREE.Vector3): void {
    const day = this.mood.dayLengthSeconds ?? 0;
    if (day > 0) {
      this.hour = (this.hour + (deltaSeconds * 24) / day) % 24;
      // Rebuild the light only when the hour has moved enough to change it.
      // Recomputing every frame would also invalidate the shadow anchor.
      const drift = Math.abs(((this.hour - this.appliedHour + 36) % 24) - 12);
      if (drift > 0.02) this.refresh();
    }
    this.weather.update(deltaSeconds, playerPosition);

    // The surface is placed from the body rather than from the map, so it does
    // not have to be measured: a reef is fifteen metres of water deep.
    if (this.mood.submerged) {
      if (!this.water.isShowing()) this.water.show(playerPosition.y);
      this.water.update(deltaSeconds, playerPosition);
    } else if (this.water.isShowing()) {
      this.water.hide();
    }
  }

  private refresh(): void {
    const sky = skyAt(this.hour, this.sky);
    const tint = TINTS[this.mood.weather];
    this.appliedHour = this.hour;

    // Sky and fog share a colour. Two colours that are merely close is the
    // single most common way a fogged scene looks cheap: the horizon stops
    // matching the sky and the world reads as a diorama in a box.
    this.background.copy(sky.skyColor);
    if (tint.grey > 0 || tint.dim !== 1) {
      this.background.getHSL(this.hsl);
      this.background.setHSL(
        this.hsl.h,
        this.hsl.s * (1 - tint.grey),
        Math.min(1, this.hsl.l * tint.dim)
      );
    }
    this.fog.color.copy(this.background);

    const hazeAmount = this.mood.haze ?? 0;
    // Haze warms the sky as well as thickening it, or the "dust and heat" maps
    // come out the same cool grey as the hospital corridor.
    if (hazeAmount > 0) {
      this.background.lerp(this.haze, Math.min(0.3, hazeAmount * 1.0));
      this.fog.color.copy(this.background);
    }
    this.fog.density = BASE_FOG * tint.fog * (1 + hazeAmount);

    this.sun.setLight(sky.sunDirection, sky.sunColor, sky.sunIntensity * tint.sun);
    this.sun.setAmbient(
      this.lift(this.ambientSky, this.background, MIN_AMBIENT_SKY_LIGHTNESS),
      this.lift(this.ambientGround, sky.groundColor, MIN_AMBIENT_GROUND_LIGHTNESS),
      Math.max(MIN_AMBIENT, sky.ambientIntensity * tint.ambient)
    );

    // Under water the hour is *filtered*, not lit: there is no sky down there to
    // be warm or cool, and what reaches the reef has already passed through
    // metres of sea. Replaced rather than tinted, because a reef that merely
    // looks a little green is still a reef in a desert.
    if (this.mood.submerged) {
      this.background.copy(this.sea).lerp(sky.skyColor, 0.12);
      this.fog.color.copy(this.background);
      this.fog.density = SEA_FOG;
      this.sun.setLight(sky.sunDirection, this.seaSun, sky.sunIntensity * 0.55);
      this.sun.setAmbient(
        this.seaSky,
        this.seaGround,
        Math.max(MIN_AMBIENT, sky.ambientIntensity * 1.1)
      );
    }
  }

  /** Copies `source` into `target`, raising its lightness to at least `floor`. */
  private lift(target: THREE.Color, source: THREE.Color, floor: number): THREE.Color {
    target.copy(source);
    target.getHSL(this.hsl);
    if (this.hsl.l < floor) target.setHSL(this.hsl.h, this.hsl.s * 0.85, floor);
    return target;
  }

  public dispose(): void {
    this.weather.dispose();
  }
}
