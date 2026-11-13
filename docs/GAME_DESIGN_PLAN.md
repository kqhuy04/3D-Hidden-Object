# Making each map its own game

> **Superseded — kept for the reasoning, not as a plan.** The user read this and
> cancelled the direction: *"thôi mỗi map là 1 game riêng bỏ đi, hơi khó quá, cứ
> tập trung làm tốt game hiện tại là oke."* The per-map minigames, the three
> coins per map, the per-map characters and the dragon finale are **not** being
> built. One part of this document did ship and is live: the time-of-day and
> weather system, in `src/data/mapMood.ts` and `src/game/render/Atmosphere.ts`
> (see `docs/ATMOSPHERE.md`). Everything below about game modes is background.

A design plan, not an implementation. Written against the build as it stands
(21 maps, 5 odd objects each, a walk-and-look hunt with a boom camera), so every
recommendation names the code it lands in.

---

## The short answer

"Every map is its own game" is the right instinct and the wrong unit.

The instinct is right because a player who has finished five maps should feel
they have seen five *places*, not five textures on the same walk. The unit is
wrong because twenty-one bespoke minigames is roughly twenty-one times the work
of one, and the failure mode is not "it ships late" — it is that each of the
twenty-one gets a tenth of the polish the hunt itself has, and the game reads as
a demo reel. That is exactly the "hời hợt" outcome.

What actually makes a map feel like its own game is **four cheap layers, three
of which are shared code**:

| Layer | Per map | Shared |
| --- | --- | --- |
| **Atmosphere** — hour, weather, light | one row of data | one system |
| **Character** — who you are here | one skin | one rig, one animator |
| **Activity** — one thing you do besides hunting | one of six mechanics | one interaction spine |
| **Place** — the kit itself | already built | already built |

Atmosphere first. It is the only layer that touches all twenty-one maps at once,
it is the cheapest, and it is the one a trailer sells with.

---

## 1. Atmosphere: time of day and weather

### What it changes

Everything visible already flows through four values, and all four are already
owned in one place:

- `SunShadows` — sun direction, sun colour, intensity, hemisphere fill
  (`src/game/render/SunShadows.ts`)
- `scene.fog` — colour and density (`Game.ts:130`, currently `FogExp2(0xd6eaf8, 0.012)`)
- `renderer.toneMappingExposure` — currently `1.05` (`Game.ts:119`)

So the system is a **preset that writes those four**, plus one new file of data.

```ts
// src/data/climate.ts
export interface Climate {
  /** Hour the map is pinned at, 0–24. 14.5 is mid-afternoon. */
  hour: number;
  /** How far the sun is allowed to drift during a round, in hours. */
  drift: number;
  /** Weather this map can produce, and how often. Empty means always clear. */
  weather: Array<{ kind: 'clear' | 'overcast' | 'rain' | 'snow' | 'fog'; weight: number }>;
  /** Colour the light has at this hour, if the automatic ramp is not right. */
  tint?: string;
  /** Fog override, for maps whose own horizon colour is not the sky's. */
  fog?: { colour: string; density: number };
}
```

### The one hard rule

**A hunt must never be unwinnable because of the weather.**

This is a hidden-object game. The odd objects are deliberately hard to see —
behind a table edge, beside a same-coloured prop. Turning the sun down for mood
can turn a 5-minute round into an impossible one, and the player will not blame
the weather, they will blame the game.

So the atmosphere system carries a visibility floor, and it is not negotiable:

- Sun elevation never drops below **18°** on a map with no artificial light. At
  18° the ground is still lit at roughly 45% of noon; shadows are long and the
  scene is warm, which is the good-looking part of a low sun, without the part
  that hides objects.
- Maps that *are* dark — the office at night, the space base, the hospital —
  get their light from a different source instead: a raised hemisphere fill and
  a warmer ambient, so the scene is dim in colour and not in contrast. Dusk
  reads as dusk because the shadows are long and blue, not because the player
  cannot see.
- Weather is atmosphere, not occlusion. Rain darkens the sky and wets the
  ground; it does not reduce the light on the objects. Fog is capped at a
  density where the far wall of a 30 m map is still legible.

If a preset cannot meet the floor, the preset is wrong, not the floor.

### Why pin the hour per map instead of running a cycle

A running cycle means a player who starts at 17:50 finishes in the dark, and the
difficulty of the map silently depends on when they pressed Start. That is the
same class of bug as a timer that runs during the pause screen.

Instead: each map is pinned to an hour that suits it, and the sun drifts by a
small amount *within* that hour over a round — enough that the light visibly
moves over ten minutes (a 2-hour drift is 30° of arc, which is a long shadow
turning), not enough to reach night. The drift resets on retry, so a retried
round looks like the round before it.

This also gives the map catalogue an identity for free: the campground is early
morning, the frontier town is high noon, the cove is late afternoon, the
symphony stage is evening. Twenty-one maps that already look different now also
*feel* like different times of day, which is the thing a player remembers.

### Weather as a state machine, not a particle demo

One weather state active at a time, changed on a timer (5–9 minutes, weighted by
the map's own list) with a 6-second crossfade of the light and fog. Precipitation
is a single `Points` cloud that follows the player and wraps inside a 20 m box —
one draw call, no per-drop objects. Rain is stretched quads, snow is round
sprites, both at a few thousand particles.

`clear → overcast → rain` is a transition, not three presets: the sun dims and
desaturates while the fog thickens over the same six seconds.

### What it costs

- ~120 lines in a new `src/game/render/Atmosphere.ts`
- ~40 lines of changes to `SunShadows` (accept a direction and a colour ramp
  instead of the fixed `SUN_DIRECTION` constant)
- ~30 lines of particle code
- one data row per map
- **no new draws on a clear day**

### How it is verified

- A screenshot per map per hour preset, from the spawn, at 3 weather states —
  a contact sheet a human can flip through.
- A guardrail test: for every map and every weather state, sample the mean
  luminance of a 64 × 64 patch at the five odd objects' screen positions. Any
  map/weather pair below the floor fails the build. This is the test that stops
  "atmospheric" from becoming "unplayable".

---

## 2. Activity: one mechanic per map, from a kit of six

Not twenty-one games. Six mechanics, assigned per map, built on one spine.

### The spine

Every activity is the same shape as picking up an object, which the game already
has: **be in reach → press E → a short, forgiving challenge → a result the HUD
already knows how to show.** `HiddenItemSystem.findTarget` already does the
reach, the aim and the occlusion test; `Game.refreshPickupPrompt` already drives
the prompt; `TargetFrame` already draws the corner marks. An activity is a new
`Challenge` implementation plus a data row.

### The six

| Mechanic | What the player does | Reuses | Fits |
| --- | --- | --- | --- |
| **Fishing** | Cast, wait, strike at the right moment | water collider, a 2-state timing bar | campground, coral reef, pirate cove |
| **Sketching** | Hold still on a target for 3 s while it is framed | camera, `TargetFrame` | symphony stage, medieval village, office |
| **Repair** | Fit 3 parts into the right sockets | prop transforms, drag-free "cycle part" | construction site, railway, space base |
| **Chase** | A creature takes something and runs; corner it | existing prop/collision system | cozy farm, neighbourhood, hospital |
| **Rhythm** | Hit 8 notes in time with the stage | audio clock (already in `AudioEngine`) | symphony stage, skatepark, stadium |
| **Traversal** | A short climb/leap chain to reach a ledge | `PlayerController` jump + crawl | chronos hearth, dia de muertos, nyc |

Two maps get no mechanic. A map whose only job is to be a very good hunt is not
a hole in the design.

### Why six and not twenty-one

Because a mechanic is only good once it has been tuned against three maps. Six
mechanics × 3 maps each is 18 opportunities to find the moment where it stops
being fun; twenty-one mechanics is twenty-one first drafts. The player also
learns the vocabulary — the second fishing map is better than the first because
they already know how to cast — and that learned fluency is what makes a
catalogue feel like a game rather than a sampler.

### Assignment rule

A map gets the mechanic its *kit* suggests. Fishing goes where there is water
the player can already walk into (the campground's bed is dredged to a beach
profile and its shallows are wadeable). Rhythm goes where there is a stage. This
is why the list above names maps: if a mechanic does not fit the geometry, it
will read as bolted on no matter how good it is.

---

## 3. Characters: one rig, many skins

The animator is built around one Mixamo humanoid skeleton with eight clips
(`CharacterAnimator.loadAnimations`). Nothing in the system cares what the mesh
looks like as long as the bone names match.

So: **do not add a character system.** Add skins. A skin is a GLB whose bones
carry the same names, loaded instead of
`family-road-tripper-247570.glb`, with the same `loadAnimations` path. One
character per map, chosen by the map's data row.

Two caveats, both learned the hard way elsewhere in this codebase:

- The clip set is authored for a humanoid of a specific height. A skin whose
  hips sit 20 cm lower needs the `bakedHip` ratio to follow it, or the feet
  float. `CharacterAnimator.buildClip` already has the ratio hook.
- Skins with capes, tails or skirts will clip through the crawl pose. Prove two
  skins end to end — one tall, one short — before commissioning twenty-one.

---

## 4. The final map

The dragon is a good idea and a scope trap, in that order.

The trap is that a flying boss with fire breath and thrown spears is a *new
genre*: new aiming, new projectile physics, new enemy state machine, new damage
and death. Every one of those is a system this game does not have, and a bad
version of any of them makes the last thing the player sees the worst thing in
the game.

The version that fits: **the dragon is a moving hidden object.**

- It flies a fixed circuit over the map. It is always in view, so the hunt is
  not "find it" but "get a clean shot".
- It breathes fire on a telegraph — a 2-second glow, then a cone. The player
  steps out of the cone. That is the whole defensive verb, and it reuses the
  collision the player already has.
- The player throws a spear when in reach and roughly on target: reuse
  `findTarget`'s reach and off-axis gates, aim at the dragon instead of a prop.
- Three hits, no death state. Getting caught in the fire costs a strike from the
  existing three-strike budget, which the HUD already draws and the results
  screen already understands.

That is a boss fight assembled from parts that already exist, and it stays
inside the game's tone: the player loses by being careless, never by being slow.

---

## 5. Build order

Each phase ends at something a player could be handed.

**Phase 1 — Atmosphere.** Hour presets for all 21 maps, sun arc and drift, the
visibility floor and its test. *Done when:* every map looks different from every
other at a glance, and the luminance test passes on all 21 × 5 objects.

**Phase 2 — Weather.** The state machine, rain and snow, per-map weights.
*Done when:* a round can be played start to finish in rain with no drop in
findability, and the transition is invisible.

**Phase 3 — Two activities, proved.** Fishing on the campground, sketching on
the stage. *Done when:* both have been played by someone who was not told how
they work, and the answer to "what do I do" is on screen.

**Phase 4 — Characters.** Two skins, tall and short, through every clip.
*Done when:* the crawl pose does not clip and the feet do not float on either.

**Phase 5 — The remaining four mechanics**, one at a time, each on one map
before it is put on three.

**Phase 6 — The dragon**, built only after the throw mechanic from Phase 3 has
been in the game for a while.

---

## What I would cut

- **The dragon as a *new* genre.** Keep it a boss assembled from the hunt.
- **A live day/night cycle.** Pin the hour per map; drift within it.
- **A character per map on day one.** Two, proved, then the rest.
- **Minigames on all 21 maps.** Six mechanics, assigned where the kit asks for
  them, with at least two maps left as pure hunts.

The thing that makes this game sellable is not that every map has a different
verb. It is that every map is a place someone obviously spent a week on, and
that the thing you do there is the thing that place would have you do.
