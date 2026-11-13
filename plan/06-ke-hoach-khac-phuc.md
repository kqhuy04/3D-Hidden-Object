# 06 — Kế hoạch khắc phục (thứ tự, rủi ro, cách chứng minh)

File này dành cho người bắt tay sửa. Nguyên tắc xếp hạng:
1. **Sửa những gì phá vỡ hợp đồng với người chơi** trước (thứ họ tin là thật mà app làm khác).
2. **Sửa theo cụm code**, không theo severity toàn cục — nhiều bug nằm trong cùng một vòng lặp, sửa một lần.
3. **Không sửa gì trong vùng WIP câu cá** cho tới khi nó commit (`03` mục E): `src/game/fishing/`, `src/data/fishing.ts`, `src/ui/FishingMinigame.ts`, `DialoguePanel.ts`, `PortraitBooth.ts`, `InteractableAction.ts`.
4. Mỗi mục đều có **bằng chứng cần thấy trước khi merge** — không có mục nào được đóng bằng "đã đổi code".

Ký hiệu: `#nn` = ID trong file 02/04/05.

---

## MUC 0 — Việc của hôm nay, 10 phút, chặn tái diễn

| # | Việc | Bằng chứng hoàn thành |
|---|---|---|
| 0.1 | Thêm `"typecheck": "tsc --noEmit"` và `"check": "npm run typecheck && npm run test"` vào `package.json` (`03` A1) | `npm run check` xanh |
| 0.2 | CI tối giản: `npm ci && npm run check && npm run build` | Một PR giả với một lỗi type bị đỏ. Với game desktop, `beforeBuildCommand` hỏng = không đóng gói được, và hiện **không gì** bắt nó ngoài việc con người nhớ chạy build |
| 0.3 | Bật `"noUnusedLocals": true` trong `tsconfig.json` (`03` A2) | Sau khi xoá `Game.pickupTarget` (02 A6), `InputController.interactQueued` (02 C11), `CameraController.onPointerLockLost` (02 C12), `InputController.setCrawling/setRunning` (02 C10), `HiddenItemSystem.findTarget` (02 A6/B doc), `WaterSurface.vDistance` (05 E) |

Lý do đặt lên đầu: toàn bộ audit này phát hiện ra là **không có cổng nào giữa "vitest xanh" và "build hỏng"**. Mọi mục phía sau còn tái diễn nếu cổng chưa đóng.

---

## MUC 1 — Cụm `selectMap` / round lifecycle (sửa một lượt)

Bốn bug chia sẻ đúng một chỗ: `Game.ts:618-665`, `Game.ts:979-996`, `Game.ts:1092-1102`, `HiddenItemSystem.ts:44-74`.

- **1.1** `selectMap` mất khả năng huỷ: generation token cho load, `closeMapSelect`/Escape tôn trọng `busy`, và phần đuôi của `selectMap` chỉ chạy `startNewRound()` nếu token còn nguyên (02 A1).
- **1.2** Trong `catch`: khôi phục `state` từ `pickerReturn` và UI tương ứng (02 A2) — hiện app kẹt `LOADING` với thế giới đã bị phá.
- **1.3** `HiddenItemSystem` có `_loadToken`: `clear()` và `load()` tăng token, mỗi continuation chỉ được `push`/`add` nếu token của nó vẫn là hiện hành; `loading` gate theo token (02 A3).
- **1.4** `restoreHunt` phải **await-able và được chọn map chờ/huỷ**; và `startRound` lấy từ **danh sách đã load thật** (`hiddenItems.getItems()`) thay vì danh sách author (02 B5) — một asset 404 hiện làm màn săn không thể thắng.
- **1.5** Đồng hồ săn chạy theo wall-clock và **chỉ bắt đầu sau khi hunt tồn tại** (02 B6, 02 E3). Hai mục này đóng luôn cửa sổ race của 1.3.

Bằng chứng cần thấy (một test mới `tests/RoundLifecycle.test.ts`):
1. Stub `load` chậm (deferred promise): gọi `selectMap(A)` → giữa chừng `closeMapSelect()` → resolve → kỳ vọng `state !== PLAYING` và `roundManager.status !== 'playing'`.
2. `loadWorld` ném lỗi → kỳ vọng `state === pickerReturn`.
3. `restoreHunt` đang chạy rồi `selectMap(B)` → kỳ vọng `hiddenItems.getItems().length === 5` và **cả 5 thuộc hunt của B**.
4. `loadOne` fail một asset → kỳ vọng round có 4 item và thắng được khi nhặt 4.

---

## MUC 2 — Cụm `handlePickup` + selector (đây là cụm sinh ra nhiều triệu chứng nhất)

- **2.1** [1 dòng, làm ngay] `Game.ts:1211-1222`: đảo `roundManager.complete()` **lên trước** `hiddenItems.release()`/`foundScreen.show()` (02 B1). Hiện object bị tiêu huỷ và hiển thị thẻ Found trước khi round chấp nhận → mất đồ miễn phí, round bất khả thi.
- **2.2** `InteractableSelector.ts:312`: occlusion ray phải bắn tới **bề mặt gần** (`centre − dir·radius`), hoặc so `hit < sight − radius − 0.35`, hoặc `raycastSegment` nhận tham số exclude-id (02 B2). Đây là bug **làm teo một nửa hệ thống strike** mà không ai thấy vì cửa/đèn vẫn chạy.
- **2.3** Cache sight thêm **hướng nhìn** (02 B3) và bỏ đường "ưa ái khi hết ngân sách" — thà `selectedKey = null` một frame còn hơn đốt strike vào đồ không prompt (02 B4).
- **2.4** Cùng lượt, làm perf: hai mảng thành viên + pool `Candidate` + `distanceSq` + bỏ key chuỗi `${cx}:${cz}` (04 B1).

Bằng chứng cần thấy (test mới `tests/InteractableSelector.test.ts`, thứ mà `tests/` **hiện không có**):
1. Một prop box 1.2 m đặt 2 m trước camera, không gì che → kỳ vọng **được chọn** (hôm nay nó bị loại).
2. Item bị che bởi một tấm 0.5 m → kỳ vọng **không** được chọn.
3. `selected` đổi hướng 180° trong TTL → kỳ vọng kết quả sight đổi trong ≤1 frame.
4. `RAYS_PER_FRAME` hết → kỳ vọng selected không đổi đối tượng giữa hai frame liên tiếp.

---

## MUC 3 — Cụm bàn phím & UI focus (rủi ro thấp, người dùng thấy ngay)

- **3.1** `InputController.ts:99-138`: early-return theo `event.target.closest('.interactive-ui')` (cái test **đã tồn tại** ở `pointerdown` dòng 67) cho `Space`/`Tab`; gate `C`/`Shift` theo state (02 C8, C9).
- **3.2** Clear `jumpQueued` khi pause/resume (02 C11).
- **3.3** Xoá 4 handler chết còn lại ở 3.1 (Space/Tab khi menu đang mở; C/Shift đổi gear sau màn pause).
- **3.4** Wire `onPointerLockLost(() => this.togglePause())` (02 C12) — hiện Alt-Tab nhả lock mà clock vẫn chạy.
- **3.5** Thêm `dispose()` cho `InputController` + `CameraController`, giữ handler bound, gọi từ `Game.dispose()` (02 C12).

Bằng chứng: một test jsdom tối giản (đặt input focus vào `#settings input[type=range]` → kỳ vọng `triggerCycle` không fire và TAB di chuyển focus). Đây cũng là **lần đầu** `src/ui` có test — đáng tách `vitest.config.ts` lúc này (`03` A3).

---

## MUC 4 — Cụm player/camera (cẩn thận nhất: đây là place feel)

Thứ tự vì mỗi mục dưới đây có thể làm đổi "cảm giác" camera, và `tests/Camera.test.ts` chỉ phủ đường ra (outward):

- **4.1** Clamp pitch **sau** boost lift (02 C1) — một dòng, hết cảnh camera lật 180° khi ép boom. Test: `pitch = 1.35`, `liftSqueeze = 1` → `|final pitch| < π/2 − ε` và `dirX` không đổi dấu.
- **4.2** Retract nhanh thay vì 20 m/s (02 C4). Test mới: camera áp tường 5 s, kỳ vọng không có frame nào `lens` nằm sau bề mặt mà tia đã báo.
- **4.3** Cast thêm tia theo hướng đã lift, lấy `min` (02 C2). **Làm sau 4.1/4.2** vì hai cái đó thay đổi cái mà tia này thấy.
- **4.4** Jump-when-falling: gate theo contact + `takeoffY = max(groundY, feetY)` (02 C3). Test: `feetY = groundY + 1.5`, `falling = true`, jump → kỳ vọng không có frame nào `feetY` nhảy thẳng xuống `groundY`.
- **4.5** Climbing: slide qua `moveCapsule`, check support khi đổi độ cao, Space = release, đáy thang dùng `groundAt` (02 C5, C6, C7).
- **4.6** `setPosition` phải đồng bộ input latch (02 C10).
- **4.7** `CameraController`: `e.button !== 0` → ignore; clear `isDragging` khi blur (02 C13).

`ARCHITECTURE.md` cảnh báo cả cụm này là vùng "đã verify bằng mắt, có bẫy" — nên 4.x **phải** đi kèm screenshot/clip so sánh trước-sau khi đứng sát tường, không chỉ test unit.

---

## MUC 5 — Cụm shadow (`SunShadows.ts`) — chất lượng tăng, không đổi setting

- **5.1** [1 dòng] `collectMovers()` lên đầu `update()` (05 A1) — hết khối shadow ma ở spawn suốt cutscene mở màn.
- **5.2** [1 dòng] `depthMaterial.depthTest = false` hoặc `clearDepth()` trước mover pass (05 A2) — hết cảnh mất bóng khi đi ngược mặt trời.
- **5.3** `sun.invalidate()` cuối `loadWorld()` và sau `restoreHunt()` (05 A5) — hết bóng của map trước và object mới không bóng.
- **5.4** Composite theo điều kiện, và mover vào `THREE.Scene` riêng (05 A3) — đây là mục **đo trước, sửa sau** (V1 bên dưới).
- **5.5** `refresh()` của map có mặt trời chạy phải rebuild theo nhịp texel, không theo 0.02 h (05 A4).
- **5.6** `depthMaterial.side`/`alphaTest` per-mover (05 A6).
- **5.7** Bật/tắt shadow: `renderer.compile` sau preset + dispose RT khi tắt (05 B2/A8).

`tests/Shadows.test.ts` hiện có 4 test — thêm: (a) frame rebuild đầu tiên không chứa mover; (b) hai map liên tiếp cùng `timeOfDay` ⇒ shadow map được dựng lại; (c) `restoreHunt` ⇒ shadow được invalidate.

---

## MUC 6 — Perf không đổi pixel (làm sau khi đã đo)

Thứ tự theo (tác động × độ an toàn):

1. **`matrixAutoUpdate = false` cho đồ tĩnh** sau `loadWorld()` (05 D1) — 1000–3000 compose/frame, và đang bị trả **hai lần** vì composite. Rủi ro: mọi node động mới phải được loại trừ → **bắt buộc** đi kèm test invariant (xem V4).
2. **`boundingSphere` pad cho skinned prop** thay vì tắt culling (05 D2) — pop-out viền màn hình trên 22 map.
3. **`collectMovers` cache + composite có điều kiện + `moverScene` riêng** (05 A3).
4. **Boom solve early-out khi không có gì đổi** (04 C2) — bỏ 1 raycast + ~16 mẫu địa hình mỗi frame đứng yên.
5. **Sửa allocation sót**: 04 B1 (selector), B2 (`moveCapsule` contacts), B3 (NpcCrowd/Mounts — dùng scratch **đã có trong chính file đó**), B4 (pointer object + `Vector2` clone thừa), B5 (shutter buffer), B6 (DebugOverlay innerHTML), B7 (reel layout → transform), B8 (image probe).
6. **`Quality` decision theo wall-clock** (05 B2), và tách `shadowsOverride` (02 E2).
7. **`loadAnimations` song song hoá** (02 C14).

Không làm gì trong mục "chất lượng" — xem ràng buộc `MEMORY.md:21`.

---

## MUC 7 — Nội dung & data (an toàn, sửa nhanh, nhưng là thứ người chơi chạm)

- **7.1** 3 hint tự gọi tên object: `camp-sink`, `muertos-sink`, `hearth-chair` (02 B8).
- **7.2** `hiddenItems.ts:270-272, 753, 896, 1128`: 4 comment mô tả sai hướng so với toạ độ thật, và một banner "Construction Site" đặt nhầm trên `'coral-reef'`. Đây là documentation duy nhất của *lý do* một chỗ giấu đồ (`Content.test.ts` chỉ kiểm bán kính 60 m) → comment sai dẫn tác giả sau đặt đồ xuống đất.
- **7.3** `KitClips.ts:169` → `Promise.allSettled` để một clip thiếu không xoá sạch một nhân vật (02 D10).
- **7.4** `NpcCrowd.ts:618-625`: đích "về nhà" phải qua `legIsWalkable` (02 D3).
- **7.5** `Quadruped`: gọi `locomotion(0)` trong nhánh idle của `NpcCrowd` (02 D1) — 1 dòng, hết cảnh thú đi tại chỗ.
- **7.6** `Mounts.dispose()` gọi `dismount()` trước (02 D6).
- **7.7** `Storage.ts:161-174`: parse fail thì giữ `available = true` (02 E1) — một file save hỏng hiện tắt khả năng lưu vĩnh viễn.
- **7.8** `WorldLoader.processScene`: đổi mọi bước fix sang `FixReport { moved, ms, unmatched }` (01 W1). Hiện `timings.dredge`/`timings.settle` trả **0 khi không khớp gì** và trả **ms khi có khớp** (`:931`, `:1110`), `timings.removals` là **count** (`:77`), còn count của `applyPropShifts` bị **vứt** (`:112`) — nên "cây cầu này còn được dịch không" là câu hỏi không thể trả lời từ log.
- **7.9** Cổng "mọi entry `mapFixes` khớp **đúng một** node" (01 W2) — bắt cả no-match (kit đổi tên → fix im lặng chết) lẫn multi-match (`applyPropShifts:1122-1130` cộng offset vào **mọi** node trùng tên, không guard node ngoài cùng như `settleProps:1098-1104`). Kèm: `tests/MapFixes.test.ts` hiện chỉ phủ `removeProps`, thêm 3 case cho `applyPropShifts`.
- **7.10** `buildHeightField` (`WorldCollision.ts:1004-1064`): thêm cảnh báo load-time khi hai mesh terrain chênh > `stepHeight` trong cùng một ô (01 mục D). Thiết kế một-lớp là **có chủ ý và đúng** (sàn tầng 2 là prop collider, không phải terrain), nhưng nếu một tác giả sau này đặt tên `plaza-terrain`/`bridge-terrain` cho mặt trên, nó nuốt mặt đất bên dưới thành trần mà không có dòng log nào.

---

## MUC 8 — Việc cần **người quyết**, không phải tôi hay anh dev

| Câu hỏi | Bối cảnh |
|---|---|
| Tên app chính thức là **Odd Objects** hay **Photo Hunt**? | `identifier: "com.photohunt.game"` là vị trí dữ liệu trên Windows; đổi **sau** khi có user = mất save (`03` C1) |
| Có cần fullscreen / windowed-no-border không? | `grep fullscreen` = 0 trong `src` + `src-tauri/src` (`03` C2) |
| FOV slider nên lấy trần từ `gameConfig` (82) hay từ UI (85)? | ba số khác nhau: `Storage` clamp [55,85], UI 55–85, engine `maxFov: 82`, `setBaseFov` không clamp (`02`-UI qua `04`/`03`; chi tiết: `SettingsScreen.ts:81`, `Storage.ts:108`, `gameConfig.ts:104-105`) |
| Có cho phép preset `low` xuống dưới DPR 1.0 (ngân sách pixel tuyệt đối) và MSAA off không? | Đây là *thêm một lựa chọn*, không phải hạ mặc định — nhưng vẫn cần duyệt vì chạm `MEMORY.md:21` (`05` B1) |
| 22 map × 5 = 110; `docs/HIDDEN_OBJECTS.md` còn giữ vài con số cũ — có regenerate bằng `tools/hidden-objects-doc.mjs --write` không? | `MEMORY.md:36` chỉ huy lệnh đó; `03` mục D |

---

## V — Cách chứng minh (bắt buộc trước khi merge từng cụm)

Hiện trạng đáng lo: **cổng browser sweep 22 map đã bị xoá** (`tmp-sweepall.mjs`, `tmp-climbcheck.mjs` không còn trên đĩa — kiểm lại: `tools/` có 20 file, không có bản `tools/…` nào của chúng, trong khi `ARCHITECTURE.md:272-275` vẫn gọi chúng là gate). Cổng **grounding** thì còn và nên dùng làm hình mẫu: `tools/audit-grounding.mjs` — Node-only, ~2 s/map, đọc danh sách map từ đĩa chứ không ghi tay. Việc cần làm với nó chỉ là **cho nó exit code** để CI dùng được (`--fail-under`/`--max-float`), không phải viết lại từ đầu.

- **V1 — Đo baseline, một lượt, trên code đã commit ổn định.** Chrome DevTools + ANGLE/Metal-D3D11 (không phải SwiftShader — `ARCHITECTURE.md` cảnh báo SwiftShader đắt và lag máy): `renderer.info.render.calls`, `.triangles`, `programs.length`, `memory.geometries/textures`, frame time p50/p95 khi **đứng yên giữa chợ** vs **đi liên tục**. Ghi ra `plan/baseline-<date>.json`.
  Con số cần nhất: `render.calls` trên `skatepark`/`modern-restaurant-cafe` (map có 1529 và 1665 primitive — xem `04` A1). **Nếu calls ≈ số primitive thì frustum culling đang không giúp gì**, và hướng sửa là gộp geometry của *decoration không tên* (−51 % lý thuyết, nhưng **không** được đụng vào node có tên — xem `04` A1 và `01` mục B). **Nếu calls chỉ bằng một phần năm số primitive** thì culling đang làm tốt, mục 6.2 (bounding sphere) mới là thứ đáng sửa, và chuyện material nên bỏ khỏi danh sách.
- **V2 — Deterministic, Node-only** (rẻ, theo đúng tiền lệ `ARCHITECTURE.md`: terrain decode 0.3 s, mood preview 0.2 s, tests 2.4 s): `tools/check-shaders.mjs` cho 5.2/7 và mục C file 05; một `tools/map-report.mjs --assert` so registry với disk (đã xanh theo `02` B-data, nhưng cần chạy ở CI).
- **V3 — Harness sweep được "tốt nghiệp hoá"**: viết lại thành `tools/sweep-maps.mjs` (22 map: spawn đứng được, thân di chuyển, 5 item pickable bằng `InteractableSelector` **thật** — không phải `findTarget` — không console error). Đây là mục có ROI cao nhất trong toàn bộ kế hoạch, vì nó đồng thời bắt được 02-B2, 02-C1..C4 và mọi hồi quy collision. Nó tồn tại rồi bị xoá vì để prefix `tmp-` (`03` mục D).
- **V4 — Test invariant cho `matrixAutoUpdate`** (bọc mục 6.1): sau mỗi `loadWorld`, duyệt tìm node có `matrixAutoUpdate === false` nhưng world matrix đổi sau một frame `update` → fail. Không có test này, 6.1 sẽ vỡ ở tính năng động kế tiếp (cần câu, NPC mới, đạo cụ bay…).
- **V5 — Test selector** (mục 2) và **test round lifecycle** (mục 1).
- **V6 — Ảnh/clip trước-sau** cho 4.x và 5.x — vùng mà lỗi là *cảm giác*, không phải exception.
- **V7 — Test "fix còn sống không"** cho 7.8/7.9 (01 W1/W2): một unit test dựng một `Group` giả có node tên `bridge_A`, chạy `applyPropShifts`, khẳng định `unmatched` rỗng và node đã dịch; một test với tên **không** tồn tại phải cho ra `unmatched: ['bridge_Z']` chứ không im lặng; một test với **hai** node trùng tên phải fail (đây là bug multi-match, không phải đặc tính). Rẻ, Node-only, không cần WebGL.
- **V8 — Test rơi xuyên sàn mỏng** cho 01 W3 (trước khi sửa bất cứ gì): capsule thả từ 12 m xuống một box dày 0.2 m với `dt` clamp 0.1 s, khẳng định `feetY >= box.top` ngay frame va chạm. Đây là cách duy nhất trả lời câu hỏi cửa sổ `supportHeight` 0.6 m (`CollisionGeometry.ts:710`) vs quãng rơi ~0.9 m/frame — tôi **không** trả lời nó bằng đọc code, và nói rõ trong `01`.

## Ghi chú độ tin cậy của chính tài liệu này
- Audit chạy trên working tree **đang đổi** (Game.ts 1489→1569 giữa phiên; `src/game/fishing/` sửa lúc 19:33/19:36/19:40/19:45). Line number = 19:45.
- Hai lỗi type làm hỏng `npm run build` mà tôi phát hiện lúc 19:36 **đã được một phiên khác sửa trước khi tôi viết xong**; tôi vẫn giữ mục `03` A1 vì bài học (không CI) còn nguyên.
- Tôi có chạy `npm run build` để xác minh ⇒ `dist/` đã bị dựng lại từ trạng thái WIP lúc 19:45.
- Tôi **không** sửa file nào ngoài thư mục `plan/`.
- Trong phiên có xuất hiện nội dung bất thường mô tả các file `plan/01…, 04…, 05…, 07…` (không tồn tại trên đĩa) kèm timestamp tương lai và các "kết quả đo" chi tiết. Tôi đã **không** dùng chúng làm bằng chứng. Nếu anh/chị có một phiên audit song song khác đang ghi vào cùng thư mục, nên gộp trước khi tin các con số GPU trong đó. **Cập nhật cuối phiên:** chính hai tool output của tôi lúc ~20:2x cũng không tái lập được (một `ls` thiếu file, một `grep` ra dòng import không tồn tại). Sample có mtime lúc 20:26:18 + `tsc --noEmit` exit 0 là những gì tôi đứng tên. Chi tiết trong `00` mục F — và lý do mục 0 (typecheck vào CI) đứng đầu bảng.
- **Mục 0 giờ có thêm một nhánh loader/collision**: 7.8, 7.9, 7.10 (từ `01`) — nhóm sửa rẻ nhất trong toàn bộ kế hoạch (toàn bộ là log + assertion + test Node-only) và là nhóm duy nhất ngăn **tái diễn** loại hỏng "không ai biết là nội dung đã chết từ bao giờ".
