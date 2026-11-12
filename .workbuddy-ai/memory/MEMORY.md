# Photo Hunt — project notes

Third-person hidden-object game. Three.js + TS + Vite + Tauri. 22 maps × 5 hidden
objects (110), 12 playable characters.

**Deeper traps and rationale: `memory/ARCHITECTURE.md`** (rendering, collision, kits,
tooling). Read it before touching the renderer, the collision solver or a tool.
Player-facing docs: `docs/START_SCREEN.md`, `MAP_SELECT.md`, `ATMOSPHERE.md`,
`HIDDEN_OBJECTS.md`.

## Standing rules from the user

- **Hidden objects must be *impossible* in the scene, not merely unusual.** A pizza
  slice or a flat-screen TV could plausibly turn up at a campsite → both invalid.
  "Someone might have brought that here" = fails.
- **Difficulty "khó vừa"**: visible from the main path, easy to miss — behind a table
  edge, in a corner, beside a same-coloured prop. Never off the path.
- Hunt content lives in one file: `src/data/hiddenItems.ts`.
- **No gradients, anywhere.** They are what makes an interface read as machine-made.
  Depth = hard offset shadows at low opacity, never blur. No emoji in player-facing
  text; the icon set is typographic.
- **Polish the existing game, do not add modes** — the "each map is its own game" plan
  was cancelled: *"hơi khó quá, cứ tập trung làm tốt game hiện tại là oke"*.

## Interface

- Tokens at the top of `src/app/styles.css`: cream `#f4ecd9`, ink `#191510`, rust
  `#b0472a`, moss for "found". Serif display, 10px uppercase micro-labels, mono for
  numbers and key caps.
- **There is no generic `.hidden` rule.** Each component declares its own
  (`#game-hud.hidden`, `.controls-modal.hidden`, …); a new overlay without one shows
  from boot.
- **Start screen is a page, not a modal**: no scrim, two halves. Left = live 3D
  portrait in a *second* small WebGL context (`src/ui/CharacterStage.ts`), `<` `>`
  level with the character, no caption, left-drag turns it. Right = Play / How to
  play / Settings / Credits, Exit as a footer link. Behind both, a map still blurred
  **on disk** by `tools/make-backdrops.mjs` (320 px, ~3 kB) — never a runtime `filter`.
- **Map picker is full screen**, 6 a page (2×3) sharing the leftover height; cards
  fall back cover → `shots/<id>.jpg` → ruled plate.
- A grid child of a flex column needs `flex: 1 1 auto; min-height: 0` or it cannot
  shrink and pushes the footer off screen. `.menu-card` scrolls; `.results-card` pins
  its actions and scrolls only the list.

## Rules that keep coming back

- **Menus must not pay for the game.** `quality.tick` runs only on
  `state === PLAYING`; `Game.render` early-returns on `state === MENU`. Ungated, the
  menu's second context plus a full-screen `filter: blur()` walked the adaptive scaler
  to the bottom preset, so every round began at 360p with shadows off.
- **No post-processing chain.** `Game.render()` is one `renderer.render`;
  `antialias: true` is the only AA. `MIN_SCALE` is 0.80 (0.55 read as "trông rất xấu").
- **A GLB arrives in its bind pose (a T for Mixamo).** Build the clone detached, load
  the animator, step the mixer once, then swap in — add-then-await flashes a T-pose.
- **Clip JSONs are cached module-wide in `CharacterAnimator`** and
  `loadAnimations(base, only?)` takes a subset. Re-fetching 430 kB per swap was the
  1–2 s roster-click delay; cached + `['idle']` it is 1–4 ms. Clips are not portable
  between characters (tracks are `${bone.uuid}.quaternion`) — only raw data is shared.
- **T-pose is a rig question, not a naming one.** `relaxPosedArms` drops the arms only
  when **both** upper arms are horizontal; one arm out is a pose.
- **Characters normalise to `capsuleHeight` 1.75 m on load** — step height, reach,
  camera stand-off and crawl clearance all measure against the capsule.
- **The camera is a boom camera** (8.0 m, 3–14), behind the body: camera position ≠
  player position, so "can the player reach this" must use the body.
- **`findSpawn` only accepts ground at the hint's own level** (`LEVEL_TOLERANCE`
  1.2 m) and defaults to a 28 m radius — pass a small one when you mean "next to this".
- **Frame-loop order is load-bearing**: `onFrameTime` → `onUpdate` → `onRender`.
  The scaler's `setPixelRatio` resets the canvas, so running it after the draw
  presents a black frame — that was the full-screen flash while walking.
  Pinned by `tests/GameLoop.test.ts`.
- **A ladder's footprint is its rungs, not its node box.** A kit's `ladder` node
  includes brackets and handrail (farm: 1.32 m box, 0.17 × 0.50 m rungs), so a
  box-derived volume let the body grab 1.19 m out and climb in mid-air. The
  climb also converges onto the rung line, and starts at the feet rather than at
  the bottom rung (campground's hangs 0.72 m up).
- **Never judge input from the live loop under SwiftShader** (`GameLoop` clamps delta
  to 0.1 s; headless runs at 1–3 fps). Drive `Game.update(1/60)`. Use browser-level
  `Input.dispatchKeyEvent` over CDP, not `dispatchEvent`.
- **No harness may override the camera or teleport the player and then declare
  success.** `tmp-pickable.mjs` is the gate.
- **A stopped loop does not draw.** `loop.stop()` then posing then a screenshot
  captures the *previous* frame; call `game.render()` first. A pose harness must
  also assert `game.pickupTarget === item` — a decoy standing in front of it
  answers the selector just as happily, and it is the decoy that glows.
- **Vite watches the project root**, so screenshots written there reload the page
  mid-harness. Write to `%TEMP%/hunt-shots`.
- **SwiftShader runs are expensive and the user notices.** Prefer Node-only analysis
  (terrain 0.3 s, moods 0.2 s, tests 2.4 s). Clear `maps/work/` after a prep run.
- **The Bash tool eats backslashes in a heredoc** — write the script, then run it.
- `node tools/hidden-objects-doc.mjs --write` regenerates `docs/HIDDEN_OBJECTS.md`.
