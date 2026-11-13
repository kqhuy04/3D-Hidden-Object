# Fishing: the rod, the bar, and the water

A fishing trip is one button held twice. Hold to wind up, let go to cast,
wait, strike, then keep the fish inside a moving band until it gives up. It is
entered by standing at the shoreline and pressing E, on any map with water deep
enough to hold a school — four of the twenty-two.

```
shoreline ──E──► idle ──hold──► charge ──release──► cast ──land──► wait
                   ▲                                                 │
                   │                                            bite │
                   │                                                 ▼
                 result ◄──── bar won/lost ──────────────────────── reel
```

## Where the numbers live

`src/data/fishing.ts` holds every balance number, in one file, so tuning the
game is editing one table rather than hunting through the systems:

| Field | Meaning |
| --- | --- |
| `length` | Metres — the model is scaled to it |
| `speed` | How fast the fish's mark darts up and down the bar |
| `interval` | Seconds between darts; shorter is harder to lead |
| `depth` | Preferred depth, used when placing the school |
| `xp`, `kg` | Experience for landing it, and the range it weighs |
| `rarity` | `common` … `legendary`; colours the name in the catch log |
| `benthic` | Walks the bed instead of swimming at a fixed depth (the crabs) |
| `clips` | Only when the model's clips are not `Idle` / `Swim` / `Swim fast` |

## Four places, four rosters

`FISHING_SPOTS` names the maps and weights the catalogue per map. The weights
are the only thing that differs between two lakes; two copies of a fish would be
two places to change its speed.

| Map | Called | What is in it |
| --- | --- | --- |
| `campground-lake` | The lake | koi, grouper, barracuda, coelacanth, reef shark |
| `alpine-and-snow` | The tarn | coelacanth and koi the common fish, the shark still the prize |
| `countryside-railway` | The canal | crabs on the piling, eels in the silt, one coelacanth nobody catches twice |
| `coral-reef` | The reef | the whole reef catalogue, eleven species, shark at the bottom |

Rare fish get *more* likely as the player levels, so a level-1 lake is mostly
koi and a level-9 lake is worth fishing. A fish that is not on the map's roster
can never be caught there, and `tests/Fishing.test.ts` checks both directions:
every roster entry exists, and every species has a home.

**Why only four.** `WaterSurface` was surveyed across all twenty-two maps for
cells at least half a metre deep within forty metres of open water:
`campground-lake` 501 cells, `alpine-and-snow` 49, `countryside-railway` 25 (an
18 m canal), `coral-reef` 37 (a 9 m pool). Everything else scored zero — a
puddle, or no sheet at all.

## The bar

The reeling bar is the whole minigame, and it is the Stardew one: a vertical
track, a moss band the player controls, and a rust mark that is the fish.

**The band accelerates; it does not follow the button.** `v` is integrated, so
a tap is a nudge and a hold is a climb that overshoots and bounces off the top.
That is the entire difficulty — the fish is random, the band is not, and the
skill is in leading a fish that leans rather than teleports.

- Progress starts at 0.3, fills at 0.27/s inside the band and drains at
  0.185/s outside it. Winning is not a formality but it is not a coin toss.
- A fish that is never once outside the band makes the catch **perfect**, worth
  1.25× the experience.
- The band's height is `0.3 − speed·0.055 + (level−1)·0.016`, clamped to
  0.2–0.5: harder fish get a thinner band, and **levelling widens it**, which is
  the progression the player actually feels.

## The rod

The rod is Polyfork's `propped-fishing-rod`, which is a rod leaning on a forked
stick with a line and a float modelled on it. Three of those four things are
wanted. The stick is removed by name; the modelled line is removed by triangle,
because the game draws its own from the tip to wherever the float landed.

The arm is Mixamo's, so the two had to be married by measurement rather than by
eye — `tools/rod-calibrate.mjs` freezes the boom, films the cast from a fixed
arc, and prints the fit.

**The rod is aimed, not inherited.** Parenting a prop to the hand is the usual
answer and it was wrong here: the Mixamo cast rolls the wrist through 140°, so a
rod carried by the wrist pointed at the sky at rest and at the ground at the top
of the back swing. The two hands do not encode the answer either — at rest they
sit side by side with the rod vertical, at the peak they have swapped heights.
So the rod's *direction* is authored (`ROD_AIM` in `FishingSystem`, in degrees
of elevation and azimuth about the character's own yaw) and only its *position*
comes from the hands. It is a lever: the grip stays in the fists and the tip
points where the cast curve says.

**Both fists are on the cork.** The idle clip puts the hands 22 cm apart *across*
the shaft, not along it, so a rod welded to the right hand passes 22 cm from the
left one and the left hand grips nothing. `FishingRod.aim` slides the holder to
the midpoint between the two hands every frame, and each fist then straddles the
handle.

**The butt is short on purpose.** The grip sits near the butt end of the cork
because everything behind it hangs down out of the hand — and at the top of the
wind-up the hand is beside the character's head, so 30 cm of butt is 30 cm
through the chest. Clearance is measured, not eyeballed: every vertex of the rod
mesh against every bone segment, pose by pose.

**The animation is scrubbed, not played, while charging.** The power meter pulls
the wind-up directly (`aimCast(power)`), so letting go throws from wherever the
arm had got to — a tap and a full hold look different because they *are*
different, and the rod never teleports on release.

## The catch card and the log

A landed fish gets the **same card a hidden object gets**: the word *Found*, the
model turning on its own little stage at one turn every 4.4 s, the name, and a
line with the weight, the experience and whether it was landed clean. It is the
same event as far as the player is concerned, and two different-looking
notifications for it would be two different feelings. The fish is a clone of the
school's prototype, so the stage is told not to free its buffers.

**F opens the catch log, in the map.** A collection you have to leave the map to
look at is a collection you look at twice — once when it fills up and never
again. The log pauses the round the way the pause menu does, and Escape closes
it back to the game rather than swapping panels.

Every species is shown. A caught one gets its picture and its name in the colour
of its rarity (common ink, uncommon moss, rare rust, legendary plum) and its
best weight. An uncaught one gets the *same picture* with `brightness(0)` on it —
a flat black silhouette — and `???`. One file per species serves both states, so
the two can never disagree about which way a fish faces.

The pictures are 192 px PNGs rendered once by `tools/fish-thumbs.mjs`, not drawn
at runtime: sixteen models is sixteen megabytes, and the player presses that key
standing in the middle of a hunt.

## Hints are people, not clocks

Fishing has no timer, for the same reason the hunt has none. The rod tells the
player what to do next through the status chip, and the level chip shows what
the next fish is worth. Nothing counts down.

## Harnesses

- `node tools/fishing-probe.mjs` — the whole trip on `campground-lake`, through
  the debug handle and real mouse events: finds the shore, casts, waits out the
  bite, wins the bar, reads the card and the save file. Screenshots to
  `%TEMP%/hunt-shots`.
- `node tools/rod-calibrate.mjs [map] [port]` — the rod through every beat of the
  cast, from a fixed lens, with the grip and tip measured in `rod-mesh`'s own
  frame.
- `node tools/fish-thumbs.mjs` — regenerates the catch log's pictures from the
  GLBs. Run it after changing `FISH`.
