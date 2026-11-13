# Photo Hunt — project notes

Third-person hidden-object game. Three.js + TS + Vite + Tauri. 22 maps × 5 hidden
objects (110), 12 playable characters. **Fishing on four maps** —
`campground-lake`, `alpine-and-snow`, `countryside-railway`, `coral-reef` — each
with its own roster out of a 16-species catalogue: rod, school, Stardew-style
reeling bar, XP that widens the band, a *Found*-style 3D catch card, and a catch
log on **F** that opens over the map.

**All traps, rationale and numbers: `memory/ARCHITECTURE.md`** (rendering/perf,
atmosphere, collision, characters, kits, fishing, tooling, frame loop). Read it before
touching the renderer, the collision solver or a tool. Player docs:
`docs/START_SCREEN.md`, `MAP_SELECT.md`, `ATMOSPHERE.md`, `HIDDEN_OBJECTS.md`,
`FISHING.md`.

## Standing rules from the user

- **Hidden objects must be *impossible* in the scene, not merely unusual.** "Someone
  might have brought that here" = fails. Difficulty "khó vừa": visible from the main
  path, easy to miss, never off the path. Content lives in `src/data/hiddenItems.ts`.
- **No gradients, anywhere.** Depth = hard offset shadows, never blur. No emoji in
  player-facing text.
- **Polish the existing game, do not add modes** — *"cứ tập trung làm tốt game hiện tại"*.
- **Hints come from people, never from a clock.** Every animated person has an `Ask`
  verb; five objects, five hints. The timer was removed at the user's request.
- **Never reduce visual quality to buy performance** (2026-11-13: audit only, no
  graphics downgrade).

## Rules that are not in ARCHITECTURE.md

- **Four verbs, not forty.** `Interactions.ts` sorts props into `hinge` / `spin` /
  `rock` / `lamp` by name and validates by shape. A new verb = a new family the player
  must learn.
- **People are not decoys.** `NpcCrowd.characters` is filtered out of
  `collectPropTargets`, which is why `npcs.attach` runs before the prop collection.
- **There is no generic `.hidden` rule.** Each component declares its own; a new
  overlay without one shows from boot.
- **A grid child of a flex column needs `flex: 1 1 auto; min-height: 0`** or it cannot
  shrink and pushes the footer off screen.
- **Scratch starts with `tmp-` and is gitignored**; a harness worth keeping graduates to
  `tools/`. `node tools/hidden-objects-doc.mjs --write` regenerates the object tables.
