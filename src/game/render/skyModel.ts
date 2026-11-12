import * as THREE from 'three';

/**
 * Turns an hour into light.
 *
 * The sun's *height* drives everything — colour, intensity, ambient, sky — and
 * the hour only matters because it produces that height. So the keyframes below
 * are indexed by elevation rather than by clock time, which means 7 a.m. and
 * 5 p.m. get the same warm low light for free and there is no chance of the two
 * drifting apart as the table is tuned.
 *
 * ## Why the light direction is clamped
 *
 * A directional light below the horizon lights the world from underneath: props
 * glow from below, shadows point up, and the whole scene reads as broken rather
 * than as night. So the *direction* is clamped to 25–47 degrees while the
 * *colour and intensity* follow the real elevation. Nobody can tell, because the
 * sky is a flat colour with no sun disc in it — what the eye reads as "evening"
 * is the warmth and the dimness, not the angle.
 *
 * The 25-degree floor is also what keeps shadows inside the shadow camera: at a
 * true 8-degree sun a 1.1 m fence casts a 7.8 m shadow, and the shadow box would
 * have to be twice the size to hold it.
 */

export interface SkyState {
  /** Unit vector from the ground toward the light. Always above the horizon. */
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  /** Flat background colour, also used as the fog colour. */
  skyColor: THREE.Color;
  groundColor: THREE.Color;
  ambientIntensity: number;
}

interface Stop {
  /** Sun elevation, -1 (nadir) to 1 (zenith). */
  e: number;
  sky: number;
  ground: number;
  sun: number;
  sunI: number;
  amb: number;
}

const STOPS: Stop[] = [
  // Deep night: everything is blue, and there is enough of it to see by.
  { e: -1.0, sky: 0x141c2e, ground: 0x20262f, sun: 0x7f95bd, sunI: 0.10, amb: 0.66 },
  // Late twilight.
  { e: -0.34, sky: 0x1f2a45, ground: 0x262d3c, sun: 0x8ba1c6, sunI: 0.17, amb: 0.72 },
  // Blue hour. Deliberately a wide band rather than a single step: the drop
  // from sunset to night is the one transition the eye is most sensitive to,
  // and a two-keyframe version of it reads as someone switching the lights off.
  { e: -0.14, sky: 0x4a5178, ground: 0x353a4a, sun: 0xa08fc0, sunI: 0.32, amb: 0.80 },
  // The sun at the horizon: rose sky, orange light.
  { e: -0.02, sky: 0xa87f92, ground: 0x4a4048, sun: 0xd08a6a, sunI: 0.58, amb: 0.88 },
  // Low sun: the long-shadow hour.
  { e: 0.12, sky: 0xe2a482, ground: 0x6a5c48, sun: 0xffb271, sunI: 1.10, amb: 1.00 },
  // Mid-morning and mid-afternoon.
  { e: 0.35, sky: 0xe8e9e2, ground: 0x6e8858, sun: 0xffe6c4, sunI: 1.50, amb: 1.10 },
  // High noon, which is the flat bright look the maps were originally lit for.
  { e: 1.0, sky: 0xd6eaf8, ground: 0x6e8858, sun: 0xfff7e8, sunI: 1.80, amb: 1.20 },
];

/** Degrees, as radians, that the light direction is kept inside. */
const MIN_LIGHT_ELEVATION = 0.44; // 25 degrees
const MAX_LIGHT_ELEVATION = 0.82; // 47 degrees

/**
 * Sunrise and sunset, in hours.
 *
 * 07:30 and 20:30, not 06:00 and 18:00. The first version of this put sunset at
 * six, which made every map set in the evening pitch dark by half past seven —
 * so all four evening maps came out the same near-black navy and there was no
 * way to ask for "golden hour" at all. A long summer day gives the whole
 * evening a usable range: 17:00 is warm, 19:30 is low and orange, 20:30 is
 * sunset, 21:30 is blue hour.
 */
const SUNRISE_HOUR = 7.5;
const SUNSET_HOUR = 20.5;
/** Midday, and the dividing line between cool morning light and warm evening. */
const SOLAR_NOON = (SUNRISE_HOUR + SUNSET_HOUR) / 2;

/**
 * How far the sun's arc is squashed vertically.
 *
 * A real arc reaches 90 degrees at noon, where the light comes straight down
 * and every shadow collapses under its caster. 0.78 tops it out at 47 degrees,
 * which is the angle the maps were tuned against.
 */
const ARC_SQUASH = 0.78;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const _a = new THREE.Color();
const _b = new THREE.Color();

/** Reusable output, so a per-frame call does not allocate. */
export function createSkyState(): SkyState {
  return {
    sunDirection: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(0xffffff),
    sunIntensity: 1,
    skyColor: new THREE.Color(0xd6eaf8),
    groundColor: new THREE.Color(0x6e8858),
    ambientIntensity: 1.2,
  };
}

/**
 * Fills `out` with the light for a given hour.
 *
 * `timeOfDay` wraps: 25.5 is half past one in the morning. Values outside
 * 0…24 are not an error, because the cycling maps add to the hour every frame
 * and normalising at the call site is the kind of detail that gets forgotten.
 */
export function skyAt(timeOfDay: number, out: SkyState = createSkyState()): SkyState {
  const hour = ((timeOfDay % 24) + 24) % 24;

  // A cosine-shaped arc between sunrise and sunset, continuing below the
  // horizon through the night.
  const angle = ((hour - SUNRISE_HOUR) / (SUNSET_HOUR - SUNRISE_HOUR)) * Math.PI;
  const elevation = Math.sin(angle);

  // Where the sun is, clamped to stay above the ground. See the note above.
  const rawElevation = Math.asin(clamp(elevation, -1, 1)) * ARC_SQUASH;
  const lightElevation = clamp(rawElevation, MIN_LIGHT_ELEVATION, MAX_LIGHT_ELEVATION);
  // Azimuth sweeps east to west through the day; at night it keeps going round
  // so the moon is not stuck in one corner of the sky.
  const azimuth = angle;
  const cosE = Math.cos(lightElevation);
  out.sunDirection.set(cosE * Math.cos(azimuth), Math.sin(lightElevation), cosE * Math.sin(azimuth));

  // Find the bracketing pair of keyframes.
  let i = 0;
  while (i < STOPS.length - 2 && elevation > STOPS[i + 1].e) i++;
  const lo = STOPS[i];
  const hi = STOPS[i + 1];
  const span = hi.e - lo.e;
  const t = span > 1e-6 ? clamp((elevation - lo.e) / span, 0, 1) : 0;

  out.skyColor.copy(_a.setHex(lo.sky)).lerp(_b.setHex(hi.sky), t);
  out.groundColor.copy(_a.setHex(lo.ground)).lerp(_b.setHex(hi.ground), t);
  out.sunColor.copy(_a.setHex(lo.sun)).lerp(_b.setHex(hi.sun), t);
  out.sunIntensity = lo.sunI + (hi.sunI - lo.sunI) * t;
  out.ambientIntensity = lo.amb + (hi.amb - lo.amb) * t;

  // Morning and evening at the same sun height are not the same light. By the
  // afternoon the air holds a day of dust, and that is what makes evening light
  // read as evening rather than as early morning. Without this the keyframes —
  // which are indexed by elevation — make 07:48 and 20:12 pixel-identical, and
  // two maps set at those hours look like the same map twice.
  const warmth = clamp((hour - SOLAR_NOON) / 4, -1, 1);
  if (warmth > 0) {
    out.sunColor.lerp(_a.setHex(0xffc98a), warmth * 0.22);
    out.skyColor.lerp(_a.setHex(0xffd2b4), warmth * 0.10);
  } else {
    out.sunColor.lerp(_a.setHex(0xcfe0ff), -warmth * 0.20);
    out.skyColor.lerp(_a.setHex(0xd8e6f4), -warmth * 0.10);
  }

  return out;
}
