// Renders a preview sheet of every map's atmosphere.
//
// Not a game capture — it is a small Lambert shading of a box on a sky plate,
// computed from exactly the numbers `Atmosphere` hands to three: the hour's sky
// and ground colour, the sun direction and intensity, the ambient, and the
// weather tint. It is the cheapest honest way to review twenty-one moods
// without loading twenty-one maps.
import fs from 'node:fs';
import { build } from 'esbuild';

// Bundle the two modules this needs straight from source, in memory. Importing
// a pre-built file would make the tool depend on someone having run the build
// first, and a preview that silently shows last week's numbers is worse than no
// preview.
const bundled = await build({
  stdin: {
    contents: `
      export { skyAt } from './src/game/render/skyModel';
      export { MAP_MOODS } from './src/data/mapMood';
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  write: false,
  logLevel: 'error',
});
const { skyAt, MAP_MOODS } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64')
);

const TINTS = {
  clear: { grey: 0.0, dim: 1.0, sun: 1.0, ambient: 1.0, fog: 1.0 },
  overcast: { grey: 0.72, dim: 0.94, sun: 0.32, ambient: 1.0, fog: 1.7 },
  mist: { grey: 0.5, dim: 1.0, sun: 0.5, ambient: 1.02, fog: 3.4 },
  rain: { grey: 0.74, dim: 0.74, sun: 0.26, ambient: 0.98, fog: 2.8 },
  snow: { grey: 0.58, dim: 1.06, sun: 0.45, ambient: 1.05, fog: 2.3 },
};
const MIN_AMBIENT = 0.62;

/** Linear -> sRGB, the transfer three applies when it hands back a hex. */
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const hex = (r, g, b) =>
  '#' +
  [r, g, b]
    .map((v) => Math.round(Math.min(1, Math.max(0, toSrgb(v))) * 255).toString(16).padStart(2, '0'))
    .join('');

/** Linear RGB of a three Color. */
const rgb = (c) => [c.r, c.g, c.b];

function tinted(colour, tint) {
  // Mirrors `Atmosphere.refresh`: drain saturation, then scale brightness.
  const hsl = colour.getHSL({ h: 0, s: 0, l: 0 });
  const c = colour.clone().setHSL(hsl.h, hsl.s * (1 - tint.grey), Math.min(1, hsl.l * tint.dim));
  return c;
}

/** Mirrors `Atmosphere.lift`: raise lightness to at least `floor`, keep the hue. */
function lift(colour, floor) {
  const hsl = colour.getHSL({ h: 0, s: 0, l: 0 });
  const c = colour.clone();
  if (hsl.l < floor) c.setHSL(hsl.h, hsl.s * 0.85, floor);
  return c;
}

const HAZE_COLOR = 0xd8c3a4;
const MIN_AMBIENT_SKY_LIGHTNESS = 0.58;
const MIN_AMBIENT_GROUND_LIGHTNESS = 0.3;

const tiles = [];
for (const [id, mood] of Object.entries(MAP_MOODS)) {
  const sky = skyAt(mood.timeOfDay);
  const tint = TINTS[mood.weather];

  const skyC = tinted(sky.skyColor, tint);
  const hazeAmount = mood.haze ?? 0;
  if (hazeAmount > 0) {
    skyC.lerp(new skyC.constructor(HAZE_COLOR), Math.min(0.3, hazeAmount * 1.0));
  }
  const groundC = lift(sky.groundColor, MIN_AMBIENT_GROUND_LIGHTNESS);
  const ambSkyC = lift(skyC, MIN_AMBIENT_SKY_LIGHTNESS);
  const sunC = sky.sunColor.clone();
  const sunI = sky.sunIntensity * tint.sun;
  const amb = Math.max(MIN_AMBIENT, sky.ambientIntensity * tint.ambient);
  const L = sky.sunDirection;

  // A prop lit by the ambient hemisphere plus the sun. Albedo is a light
  // neutral, the same for every map, so the differences on the sheet are the
  // light and nothing else.
  const ALBEDO = 0.58;
  const face = (nx, ny, nz) => {
    const ndl = Math.max(0, nx * L.x + ny * L.y + nz * L.z);
    // Hemisphere ambient: mostly the sky colour from above, the ground bounce
    // from below, which is what HemisphereLight does.
    const hemi = 0.5 + 0.5 * ny;
    return [0, 1, 2].map((i) => {
      const ambC = rgb(ambSkyC)[i] * hemi + rgb(groundC)[i] * (1 - hemi);
      const direct = rgb(sunC)[i] * sunI * ndl;
      return ALBEDO * (ambC * amb + direct);
    });
  };

  tiles.push({
    id,
    hour: mood.timeOfDay,
    weather: mood.weather,
    sky: hex(...rgb(skyC)),
    ground: hex(...rgb(groundC)),
    top: hex(...face(0, 1, 0)),
    front: hex(...face(0, 0, 1)),
    side: hex(...face(1, 0, 0)),
    fog: (0.012 * tint.fog * (1 + (mood.haze ?? 0))).toFixed(4),
    sunI: sunI.toFixed(2),
    amb: amb.toFixed(2),
  });
}

const clock = (h) => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

const cells = tiles
  .map(
    (t) => `
    <figure class="tile">
      <div class="scene" style="background:${t.sky}">
        <div class="ground" style="background:${t.ground}"></div>
        <div class="box">
          <div class="f-top" style="background:${t.top}"></div>
          <div class="f-side" style="background:${t.side}"></div>
          <div class="f-front" style="background:${t.front}"></div>
        </div>
      </div>
      <figcaption>
        <span class="name">${t.id}</span>
        <span class="meta">${clock(t.hour)} · ${t.weather} · sun ${t.sunI} · amb ${t.amb} · fog ${t.fog}</span>
      </figcaption>
    </figure>`
  )
  .join('');

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { margin:0; background:#f4ecd9; color:#191510;
         font-family: ui-serif, Georgia, serif; padding:22px 24px 28px; }
  h1 { font-size:20px; margin:0 0 2px; letter-spacing:-0.01em; }
  .sub { font-family: ui-monospace, monospace; font-size:10px; letter-spacing:0.09em;
         text-transform:uppercase; color:rgba(25,21,16,0.5); margin-bottom:16px; }
  .grid { display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; }
  .tile { margin:0; }
  .scene { position:relative; height:96px; overflow:hidden; border:1.5px solid rgba(25,21,16,0.55); }
  .ground { position:absolute; left:0; right:0; bottom:0; height:30px; }
  .box { position:absolute; left:50%; bottom:22px; width:74px; height:52px;
         transform:translateX(-50%); }
  .f-top { position:absolute; left:12px; top:0; width:50px; height:20px;
           transform:skewX(-32deg); transform-origin:bottom left; }
  .f-side { position:absolute; right:0; top:12px; width:12px; height:40px;
            transform:skewY(-32deg); transform-origin:top left; }
  .f-front { position:absolute; left:12px; top:14px; width:50px; height:38px; }
  figcaption { padding-top:6px; }
  .name { display:block; font-size:11.5px; font-weight:600; }
  .meta { display:block; font-family: ui-monospace, monospace; font-size:8.5px;
          letter-spacing:0.03em; color:rgba(25,21,16,0.55); margin-top:1px; }
</style></head><body>
  <h1>Atmosphere preview</h1>
  <div class="sub">Computed from the same values the game uses &middot; not a screenshot</div>
  <div class="grid">${cells}</div>
</body></html>`;

fs.writeFileSync('tmp-moods.html', html);
console.log('wrote tmp-moods.html', tiles.length, 'tiles');
