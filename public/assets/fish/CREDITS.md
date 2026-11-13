# Fish credits

The school that swims under the four fishable maps, and the sixteen species the
reeling bar can land. Free low-poly models from Polyfork, used under CC BY 4.0 —
the credit lines below are the attribution that licence asks for. Files are
hosted locally so the game keeps working offline (it ships as a Tauri desktop
app).

## Fresh water

| Fish | Asset | Licence |
| --- | --- | --- |
| Koi | Koi by Polyfork (https://polyfork.dev/asset/koi-base), CC BY 4.0 | CC BY 4.0 |
| Grouper | Grouper by Polyfork (https://polyfork.dev/asset/grouper-base), CC BY 4.0 | CC BY 4.0 |
| Barracuda | Barracuda by Polyfork (https://polyfork.dev/asset/barracuda-base), CC BY 4.0 | CC BY 4.0 |
| Coelacanth | Coelacanth by Polyfork (https://polyfork.dev/asset/coelacanth-base), CC BY 4.0 | CC BY 4.0 |
| Reef shark | Reef shark by Polyfork (https://polyfork.dev/asset/reef-shark-base), CC BY 4.0 | CC BY 4.0 |

## Reef

| Fish | Asset | Licence |
| --- | --- | --- |
| Reef fish | Reef fish by Polyfork (https://polyfork.dev/asset/reef-fish-base), CC BY 4.0 | CC BY 4.0 |
| Flame angelfish | Flame angelfish by Polyfork (https://polyfork.dev/asset/flame-angelfish-ce502b), CC BY 4.0 | CC BY 4.0 |
| Foxface | Foxface rabbitfish by Polyfork (https://polyfork.dev/asset/foxface-rabbitfish-6a7006), CC BY 4.0 | CC BY 4.0 |
| Firefish | Firefish by Polyfork (https://polyfork.dev/asset/firefish-base), CC BY 4.0 | CC BY 4.0 |
| Jellyfish | Jellyfish by Polyfork (https://polyfork.dev/asset/jellyfish-base), CC BY 4.0 | CC BY 4.0 |
| Moray eel | Moray eel by Polyfork (https://polyfork.dev/asset/moray-eel-base), CC BY 4.0 | CC BY 4.0 |
| Octopus | Octopus by Polyfork (https://polyfork.dev/asset/octopus-base), CC BY 4.0 | CC BY 4.0 |
| Stingray | Stingray by Polyfork (https://polyfork.dev/asset/stingray-base), CC BY 4.0 | CC BY 4.0 |
| Sea turtle | Sea turtle by Polyfork (https://polyfork.dev/asset/sea-turtle-base), CC BY 4.0 | CC BY 4.0 |
| Shore crab | Shore crab by Polyfork (https://polyfork.dev/asset/shore-crab-base), CC BY 4.0 | CC BY 4.0 |
| Hermit crab | Hermit crab by Polyfork (https://polyfork.dev/asset/hermit-crab-base), CC BY 4.0 | CC BY 4.0 |

## What the files are

Each fish ships with three clips — `Idle`, `Swim` and `Swim fast` — and the
school picks between them from how hard the fish is working. The two crabs ship
`Idle` / `Walk` / `Run` instead, and `src/data/fishing.ts` maps them onto the
three the school expects, because a crab walks the bed rather than swimming over
it. The models are authored nose-first along +Z with the origin on the bed, which
is what lets `FishSchool` place them by the water's own depth grid instead of by
a hand-written table of positions.

`thumbs/` holds one 192 px PNG per species, rendered from the same GLB by
`tools/fish-thumbs.mjs`. The collection screen shows the picture as it is for a
fish you have caught and as a flat black silhouette for one you have not, so a
single file serves both states.
