# Technical Decisions — Photo Hunt

## 1. Architecture Choice

### Rendering & Framework: Three.js + TypeScript + Vite
- **Choice:** Vanilla Three.js with TypeScript and Vite.
- **Rationale:** 
  - Direct integration with Polyfork's `buildKit()` API which outputs native `THREE.Group`, `THREE.Mesh`, and `THREE.Box3`.
  - Zero framework overhead (avoids React Three Fiber / component re-renders during 60 FPS gameplay loops).
  - Clean separation of game subsystems (`core`, `world`, `player`, `photography`, `missions`, `ui`).

### Desktop Packaging: Tauri 2 (Windows MSI First)
- **Choice:** Tauri 2 over Electron.
- **Rationale:**
  - Tauri produces tiny, high-performance native executables (~5-10 MB instead of 150+ MB for Electron).
  - Uses Windows WebView2 (already present on modern Windows 10/11 installations).
  - Out-of-the-box support for generating Windows `.msi` installers via WiX toolset.
  - Native multiplatform readiness for Android/iOS in subsequent milestones.

### Physics & Collision: Polyfork Hull & Box Collisions
- **Choice:** Built-in Polyfork collision geometry (`place.blocked()`, `place.boxes()`, `place.groundAt()`) with character sliding cylinder/capsule physics.
- **Rationale:**
  - Polyfork's kit already computes tight 2D convex hulls for all 174 obstacles and provides raycast ground heights.
  - Heavy physics engines like Rapier are unnecessary for casual walking and introduce WASM initialization latency, memory footprint, and potential build complexity for desktop MSI.

### Audio Engine: Procedural Web Audio API Synthesizer
- **Choice:** Procedural audio synthesis inspired by Segn11's audio engine.
- **Rationale:**
  - Zero external MP3/WAV files to load or bundle.
  - Generates shutter clicks, success fanfares, timer alerts, and ambient chimes synthetically in real time.
  - 100% offline and low memory overhead.

## 2. Evaluation of Candidate Repositories

### Repository A: `three-game-starter` (luckasnix)
- **Status:** Evaluated and selected as Tauri 2 scaffold structure.
- **Strengths:** Clean Tauri 2 + Vite + TypeScript setup, correct `tauri.conf.json` v2 schema, clean package manager scripts.
- **Adopted:** Tauri 2 configuration, Vite setup, and project scaffolding.
- **Discarded:** Unnecessary Rapier dependency for walking gameplay.

### Repository B: `low-poly-3d-adventure` (Segn11)
- **Status:** Surveyed for subsystem patterns.
- **Strengths:** Proven 3rd-person camera orbit mathematics, mouse drag / pointer event handling, smooth spherical damping, procedural audio engine.
- **Adopted:** Camera orbit & pitch clamping algorithms, procedural Web Audio SFX patterns.
- **Discarded:** Platformer mechanics (jumping, wall-jump, floating islands, enemies, combat, Electron shell).

### Repository C: `React-Three-Fiber-Character-Controller` (3merillon)
- **Status:** Surveyed and discarded.
- **Reason for Discard:** Tied to React Three Fiber and Rapier. Mixing R3F into a vanilla Three.js Polyfork pipeline adds unnecessary architectural friction.

## 3. Polyfork Integration Strategy

- **Build-Time & Packaging:** `buildKit()` reads the kit from a local, gitignored `assets-source/` and writes the merged result to `public/assets/maps/`. Only that merged GLB is committed — see *What this repository does and does not redistribute* in `ASSET_INVENTORY.md` for why the kit's `.mjs` modules and manifests never ship.
- **Target Node Retention (`keep` parameter):** When `buildKit()` is invoked, target object IDs (such as `camp-canoe`, `camping-lantern`, `a-frame-cabin`, etc.) are passed to `keep`. This ensures Polyfork merges static background clutter (trees, terrain, fences) into batch draw calls for 60 FPS performance while keeping interactive photo targets as isolated nodes for bounding-box and raycast validation.
- **Animation Local Packaging:** Animations (`Idle`, `Walk`, `Run`) were fetched and saved locally in `public/assets/anims/` so no runtime network calls ever occur.

## 4. Frame Loop Order

The three callbacks in `GameLoop.tick` are **not** interchangeable. The order is
`onFrameTime` → `onUpdate` → `onRender`, and the first one is first for a reason.

`onFrameTime` is where `RenderQuality` decides to change the internal resolution,
and applying that decision calls `renderer.setPixelRatio` → `setSize` → assigns
`canvas.width`, which resets the drawing buffer to transparent black. With the
call *after* `onRender` — where it used to be — the buffer was cleared with the
finished frame already in it, and the browser presented an empty canvas until
the next `requestAnimationFrame` painted over it. Against `body { background:
var(--ink) }` that reads as a full-screen black flash, which is what was
reported as *"màn hình thỉnh thoảng đen toàn màn hình 1 vài frame"* while walking.

It only happened occasionally because the scaler decides at most once a second
and only steps when the smoothed frame time crosses 20.5 ms or 13.0 ms — and
only while a round is running, which is why it looked tied to movement.

`onWindowResize` had the same shape and now repaints immediately after
`setSize`, since a resize arrives between frames rather than inside one.

`tests/GameLoop.test.ts` pins the order, so a future reorder fails the suite
rather than the player.
