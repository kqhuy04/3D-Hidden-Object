# Map selection and map swapping

Nine maps ship with the game: the built-in campground plus eight kit maps
prepared from `maps/*.zip`. Until this round the only way to reach one was
`?map=<id>` on the URL, which is not a feature a player can use. There is now a
picker, and switching maps no longer requires a reload.

## 1. The picker

`src/ui/MapSelect.ts` — one screen, opened from two places:

| entry point | button | returns to |
| --- | --- | --- |
| start screen | `#btn-play` — Play opens the picker | start screen |
| pause menu | `#btn-pause-map` | pause menu |

The catalogue is built from `MAPS` in `src/data/mapRegistry.ts`, so adding a map
archive adds a card with no UI change.

**Six cards a page, two rows of three.** A page has a bottom, so the player can
see how much of the game is left without dragging a scrollbar, and six is the
most that still fits two rows at a legible thumbnail size on a 1280 × 800
window. The pager in the footer is two square keys and a `1 / 4` counter; the
picker opens on the page holding the map the player is already in, so someone in
the eleventh place does not page past ten they have finished.

The picker is **the whole screen**, not a card on one. Six covers at catalogue
size need the width, and a modal that large reads as a document viewer rather
than a place to choose where to go. The grid keeps its three columns and two
rows, and both rows share whatever height is left over, so a page has no ragged
bottom edge and nothing scrolls.

Each card is a picture with the name under it: the label, the brief, and the
player's own record (`3 of 5 found`, `Cleared · 2:14`). The current map
carries a `PLAYING` chip over the picture.

The pictures are the **kits' own isometric covers**, from the same Polyfork pages
the maps were downloaded from — a picture of everything the kit is made of,
which is what a player is actually choosing between. They live in
`public/maps/<id>.jpg`, 720 px wide, about 1 MB for all twenty-two.

```bash
node tools/fetch-kit-covers.mjs        # all maps (add --force to re-encode)
```

`tools/map-thumbs.mjs` still exists and writes the in-game captures to
`public/maps/shots/`; the picker falls back to one when a kit cover is missing,
and then to a ruled plate with the place's initial on it, because a broken-image
icon in a catalogue reads as a bug in the catalogue.

```bash
node tools/map-thumbs.mjs              # all maps
node tools/map-thumbs.mjs --only office
```

One cover needs surgery on the way in: the Día de Muertos promo art has a
palette legend baked into its top-left corner. It is cropped off in
`CROP_TOP` rather than patched over — cloning backdrop across that corner
leaves a visible band straight through the church façade.

Escape closes the picker and returns to whatever opened it — never straight to
gameplay. A player who opened it from the pause menu expects to land back in the
pause menu.

## 2. Swapping a map without a reload

`Game.loadMap(map)` is the only path that changes `this.map`. It removes the
previous scene group, asks the loader to free it, clears collision and the
target registry, then loads the new world into the same scene. The character is
loaded once and kept across swaps: reloading a rig on every map change would be
a visible stall for no benefit.

It is reloaded only when the player has *chosen a different one* on the start
screen, and `Game.ensureCharacter()` does that once, right before the round
starts — not on every click of the roster arrows, because a swap re-parses the
GLB and rebuilds the animator for a character the player may not keep.

The HUD stays mounted across the swap and the round is restarted afterwards, so
a swap from the pause menu lands the player in a fresh round on the new map.

## 3. What has to be freed, and what does not free itself

Removing a node from the scene graph frees nothing. Every swap has to release,
by hand:

| resource | owner | freed by |
| --- | --- | --- |
| geometry | each mesh | `mesh.geometry.dispose()` |
| material + its textures | each mesh | `material.dispose()`, then each `isTexture` value |
| shadow map (2048²) | each shadow-casting light | `light.dispose()` |
| bone texture | each `SkinnedMesh` skeleton | `skeleton.dispose()` |
| heightfield, collision parts | `WorldCollision` / `CollisionGeometry` | `clear()` |
| render lists | renderer | `renderer.renderLists.dispose()` |

### 3.1 The bone textures

Every kit ships its props as **`SkinnedMesh`** — the stadium has 391 of them, the
hospital 41 — even though nothing animates. Each skeleton allocates a 12×12 bone
texture on first draw. That texture belongs to the skeleton, not to the mesh's
material, so the material sweep missed it and every swap leaked one small
texture per skinned prop.

It was invisible in the frame time (the textures are 576 bytes each) and only
showed up when counting `gl.createTexture` against `gl.deleteTexture`:

```
before the fix   after four swaps: created 855  deleted 4    live 851
after  the fix   after four swaps: created 1239 deleted 847  live 392
```

`live` now returns to the new map's own baseline every time (stadium 392,
hospital 50, campground 45) instead of climbing. `renderer.info.memory.textures`
was a red herring on the way there: it counts every texture *init*, including
re-inits after a dispose, so it reads 392 for a map whose materials carry no
textures at all. Counting the GL calls is the only honest measure.

## 4. Verification

Headless Chromium against the dev server, `?debug=1`:

| check | result |
| --- | --- |
| picker opens from the main menu | 6 cards, 1 marked current, `1 / 4` |
| click a card | map changes, `PLAYING`, HUD visible, picker closed |
| body on the new map | skatepark `(−1, 0.05, 7)`, walks `+x` and `−z` unblocked |
| pause → `CHANGE MAP` → card | hospital, `PLAYING` |
| Escape in the picker | returns to pause, not to gameplay |
| `BACK` | returns to pause |
| scene graph after a swap | 3 children before, 3 after — nothing accumulates |
| console | no errors on any of the eight kit maps |
| four swaps, GL texture count | returns to baseline every time |

The swap itself takes ~11 s in the headless software renderer, almost all of it
the 400k-triangle upload; on a GPU it is a fraction of that. The spinner is
there because the wait is real either way.

## 5. Adding a map

```bash
# drop the archive in ./maps, then
node tools/prepare-maps.mjs
```

The script skips archives it has already processed, compresses the new one,
writes its sidecar and regenerates `src/data/mapRegistry.ts`. The new map
appears in the picker on the next reload, sorted by id.

Its card has no picture until one is captured:

```bash
node tools/map-thumbs.mjs --only <new-map-id>
```
