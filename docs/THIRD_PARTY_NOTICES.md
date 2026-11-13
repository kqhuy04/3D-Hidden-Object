# Third-Party Notices — Photo Hunt

This project incorporates assets, code algorithms, and libraries licensed under open-source and commercial game licenses.

---

## 1. Polyfork Assets and Modules
- **Source:** Polyfork (https://polyfork.dev)
- **Included Assets:**
  - **22 map kits**, listed in `src/data/mapRegistry.ts` and downloaded to
    `public/assets/maps/` (e.g. `campground-lake-ad32b0`, `alpine-and-snow`).
  - **12 player characters**, listed in `src/data/characters.ts` and downloaded
    to `public/assets/characters/` (e.g. `family-road-tripper-247570`,
    `armoured-knight-hero-07121f`). Per-asset attribution, with the author and
    the asset URL for each, is in `public/assets/characters/CREDITS.md` and is
    what the in-game Credits sheet lists.
  - **Kit cover artwork**, the isometric promotional renders of each kit, at
    `public/maps/<id>.jpg`. Derived from `https://polyfork.dev/kits/<kit>/cover.png`
    and re-encoded; see `tools/fetch-kit-covers.mjs`.
  - **One fishing rod and sixteen fish**, at `public/assets/props/` and
    `public/assets/fish/` (`propped-fishing-rod-072978`, and the five freshwater
    and eleven reef species listed in `src/data/fishing.ts`). Attribution, with
    the asset URL for each, is in `public/assets/props/CREDITS.md` and
    `public/assets/fish/CREDITS.md`.
  - **Fish thumbnails**, at `public/assets/fish/thumbs/`. Rendered from the same
    GLB files by `tools/fish-thumbs.mjs`; no third-party artwork is involved
    beyond the models they depict.
  - Animation keyframe tracks (`anim-idle.json`, `anim-walk.json`, `anim-run.json`,
    and the five gait clips).
- **License Terms:**
  - Mesh files (`.glb`) and rendered cover artwork: Dual-licensed under Creative Commons Attribution 4.0 International (CC BY 4.0) and Polyfork Commercial License.
  - ES Modules (`.mjs`) & kit logic: Polyfork Commercial License.
  - Permitted Use: Games, apps, interactive products sold or distributed commercially.
  - Restrictions: Files are not redistributed as standalone raw 3D assets or used to train commercial 3D asset generators.
- **What is deliberately not in this repository:** no `.mjs` module, `LAYOUT.json`,
  `PARTS.json`, `kit.json`, `KIT.md` or `API.md` from any kit download. Those are
  rebuild inputs, extracted locally into `assets-source/` and `extracted_kit/`,
  both gitignored. The repository ships the merged result of `buildKit()` as
  `public/assets/environment/scene.glb` and nothing of the kit's own source.
- **One item to keep an eye on:** the animation tracks in `public/assets/anims/`
  are keyframe data served by Polyfork, not mesh files, so they sit on the
  Polyfork-License side of the split rather than the CC BY 4.0 side. They are
  included because the game plays them at runtime. If Polyfork asks for them to
  go, they can be re-fetched into the build instead of committed.

---

## 2. Three.js Game Starter
- **Author:** luckasnix (https://github.com/luckasnix/three-game-starter)
- **License:** MIT License
- **Reused Components:** Tauri 2 desktop project scaffolding and Vite configuration patterns.

```
MIT License

Copyright (c) 2024 luckasnix

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

---

## 3. Super Star Hopper / low-poly-3d-adventure
- **Author:** Segn11 (https://github.com/Segn11/low-poly-3d-adventure)
- **License:** MIT License
- **Reused Components:** Camera orbit mathematics, smooth spherical coordinate damping, Web Audio synthesizer architecture.

```
MIT License

Copyright (c) 2024 Segn11

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

---

## 4. Adobe Mixamo Animations
- **Source:** Adobe Mixamo (https://www.mixamo.com)
- **Included Assets:** The two fishing clips, `Fishing Idle` and `Fishing Cast`,
  downloaded as FBX and converted to `public/assets/anims/anim-fishIdle.json` and
  `anim-fishCast.json` by `tools/convert-fbx-anim.mjs`. The other gait, jump and
  idle clips on the roster are built the same way.
- **License Terms:** Mixamo animations are free to use in personal and commercial
  projects under Adobe's Mixamo terms. The animations are baked to keyframe data
  for the game's own rig; no Mixamo files are redistributed as standalone assets.

---

## 5. Three.js
- **Author:** Ricardo Cabello (Mr.doob) and Three.js Authors (https://threejs.org)
- **License:** MIT License

```
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
```
