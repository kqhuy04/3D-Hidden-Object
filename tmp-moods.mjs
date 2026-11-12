// Reports what each map's atmosphere resolves to, so the mood table can be
// reviewed as numbers instead of by loading twenty-one maps one at a time.
import { skyAt, MAP_MOODS } from './tmp-sky.mjs';

// The same constants `Atmosphere` uses. Duplicated on purpose: this is a
// reporting script, and importing the class would drag in three and a renderer.
const TINTS = {
  clear: { grey: 0.0, dim: 1.0, sun: 1.0, ambient: 1.0, fog: 1.0 },
  overcast: { grey: 0.72, dim: 0.94, sun: 0.32, ambient: 1.0, fog: 1.7 },
  mist: { grey: 0.5, dim: 1.0, sun: 0.5, ambient: 1.02, fog: 3.4 },
  rain: { grey: 0.74, dim: 0.74, sun: 0.26, ambient: 0.98, fog: 2.8 },
  snow: { grey: 0.58, dim: 1.06, sun: 0.45, ambient: 1.05, fog: 2.3 },
};
const BASE_FOG = 0.012;
const MIN_AMBIENT = 0.62;

const lerpHex = (a, b, t) => {
  const ch = (v, s) => (v >> s) & 255;
  const mix = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
};
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const lum = (n) => (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;

const rows = [];
for (const [id, mood] of Object.entries(MAP_MOODS)) {
  const sky = skyAt(mood.timeOfDay);
  const tint = TINTS[mood.weather];
  // Desaturate the hour's own sky, exactly as `Atmosphere` does.
  const hsl = sky.skyColor.getHSL({ h: 0, s: 0, l: 0 });
  const c = sky.skyColor.clone().setHSL(
    hsl.h,
    hsl.s * (1 - tint.grey),
    Math.min(1, hsl.l * tint.dim)
  );
  const skyHex = c.getHex();
  const fog = BASE_FOG * tint.fog * (1 + (mood.haze ?? 0));
  const sunI = sky.sunIntensity * tint.sun;
  const amb = Math.max(MIN_AMBIENT, sky.ambientIntensity * tint.ambient);
  rows.push({ id, time: mood.timeOfDay, weather: mood.weather, skyHex, fog, sunI, amb, lum: lum(skyHex) });
}

rows.sort((a, b) => a.lum - b.lum);
console.log('map'.padEnd(31), 'hour  weather   sky      fog     sun   amb   skyLum');
for (const r of rows) {
  console.log(
    r.id.padEnd(31),
    String(r.time).padEnd(5),
    r.weather.padEnd(9),
    hex(r.skyHex).padEnd(8),
    r.fog.toFixed(4).padEnd(7),
    r.sunI.toFixed(2).padEnd(5),
    r.amb.toFixed(2).padEnd(5),
    r.lum.toFixed(3)
  );
}
const lums = rows.map((r) => r.lum);
const fogs = rows.map((r) => r.fog);
console.log('\nsky luminance', Math.min(...lums).toFixed(3), '->', Math.max(...lums).toFixed(3));
console.log('fog density  ', Math.min(...fogs).toFixed(4), '->', Math.max(...fogs).toFixed(4));
console.log('ambient      ', Math.min(...rows.map((r) => r.amb)).toFixed(2), '->', Math.max(...rows.map((r) => r.amb)).toFixed(2));
