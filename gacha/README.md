# DESIGN GACHA

A small capsule-toy game built around a 3D gacha machine modelled from the
reference art. Standalone — it does not touch the Photo Hunt game code.

## Run it

```bash
npm install          # once, from the repo root — gacha has no package.json of
                     # its own, it borrows the root node_modules and vite
npm run dev:gacha    # -> http://127.0.0.1:5180/
```

Production build: `npm run build:gacha` (output in `gacha/dist/`).
Typecheck: `npm run typecheck` (both apps; `gacha/tsconfig.json` covers this one).

The Photo Hunt game is `npm run dev` on port 1420. Both servers can run at the
same time — different ports, different configs.

## The loop

1. **Insert coin** (click the coin plate, or `SPACE`) — a coin arcs into the slot.
2. **Press the button** — the mint cap clicks in, the machine shakes, and every
   capsule in the chamber is thrown in its own direction, bouncing off the glass
   and the ceiling before dropping back.
3. While the pile is in the air the **hatch in the shelf swings open**, and one
   capsule drops straight down the shaft and out through the arch.
4. **Click the capsule** — it flies to the middle of the screen, cracks open, and
   the creature inside comes out (see *The reveal*).
5. **Turn it over** — drag with the mouse. It stays where you leave it; there is
   no auto-spin, so the pose is the player's.
6. The prize joins your collection (kept in `localStorage`) and flies back down
   to the floor when you insert the next coin.

Coins are the currency: one per pull, one back for a common pull, two back for
a rare or legendary one.

## The reveal

The camera never moves. The capsule flies to a point on the camera's own axis
(`REVEAL_DISTANCE`, 1.5 m), which is exactly the middle of the screen whatever
angle the player is looking from. From there:

1. the capsule arrives and scales up,
2. the two halves swing apart on hinges at the *back* edge of the seam, so the
   mouth opens toward the viewer; the creature comes up out of it, still small,
3. the empty shell keeps drifting away from the camera and fades while the
   creature grows to full size,
4. the aura blooms behind the prize — a stack of ten faint discs in the rarity
   colour (grey, blue, gold),
5. the name plate (name + rarity) appears under it.

**The shell always drifts backwards, never forwards.** `revealForward` is the
direction the camera looks, so the retreat vector is `revealForward` itself —
using its negative sends the shell straight at the lens, where it grows and
covers the creature for the whole of the fade. That sign was inverted for a
while and was the real cause of "the shell sometimes hides the prize".

Beat 2 also drifts the shell back by 0.16 while it opens. The lower rim sits
0.135 in front of the capsule's centre and the creature's belly only 0.07, so
without that offset the bowl is drawn across the prize's body.

**The creature is bigger than the shell.** It cannot be lifted out at full size:
the halves would end up framing it instead of holding it, and the seam would cut
across its face. So it emerges at `small` (0.55) and grows into the frame only
after the shell has left.

**The halves are hinged, not rotated in place.** `buildCapsule` puts each dome
inside a pivot parked at `z = -radius * 0.92`; `userData.topGroup` and
`bottomGroup` are those pivots. Rotating a pivot about X swings its front rim
away from the other one — a mouth opening toward the camera. Rotating a dome
about its own centre sweeps the rim through the middle of the capsule instead,
which reads as a hoop worn around the creature's head. Each half also carries a
`BackSide` lining a little smaller than its outer skin, so the open shell looks
hollow rather than showing the back of its own shell.

The prize is **turned with the mouse**: any drag on the canvas rotates it, and
it does not drift on its own — a prize that spins while you are trying to look
at one side of it is fighting you. `OrbitControls` is switched off while a prize
is on screen so the composition holds.

Three details that are easy to get wrong: the creature's origin is at its
*feet*, so it sits below the anchor and the drag has to orbit about
`PRIZE_CENTRE` (`pos = base + offset - offset.applyEuler(rot)`) or it swings out
of frame; the rotation order must be `YXZ`, or the tilt axis turns with the yaw
and a full flip tumbles sideways; and the name plate must not take pointer
events, or it swallows the drag.

## The machine

`gacha-machine.glb` (~880 KB, 11 untextured materials, no image textures) is
modelled procedurally in Blender and exported from `build_machine.py`. To
rebuild it:

1. Open Blender 5.2 with the MCP for Blender addon connected.
2. `exec(open(r"<repo>/gacha/build_machine.py").read())` — it builds the scene,
   exports `gacha/assets/gacha-machine.glb` and renders
   `gacha/assets/machine-preview.png`.

The chamber is glass on the front, left and right faces and solid at the back;
the three panes ship inside the GLB, so the game draws no glass of its own.

**The body under the shelf is solid.** A hole in the shelf drops into a square
shaft, which meets a tunnel that runs forward out of an arch cut in the front
face — one hollow pipe from the pile to the exit, not a hollowed-out cabinet.
The hole is covered by a hatch hinged on its rear edge, so the machine can hold
the pile back until it opens.

Three things block that pipe if they are built after the bore and not cut:
the `CabinetLedge`, the `GlobeShell` floor (z 1.04..1.10, which sits *inside*
the shelf) and the shelf itself. `build_machine.py` cuts all three.

## Nodes the game animates

`build_machine.py` names the parts the game needs, so `src/machine.ts` can find
them without an index:

| Node | Used for |
| --- | --- |
| `Button` | the start control — a single cap that sinks into the panel and springs back |
| `CoinPlate` | the click target for inserting a coin |
| `HatchHinge` | rotate `+90°` about X to open the hatch; it swings down the shaft's rear wall |
| `Cap00`..`Cap10` | the pile in the chamber, thrown while the machine runs |

The delivery anchors live in `src/machine.ts` as constants (`DROP_HOLE`,
`SHELF_TOP`, `CAVITY_FLOOR`, `ARCH_MOUTH_Z`, `HATCH_OPEN`). They mirror the
numbers in `build_machine.py`, so **if you move the shelf, the hatch, the arch
or the shaft floor, change both files**. Blender space `(x, y, z)` becomes glTF
`(x, z, -y)`, and Blender's front (`-Y`) becomes glTF `+Z` — so a capsule
"rolls forward" by increasing `z`, and the hinge opens on positive `rotation.x`.

The hatch is the same tone as the shelf on purpose: closed, the shelf reads as
one solid floor and the hole only appears when it swings. When it is open the
plate hangs at `y 0.209..0.235`, clear of a capsule falling at `y ≤ 0.185` and
of the shaft's rear wall at `y 0.260`.

## The burst

Pressing the button throws every capsule with its own velocity and spin. There
is no physics engine — `updateGlobeBurst` in `src/main.ts` integrates gravity,
bounces each ball off the chamber's inner box, and runs a two-pass
`separateBalls` push-apart so the pile does not pass through itself and read as
one lumpy mass.

The push-apart also carries an **impulse**: when two capsules are closing on
each other the normal component of their relative velocity is reflected, or the
pile keeps grinding through itself and every frame looks slightly different in a
way that reads as jitter. Near-vertical contacts are resolved *vertically*
(`|ny| > 0.5` snaps the normal to ±Y), which is what lets one capsule come to
rest on top of another instead of being shoved aside.

Each capsule is also shoved *away from the middle of the heap* on the throw
itself, so the pile does not erupt in the corner it was already sitting in.
After `BURST_FLY` the sideways drift bleeds off and the heap stops wherever it
lands. **Nothing pulls it anywhere.** There was a funnel towards the middle of
the shelf for a while — it kept the pile compact, but the player could watch the
capsules slide inward after every burst, which reads as a magnet rather than as
a machine. The pile now spreads as it settles (`mean |x|` grows through the
settle, never shrinks) and still stacks to `ySpan ≈ 0.19`, because eleven
capsules cannot fit on the shelf in one layer.

**Nothing re-packs it either.** An earlier version had a `packPile` pass that
dropped each capsule onto the one below; it was a visible teleport at the end of
every burst. The heap comes to rest on its own, when the fastest ball has been
under `BURST_REST_SPEED` for 0.2 s (or after `BURST_SETTLE_MAX`), and every pull
leaves a different pile — which is what a real machine does.

**The shelf is wide enough for all eleven capsules**, so honest physics settles
them into a single flat layer unless the vertical-contact rule above is in
place. If the heap starts reading flat again, that rule is the first thing to
check: it is what gives the pile its `ySpan ≈ 0.2`.

The box (`GLOBE_X`, `GLOBE_Y_FLOOR`, …) is the chamber inset by the capsule
radius. **It is the one place the model's dimensions are duplicated in code** —
move the glass, the shelf or the chamber ceiling in Blender and these have to
follow, or balls will sink through the shelf or hang outside the glass.

## Layout

| Path | What it is |
| --- | --- |
| `build_machine.py` | Blender script that models and exports the machine |
| `assets/` | `gacha-machine.glb`, `machine-preview.png` |
| `src/prizes.ts` | The six prizes, their odds, the procedural meshes, the aura and the hinged capsule |
| `src/machine.ts` | GLB loading, node handles, and the delivery anchors |
| `src/audio.ts` | WebAudio synth — every sound is generated, no audio files |
| `src/ui.ts` | HUD, collection drawer, name plate |
| `src/main.ts` | Scene, choreography, state machine |
| `shoot.mjs` | Headless-Chromium harness that plays the game and screenshots it |

## Harness

```bash
node gacha/shoot.mjs
```

Plays a full pull in headless Chromium and writes `gacha/shots/01..10.png`.
It drives the machine through `window.__gacha` instead of guessing screen
coordinates, and **polls for the phase** rather than sleeping: headless
SwiftShader runs at a few frames a second, and the delivery advances on a
clamped physics step, so a fixed sleep is a coin flip. A pull that takes 1.5 s
on a real GPU takes ~18 s headless.

It also waits for `window.__gacha` to appear: fetching and parsing the model on
a software renderer takes several seconds, and driving the game before the hook
exists is a guaranteed "undefined" failure.

`window.__gacha.reveal()` returns everything the reveal choreography touches —
the shell's scale, position, lid and bowl angles, and the prize's scale and
position — which is how the timings were tuned.

Beware when shooting a transition: a capture returns the frame that is *already
presented*, and dispatching the click plus asking for the image costs a few
hundred milliseconds of the choreography, so a sleep in the harness does not map
onto a moment in the animation. `06-opening` needs 0.45 s where `07-reveal`
needs 1.6 s. To photograph a specific moment reliably, stretch that beat's
duration for the take (`tween(3.0, …)`) and put it back afterwards.
