# The hunt: five objects that do not belong

The game used to be a photo hunt: three randomised subjects, a viewfinder, a
180-second clock, a four-check validator. That is all gone. What replaced it is
simpler to explain and harder to design — every map hides **five objects that do
not belong to its theme**, and the player has to notice them.

This document covers the mechanic, the data, where all hundred and five objects are,
and how to author another map.

---

## 1. The mechanic

| | |
|---|---|
| **Goal** | Find and pocket all five intruders on the map |
| **Input** | `E`, or a left-click — pick up whatever the crosshair is on. A drag of more than 6 px is a camera orbit, not a click |
| **Reach** | 3.2 m from the player's chest, and within 42% of the screen centre |
| **Occlusion** | A ray from the camera to the object must be clear (0.35 m tolerance) |
| **On pickup** | The object is removed from the scene and its buffers freed. It does not come back until a retry or replay |
| **Naming** | The HUD shows `???` until an object is found, then its name |
| **Clock** | Counts *up*, no limit. Shown as `m:ss` |
| **Hint** | At 5:00, a vague description of one still-missing object. Every 75 s after that, another |
| **Win** | All five found → results card with the time taken |

### Why no timer

The old round was a sprint: 180 seconds, three subjects. A hunt for five small
objects in a hundred-metre map is the opposite kind of task — the player has to
slow down and look at things. A countdown would punish exactly the behaviour the
mode is asking for, so the clock only measures.

### Why the names are hidden

A list of five names turns the map into a checklist: find the toaster, find the
TV. `???` keeps the question the right one — *what here is wrong?* — and makes
each find a small reveal. The hint exists because "look at everything" has a
failure mode: a player can walk past the same bench four times.

### Why they are not colliders

The five objects are loaded as their own group, separate from the map's collision
geometry. Two reasons:

1. **Removal is instant.** Picking something up has to erase it in the same
   frame. If the object lived inside the map's triangle soup, every pickup would
   force a rebuild of the collider — on `symphony-stagecraft` that is 1.18 million
   triangles.
2. **Walking through a toaster is fine.** These are small props. Making a hay bale
   block the player would be more annoying than convincing.

---

## 2. Where the data lives

`src/data/hiddenItems.ts`

```ts
export interface HiddenItemPlacement {
  id: string;        // unique within the map; the round tracks this
  asset: string;     // Polyfork asset id → /assets/hidden/<asset>.glb
  name: string;      // revealed only after pickup
  hint: string;      // the five-minute nudge: describes, never names
  spot: { x: number; z: number; y?: number };
  rotationY: number;
  scale?: number;
}
```

`spot.y` is optional. Without it the loader casts a ray straight down and sits the
object on the first surface it hits — starting at 3 m, not 60 m, because a ray
dropped from the sky lands on the first roof it meets (that is how a traffic cone
ended up on a cabin roof during development). With `y`, the object is placed
exactly, which is what furniture needs: a table top, a stump, a dock plank.

The meshes live in `public/assets/hidden/` and are downloaded by
`tools/fetch-hidden-items.mjs`. The credits for the CC BY meshes are written to
`public/assets/hidden/CREDITS.md` by the same script.

---

## 3. The objects

Twenty-two maps, five objects each: **110** in total. Positions come from
the map's own collision geometry (`node tmp-spots.mjs <map-id>`), not from guesswork,
and every one is verified pickable from a natural standing spot with the real follow
camera (`node tmp-pickable.mjs <map-id>`).

A position of `ground` means the height is not written down: the object stands on
whatever the collision resolver finds under that point, which is what keeps it from
floating or sinking on maps whose floor is not at zero.

The rule for choosing them is the same on every map: the object must be *impossible*
there, not merely unusual. A toaster in a forest needs a socket that does not exist; a
pizza box at a campsite is just a pizza box.

### Campground & Lake — `campground-lake`

*Five things were left in this camp that no camper would pack.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Toaster** | A box that browns bread and pops it up — and it wants a wall socket. | `2.35, 0.76, 1.45` |
| **Fire hydrant** | A squat iron post with two capped nozzles, painted red, in a clearing. | `-3, 0, 6.5` |
| **Parking meter** | A thin post with a coin slot and a little window, waiting for a car. | `-13, -0.42, -3.5` |
| **Phone booth** | A glass box with a handset inside, and no wire running to it. | `-19.5, -0.64, 1` |
| **Kitchen sink** | A basin with a tap and a drain — everything but the kitchen sink, and here it is. | `-10.5, 1.04, -11` |

### Alpine Ski Resort — `alpine-and-snow`

*Five things were left on this mountain that the snow does not explain.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Scarecrow** | A figure in a coat and a straw hat, arms held out, guarding a field that is not there. | `-7.6, ground, 39.4` |
| **Toilet** | A white ceramic bowl with its cistern, standing in the snow behind the ski racks. | `11.0, ground, 46.8` |
| **Upright piano** | A tall dark case with a row of keys, its back against the station wall. | `11.2, ground, 35.4` |
| **Riding mower** | A little tractor with a cutting deck, parked where the grass is under two metres of snow. | `-2.0, ground, 40.0` |
| **Admiralty anchor** | A rusted iron hook on a wooden stock, taller than a person, beside the signpost. | `23.0, ground, 48.5` |

### Chrome Arcology Transit — `chrome-arcology-transit`

*Five objects here were made by hands that never touched chrome.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Wooden barrel** | Staves and iron hoops, the kind you roll — in a city with no wood. | `36.1, 0.06, -13.4` |
| **Hay bale** | Dried grass, tied up with twine, dropped where a bus parks. | `30, ground, 11.4` |
| **Stone well** | A ring of stone with a rope and a bucket, sunk where nobody digs. | `-6, ground, -36.4` |
| **Treasure chest** | A curved lid, iron bands, a lock — the kind of thing pirates bury. | `16.5, ground, 15.6` |
| **Candle cluster** | Wax on iron spikes, waiting for a match nobody carries. | `44, 0.11, -12` |

### Chronos Hearth — `chronos-hearth`

*Five things were carried into this settlement from a century it has never seen.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Rubber duck** | Small, yellow, and it floats. It has never seen water here. | `-2.2, 0.58, -14.6` |
| **Microwave** | A little oven with a numbered keypad and a glass door. | `-6.6, 0.46, -7.8` |
| **Office chair** | A chair with five little wheels and a lever underneath. | `17.6, ground, 25.2` |
| **Vending machine** | A lit box of snacks behind glass, humming to itself. | `33.6, ground, 16.2` |
| **Skateboard** | A board with four small wheels under it. | `24.2, ground, 22.6` |

### Coral Reef — `coral-reef`

*Five things sank here that were never meant to get wet.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Fire hydrant** | A squat iron post with two capped nozzles — for a street that is not down here. | `13, -0.07, 2` |
| **Parking meter** | A thin post with a coin slot and a little window, waiting for a car that cannot come. | `18, -0.31, 9.5` |
| **Phone booth** | A glass box with a handset inside, and no line to anywhere. | `-12.5, 1, -2` |
| **Jukebox** | A lit arch of glass and chrome that plays for coins. It has been quiet a long time. | `-17, 0.67, -6.5` |
| **Toilet** | Porcelain, a lid, a cistern — and absolutely nothing to plumb it into. | `-7, -1.92, 19.5` |

### Countryside Railway — `countryside-railway`

*Five things came off a train that has never stopped here.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Sofa** | Three cushions, two arms, upholstery — on a platform where people wait standing up. | `-2, 0, 2.5` |
| **Espresso machine** | Chrome, a portafilter, a steam wand — it wants pressure and a power line. | `-5, 1.17, -8` |
| **Upright piano** | Eighty-eight keys under a wooden lid, out in the weather. | `8.5, 1.21, -18.5` |
| **Hammock** | A canvas sling between two posts, for a nap nobody takes on a platform. | `18, 0.05, 12.5` |
| **Office chair** | Five wheels, a gas lift, a lever underneath — on gravel. | `8, 0, 12.5` |

### Cozy Farm — `cozy-farm`

*Five things were left in this yard that the farm has no use for.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Phone booth** | A red glass box with a handset — the fields have no line. | `-13.5, 0, 6` |
| **Vending machine** | A lit cabinet of snacks behind glass, humming where there is no mains. | `11.5, 0, 6` |
| **Jukebox** | Chrome and glass, and a slot for coins, out among the crops. | `-11, 0, -11.5` |
| **Fridge freezer** | A tall white cupboard that hums and keeps things cold. It needs a wall socket. | `-1, 0, -11.5` |
| **Parking meter** | A coin slot on a post, in a field where nothing parks. | `9, 0, -1.5` |

### Día de Muertos — `dia-de-muertos`

*Five things were carried in with the flowers that belong to no altar.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Toilet** | Porcelain, a lid and a cistern, standing among the graves. | `-5.5, -1.7, -6` |
| **Sofa** | Three cushions and two arms, set out as if for a family that never sits. | `-3, 3.19, 16.5` |
| **Kitchen sink** | A basin with a tap and a drain — everything but the kitchen sink, and here it is. | `-10.5, -3.52, 9` |
| **Office chair** | Five wheels and a gas lift, parked on a tiled landing. | `12, 7.19, 1.5` |
| **Post box** | A red iron pillar with a slot for letters, at the edge of the graves. | `4.5, 3.19, 16.5` |

### Construction Site — `construction-site`

*Five things were unloaded here that no site ordered.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Sofa** | Three cushions and two arms, on a stack of pallets in the mud. | `12.5, -2.57, 3.5` |
| **Fridge freezer** | A tall white cupboard that hums, standing where the power is a generator. | `15, 0.05, 18.5` |
| **Upright piano** | Eighty-eight keys under a wooden lid, out where the excavator turns. | `-2.5, -5.72, 3.5` |
| **Bird bath** | A little stone basin on a pedestal, for a garden that is not here. | `20, -0.34, 6` |
| **Post box** | A red iron pillar with a slot for letters, on a site with no address. | `28.5, 0.4, -2.5` |

### Frontier Town — `frontier-town`

*Five things were left on this street that were not made in this century.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Vending machine** | A lit cabinet of snacks behind glass, humming on a boardwalk. | `-3, 0.05, 13.5` |
| **Phone booth** | A glass box with a handset, and no wire running out of it. | `-11, 1.22, 3.5` |
| **Fridge freezer** | A white cupboard that keeps things cold. It wants a wall socket. | `7, 0.29, 23.5` |
| **Jukebox** | A lit arch of chrome and glass that plays for coins. | `7, 0.29, 3.5` |
| **Microwave** | A little oven with a numbered keypad and a glass door. | `-3, 0.01, 23.5` |

### Hospital — `hospital`

*Five things were brought into this building that belong outside it.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Hay bale** | Dried grass, tied with twine, sitting on a bench in a corridor. | `12, 0.03, 1.5` |
| **Campfire** | A ring of stones with charred logs — indoors, on a vinyl floor. | `-8, 0.04, 1.5` |
| **Scarecrow** | A coat on crossed sticks with a sack for a head, out in the ambulance bay. | `17, 0.03, -3.5` |
| **Anvil** | A block of iron with a horn, heavy enough to need two people. | `-10.5, 0.04, -6` |
| **Rowboat** | A wooden hull with two oars, parked where the trolleys go. | `17, 0.03, 6.5` |

### Japanese Suburban City Street — `japanese-suburban-city-street`

*Five things were left on this street that the street has no place for.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Scarecrow** | A coat on crossed sticks with a sack head, watching a pavement. | `-8.5, 0, 1.5` |
| **Straw bale** | A cube of dried stalks, tied with twine, on a tiled street. | `11.5, 0, 1.5` |
| **Anvil** | A block of iron with a horn, dropped by a kerb. | `-19, 0.41, -8.5` |
| **Riding mower** | A little tractor with a cutting deck, parked across a tram track. | `-31, 0.36, 5` |
| **Coffin** | A tapered wooden box with brass handles, left on the far pavement. | `1.5, 0, 11.5` |

### Medieval Village — `medieval-village`

*Five things appeared in this village that no trader could have carried here.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Vending machine** | A lit cabinet of snacks behind glass, humming beside the market stalls. | `9, 0.61, 9.5` |
| **Office chair** | Five little wheels and a lever underneath, on packed earth. | `-11, 0.04, -2` |
| **Microwave** | A little oven with a numbered keypad and a glass door. | `-8.5, 0.06, -9.5` |
| **Traffic cone** | Bright orange, meant for a road, standing in a lane with no road. | `11.5, 0.04, -9.5` |
| **Espresso machine** | Chrome, a portafilter and a steam wand — it wants pressure and a cable. | `14, 0.07, -2` |

### Modern Restaurant Cafe — `modern-restaurant-cafe`

*Five things were left on this terrace that came in from a field.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Straw bale** | A cube of dried stalks tied with twine, beside a parasol. | `12.5, 0.05, 6` |
| **Anvil** | A block of iron with a horn, sitting where the plates go. | `9, 1.13, -3` |
| **Scarecrow** | A coat on crossed sticks with a sack for a head, among the olive planters. | `-7.5, 0.05, 3.5` |
| **Rowboat** | A wooden hull with two oars, parked between the tables. | `0, 0.05, -4` |
| **Riding mower** | A little tractor with a cutting deck, parked at the back of the room. | `-7.5, 0.05, -4` |

### Neighborhood Pathways — `neighborhood-pathways`

*Five things were left along these paths that this street never had.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Deck cannon** | An iron barrel on a wooden carriage with small wheels, aimed at a hedge. | `13, 0.42, 10` |
| **Stone well** | A ring of stone with a rope and a bucket, sunk into a front lawn. | `-17, 0.53, 1` |
| **Coffin** | A tapered wooden box with brass handles, left on a garden path. | `17.5, 0.42, 14.5` |
| **Outhouse** | A little timber hut with a crescent moon cut in the door. | `-21.5, 0.45, -14` |
| **Anvil** | A block of iron with a horn, sitting on the pavement. | `1, 0.45, -26` |

### NYC City — `nyc-city`

*Five things were left on this block that came in from somewhere quieter.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Stone well** | A ring of stone with a rope and a bucket, on a sidewalk. | `-9, 0.57, 11` |
| **Rowboat** | A wooden hull with two oars, pulled up where the taxis stop. | `-15, 0.96, -4` |
| **Deck cannon** | An iron barrel on a wooden carriage, pointed down an avenue. | `7, 0, 6` |
| **Straw bale** | A cube of dried stalks, tied with twine, on a city sidewalk. | `12, 0, -6.5` |
| **Coffin** | A tapered wooden box with brass handles, left in a doorway. | `-13.5, 0.35, -14.5` |

### Office — `office`

*Five things were left in this building that were never part of the job.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Straw bale** | A cube of dried stalks, tied with twine, in a breakout area. | `5.5, 0.05, 2` |
| **Campfire** | A ring of stones with charred logs, burning on a carpet tile. | `-9, 0.77, 1` |
| **Anvil** | A block of iron with a horn, sitting on a desk where a monitor should be. | `9, 1.2, -0.5` |
| **Camp tent** | Poles, canvas and a zip door, pitched where a meeting table should be. | `10.5, 0.05, 7` |
| **Scarecrow** | A coat on crossed sticks with a sack for a head, standing by the windows. | `-2, 0.05, 4.5` |

### Pirate Cove — `pirate-cove`

*Five things washed up in this cove that no ship here ever carried.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Vending machine** | A lit cabinet of snacks behind glass, humming on the boards. | `-1, 0.88, 10.5` |
| **Laptop** | A hinged slab that folds shut, the kind people type on. | `5, 0.88, 12` |
| **Office chair** | Five little wheels and a lever underneath, on wet sand. | `1.5, 0, -13` |
| **Traffic cone** | Bright orange, meant for a road, standing where there is only sand. | `9, 0, -10.5` |
| **Jukebox** | A lit arch of chrome and glass that plays for coins. | `11.5, 0, -3` |

### Skatepark — `skatepark`

*Five things were dumped here that no skater brought.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Sofa** | Three cushions and two arms, parked on a flat slab. | `-9, 0.05, 10.5` |
| **Fridge freezer** | A tall white cupboard that hums, standing by the rail. | `8.5, 0.05, 8` |
| **Upright piano** | Eighty-eight keys under a wooden lid, on a concrete deck. | `-14, 0.05, 5.5` |
| **Toilet** | Porcelain, a lid, a cistern — and nothing to plumb it into. | `-1.5, 0.05, 18` |
| **Kitchen sink** | A basin with a tap and a drain, sitting in the middle of the flat. | `3.5, 0.05, 13` |

### Space Base — `space-base`

*Five things were brought out here that this base has no use for.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Hay bale** | Dried grass tied with twine, sitting on a service walkway. | `-8.5, 0.67, -15.5` |
| **Stone well** | A ring of stone with a rope and a bucket, sunk into regolith. | `11, -0.75, -20` |
| **Outhouse** | A little timber hut with a crescent moon cut in the door. | `-1, -1.1, -30.5` |
| **Campfire** | A ring of stones with charred logs — in a place with no oxygen to burn. | `2, -0.44, -33.5` |
| **Ship anchor** | Two flukes and a shank, heavy enough to hold a ship — with no sea for miles. | `-6, 0, -6.5` |

### Stadium — `stadium`

*Five things were left in this ground that no team brought.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Sofa** | Three cushions and two arms, set down where the warm-up happens. | `16.5, -0.06, 1` |
| **Fridge freezer** | A tall white cupboard that hums, standing on the touchline. | `16.5, -0.06, -9` |
| **Straw bale** | A cube of dried stalks, tied with twine, on the turf. | `11.5, 0.05, 6` |
| **Upright piano** | Eighty-eight keys under a wooden lid, on the running track. | `11.5, 0.05, -14` |
| **Rowboat** | A wooden hull with two oars, pulled up in the long-jump pit. | `6.5, 0.05, -19` |

### Symphony Stagecraft — `symphony-stagecraft`

*Five things were left in this hall that no orchestra carries.*

| Object | Hint (shown after five minutes) | Position |
|---|---|---|
| **Hay bale** | Dried grass tied with twine, sitting on a riser in the stalls. | `-6.5, 0.45, 0` |
| **Kitchen sink** | A basin with a tap and a drain, in the middle of the floor. | `7, 0.85, 7.5` |
| **Riding mower** | A little tractor with a cutting deck, parked between two seat rows. | `-21.5, 0.73, 6` |
| **Vending machine** | A lit cabinet of snacks behind glass, humming against the panelling. | `-15.5, 0.85, -6` |
| **Office chair** | Five wheels and a gas lift, on a stone floor built for pews. | `1.5, 0.45, -2` |

---

## 4. Authoring the next map

0. **Prepare the kit.** Drop the archive in `maps/` and run
   `node tools/prepare-maps.mjs --only <substr>`. That unzips the baked
   `scene.glb`, measures every object, compresses the payload into
   `public/assets/maps/`, writes `maps/reports/<id>.json` and rebuilds
   `src/data/mapRegistry.ts`. Add a `LABEL_OVERRIDES` entry if the kit's name
   describes the box rather than the place — and use `--refresh` to rewrite the
   sidecar, because an up-to-date map is skipped and keeps the old label.
1. **Give the map a mood** in `src/data/mapMood.ts` before anything else, so
   every later look at the map is lit the way it will ship. `tests/Sky.test.ts`
   fails until every registry map has one. `node tools/preview-moods.mjs` draws
   all of them as a swatch sheet in a couple of seconds, which is where the four
   atmosphere mistakes were caught — not by reasoning about the numbers.
2. **Read the map's vocabulary.** `node tmp-keys.mjs <map-id>` prints the prop
   names the kit places, biggest first, which is what tells you what the map is
   made of — and therefore what cannot belong there.
3. **Find candidate spots.** `node tmp-spots.mjs <map-id>` scans the map's own
   collision triangles and prints two lists: `T` surfaces (a flat top between
   knee and chest height, i.e. a table, crate or bench, with the gap to the
   nearest standable point) and `G` open ground where a capsule fits. Node names
   in the exported GLBs are mesh part names — `body`, `hull` — not the kit's part
   names, so "put it on the picnic table" cannot be done by name; the triangles
   are the only thing that knows.
4. **Pick objects from another theme.** `node tmp-search.mjs "toaster" "vending
   machine"` searches the Polyfork catalogue and prints ids, triangle counts and
   real-world sizes. The test is *impossible*, not *unusual*: a toaster in a
   forest needs a socket that does not exist, a pizza box at a campsite is just a
   pizza box. Prefer small props; one big one per map is enough to be funny.
5. **Add the ids to `tools/fetch-hidden-items.mjs`** and run it. It downloads the
   GLB, records the credit line and rewrites `CREDITS.md`.
6. **Write the entries** in `src/data/hiddenItems.ts` under the map's id, with a
   `hint` that describes the object without naming it.
7. **Solve the placement.** `node tmp-place.mjs <map-id>` moves each object
   through the candidate spots inside the live scene and asks the game's own
   `findTarget` from eight approaches at two stand-off distances, then writes the
   winning coordinates to `tmp-place-<map-id>.json`. `node tmp-apply.mjs` copies
   those back into the data file. This is the cheap loop: one browser launch
   instead of one per attempt.
8. **Verify for real.** `node tmp-pickable.mjs <map-id>` walks up to each object
   with the follow camera settling naturally — no camera override — and reports
   `OK` or `NOT PICKABLE` per object. This is the gate: a harness that parks the
   camera two metres out proves nothing about a camera that normally sits eight
   metres behind the body.
9. **Check the ground and the picture.** `node tools/audit-grounding.mjs --map
   <id>` for props hanging over a bank, and `node tools/map-thumbs.mjs --only
   <id>` for the card in the picker. The audit only flags props *tilted* against
   the terrain — a prop floating uniformly is bucketed as "elevated, expected" —
   so the thumbnail is not redundant.
10. **Regenerate the doc and run the tests.** `node tools/hidden-objects-doc.mjs
    --write`, then `npx tsc --noEmit && npx vitest run`. `tests/Content.test.ts`
    is the one that catches a map added without objects, an object pointing at an
    asset that was never shipped, or a duplicated id.

A map with no entry in `HIDDEN_ITEMS` is not broken — it opens in free roam, with
the HUD reading "Nothing to find here".

---

## 5. What was removed

The photo mode is gone, not hidden behind a flag:

- `src/game/photography/PhotoSystem.ts`, `PhotoValidator.ts`
- `src/game/missions/ObjectiveSelector.ts`
- `src/data/targetCatalog.ts`
- `src/game/world/TargetRegistry.ts`
- The `F` binding, the shutter button, the viewfinder corners, the shutter flash,
  the star row, the 180-second countdown and the `timeout` state.

`RoundManager` now tracks a list of placements and an elapsed time; the results
card reports objects found and time taken. `GameHUD` renders the five slots, the
brief line, the hint box, the crosshair and the pickup prompt.

---

## 6. Verification

- **110/110 objects** are pickable: `node tmp-pickable.mjs <map-id>` walks up to
  each one with the follow camera settling on its own and asks the game's own
  `findTarget`. Every map reports `5/5`; there is no `NOT PICKABLE` line left.
- **The reach bug that made the hunt unplayable is fixed.** Reach used to be
  measured from the camera, which sits eight metres behind the body, so no object
  was ever within 3.2 m and `E` did nothing. It is measured from the player's
  chest now, with aim and line of sight still taken from the camera.
- **A click picks up too.** The canvas is also the orbit surface, so a press that
  moves more than six pixels is a drag and a press that does not is a pickup.
- **Pickup chain**, driven by real browser key and mouse events: `E` or a click →
  object removed from the scene (5 → 0) → slot flips to its name → toast →
  results card.
- **Replay and retry** restore all five meshes; switching maps swaps the set and
  leaves none of the previous map's objects behind.
- **Hint** appears at 5:01 of hunt time with the vague text, and the clock stops
  while paused.
- `tsc` clean, **82 tests pass**, `npm run build` OK. `tests/Content.test.ts`
  checks the content itself: every playable map has five objects, no object points
  at an asset that was never shipped, and the two rejected example assets (a
  pizza slice, a flat-screen TV) stay unused.

Screenshots: `docs/hunt/`. `node tmp-pickable.mjs <map-id> <out-dir>` writes one
per object from the angle that actually works, which is also the quickest way to
see that an object is sitting on something rather than floating.
