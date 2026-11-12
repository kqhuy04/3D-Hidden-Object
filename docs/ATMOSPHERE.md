# Atmosphere: hour, weather, and what they cost

Every map is a place at an hour. `src/data/mapMood.ts` holds the hour and the
weather; `Atmosphere` turns them into a sky, a fog and two lights.

```
mapMood.ts  ──►  Atmosphere  ──►  scene.background, scene.fog
   hour,              │            SunShadows.setLight()
   weather,           │            SunShadows.setAmbient()
   haze               └─────────►  Weather.setKind()
```

## The sky model

`skyModel.ts` maps an hour to light through one number: the sun's elevation.
The keyframes are indexed by elevation rather than by clock time, so 09:00 and
19:00 get the same warmth for free and cannot drift apart as the table is tuned.

Sunrise is **07:30** and sunset **20:30**. That is a long summer day on purpose.
The first version used 06:00 and 18:00, which put every "evening" map in
darkness by half past seven: four maps came out the same near-black navy and
there was no way to ask for golden hour at all.

### Two things the model refuses to do

**It never puts the light below the horizon.** A directional light under the
ground lights props from underneath and points every shadow up. The *direction*
is clamped to 25–47 degrees while colour and intensity follow the real
elevation. Nobody notices, because the sky is a flat colour with no sun disc in
it — what reads as evening is the warmth and the dimness, not the angle. The
25-degree floor also keeps a fence's shadow inside the shadow camera.

**It is not symmetric.** Morning and evening at the same sun height are not the
same light: by the afternoon the air holds a day of dust. Without a warmth bias,
07:48 and 20:12 are pixel-identical and two maps set at those hours look like the
same map twice. `tests/Sky.test.ts` pins this.

## Weather is a modifier, not a preset

Each kind is a small set of multipliers applied to whatever the hour produced,
so a rainy map at 19:00 is a dim warm-grey evening rather than a fixed "rain"
look that ignores the clock.

| kind | grey | dim | sun | fog |
| --- | --- | --- | --- | --- |
| clear | 0 | 1.00 | 1.00 | ×1.0 |
| overcast | 0.72 | 0.94 | 0.32 | ×1.7 |
| mist | 0.50 | 1.00 | 0.50 | ×3.4 |
| rain | 0.74 | 0.74 | 0.26 | ×2.8 |
| snow | 0.58 | 1.06 | 0.58 | ×2.3 |
| motes | 0.15 | 0.90 | 0.55 | ×1.0 |

`grey` **desaturates the hour's own sky** rather than mixing it toward a fixed
grey. The first version mixed toward `#c9c9c4`, which made the four overcast maps
identical — a noon overcast and a four o'clock overcast were the same flat
blue-grey, and the hours may as well not have been set.

`haze` is per map on top of that. It thickens the fog *and warms the sky*, or the
"dust and heat" maps come out the same cool grey as the hospital corridor.

## Under water is a place, not a weather

`coral-reef` sets `submerged: true` instead of a weather. The distinction is not
pedantry: a reef does not stop being under water when the sun comes out, and
expressing it as another `WeatherKind` would have made the two mutually
exclusive. Everything the hour produced is *replaced*:

| | above water | under water |
| --- | --- | --- |
| background / fog colour | the hour's sky | `#14606a` lerped 12% toward it |
| fog density | 0.012 × tint | **0.045** — about 22 m of visibility |
| sun colour / intensity | warm, full | `#9fe4e0`, ×0.55 |
| particles | — | `motes`: marine snow, 0.45 m/s down |

The 12% keeps a morning reef cooler than a noon one without ever letting the sky
show through. `WaterSurface` draws the underside — a 420 m plane fifteen metres
over the body, following it in XZ — because a flat fog colour overhead is a
ceiling, and the thing that says *water* is movement above your head.

**Why this was needed.** The map is a seabed: corals, seagrass, a research
habitat, a sea turtle. Lit by a noon sky it came out as a sand desert with a
turtle flying through it. No amount of prop work fixes that; the light has to
say where you are before the props are read.

## The two floors

```
MIN_AMBIENT = 0.62
MIN_AMBIENT_SKY_LIGHTNESS = 0.58
MIN_AMBIENT_GROUND_LIGHTNESS = 0.30
```

The hunt is "find five small objects", so darkness is a budget. `MIN_AMBIENT`
stops the weather multipliers taking a night map below readability.

The two lightness floors fix a subtler bug. The hemisphere fill was being
coloured by the sky itself — right at noon, badly wrong at night, because a night
sky is a dark navy and a prop lit only by a dark navy light comes out almost
black. **The fill is a light source, not a paint colour.** Lifting its lightness
keeps the hour's hue and makes a night map readable.

## Precipitation

`Weather.ts` draws rain or snow as a single `THREE.Points`, one draw call,
animated entirely in the vertex shader from a per-point seed and a clock. The
drops wrap in a 30 × 22 × 30 m box centred on the player, so the field follows
the body instead of covering the map. Per frame the cost is two uniform writes.

The material is `toneMapped: false` and its colours are display-space: a raw
`ShaderMaterial` gets neither three's tone mapping nor its output colour
conversion, and a linear colour written by it would draw about a stop bright.

`tools/check-shaders.mjs` compiles the two shaders against a bare WebGL context —
a GLSL typo costs two seconds there instead of a forty-second map load.

## Reviewing the table without loading 22 maps

```bash
node tools/preview-moods.mjs          # writes tmp-moods.html
```

It bundles the two modules from source, computes exactly what `Atmosphere` would
hand three, and draws a Lambert-shaded box on a sky plate for each map. The sheet
is a preview, not a capture, and says so on its face.

```bash
npx vitest run tests/Sky.test.ts
```

Twelve assertions, of which the load-bearing ones are: the light is above the
ground at every hour; the ambient never drops below the floor; every map in the
registry has a mood and every mood has a map.

## What a new map needs

One line in `MAP_MOODS`. A map with no entry falls back to noon, clear — and the
test above fails, on purpose, so a new place cannot ship looking like every other
place.

Only `chrome-arcology-transit` sets `dayLengthSeconds`. A moving sun means a
moving shadow map, and the shadow budget in `SunShadows` assumes a still light.
