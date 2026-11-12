# Jump — animation, input and vertical placement

Space is now the jump; the photo moved to **F**.

| Key | Action |
| --- | --- |
| `W A S D` / arrows | Walk |
| `Space` | Jump |
| `F` | Take photo |
| Mouse drag / wheel | Aim / zoom |
| `Esc` | Pause |

## What was added

- `raw-anims/Jumping.fbx` → `public/assets/anims/anim-jump.json` (1.90 s, 58 keys, 21 bones).
- `tools/convert-fbx-anim.mjs` — Mixamo FBX → the JSON format `CharacterAnimator` loads.
- `CharacterAnimator` — loads `jump`, plays it once (`LoopOnce`, `clampWhenFinished`), exposes `startJump()`, `isJumping()`, `getRootLift()`.
- `PlayerController` — owns vertical placement: ground + jump lift, and asks the resolver to settle the body when idle.
- `InputController` — `Space` is edge-triggered (`consumeJump()`), `F` captures.
- HUD and main-menu control hints updated.

## Regenerating a clip

```bash
node tools/convert-fbx-anim.mjs raw-anims/Jumping.fbx jump
```

The script writes `downloaded_anims/anim-<name>.json` **and** `public/assets/anims/anim-<name>.json`.
Add the name to `clipNames` in `CharacterAnimator.loadAnimations` for a new clip.

## Three pitfalls this pipeline handles

**1. More than one take in the file.** `Jumping.fbx` contains a leftover 1 s `Walk` take *and*
the real `mixamo.com` jump. `animations[0]` silently converts the wrong motion, so the script
picks `mixamo.com` by default, refuses when the choice is ambiguous, and accepts
`--take=<name|index>`. Always read the `takes:` line it prints.

**2. Bones with a single keyframe.** Mixamo exports bones it never animates (`Face_Jaw`) as one
key while the body tracks have 58. Writing those onto a shared time array produces a
`QuaternionKeyframeTrack` with 4 values and 58 times; three derives `valueSize = 4 / 58` from
that, allocates a zero-length mixer buffer, and `PropertyMixer.saveOriginalState` loops forever
the first time the action plays — **a frozen tab, not an exception**. The converter resamples
every track onto the densest grid, and `buildClip` skips (with a warning) any track whose key
count does not match, so a bad clip can never freeze the game again.

**3. Hip height is an offset from the bind pose.** The converter reads the rig's bind-pose hip
height from the file (94.99 cm here) instead of hard-coding Mixamo's default, and writes metres.
This is the same convention `anim-walk.json` uses, which is why the first-frame quaternions of
the new clip match the existing ones exactly.

## Why the vertical motion is split

The clip's hip curve is the truth for how the body moves, but the game owns the player's root
height. Writing the whole curve into the skeleton *and* moving the root would double it, so the
converter splits it:

- `rootLift` (airborne part, 0 → 0.560 m) → the game raises the player root, so the camera
  follows and the body leaves the ground.
- `hips` (compression only, 0 → −0.432 m) → stays in the skeleton. A crouch or a landing must
  bend the legs for a hip height the body is actually at; moving the root down instead would
  push the feet through the floor.

`hips + rootLift` always reconstructs the authored curve, so the pose is unchanged — only which
node carries it differs. A unit test asserts this reconstruction.

The collision probe is fed the **un-lifted** ground height, so being 0.5 m up in the air cannot
let the body step onto a table mid-flight.

## Walking out of a landing

The clip holds a landing crouch for its last ~0.4 s. Standing in that pose while the player is
already running reads as sliding, so `locomotion()` takes the body back as soon as the hips have
recovered past −0.15 m and the player is moving. An idle player still plays the clip to the end.

## Verified

In headless Chrome against both the dev server and the production bundle:

- `Space` starts the jump (`Idle → Jump → Idle`), `Space` does **not** take a photo, `F` does.
- Apex **+0.560 m** at 0.77 s; 34 airborne frames; returns exactly to ground; 0 frames below ground.
- A second `Space` mid-air is ignored; jumping again after landing reaches the same height.
- Horizontal movement continues while airborne (10.3 m over the run).
- No console errors, no exceptions.
- 48 unit tests pass (9 new), `tsc` clean, `npm run build` clean.

Screenshots: `docs/jump-1-anticipation.png` (crouch), `jump-2-apex.png` (airborne),
`jump-3-landing.png`, `jump-4-recovered.png`.

---

# Round 2 — jump feel, and the landing that happened in mid-air

Two play-test reports: *"the jump doesn't feel smooth, maybe the jump or the crouch takes too
long"* and *"jumping from high to low, at the end of the jump the character's feet are standing
in the air"*. Both were real, and both had a single measurable cause.

## 1. The clip was played at one rate from start to finish

Measured on the old build, driving the real controller frame by frame:

| | before | after |
| --- | --- | --- |
| Standing still before the feet leave the ground | **0.500 s** | **0.167 s** |
| Airtime | 0.567 s | 0.533 s |
| Standing still after touchdown | **0.800 s** | 0.333 s |
| Whole jump, start to walk-out | **1.867 s** | **1.033 s** |

The clip is 1.90 s: a 0.533 s crouch, a 0.600 s flight and a 0.767 s landing recovery. Played
straight, **1.3 s of it carries no travel** — half a second of a motionless squat before the body
even leaves the ground, which is exactly what "the crouch takes too long" describes.

The fix is one rate per phase, set from the action's own time every frame
(`CharacterAnimator.applyJumpRate`):

```ts
action.timeScale =
  t < jumpTakeoffTime  ? JUMP_CROUCH_RATE   // 3.0
: t < jumpContactTime  ? 1                  // the flight keeps its authored rate
                       : JUMP_RECOVERY_RATE; // 2.4
```

The flight deliberately keeps rate 1. The arc comes from `rootLift` sampled at the clip's time,
so slowing the flight makes the body hang in the air and speeding it up pulls it down faster
than the arc — the feet skate either way. Only the two phases that carry no travel are re-timed.

The three boundaries are **read out of the clip**, not hard-coded (`readJumpPhases`):

- `jumpTakeoffTime` — the first key where `rootLift` rises above 1 cm (0.533 s).
- `jumpContactTime` — the first key after the flight where it is back down (1.133 s).
- `jumpReleaseTime` — the last key whose hip offset is still below 35 % of the crouch depth
  (1.533 s). That is the moment the body is upright enough to run out of the landing.

Re-exporting the animation therefore re-times the jump on its own.

## 2. The landing crouch played while the body was still falling

`resolveVertical` computed the arc as `Math.max(takeoffY + rootLift, groundY)`. The arc is
anchored on the ground the jump *started* from, so it can only ever come back down to that
height. Jump off a 3 m ledge and the arc finishes at 3 m — with the ground 3 m below — and
`Math.max` then holds the body at the take-off height while the clip plays its landing crouch
there. The result is a character squatting on nothing, and a teleport down once the jump ends.
It affected every drop, not just cliffs: a 0.8 m step off the lakeshore showed the same thing.

The body now falls to the landing, and the clip waits for it:

```ts
} else if (this.animator.isJumpArcFinished()) {
  this.feetY = arc;
  this.animator.holdJumpAtContact();   // freeze on the last airborne frame
}
```

`holdJumpAtContact()` pins `action.time` to the contact frame and sets `paused`. While held, the
controller integrates gravity from the contact height; on touchdown `landJump()` releases the
clip and the absorb plays — now with something under the soles. `getMoveScale()` returns 1 while
held, because a body in free fall is not a body with planted feet.

One trap, found by the harness: on touchdown the arc has to be **re-anchored** on the landing
(`takeoffY = groundY`). The absorb still has frames to play, and during it `rootLift` is zero —
measured from the old take-off height that reads as "the arc is over and the landing is below"
all over again, which snapped the body back up and dropped it a second time, forever.

## 3. The camera was riding the arc

`CameraController` lerped its look-at at the horizontal damping rate (10/s), so it followed the
0.55 m arc almost exactly: the whole view went up and came back down with the body, which is most
of what made the jump feel weightless. The vertical aim now follows the **surface the body stands
on**, at `verticalDamping = 3.2`, plus `jumpFollow = 0.25` of the gap between body and surface.
The character rises through the frame instead of the frame rising with it, and a drop off a ledge
is still followed, just slowly. `PlayerController.getGroundY()` supplies the surface height.

## Verified

Measured in headless Chrome by stopping the game loop and stepping the real `Game.update` by
hand, then reading the world height of `LeftToeBase` / `RightToeBase` on every frame. The toe
bone sits ~0.07 m above the sole in the bind pose, so 0.07 is "planted".

| case | take-off | toes at the end of the arc | held | toes at touchdown | absorb |
| --- | --- | --- | --- | --- | --- |
| flat ground | 0.20 s | 0.94 m at apex | 0 frames | 0.073 (planted) | plays on the ground |
| 0.8 m step down | 0.20 s | 0.72 m above the landing | 11 frames | 0.078 | plays on the ground |
| 4.4 m cliff | 0.20 s | 3.67 m above the landing | 33 frames | 0.078 | plays on the ground |

Before the fix the cliff case played the whole landing crouch at the take-off height, 3.5 m above
the terrain. The dev server and the production bundle give identical numbers; the console is
clean in both.

The fall also keeps the speed the arc had at contact (`getContactFallSpeed()`, ~2 m/s for this
clip) instead of restarting from zero, so the descent through the end of the flight is continuous
— the 0.8 m step takes 11 frames of falling rather than stalling for a frame and re-accelerating.

Screenshots: `docs/jump-5-crouch.png`, `jump-6-apex.png` (flat jump), `jump-7-fall-hold.png`
(held airborne frame over the edge), `jump-8-landing-lower.png` (absorb with the feet on the
lower ground).

57 unit tests pass (5 new in `tests/Jump.test.ts`, each checked to fail against the old code),
`tsc --noEmit` clean, `npm run build` clean.

## 4. The fall that stalled for two frames

Reported as "one frame jerks while falling from a height, sometimes not".

The clip's root lift curve does not stop at the ground: its last three keys decelerate
so a jump on the spot settles instead of slamming. That cushion is a landing only if
the ground is where the arc expects it. Jumping off the forest hill, the body is three
metres up when those keys play, so the fall slows to 40% of its speed for two frames
and then re-accelerates:

```
per-frame fall, before     0.0597  0.0236  0.0236  0.0492  0.0542
per-frame fall, after      0.0597  0.0602  0.0652  0.0702  0.0752
```

Two changes, both in the animator:

- `readJumpPhases` now records where the descent is **steepest** (`jumpImpactTime`,
  `jumpPeakFallSpeed`, sampled over a 0.05 s window). Past that point the clip is
  cushioning.
- `PlayerController.resolveVertical` takes over the vertical as soon as the clip is
  cushioning **and** the ground is more than 0.12 m below the height the jump started
  from — the authored cushion travels about 5 cm, so anything further down is not what
  it was written for. The body keeps the speed it had at impact and holds the airborne
  pose; the absorb plays when there is ground.

A jump that lands back on its own ground — flat, a slope, the deck it took off from —
is untouched: `groundY < takeoffY - CUSHION_SKIP` is false there and the cushion plays
as the landing it was authored to be.

`getContactFallSpeed()` (the 0.12 s average at contact) is still used by the other
handoff, where the arc does finish; it includes the cushion, so it reads ~2 m/s where
the body was falling at 3.6, which is why the cut path seeds `getPeakFallSpeed()`
instead.

Verified over three runs (cliff drop, jump onto a bench, flat jump) stepping the loop
deterministically: the only remaining frame-to-frame spike in any of them is the first
frame of the arc, which is the jump's own acceleration.
