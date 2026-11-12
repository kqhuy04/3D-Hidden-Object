# Start screen and the roster

The first thing the game shows: a character on the left, four ways in on the
right. Play opens the map picker; the picker is where a round starts.

```
┌───────────────────────────┬───────────────────────────┐
│                           │  A HIDDEN OBJECT HUNT     │
│                           │  Odd Objects              │
│   ‹    live 3D portrait   │  Five things in every ... │
│        (drag to turn)     │                           │
│                           │  [ PLAY ]                 │
│                           │  NEXT  ALPINE SKI RESORT  │
│                           │  [ HOW TO PLAY ]          │
│                           │  [ SETTINGS ]             │
│                           │  [ CREDITS ]              │
│                    ›      │                           │
│                           │  Exit game      v0.1.0    │
└───────────────────────────┴───────────────────────────┘
        blurred still of the map, behind everything
```

There is no caption. The model is the label: a name and a one-line blurb under
the portrait turned a hero shot into a character sheet, and the arrows are level
with the character so the whole left half is one object — a person you can turn
and page through, not a form with a portrait attached.

## 1. Why the portrait is a live render

A still image of twelve characters reads as a shop. The point of showing them at
all is that you will be walking around inside that body for the next twenty
minutes, and an idle animation with a real shadow is the shortest way to say so.

`src/ui/CharacterStage.ts` is a **second, small WebGL context** — not a corner of
the game's. The game's camera is a boom eight metres behind a body standing in a
loaded map; pointing that at a character on a plain background would mean tearing
the view down and rebuilding it on every click of an arrow. One extra context
with one model in it costs a fraction of a frame and cannot disturb the hunt.

It draws on a **transparent canvas**, so whatever is behind it is the
background and the portrait sits on the same surface as the rest of the screen
rather than looking like a window cut into a card. The shadow comes from a
`ShadowMaterial` plate, which only draws where something is in shadow — a real
plane in a light colour would put a grey rectangle behind the feet.

### Dragging turns the character

Left-button drag, with a little momentum on release. Pointer capture, not a
`mousemove` on the window: the drag has to keep working when the cursor leaves
the panel — which it does almost immediately, because the panel is only half the
screen — and it has to stop cleanly if the button comes up outside the window.

The arrow buttons are separate elements with `pointer-events: auto` inside a
`pointer-events: none` layer, so a press that starts on one never reaches the
canvas and can never be read as the start of a turn. The layer itself is
transparent to the pointer, so a press anywhere between the arrows still drags.

Yaw only. A portrait you can orbit into a strange angle stops being a portrait of
the person you are about to play.

The parsed GLBs are cached by id — as *promises*, so a prefetch still in flight
is joined rather than duplicated — and the context is only stopped, never
disposed, when the menu hides: paging back to a character you have already seen
is instant, and returning to the menu does not re-create the renderer.

### Paging has to be instant

The first version took 180–350 ms per click even for a character already in
memory, and 1.5–2.5 s for one that was not. Measured, not guessed:

```
[stage] armoured-knight-hero-07121f total=1861ms glb=188ms  clips=1658ms
[stage] prospector-69a481           total=276ms  glb=101ms  clips=130ms
```

Two causes. `loadAnimations` fetched and re-parsed all eight clip files — 430 kB
of JSON — on **every** swap, for a portrait that plays exactly one of them. And
the first view of a character paid for the GLB with nothing to hide it.

So: `CharacterAnimator` keeps the raw keyframes in a module-level cache (they are
the same eight files for every character; only the bone binding differs), the
stage asks for `['idle']` alone, and each swap prefetches its two neighbours half
a second later. The same two lines now read:

```
[stage] prospector-69a481 total=17ms  glb=1ms clips=2ms
[stage] armoured-knight-hero-07121f total=13ms glb=0ms clips=2ms
```

The stage is also not built until `Game.initialize` says *which* character — it
used to be built by the `UIManager` constructor, one line before the saved choice
arrived, so every launch parsed the default model and threw it away.

### Framing is measured, not eyeballed

30° at 4.15 m is a 2.22 m frame; looking at 0.86 m puts it from −0.25 to 1.97.
That is ~11% clear air under the boots and 10% over the head, which is enough
that a hat or a pair of heels is never sliced by the edge of the panel. The first
version used 3.35 m and the backpacker's boots were cut off — visible in a
screenshot, invisible in the numbers, which is why the numbers are written down.

The camera only pulls back further below an aspect of 0.8. Above that the frame
is already wide enough for a standing body, and an earlier `1 / aspect` rule was
making the character small on an ordinary window for no reason.

The key light sits high (1.5, 4.4, 2.1). Lower than that and the shadow stretches
a body-length to the left, where it reads as a second, darker person standing
beside the first.

## 2. The backdrop

Behind both halves is a still of the map, blurred 20 px and washed with paper.

It is a **still, not the live render**, and it is **blurred on disk**:
`tools/make-backdrops.mjs` writes a 320 px copy of each map to
`public/maps/backdrop/<id>.jpg`, 3 kB each, 62 kB for all twenty-two. A 4.5×
bilinear upscale *is* a blur, so the menu runs no `filter` at all.

That matters more than it sounds. `filter: blur(20px)` on a full-screen element
is a compositor pass on every frame the menu is up, and it was expensive enough
to drag the frame rate down — which the adaptive scaler then read as "this
machine is slow" and answered by dropping the game's resolution and shadows.
`Game.onFrameTime` now only feeds the scaler while `state === PLAYING`, and
`Game.render` skips the world entirely while the start screen is up, because a
full-bleed opaque menu over a 300k-triangle map is a frame nobody sees.

The source is `public/maps/shots/<id>.jpg` — the map at eye level, which is what
"standing in it" looks like — with the kit's isometric cover as the fallback.
`MainMenu.setMap(id, label)` is called from `Game.initialize` and again on every
map change, so the screen always shows the place Play will open.

The wash is a flat colour on purpose. A vignette here would be a gradient, and a
gradient is the one thing this interface does not do. Two veils, not one: 26% over
the whole screen, then 70% behind the buttons and almost nothing behind the
portrait, because the portrait is meant to sit *in* the place and the buttons are
meant to sit on paper.

`transform: scale(1.16)` on the backdrop hides the blur's pale fringe — a filter
blurs an element's own edges inward, and without the overscan there is a light
border all the way round the screen.

## 3. The roster

Twelve characters in `src/data/characters.ts`, seven of whom you could plausibly
meet and five of whom you plainly could not. A knight standing in a ski-lift
queue is the same joke the hunt is built on, so the cast says it before the first
map does.

They are Polyfork characters and they all share **the same 22-bone Mixamo rig
plus nine `Face_*` joints**, which is the whole reason a roster is possible at
all: `CharacterAnimator` drives the body by bone *name*, so a character is a
costume rather than a new system. `tools/fetch-characters.mjs` refuses any
character missing one of the eighteen bones the animator drives.

```bash
node tools/fetch-characters.mjs        # re-reads the ids from characters.ts
```

Twelve GLBs, 9.4 MB in total. `CREDITS.json` / `CREDITS.md` are written by the
same run and are what the Credits sheet lists.

### Height is normalised on load

Polyfork characters are 1.5–2.0 m tall. The capsule is a fixed 1.75 m
(`GAME_CONFIG.player.capsuleHeight`), and step height, reach, camera stand-off
and crawl clearance are all measured against it. Without normalisation a 1.92 m
knight puts its head through every low beam it crawls under and a shorter one
leaves the camera looking at the top of a hat.

`Player.normaliseHeight` and `CharacterStage.normalise` both scale the model to
the capsule height. The guard rejects a correction outside 0.25×–4×: that is not
a tall character, it is a different unit, and silently scaling it would bury the
model inside the ground.

Verified on two different models: `__hunt.characterHeight` reads **1.75** for
both the Road-Tripper and the Commuter.

## 4. Where the choice lives

`Settings.character` in `src/app/Storage.ts` — settings, not progress, because it
is a preference and "reset progress" must not change who you are. An id that no
longer exists falls back to the default in `characterFor()` rather than being
validated in the store, so removing a character cannot strand a save.

The swap into the world is **deferred**. Clicking the arrows only repaints the
portrait and writes the id; `Game.ensureCharacter()` loads the model once, right
before a round starts. A swap re-parses a ~0.8 MB GLB and rebuilds the animator,
which is a visible hitch for a character the player may not keep — and by the
time a map is picked, the map load is already covering the seconds.

`Player.swapModel` keeps the same group and replaces only its child, so the body
stays exactly where it was standing and the controller's collision is still the
live map's. The controller is rebuilt rather than patched: the animator is bound
to one skeleton for life, and half-swapping it is how you get a character whose
legs are driven by the previous one's bones.

### No T-pose on the way in

A GLB arrives in its bind pose, which for a Mixamo rig is a T. Adding it to the
scene and loading the clips afterwards — the obvious order — shows that T for as
long as the eight animation files take to arrive, so every click on an arrow
flashed a scarecrow before the character relaxed.

`CharacterStage.setCharacter` now builds the clone **detached**, builds its
animator, waits for the clips, steps the mixer once to bake the first frame of
Idle into the bones, and only then swaps it in and removes the old one. Nothing
un-posed is ever in front of the camera, and there is no blank frame between the
two either. `tmp-drag.mjs` shoots the panel at 90, 220 and 420 ms after a click
to prove it.

## 5. What the start screen is not

It is a page, not a modal over the world. There is no scrim: the menu fills the
window in `--paper`, so the character is not standing somewhere in the loaded
map. `Exit game` is a footnote link rather than a button the same size as Play,
because a quit control that size is the one thing a player clicks by accident.

## 6. Testing

```bash
node tmp-shots.mjs      # clean captures: start screen, picker, credits
node tmp-menu.mjs       # the same walk with DOM assertions (paging, grid, pager)
node tmp-drag.mjs       # drag turns the model; no T-pose during a swap
node tmp-swap.mjs       # the [stage] timing line for nine swaps
node tmp-quality.mjs    # the scaler's choice after ten seconds on the menu
node tmp-charswap.mjs   # page a character -> Play -> pick current map -> round
```

`tmp-drag.mjs` measures the turn as a pixel difference over the portrait rather
than reading the holder's rotation: the point is what the player sees. A 216 px
drag moves the mean channel value by about 12/255 over the panel, which is the
difference between a front view and a three-quarter back view.

`tmp-charswap.mjs` is the one that matters: it exercises the branch where the
picked map is already loaded, which has no world load in it and therefore no
loading screen to hide a mistake behind. It asserts the body is wearing the
chosen character, that the height is still 1.75, that the round started, and that
the id was saved.

Both need the dev server on port 1420 and take ~40 s each, because the game will
not show its menu before a world exists.
