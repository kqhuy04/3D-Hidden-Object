# 04 — Điểm tối ưu (perf & chi phí thật)

Ràng buộc tôi giữ nguyên từ `MEMORY.md:21`: **"Never reduce visual quality to buy performance."**
Vì vậy mọi đề xuất dưới đây chỉ thuộc ba loại:
- **(1) bỏ công việc không ra pixel nào** (update thứ đang ẩn, tính lại thứ chưa đổi),
- **(2) làm lại cùng công việc rẻ hơn** (scratch object, cache, thuật toán),
- **(3) chỉ tăng** (asset pipeline, không phải downgrade runtime).
Không có đề xuất nào tắt shadow, giảm pixel ratio, bỏ NPC, bỏ animation.

Mức độ = tác động ước tính trên frame budget. Tôi **chưa** profile runtime (lý do: `tmp-chrome-profile` + dev server sẽ xung đột với phiên đang sửa code — xem mục D cuối file). Đây là phân tích tĩnh, có bằng chứng đếm được; bước "đo thật" nằm trong `06-ke-hoach-khac-phuc.md` mục V1.

---

## A. Bằng chứng định lượng tôi tự đo

### A1. Số vật thể trong mỗi map (`git ls-tree` + decode JSON chunk của GLB)

| Map | MB | meshes | **materials** | nodes |
|---|---|---|---|---|
| dia-de-muertos | 4.02 | 1585 | 349 | **7435** |
| symphony-stagecraft | 9.07 | 1519 | 925 | **6948** |
| frontier-town | 5.33 | 2088 | 599 | 5671 |
| stadium | 4.74 | 1382 | 430 | 4716 |
| modern-restaurant-cafe | 3.92 | 1665 | **1207** | 4256 |
| skatepark | 3.34 | 1529 | **1268** | 3850 |
| cozy-farm | 3.14 | 1540 | 619 | 3563 |
| office | 3.05 | 1488 | **1047** | 3631 |
| chronos-hearth | 3.85 | 1245 | 563 | 3883 |
| coral-reef | 1.40 | 383 | 195 | 1735 |

Hai con số đáng chú ý:

1. **`imgs: 0` trên cả 21 map** — không map nào có texture; toàn bộ hình họa là màu vật liệu + light. Tốt cho payload, nhưng mỗi material là một draw call riêng vì không có atlas nào gộp chúng lại.

   **Đo thật (21 map `public/assets/maps/*.glb`, script `plan/tmp-materials.mjs`, đếm `(material.name, baseColorFactor)`):**

   | | Tổng |
   |---|---|
   | material | **10 834** |
   | pair `(name,color)` **trong từng map** | **10 616** → dedup màu *trong một map* chỉ tiết kiệm **218** (~2 %) |
   | primitive | **21 538** |
   | pair `(name,color)` **gộp cả 21 map** | 1 456 — tiết kiệm 86 %, **nhưng vô nghĩa**: mỗi lần chơi chỉ nạp 1 map |

   Bản thân con số 2 % đã là một kết quả đáng báo cáo: các vật liệu **đã** khác màu nhau gần như từng cái một, nên "dedup material" kiểu quét tên+ màu **không phải** cơ hội ở đây. Cơ hội thật nằm ở chỗ khác, và nó nằm ngay ở cột cuối: **21 538 primitive chỉ cho 10 616 material → mỗi material được dùng trung bình 2.03 lần** (`office` 1047/1488, `skatepark` 1268/1529, `medieval-village` 566/606 ≈ 1.07 — tức có map gần như 1:1, có map 1:2). Gộp geometry *theo material* về lý thuyết đưa số draw call từ 21 538 về 10 616 (−51 %).

   **Nhưng không làm thô được, và đây là điểm phải cân nhắc kỹ trước khi ai đó chạy `@gltf-transform merge`:** bộ solver của game đánh địa chỉ **theo node** — `CollisionGeometry` dựng part từ node, `isPickablePart(name)` chọn decoy theo tên node, `PROP_SHIFTS`/`PROP_REMOVALS` trong `mapFixes.ts` tìm node **bằng tên**, hidden object attach vào node. Gộp mesh là **xoá node**. Một lệnh merge mù sẽ âm lặng phá toàn bộ pipeline nội dung (và với `01` W1/W2 — fix không khớp mà không ai thấy — thì không có gì báo cho biết đã phá). Nếu muốn theo hướng này, chỉ gộp được nhóm node **không có tên trong bất kỳ danh sách nào** (decoration thuần), và phải có báo cáo "đã gộp gì, đã bỏ qua gì và vì sao".
   → Vẫn cần số thật (bước V1 trong `06`): `renderer.info.render.calls` lúc đứng giữa chợ skatepark. Nếu calls ≈ 1500 (bằng số primitive của map) thì culling đang **không** giúp gì và việc gộp decoration là ưu tiên; nếu calls ≈ 300 thì frustum + occlusion đang làm tốt và mục này tụt xuống cuối.

2. **7435 node cho một map** (`dia-de-muertos`). Mỗi node là một `Object3D` với matrix thế giới. Nếu ba mẹ con đều `matrixAutoUpdate = true` mặc định, `scene.updateMatrixWorld()` mỗi frame duyệt và nhân ma trận cho toàn bộ chúng ngay cả khi cả map đứng yên.
   → Kiểm tra: bao nhiêu node đặt `matrixAutoUpdate = false` / `static`? Nếu chưa có chỗ nào, đây là "công việc bỏ đi thuần túy" (loại 1) và là chiến thắng lớn mà không đổi một pixel nào: `updateMatrixWorld` trên 7k node mỗi frame, trong khi chỉ có vài chục node thật sự di chuyển.

### A2. Allocation trong đường nóng (`grep -c "new THREE\." …`, tự chạy)

| File | `new THREE.*` / `.clone()` |
|---|---|
| `WorldLoader.ts` | 28 (chủ yếu load-time — ổn) |
| `FishingSystem.ts` | 28 (mới, WIP) |
| `CollisionDebugView.ts` | 25 (debug-only — ổn) |
| `Mounts.ts` | 15 |
| `WorldCollision.ts` | 13 ← **query chạy mỗi frame của player** |
| `NpcCrowd.ts` | 12 |
| `SunShadows.ts` | 11 |
| `CameraController.ts` | 10 |
| `PlayerController.ts` | 2 module-scratch + 1 trong update |

Điểm đáng khen: cả codebase dùng **pattern scratch module-level** nhất quán (`_boomEnd`, `_eye`, `_world`, `_local`, `_quat`, `_parentQuat`, `_groundProbe`, `_noMovement`, `_movementDelta`), và một số file đã có comment giải thích vì sao (`CameraController.ts:88-93`, `PlayerController.ts:8-18`). Nghĩa là tác giả đã biết vấn đề; các chỗ còn lại là **sót**, không phải chưa hiểu. Danh sách "sót" cụ thể ở mục B.

### A3. Số chỗ `scene.traverse` theo file
`WorldLoader.ts` 13 (load-time), còn lại 1-5/file. Cần xác minh file nào traverse **mỗi frame** — đó mới là bug. Theo các report đã kiểm: `skinnedCulling.ts` (1) và `SunShadows.ts` (1) là hai ứng viên phải đọc kỹ; `NpcCrowd.ts` (2), `Mounts.ts` (3), `CharacterAnimator.ts` (2), `HiddenItemSystem.ts` (3) có thể là attach-time. Đánh dấu là **V2** trong file kế hoạch.

### A4. Bundle
`index.js` = 864 KB (232 KB gzip), một chunk duy nhất, Vite cảnh báo > 500 KB. Với app Tauri offline: **không đáng sửa**. Code-split theo map sẽ làm phức tạp load path mà không đổi thời gian khởi động đáng kể (vì map GLB 60 MB mới là payload thật). Ghi lại để khỏi mất thời gian tranh luận.

---

## B. Allocation còn sót trong đường nóng — sửa được ngay, cùng pixel

Mỗi dòng dưới đây tôi đã grep/xem code thật tại thời điểm 19:45.

### B1. `InteractableSelector.update()` — array + object literal mỗi frame, mỗi candidate
`src/game/missions/InteractableSelector.ts:203, 243, 285-321`
Mỗi frame của PLAYING: `const scored: Candidate[] = []`, `const visible: Candidate[] = []`, một object literal cho mỗi candidate trong tầm (`scored.push({ key, kind, object, centre, radius, distance, item, action })`), một sort qua closure, cộng thêm một chuỗi `` `${cx}:${cz}` `` **mỗi ô grid** được thăm. Ở góc chợ đông, hàng chục object ngắn sống × 60/s.
Sửa: hai mảng thành viên (`scored.length = 0`), pool `Candidate` theo slot, so sánh `distanceSq` trước khi dựng object, và lưu index ô thay vì string key.
Đây là chỗ có thêm bug logic (file 02 mục B2/B3/B4) → **sửa perf và sửa logic cùng một lượt**, vì sẽ phải đụng lại vòng lặp.

### B2. `WorldCollision.moveCapsule` — clone + mảng contacts mỗi lần gọi
`src/game/world/WorldCollision.ts:295-296, 435-445` (theo báo cáo agent, 1-2 lần/frame)
`moveCapsule` clone probe và dựng mảng `contacts` mới với tới 8 object contact mỗi call. 8 object × 2 call × 60 frame/s = ~960 object/giây toàn phần từ một hàm.
Sửa: mảng contact phẳng (`Float32Array` hoặc preallocated `Contact[]` với counter), hết vòng thì reset counter thay vì cấp phát.

### B3. `NpcCrowd` — Vector3 cho từng candidate khi chọn người rảnh
`src/game/npc/NpcCrowd.ts:597`: `const distance = other.unit.getWorldPosition(new THREE.Vector3()).distanceTo(here);` → một Vector3 mỗi người mỗi lần tìm. `Mounts.ts:392` (`face()`): `parent.getWorldQuaternion(new THREE.Quaternion())` mỗi frame khi đang cưỡi. `Mounts.ts:135` / `NpcCrowd.ts:272` getter `actions` map ra mảng mới **mỗi lần đọc**, và selector đọc khi chọn đích. `NpcCrowd.ts:216-217`: `new THREE.Euler()` + `getWorldQuaternion(new THREE.Quaternion())`.
Sửa: dùng scratch `_world`/`_parentQuat` đã có sẵn trong chính file đó (dòng 183-186) — không phải thêm hạ tầng, chỉ là gọi cái đã có.

### B4. Camera: object literal cho mỗi sự kiện chuột, `Vector2` clone mỗi frame
- `CameraController.ts:196, 209`: `this.lastPointerPos = { x: e.clientX, y: e.clientY }` và `clickOrigin = {…}` → tới ~1000 object/giây với chuột 1 kHz.
- `InputController.ts:68`: `{ x: e.clientX, y: e.clientY }` mỗi pointerdown.
- `PlayerController.ts:241`: `const normalizedInput = inputDirection.clone().normalize();` — cấp phát 60/s, **và vô nghĩa**: `InputController.getMovementVector` (292-294) đã clamp độ dài về 1 rồi.
- `PlayerController.ts:272-274, 292`: `Math.hypot(actualDx, actualDz)` tính **hai lần** trong cùng frame.
Sửa: hai số `lastX/lastY` thay cho object; bỏ `.clone().normalize()`; lưu hypot một lần vào `actualDistance`.

### B5. `AudioEngine.playShutter` — sinh buffer noise mỗi lần chụp
`src/app/audio/AudioEngine.ts:96-101`: tạo `createBuffer` và điền `Math.random()` (~1.5k mẫu) mỗi kiểu chụp — ngay khoảnh khắc renderer đang capture và mở found screen. Âm không cần tươi mới từng shot.
Sửa: sinh một `AudioBuffer` lazy rồi dùng lại (kể cả khi muốn "không lặp y hệt", chỉ cần detune/playbackRate ngẫu nhiên — rẻ hơn rất nhiều).

### B6. `DebugOverlay` — `innerHTML` toàn bộ mỗi frame (chỉ khi `?debug=1`)
`src/ui/DebugOverlay.ts:74-81`: dựng `itemStatus` bằng `.map()` qua mọi hidden item (kèm `Math.hypot`) rồi `.join('')` và gán `container.innerHTML` **mỗi frame**.
Ship impact: 0 (dev-gated). Nhưng nó đốt frame budget đúng trong phiên debug low-FPS mà nó tồn tại để phục vụ → số FPS đọc được là số bị thiết bị đo làm méo.
Sửa: dựng DOM một lần, giữ node ref, ghi `textContent` có đổi-gate (pattern `GameHUD.ts:193-203` đã làm đúng và đã có trong codebase).

### B7. Fishing reel — viết thuộc tính layout mỗi frame ngay trên canvas WebGL
`src/ui/FishingMinigame.ts:152, 185-191`: `zone.style.bottom`, `fish.style.bottom`, `progressFill.style.height`, `powerFill.style.width` bằng %, mỗi frame (gọi từ `FishingSystem.ts:549` trong update loop). `bottom`/`height`/`width` ⇒ **layout + paint** lại subtree, không phải GPU-composited.
Sửa: `transform: translateY()` + `scaleY()` trên phần tử đã đặt vị trí — cùng visuals, hết layout. (Đây là loại (1): không đổi hình, chỉ đổi thuộc tính.)

### B8. `MainMenu.setMap` — `new Image()` probe không theo dõi, last-writer-wins
`src/ui/MainMenu.ts:247-255`: mỗi lần `setMap` tạo một `probe` với `onload/onerror` ghi `backdrop.style.backgroundImage`; không huỷ probe trước. Đổi map nhanh → probe cũ resolve sau và ghi sai nền.
Sửa: giữ ref probe trước và `probe.src = ''`/gán token, hoặc check `probe.src === baked` trong callback.

---

## C. Công việc tính toán lại hoặc tính cho thứ không tồn tại trên màn hình

### C1. **[LARGE WIN, loại 1]** Crowd NPC update khi bị che/không draw, và cố tình không cull được
`Game.ts:1270` gọi `npcs.update()` **trước** gate `state === PLAYING` → toàn bộ cast chạy trong pause menu, trong cutscene mở màn, và khi người chơi đứng cách spawn 100 m. Không LOD, không khoảng cách, không hook Quality (`Quality.ts:27` — preset chỉ có shadows + pixel ratio, nên "quality thấp" cũng không giảm được gì ở đây).
Trầm trọng hơn vì chính thiết kế culling: `attach` đặt `part.frustumCulled = false` (`NpcCrowd.ts:426`) và `stopCullingAnimatedParts(unit)` (427) cho mọi skinned part. Ý đồ đúng: skinned mesh bị cull theo bind-pose sphere sẽ biến mất khi NPC đi ra ngoài (đây chính là "stale skinned sphere" đã ghi trong `ARCHITECTURE.md`). Hệ quả: NPC **luôn** được submit.
Chi phí hiện tại (5 người × ~5 skinned mesh + 4 quadruped, mỗi người một `AnimationMixer` ~58 quaternion track mỗi frame).
Sửa đề xuất (không hạ chất lượng):
1. Gate `npcs.update()` theo state (menu: bỏ — mục A4 của file 02).
2. Một ngưỡng khoảng cách để **bỏ update animation** cho người ngoài tầm mắt — họ đã không nhìn thấy, không phải thấy mà xấu đi.
3. Thay vì `frustumCulled = false` vĩnh viễn, cập nhật `boundingSphere`/`boundingBox` của skinned mesh theo frame (rồi `visible`/cull theo nó) — giữ đúng pixel, bỏ đúng draw.

### C2. **[loại 2]** Boom solve của camera chạy full mỗi frame, kể cả khi không có gì đổi
`CameraController.ts:438-450, 494-501`: mỗi frame một mesh segment ray (`collision.cameraDistance` → `WorldCollision.ts:176`) **cộng** 8-15 mẫu `terrainHeight` heightfield (`184-213`), cộng thêm một mẫu terrain nữa ở 494-501. Đứng yên giữa đồng, chuột không nhúc nhích: `wanted`, `boomTarget`, `boomDistance`, `currentLookAt`, yaw, pitch đều **bit-identical** với frame trước; đầu ra duy nhất là một `camera.lookAt` trên các số không đổi.
Sửa: early-out khi (target yaw/pitch/distance + vị trí thân + `surfaceY` không đổi) **và** `|boomTarget - boomDistance| < 1e-4`. Đây là win lớn vì nó bỏ cả raycast **lẫn** ~16 mẫu địa hình cho mọi frame "đứng xem đồ".

### C3. **[loại 2]** `terrainHeight` 8 mẫu + bisection cho boom, mỗi frame, mỗi… — xem `WorldCollision.ts:179-194`
Comment cho biết đã tránh `getGroundHeight` (nó raycast toàn bộ tam giác địa hình ngoài field) và dùng `terrainHeight` — đúng. Nhưng `STEPS = 8` rồi **bisection** sau: chi phí thực ≈ 8 + (vài lần) mẫu. Có thể lưu kết quả theo (from,to) của frame nếu camera không đổi (chồng C2), và giảm sample khi `|dy|` nhỏ.

### C4. **[loại 2 — cần đo]** cache occlusion của selector: TTL + chỉ theo vị trí
`InteractableSelector.ts:84-85, 337-351, 353-369`: cache tầm nhìn có trần 256 entry và clear hàng loạt (`size > 256 → clear()`), nên mỗi lần đầy lại **ray lại cả vùng** với 2 ray/frame. Cùng lúc, entry `clear` của một item không bao giờ được ray lại trong TTL. Hai vấn đề một chỗ: eviction thô (LRU thay cho bulk clear) và key thiếu hướng nhìn (file 02 mục B3).

### C5. **[loại 1]** `atmosphere`/`weather`/`npcs` sau MENU, và `Cutscene`
Như C1 + file 02 mục A4. Riêng `Cutscene.ts` cần xem nó có chạy nền các update nặng khi đang cutscene mở màn không (`Game.ts:1270` gợi ý là có).

### C6. **[loại 3, build-time]** Vật liệu & node của map — xem A1 mục 1 và 2.
Hướng đi khả thi nhất về hiệu quả: **xử ở `tools/prepare-maps.mjs`** (dedup material theo màu, gộp mesh cùng material, đặt `matrixAutoUpdate=false` cho node tĩnh lúc load) — một pass offline, không đổi hình, không đổi runtime API.

---

## D. Vì sao tôi không profile runtime trong lượt này

- Working tree **đang được một phiên khác sửa** (`Game.ts` lớn 1489→1569 ngay giữa audit; `src/game/fishing/` thay đổi lúc 19:33/19:36/19:40/19:45). Chạy `vite` + `tmp-chrome-profile` (Chrome profile **có state**: `localStorage` giữ quality level của lần chạy trước — `ARCHITECTURE.md` đã cảnh báo đúng điều này) trên một target đang đổi nghĩa là số đo không gán được cho commit nào.
- `ARCHITECTURE.md` ghi rõ các harness sweep (`tmp-sweepall.mjs`) **đã bị xoá** — không còn đường chạy lại benchmark 22 map một cách có hệ thống.
- Vì vậy thứ tự đúng là: **đo sau khi WIP câu cá commit xong**, theo `05-ke-hoach-khac-phuc.md` mục V (kèm việc dựng lại harness thành `tools/sweep-maps.mjs` để nó không chết lần nữa).

Kết luận trung thực: mục A1/A2 ở trên là **số thật tôi đo được tĩnh**; mọi con số "ước tính chi phí frame" trong B/C là suy luận từ cấu trúc code, chưa phải số GPU. Đừng sửa thứ gì trong mục C chỉ vì đọc thấy nó tốn — hãy đo.
