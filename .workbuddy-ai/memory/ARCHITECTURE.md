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

## Characters

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

## Testing discipline

- **Never judge input handling from the live loop under SwiftShader.** `GameLoop`
  clamps delta to 0.1 s and the headless renderer runs at 1–3 fps, so half a second of
  real time is frequently *zero* frames: "C did nothing" was really "no frame was
  produced". Drive `Game.update(1/60)` in a loop (`tmp-crawl3.mjs`, `tmp-gears.mjs`).
- Never write a harness that overrides the camera or teleports the player into place
  and then declares success. `tmp-pickable.mjs` is the gate: it places the body, lets
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
- All 22 maps sweep clean in one browser session via `tmp-sweepall.mjs` (spawn
  grounded, body mobile, five objects, no console errors). ~4 minutes.
  `tmp-climbcheck.mjs <map> <cx> <cz>` is the ladder gate.
