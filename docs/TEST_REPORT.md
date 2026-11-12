# Test & Verification Report — Photo Hunt

**Date:** 2026-11-08  
**Environment:** Windows 10/11 x64, Node.js v22.19.0, Vite 6.4.5, Three.js 0.170.0, Tauri 2.12  
**Test Harness:** Vitest v3.2.7  

---

## 1. Automated Unit Tests

All 22 unit tests across the 4 core gameplay modules executed with 100% pass rate.

```bash
npm test
```

### Output:
```
 RUN  v3.2.7 C:/Users/HuongKT/Photo Hunt

 ✓ tests/RoundManager.test.ts (6 tests)
 ✓ tests/ObjectiveSelector.test.ts (5 tests)
 ✓ tests/PhotoValidator.test.ts (6 tests)
 ✓ tests/PlayerController.test.ts (5 tests)

 Test Files  4 passed (4)
      Tests  22 passed (22)
   Duration  2.81s
```

### Test Case Breakdown

#### ObjectiveSelector (`tests/ObjectiveSelector.test.ts`)
- `[PASS]` Selects exactly 3 objectives.
- `[PASS]` Does not select duplicate targets in the same round.
- `[PASS]` Only selects targets present in the target registry.
- `[PASS]` Produces deterministic output with identical seed.
- `[PASS]` Retry preserves the exact same objectives.

#### RoundManager (`tests/RoundManager.test.ts`)
- `[PASS]` Initializes with 3 uncompleted objectives and 180s.
- `[PASS]` Timer decrements correctly on update.
- `[PASS]` Pause stops timer decrement and resume continues.
- `[PASS]` Completing objectives awards stars and triggers victory on 3.
- `[PASS]` Timeout ends round and preserves earned stars.
- `[PASS]` Retry resets time and progress while keeping the same 3 objectives.

#### PhotoValidator (`tests/PhotoValidator.test.ts`)
- `[PASS]` Passes when target satisfies all four conditions (Target In Frame, Player Proximity, Target Visibility, Screen Size).
- `[PASS]` Fails with `PROXIMITY` ("TOO FAR — Move closer!") if player is beyond target's max distance.
- `[PASS]` Fails with `IN_FRAME` ("NOT IN FRAME — Aim at the target!") if target is outside camera field of view.
- `[PASS]` Fails with `IN_FRAME` if target is behind camera near plane.
- `[PASS]` Fails with `SIZE` ("TOO SMALL — Get closer to the target!") if target screen projection is below minimum fraction.
- `[PASS]` Fails with `OCCLUSION` ("OBSTRUCTED — The target is blocked!") if a solid wall blocks line of sight.

#### PlayerController (`tests/PlayerController.test.ts`)
- `[PASS]` Moves player forward along camera direction.
- `[PASS]` Diagonal movement is normalized and does not exceed straight speed.
- `[PASS]` Prevents player from walking through solid obstacles (sub-stepped collision sliding).
- `[PASS]` Clamps player within map boundary.
- `[PASS]` Grounds player to terrain height.

---

## 2. Production Frontend Build

```bash
npm run build
```
- **TypeScript Check (`tsc --noEmit`):** Clean, 0 errors.
- **Vite Bundler:** Built in 6.12s.
- **Output Artifacts:**
  - `dist/index.html` (0.88 kB)
  - `dist/assets/index-BvxgGqul.css` (8.29 kB)
  - `dist/assets/index-CmBnzMeH.js` (627.26 kB)
  - Complete local copy of `public/assets/` (3D scene, character, offline animations)

---

## 3. Manual Gameplay Verification Checklist

| Scenario | Expected Behavior | Status |
|---|---|---|
| **Start Game** | Main Menu displays with Start Expedition, How to Play modal, Exit. Clicking Start loads 3D scene. | Verified |
| **Campground & Lake Load** | Terrain, cabins, lake, trees, lighting, and shadow maps render seamlessly. | Verified |
| **Character Spawn** | Family Road-Tripper appears on ground at spawn coordinates (0, 0.5, 0). | Verified |
| **Character Locomotion** | Smooth blend between Idle pose and Walk cycle based on movement speed. | Verified |
| **Camera Orbit & Zoom** | Pointer drag rotates yaw/pitch. Mouse wheel zooms camera between 3m and 14m. | Verified |
| **Camera Clearance** | Camera stays >=0.6m above terrain, avoiding underground clipping. | Verified |
| **Target Proximity Fail** | Snapping photo from >20m displays "TOO FAR — Move closer!". | Verified |
| **Target Occlusion Fail** | Snapping photo through cabin walls displays "OBSTRUCTED — The target is blocked!". | Verified |
| **Target Size Fail** | Snapping a tiny distant prop displays "TOO SMALL — Get closer to the target!". | Verified |
| **Target In Frame Fail** | Pointing camera away from targets displays "NOT IN FRAME — Aim at the target!". | Verified |
| **Target Capture Success** | Valid target snapshot triggers white flash, shutter sound, success chime, and checks off objective. | Verified |
| **Multi-Target Snapshot** | Framing multiple objectives in one shot completes all in that photo. | Verified |
| **Star Progression** | Stars update from ☆☆☆ to ★★★ in real time as objectives complete. | Verified |
| **Round Victory** | 3 completed objectives immediately opens Results screen with 3 Stars and remaining time. | Verified |
| **Round Timeout** | Clock reaching 0s triggers Time's Up, awarding earned stars. | Verified |
| **Retry Round** | Preserves original 3 objectives, resets timer to 180s, resets completed status. | Verified |
| **Offline Independence** | Zero remote network or CDN dependencies required at runtime. | Verified |
