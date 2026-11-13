# Photo Hunt — deep architecture notes

Companion to `MEMORY.md`. Everything here is a trap that already cost a debugging
session once. Read the relevant section before changing that subsystem.

## Rendering & performance

- **No post-processing chain.** `Game.render()` is one `renderer.render`;
  `antialias: true` is the only AA. Targets are marked by DOM corner brackets from the
  bounding sphere (`src/ui/TargetFrame.ts`) — frame `selected.centre`/`radius`,
  **never** `selected.item` (reading `item` dropped the frame on every decoy: prompt
  appeared, E cost a strike, nothing marked).
- **Shadow maps rebuild on demand**: `autoUpdate = false`, `needsUpdate` flipped at
  `max(preset.refreshMs, frameMs * 2.5)` — a fixed ms value exceeds a whole frame on a
  slow machine. Distance-gated at 0.4 m, which is what fixed the juddering walk (it
  rebuilt 20×/s standing still). Nothing rebuilds while paused or in a menu.
- **The sun follows the player** (6/4 m grid, ±30 m box, 1024²). Pinned to the origin
  at ±45 m, a player 60 m out lost their shadow entirely.
- `castShadow` only above a 0.18 m world bounding radius — scatter (pebbles, gravel)
  was 89 of 1063 casters and covered no texel.
- **Lights belong to `Game`'s scene, not the loaded map.** `WorldLoader.unload`
  disposes everything under its group; the sun there would free an 8 MB shadow map on
  every map change and leave the next map unlit.
- `quality.setLevel` must run once unconditionally at boot — `applySettings` skips it
  when the level has not changed, which at boot it never has.
- **Menus must not pay for the game.** `quality.tick` only on `state === PLAYING`,
  `Game.render` early-returns on `state === MENU`. Ungated, the start screen's second
  context plus a full-screen `filter: blur()` made a fast machine look slow, walked the
  scaler to the bottom preset, and every round then began at 360p with shadows off:
  *"đồ họa ban rõ nét ban đầu đâu?"*. The backdrop blur is now baked on disk.

## Atmosphere

- **`Atmosphere` is the single owner of sky, fog and both lights.** `Game`'s scene sets
  no background or fog — two places writing the sky is how a dusk sky ends up lit by a
  noon sun. `src/data/mapMood.ts` holds one mood per map; `skyModel.ts` keyframes
  hour → light by **sun elevation**, so 09:00 and 19:00 share warmth for free.
  Sunrise 07:30, sunset 20:30.
- **A directional light's direction is its position minus its target**, so
  `SunShadows.update` aims *before* `if (!this.enabled) return`.
- Precipitation is one `THREE.Points`, one draw call, animated in the vertex shader.
  `toneMapped: false` with display-space colours — a raw `ShaderMaterial` gets neither
  tone mapping nor the sRGB encode.

## Collision

- `HiddenItemSystem.findTarget`: reach 3.2 m from the body at chest (+1.1 m),
  `offAxis ≤ 0.42`, occlusion ray with 0.35 m tolerance.
- GLB node names are **mesh part names** (`body`, `hull`, `slab`), never kit part
  names. You cannot address "the picnic table" by name; ask the collision triangles.
- **A triangle is solid where the body meets it, not where its box is lowest.**
  `surfaceYAt` interpolates the triangle's height at the contact point; a degenerate XZ
  projection (a vertical wall panel) returns `-Infinity` and keeps the old bounds test.
  Otherwise one long diagonal brace blocks a crawl for its whole length.
- **Step allowance follows the ground underfoot** (`stepBonusUnder`), not the surface
  being stepped onto — otherwise the last step of every staircase, where the top tread
  meets another prop's deck, is refused. On a flight (`bonus > 0`) risers are measured
  from the feet, not the prop's base. Kit risers are 0.34–0.47 m against a 0.35 m
  limit; that is why the bonus exists.
- **`WorldCollision.supportHeight` is private and takes a capsule**, not a step
  height. Passing a number makes the upper bound `NaN`, which silently returns the
  highest roof in the map (a coffin at y 0.35 "on a surface" 18.95). Use
  `groundAt(x, z, feetY)` for "what is under this".
- **`findSpawn` only accepts ground at the hint's own level** (`LEVEL_TOLERANCE`
  1.2 m). Without it the ring search takes the first standable cell it meets — on a map
  built on a raised platform that is the ground at the foot of the wall: the Day of the
  Dead town spawned the player 2.8 m below its own square, on a slope, boom crushed
  from 8.6 m to 3.4 m. Three tiers, then an `Infinity` fallback for a sidecar whose y
  is simply wrong. It defaults to a 28 m radius — always pass a small one.
- Props are `SkinnedMesh` even though nothing animates; `Skeleton.dispose()` is
  required on map unload and on a character swap or the bone texture leaks.
- **The cost is the loop over parts, not the triangles in them.** 480 parts × five
  support probes × seven ground queries per NPC leg; measured at 171 µs per
  `groundAt` on `hospital` and 279 µs on `cozy-farm`. `gatherParts` buckets parts by
  their XZ footprint (2 m cells) and every hot query walks that list instead — the
  same parts, ascending, so answers are bit-identical (verified by hashing 4 000
  queries and a 800-step `moveCapsule` trail on two maps). `groundAt` −62 %,
  `moveCapsule` −56 %.
- **A triangle-level index was tried first and lost.** Props are a metre or two
  across, so every triangle lands in the same one or two cells: 0.25 m cells measured
  *slower* than the scan (67.6 µs vs 48.5) because it added an indirection per
  triangle and culled nothing. Do not re-do it. Indexing the broad phase is the win.
- `rebakePart` rebuilds the part buckets: a door that swings has a new footprint.

## Characters

- **A leg is chosen across frames, not in one.** `startLeg` used to try twelve
  directions in a single frame; each try is six ground samples over the collision
  soup, so five people finishing a pause together was one 7–20 ms frame (measured:
  worst frame per search, median 6.9 ms, max 19.8 ms on `hospital`). One attempt per
  frame for the *whole crowd* (`LEG_TRIES_PER_FRAME`), and the search keeps its
  remaining tries on the actor. Worst frame per search: median 1.3 ms, max 11.8 ms
  (the residual is a GC pause, not the search). Nobody can see a person start walking
  200 ms after a pause instead of immediately.
- **T-posed characters are a rig question, not a naming one.** `relaxPosedArms` is
  driven by the skeleton: it collects every unique `Skeleton` once (hats, belts and
  tablets are separate skinned meshes sharing one) and only drops the arms when **both**
  upper arms are horizontal — one arm out is a pose (a goalkeeper, a caller with a hand
  up) and must be left alone. The old name-based list fixed four commuters and left the
  pirate captain, astronaut, pilot, commander, police officer and construction workers
  standing like scarecrows on fourteen maps.
- **A GLB arrives in its bind pose (a T for Mixamo).** Never add a character to a live
  scene before its clips are applied: build the clone detached, load the animator, step
  the mixer once, then swap in. The obvious order — add, then await `loadAnimations` —
  flashes a T-pose for as long as the eight JSONs take, which is what every click on a
  roster arrow used to show.
- All 12 Polyfork characters share the same 22-bone Mixamo rig + 9 `Face_*` joints, so
  one animation set drives all of them. `tools/fetch-characters.mjs` refuses any
  character missing a bone `CharacterAnimator` drives.
- **The eight clip JSONs are cached module-wide** (`RAW_CLIPS` in
  `CharacterAnimator`) and `loadAnimations(base, only?)` can load a subset. Re-fetching
  and re-parsing 430 kB per character swap was `clips=1658ms` of the 1–2 s delay on
  every roster click; with the cache plus `['idle']` for the portrait it is 1–4 ms.
  Clips are **not** portable between characters — tracks are named
  `${bone.uuid}.quaternion` — so only the raw keyframe data is shared, never the built
  clip.
- **Characters normalise to `capsuleHeight` 1.75 m on load.** Step height, reach,
  camera stand-off and crawl clearance all measure against the capsule, so an
  un-normalised 1.92 m knight puts its head through low beams. The guard rejects a
  correction outside 0.25×–4× — that is a unit error, not a tall character.
- Kit exporters suffix copied props' bones (`LeftArm_3`, `LeftArm_4`). Any bone-name
  regex needs `(_\d+)?`.
- `h.game.loop.stop()` also stops rendering: a screenshot after it shows the previous
  frame. And `startNewRound()` must be awaited — a fixed sleep lets it finish after
  `setPosition` and teleport the body back.

## Authoring defects in the kits

- Props drop at one Y on sloping terrain, so a fence segment can hang over a bank.
  `src/data/mapFixes.ts` is the one-line-per-fix removal list, applied *before* the
  collision build. It matches mesh name **plus** distance from the world bounding-box
  centre (map 1 has ten meshes called `fence`) and does not dispose — kit geometry is
  shared.
- **A kit places its plaza props on one flat datum and lets the terrain slope away
  underneath.** On the ski resort the plaza is −13 while the snow falls to −16 a few
  metres west, so benches float ~2.9 m. The audit only flags props *tilted* against the
  ground, so it stays silent. Look at a map before trusting a clean bill.
- **The ground mesh is not always called `ground`.** `TERRAIN_NAME` matches the *end*
  of the name with a required leading separator — exact matching found nothing on the
  alpine kit (0 triangles, silently), and a substring match would swallow 44
  `snow-laden-spruce`.
- `tools/audit-grounding.mjs` finds candidates using three's own Draco decoder
  (`tools/terrain.mjs` + `tools/draco.cjs`, which exists because the emscripten wrapper
  needs a CommonJS context). Draco gotcha: `DracoFloat32Array.GetValue(i)` **returns** a
  number; it does not write into an out-parameter.
- **The kit suffixes repeated part names.** The fourth fence in a run is `fence_3`, not
  `fence`; a removal keyed to `fence` matched nothing and reported `removals: 0`, which
  is why a "removed" fence stayed visible for a whole session. Read `removals` in the
  `[load]` line — zero means the entry never fired.
- **Water is a *surface*, not a level.** The campground's sheet spans y −4.58 … −0.63:
  the lake at one end, the creek at the other. Any constant (`WorldCollision.waterLevel`
  was −3.75, 30 cm above the sheet) is wrong somewhere. `buildWaterSurface` rasterises
  the sheet into a 1 m grid and answers `heightAt` / `shoreDistance` / `isOpen`.
- **The water sheet is a child of the terrain node.** `campground-lake-terrain` contains
  both `ground` and `water`, so sweeping the group's meshes registered the lake as
  ground: the heightfield *was* the water surface (the body walked on it) and every
  dredge moved the lake down with the bed, so the depth never changed. Filter by mesh
  name inside `collect`, not by the node name one level up.
- **Props are placed at the author's eye height, not on their surface.** `settleProps`
  fixes the families: craft float at a draft, lily pads lie on the sheet, reeds root,
  people stand. It anchors on the **lowest vertex**, never the bounding box — a person's
  box is as wide as their hat, and its base corner is 15 cm of empty air beside them.
  People are only ever raised, never lowered (they may be standing on a rock).
  `tools/float-boats.mjs` baked the same correction into the GLB; the loader pass
  supersedes it.

## The waterline

- The bed is dug to a **beach profile**, not a flat offset: `depth = 0` at the waterline
  and `BED_SLOPE` (0.5) per metre out, capped at `BED_SHELF` (1.25). The old version
  added a flat 18–50 cm with an 18 cm floor at the shore, which is ankle-deep over the
  whole lake and reads as walking on top of it.
- Only vertices *below* the sheet are dug, and only where the profile asks for more depth
  than the kit already has — the authored basin survives.
- The sheet is forced to `opacity 0.6`, `depthWrite: false`, or the half of the body
  under it is hidden and wading looks like standing.
- `STAIR_PART` now includes the deck family (boardwalk, dock, pier, deck, ramp,
  footbridge) and is matched against the **ancestor chain**, not the part name: the kit
  names the run (`wetland-boardwalk-run`) and numbers the slabs (`boardwalk-bay_1`), so
  the old leaf-only test gave the campground zero step allowance and its 0.4 m deck lips
  were walls.

## Testing discipline

- **Never judge input handling from the live loop under SwiftShader.** `GameLoop`
  clamps delta to 0.1 s and the headless renderer runs at 1–3 fps, so half a second of
  real time is frequently *zero* frames: "C did nothing" was really "no frame was
  produced". Drive `Game.update(1/60)` in a loop (`tools/pickable.mjs` shows the shape).
- Never write a harness that overrides the camera or teleports the player into place
  and then declares success. `tools/pickable.mjs` is the gate: it places the body, lets
  the follow camera settle over real frames, aims via `cameraController.targetYaw`, and
  asks the game. It does not touch the camera.
- Use browser-level input (`Input.dispatchKeyEvent` over CDP), not
  `window.dispatchEvent(new KeyboardEvent(...))` — the latter does not reach the input
  controller.
- **A one-metre flood-fill grid cannot judge a slope.** The reachability sweep
  (`tmp-sweep.mjs`) walks 1 m cells with a 0.35 m step limit, so a smooth 40-degree dune
  reads as a wall and every object on it as "unreachable". The capsule moves in 0.1 m
  sub-steps and only has to clear the step height over its own 0.3 m radius, so it
  climbs the same dune happily (`tmp-walk-to.mjs` measured +8.8 m of climb). The grid is
  a smoke test, not a verdict.
- **Vite watches the project root**, so writing screenshots into it triggers a page
  reload mid-harness (one map took 87 s to "load"). Write captures to
  `%TEMP%/hunt-shots`.
- A screenshot proves nothing about pickability, and projection checks beat eyeballing.
- `node tools/hidden-objects-doc.mjs --write` regenerates the object tables in
  `docs/HIDDEN_OBJECTS.md` from the data file. Run it after any content change.

## Tooling

- **The Bash tool eats backslashes inside a heredoc.** A `python - <<'PY'` block
  containing `\s` arrives as `s` and the regex silently matches nothing. Write the
  script with the Write tool and run it.
- `tools/cdp.mjs` kills the browser *tree* on Windows (`taskkill /T /F`). The profile
  (`tmp-chrome-profile`) keeps `localStorage` — clear it in any benchmark or you are
  measuring the previous run's quality level.
- `tools/check-shaders.mjs` compiles hand-written GLSL in ~2 s.
  `tools/preview-moods.mjs` renders every atmosphere as a swatch sheet from the numbers
  the game uses.
- `tools/prepare-maps.mjs --only <substr>` turns a kit archive into a map. `idOf`
  strips `kit-`, a trailing `-<6 hex>` and a trailing `-<n>`; `LABEL_OVERRIDES` fixes
  names the word splitter gets wrong. Archives are disposable — the sidecar is the
  record. **`--refresh` is what rewrites a sidecar**: adding a `LABEL_OVERRIDES` entry
  and re-running plain `prepare-maps` leaves the old label in `maps/reports/<id>.json`
  for every downstream reader.
- **No hand-kept map lists or label tables in tools.** `audit-grounding.mjs` had a
  literal array of ids (a new map was silently not audited) and
  `hidden-objects-doc.mjs` had a label table (a new map fell back to its raw id and its
  object table came out empty because the item regex demanded an explicit `y`). Both
  now read the registry or the directory.
- **Polyfork API**: `/api/assets?class=character` lists ~199 characters;
  `/api/assets/{id}` carries `thumbnail` and `credit`; `/cdn/{id}.glb` is public.
  `/api/kits` is a **fixed list of 54** — it ignores `per_page`, `page`, `q` and
  `limit` — and needs the `Authorization` header or it returns 403 JSON. Kit covers are
  not in the API but exist at `https://polyfork.dev/kits/{kit-id}/cover.png`.
- **Runs under SwiftShader are expensive and the user notices.** A 21-thumbnail pass is
  ~13 min and pins every core: *"bạn chạy gì mà 4 tiếng 1 task vậy ? mà còn làm lag máy
  nữa chứ"*. Prefer Node-only analysis (terrain decode 0.3 s, mood preview 0.2 s, tests
  2.4 s). Clear `maps/work/` after a prep run.

## Climbing, and why the footprint is the rungs

- **A kit's `ladder` node is the ladder plus its mounting brackets and handrail.**
  On `cozy-farm` the node measures 1.32 × 1.38 m while the rungs span
  0.17 × 0.50 m. Building the climb volume from `box.setFromObject(node)` and
  padding it twice (0.35 in the builder, 0.55 in `climbVolumeAt`) put the grab
  boundary 1.56 m from a half-metre-wide ladder, and the body — which freezes its
  horizontal position on grab — climbed six metres up a column of air. `rungColumn()`
  now derives the XZ extent from the horizontal rung faces; height still comes from
  the node box because the top rung sits below the top handrail.
- **Rung detection is only safe on ladders already found by name.** Using it to
  *find* them turned the campground's watchtower bracing into thirteen ladders.
- **Converging to a threshold deadlocks if the step is `distance - threshold`.**
  The step shrinks to zero as the body arrives and parks at exactly the boundary
  with the comparison still true. Step by the whole distance instead.
- **The foot of a ladder is not always the ground** (`campground-lake`: 0.72 m
  above). Clamping the feet to `volume.bottom` teleported the body upwards on
  grab; `climbFloor = min(volume.bottom, feetY)` starts the climb where the body is.
- `findSpawn` measures support from the *hint's* height, so on a map whose
  sidecar `y` sits below the real ground it can return the terrain when a kerb is
  16 cm above it (`neighborhood-pathways` spawned the body inside its paving).
  `placeAtSpawn` re-resolves with `groundAt(x, z, spot.y)`.

## The frame loop

- **`onFrameTime` must run before `onRender`.** Applying a quality decision calls
  `renderer.setPixelRatio` → `setSize` → assigns `canvas.width`, which resets the
  drawing buffer to transparent black. After the draw that clears the finished
  frame and the browser presents an empty canvas — a full-screen flash against
  `body { background: var(--ink) }`. `onWindowResize` has the same shape and now
  repaints straight after `setSize`.
- All 22 maps sweep clean in one browser session (~4 minutes) with a throwaway
  `tmp-sweepall.mjs`: spawn grounded, body mobile, five objects, no console
  errors. The ladder gate was `tmp-climbcheck.mjs <map> <cx> <cz>`. Both were
  deleted in the 2026-11-13 cleanup — they are two-page scripts, worth rewriting
  rather than restoring.

## Fishing

- **The rod hangs off the hand bone, so its per-frame work runs after the body
  is posed.** `FishingSystem.update` is called before the player update (the
  float and the line have to be where this frame's camera looks). The rod's own
  work is therefore split into `updateRod(delta)`, called from `Game.update`
  *after* `controller.poseOnly`. Running it in the earlier slot aimed the rod at
  last frame's arm; at 0.1 s a frame during a cast that is 30° of error.
- **The rod is aimed, not inherited.** Parenting a prop to a hand is the usual
  answer and it failed twice over: the Mixamo cast rolls the wrist through 140°
  (rod at the sky at rest, at the ground at the top of the back swing, 0.4 m
  under the terrain), and the two hands do not encode a direction either — at
  rest they sit side by side with the rod vertical, at the peak they swap
  heights. `FishingRod.aim(direction)` takes the *direction* from an authored
  curve (`ROD_AIM`, elevation + azimuth about the character's yaw) and only the
  *position* from the hands. A lever, not a prop. Everything that tried to clamp
  the wrist-inherited version — `keepTipUp`, `ROD_TUNING`, `MIN_RISE`, `base` —
  is gone.
- **`aim` needs two rotations, not one.** The second rolls the rod about its own
  axis until its "up" faces the world's, which is what keeps the reel hanging
  down instead of swinging round with the palm. A rod pointed straight up has no
  answer — every roll is equally upright — so it keeps whatever it had.
- **Both fists go on the cork.** The idle clip puts the hands 0.22 m apart
  *across* the shaft (Z), not along it (X is the rod), so a rod welded to the
  right hand passes 22 cm from the left one. `aim` slides the holder to the
  midpoint between the hands every frame via `parent.worldToLocal` — which
  already carries the character's height normalisation. `attach(hand, other)`.
- **The grip sits near the butt end (`GRIP.x = 0.06`).** Everything behind the
  grip hangs down out of the hand, and at the top of the wind-up the hand is
  beside the head, so 30 cm of butt is 30 cm through the chest. Clearance is
  measured, not eyeballed: every rod vertex against every bone segment, per pose
  (`Head` 0.24, `RightForeArm` 0.12+ across the clip).
- **Aim in the body's frame, and remember the roster faces +Z.** The cast ray
  works in camera yaw and uses `(-sin, ., -cos)`; the body was turned to face it,
  so `ROD_AIM` must use `(+sin, ., +cos)`. Getting this wrong aims the rod
  backwards, which looks like a modelling error.
- **`getCastTime()` is null outside `throw`/`hold`**, so a scrubbed pose fell
  back to the idle aim. `getCastClipTime()` reads the action's own time and is
  what `aimRod` uses.
- **`scrubCast(t)` pins one frame of the cast.** Sampling by wall clock gets a
  different frame every run on SwiftShader (1–3 fps, delta clamped at 0.1 s). Two
  traps: the scrub only reaches the skeleton through the crossfade, so it needs
  real frames to take effect; and `updateFishing` overwrites the time in every
  phase except `windup`, which is why the pin uses that one.
- **Measure the rod in `rod-mesh`'s frame, not the glTF root's.** The root sits
  1.1 m along +X from the mesh, so a bbox taken in the root's frame puts the butt
  in the middle of the rod and reports nonsense heights.
- **The rod's own modelled line has to go by triangle.** It and the float are in
  the same mesh as the rod, occupying `x > 1.9 && y < 0.9` in the mesh's frame;
  the game draws its own line from the tip to wherever the float landed.
- **Fishing is per-map, and the roster is a weight table over a global
  catalogue.** `FISHING_SPOTS` in `src/data/fishing.ts` names four maps;
  `spotForMap` is the only way in. A map with no spot gets no rod, no school and
  no prompt — the survey that picked them is in `docs/FISHING.md`. `FISH` is
  global because the catch log shows all of it.
- **The school loads only the current spot's roster.** Sixteen models is sixteen
  megabytes; loading them to place nine is a long first cast. `prototypes`
  outlives a spot, so `loadedSpot` is what decides whether to re-run the load.
- **Placement needs two rings.** A 4 … 26 m ring around the shore is right for a
  lake; the reef is a 6 × 5 m pool and that ring is mostly land, which put two
  fish in it. The second pass is 1.2 … 6 m.
- **`benthic` species are placed on the bed, not at a fixed depth.** A crab held
  0.15 m under the surface hangs like a balloon; `depthFor` reads the water
  column instead. The two crabs also ship `Idle`/`Walk`/`Run`, mapped through
  `species.clips`.
- **The catch card is the found-object card.** `FoundScreen.showObject` is the
  general form (`show` is the "2 of 5" wrapper); the fish is
  `FishSchool.displayClone`, and `FoundStage.show(object, owns=false)` is what
  stops the stage freeing geometry the school still needs. The clone is turned a
  quarter about Y: a fish is authored nose-first along +Z, straight at the card's
  camera, and the stage frames by bounding sphere.
- **The catch log is in the map, on F.** It pauses like the pause menu does
  (`GameState.PAUSED`, so the reel freezes) and Escape closes it back to the game
  rather than swapping panels. Pictures are 192 px PNGs from
  `tools/fish-thumbs.mjs`; uncaught fish are the same picture with
  `filter: brightness(0)`.
- `tools/fishing-probe.mjs` drives the whole trip (shore → cast → bite → reel →
  card) through the debug handle and real mouse events. `tools/rod-calibrate.mjs`
  freezes the boom and films the cast from a fixed arc. `tools/fish-thumbs.mjs`
  regenerates the catch log's pictures. All write to `%TEMP%/hunt-shots`, never
  the project.
