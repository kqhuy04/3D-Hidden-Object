# Asset Inventory — Photo Hunt

| Asset Name | Source / Origin | Format | Size | Rig / Skeleton | Animations | License | Role in Photo Hunt |
|---|---|---|---|---|---|---|---|
| `family-road-tripper-247570.glb` | Polyfork (`asset/family-road-tripper-247570`) | GLTF Binary (GLB) | 940,004 bytes | 31-bone Mixamo humanoid skeleton | Built-in `Walk` clip | Polyfork License / CC BY 4.0 | Player character model |
| `kit-campground-lake-ad32b0.zip` | Polyfork (`kit/campground-lake-ad32b0`) | Zip archive (GLB, MJS, JSON) | 41,889,214 bytes | Some character parts rigged; buildings & props static | Baked layouts and animations | Meshes CC BY 4.0 / Code Polyfork License | Campground & Lake 3D environment, 62 parts, 174 placements |
| `extracted_kit/terrain.glb` | Polyfork Campground & Lake | GLTF Binary (GLB) | 3,286,088 bytes | None (Terrain mesh) | None | CC BY 4.0 | Low-poly terrain geometry with height relief, lake bed, creek |
| `extracted_kit/LAYOUT.json` | Polyfork Campground & Lake | JSON | 34,577 bytes | N/A | Placement paths for roaming NPCs | Polyfork License | Master layout coordinates for all 174 object instances in scene |
| `extracted_kit/kit.json` | Polyfork Campground & Lake | JSON | 3,967 bytes | N/A | N/A | Polyfork License | Classification metadata (buildings, vehicles, props, characters) |
| `extracted_kit/PARTS.json` | Polyfork Campground & Lake | JSON | 26,477 bytes | N/A | N/A | Polyfork License | Part definitions, colorways, customizable parameters |
| `downloaded_anims/anim-idle.json` | Polyfork Animation CDN | JSON track data | ~180 KB | 22 humanoid bone tracks | `Idle` (299 keyframe poses) | Polyfork License | Character idle animation (100% offline) |
| `downloaded_anims/anim-walk.json` | Polyfork Animation CDN | JSON track data | ~25 KB | 22 humanoid bone tracks | `Walk` (30 keyframe poses) | Polyfork License | Character walk locomotion cycle (100% offline) |
| `downloaded_anims/anim-run.json` | Polyfork Animation CDN | JSON track data | ~20 KB | 22 humanoid bone tracks | `Run` (22 keyframe poses) | Polyfork License | Optional run/sprint locomotion (100% offline) |

### What this repository does and does not redistribute

Polyfork's terms split the kit in two: **the GLB meshes are CC BY 4.0**, everything
else in the download — the `.mjs` build modules, `LAYOUT.json`, `PARTS.json`,
`kit.json`, `KIT.md`, `API.md` — is under the **Polyfork License**, which forbids
redistributing them as standalone asset files. The public repository therefore
carries only the merged map (`public/assets/maps/*.glb`, CC BY 4.0) and the game's
own code.

`assets-source/` and `extracted_kit/` are **not** in the repository and are listed
in `.gitignore`. They are rebuild inputs, produced locally by
`node tools/prepare-maps.mjs` from the kit download; the rows above document that
local lineage so a future rebuild knows what it is starting from. Do not commit
them, and do not paste their contents into an issue, a release or a gist.

## Target Objects Available in Map
From `LAYOUT.json` and `kit.json`, the following catalog of 19 distinct target types are physically present in the Campground & Lake scene:
1. `camp-canoe` (Vehicle, 2 instances)
2. `camping-lantern` (Prop, 4 instances)
3. `a-frame-cabin` (Building, 1 instance)
4. `porch-log-cabin` (Building, 1 instance)
5. `splay-leg-lookout-tower` (Building, 1 instance)
6. `hip-roof-ranger-station` (Building, 1 instance)
7. `pop-top-camper-van` (Vehicle, 1 instance)
8. `rv-travel-trailer` (Vehicle, 1 instance)
9. `teardrop-trailer` (Vehicle, 1 instance)
10. `lake-kayak` (Vehicle, 1 instance)
11. `lake-rowing-skiff` (Vehicle, 2 instances)
12. `bear-proof-food-locker` (Prop, 1 instance)
13. `two-burner-camp-stove` (Prop, 1 instance)
14. `creek-footbridge` (Prop, 1 instance)
15. `trailhead-sign` (Prop, 1 instance)
16. `tackle-box` (Prop, 1 instance)
17. `stand-up-paddleboard` (Prop, 1 instance)
18. `hammock-on-posts` (Prop, 1 instance)
19. `swim-raft` (Prop, 1 instance)

All assets are packaged locally with zero external network / CDN calls during runtime.

---

## Payload budget

Measured on the shipping build, not estimated.

### What the game actually downloads

| file | before | after |
| --- | --- | --- |
| `scene.glb` — the whole map | 18.95 MB | **1.47 MB** (Draco) |
| `family-road-tripper-247570.glb` — player | 0.92 MB | 0.92 MB |
| `anims/*` — 5 clips | 0.26 MB | 0.26 MB |
| `draco/` — decoder (wasm + wrapper) | — | 0.25 MB |
| JS + CSS | 0.68 MB | 0.68 MB |
| **runtime total** | **20.8 MB** | **3.6 MB** |

`dist/` was 62 MB because Vite copies all of `public/` and the folder held the kit's
individual parts as well. Nothing ever fetched them — `src/` references only
`scene.glb`, the character and the anims — so they were moved to `assets-source/kit/`
and `dist/` is now **3.5 MB**.

### Why the map was 19 MB

No textures at all (`images: 0`, `textures: 0`). The weight is vertex data:

| accessor class | bytes | share |
| --- | --- | --- |
| `VEC3` float32 — POSITION, NORMAL, COLOR_0 | 16.71 MB | 90% |
| `VEC4` float32 — WEIGHTS_0 (skinning) | 0.81 MB | 4% |
| `SCALAR`/`VEC4` uint16/uint32 — indices, JOINTS_0 | 1.09 MB | 6% |

486,699 vertices × 36 bytes (three `VEC3` float32 attributes) is the whole file.
`extensionsUsed` is empty: the kit ships uncompressed.

### What each compression step buys

| step | size | ×  | note |
| --- | --- | --- | --- |
| original | 18.95 MB | 1.0 | |
| `quantize` (pos 14 bit, normal 8, uv 12) | 7.34 MB | 2.6 | keeps plain glTF |
| `meshopt --level high` | 3.02 MB | 6.3 | 20 kB decoder |
| **`draco`** | **1.40 MB** | **13.5** | 250 kB decoder |

Draco also loads *faster*: the app reaches the menu in **5.4 s** instead of **16.5 s**,
because parsing 19 MB of float arrays costs more than decoding 1.4 MB.

### Applying it to a new map

```bash
npx @gltf-transform/cli@4 draco map.glb map-draco.glb
```

`DRACOLoader` is already wired in `WorldLoader` against `/draco/`, so the output drops
straight in. Do **not** use `gltf-transform optimize` — it runs `join`, which merges
meshes and destroys the per-prop node names that `CollisionGeometry` uses to build
collision parts (and the `neverWall`/`NON_SOLID` name lists).

### Verifying a compressed map

A walk fingerprint over 75 points on a 8 m grid — teleport, settle, walk +x for 45
frames, record the end position — run against both versions of the same map:

- **73 of 75 points identical** to the millimetre.
- 1 point differs by 9 cm, in the water at y −4.7 (outside the playable area).
- 1 point at (14, 6) diverges 3.4 m: the body starts wedged in a cluster of props and
  the quantisation changes which way it slips out. Both versions are heavily blocked
  there; it is a knife-edge, not a regression.

Collision structure is unchanged: 149 parts, 110,713 collision triangles, and the
hammock part is still 782 triangles with identical bounds.

### Scaling to 20 more maps

At 40 MB per kit folder the user's estimate was 1 GB. Measured, a map is 18.95 MB as a
single `scene.glb`, and 1.4 MB compressed:

| maps | uncompressed | Draco |
| --- | --- | --- |
| 1 | 18.95 MB | 1.4 MB |
| 10 | 190 MB | 14 MB |
| 21 | 398 MB | 29 MB |

If every map ships in one build they must not all be loaded at once — one `scene.glb`
is decoded and its collision built at startup, so maps should be swapped, not merged.

### Measured: twenty maps

The estimate above was per map. Twenty kits later the numbers are real:

| | |
| --- | --- |
| archives in `maps/` | 1.26 GB (20 zips) |
| extracted `scene.glb` (what the pipeline actually reads) | 806 MB |
| Draco payload in `public/assets/maps/` | 58 MB |
| compression | **14.0×** |
| `dist/` with all twenty | 62 MB |

The gap between 1.26 GB of archive and 806 MB of `scene.glb` is the kit's own
part files — each zip carries a hundred-odd separate meshes beside the assembled
scene, and the game never loads them. `tools/prepare-maps.mjs` extracts only
`scene.glb`.

| map | source | Draco | × | objects | triangles |
| --- | --- | --- | --- | --- | --- |
| symphony-stagecraft | 181.5 MB | 9.07 MB | 20.0 | 757 | 1,182,724 |
| stadium | 62.4 MB | 4.74 MB | 13.2 | 424 | 430,812 |
| frontier-town | 58.9 MB | 5.33 MB | 11.1 | 589 | 430,954 |
| chronos-hearth | 53.8 MB | 3.85 MB | 14.0 | 1,073 | 652,814 |
| countryside-railway | 46.7 MB | 3.33 MB | 14.0 | 291 | 355,480 |
| skatepark | 44.3 MB | 3.34 MB | 13.3 | 1,267 | 347,470 |
| modern-restaurant-cafe | 43.8 MB | 3.92 MB | 11.2 | 1,158 | 334,304 |
| office | 40.5 MB | 3.05 MB | 13.3 | 1,030 | 354,684 |
| dia-de-muertos | 38.0 MB | 4.02 MB | 9.4 | 600 | 489,108 |
| construction-site | 36.1 MB | 2.21 MB | 16.4 | 252 | 310,806 |
| cozy-farm | 35.4 MB | 3.14 MB | 11.3 | 618 | 295,295 |
| chrome-arcology-transit | 31.3 MB | 2.39 MB | 13.1 | 544 | 275,603 |
| japanese-suburban-city-street | 26.4 MB | 1.71 MB | 15.5 | 524 | 250,969 |
| coral-reef | 23.1 MB | 1.40 MB | 16.6 | 195 | 168,914 |
| neighborhood-pathways | 21.1 MB | 1.28 MB | 16.5 | 292 | 183,517 |
| hospital | 14.1 MB | 1.17 MB | 12.0 | 319 | 114,539 |
| space-base | 13.4 MB | 0.78 MB | 17.1 | 157 | 118,476 |
| medieval-village | 13.2 MB | 1.24 MB | 10.7 | 559 | 120,191 |
| pirate-cove | 11.7 MB | 0.83 MB | 14.1 | 185 | 106,426 |
| nyc-city | 10.5 MB | 0.70 MB | 15.0 | 208 | 95,077 |

Only the selected map is fetched at runtime; the other nineteen are files on
disk (or in the Tauri bundle) that nothing touches until the picker asks for
one. In the desktop build they are local reads, not downloads.

### The archives are disposable

Once a map is prepared, its zip is redundant: `maps/reports/<id>.json` holds the
bounding boxes and spawn, `public/assets/maps/<id>.glb` is the payload, and
`maps/work/<id>/scene.glb` is the extracted source kept for `--refresh`.
`src/data/mapRegistry.ts` is now rebuilt from those sidecars rather than from the
archives present, so deleting every zip does not shrink the registry — a run
with no archives left just rebuilds it and exits.
