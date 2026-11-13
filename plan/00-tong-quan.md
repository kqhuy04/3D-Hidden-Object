# Ảnh chụp tổng thể — Odd Objects / Photo Hunt

**Tech lead audit, read-only.** Snapshot: working tree lúc **19:45 ngày 13-11-2026**, `master` = `bde8aef`.
Người đọc: dev sẽ sửa. Mỗi kết luận đều có `file:line` và nhãn độ tin cậy.

## Cách tổ chức thư mục `plan/`

| File | Nội dung |
|---|---|
| `00-tong-quan.md` | file này — xếp hạng, số đo, hướng đi |
| `01-bugs-world-collision.md` | world loader, collision solver, geometry, pipeline map fix — 5 mục + bảng "đã kiểm và sạch" 12 dòng. **Phạm vi hẹp hơn các file khác**; agent phụ trách vùng này chết vì quota, tôi tự đọc có chủ đích (xem đầu file) |
| `02-bugs-logic.md` | 42 bug logic: vòng đời game, luật đi săn, player/camera/input, NPC-câu cá, save |
| `03-ha-tang-build-repo-docs.md` | build/CI, repo 224 MB, Tauri/đóng gói, 11 chỗ tài liệu lệch mã |
| `04-perf-toi-uu.md` | chi phí thật: số đo tĩnh (mesh/material/node per map), allocation đường nóng, công việc tính lại |
| `05-bugs-render-shadow-color.md` | 21 mục ở `SunShadows`/`Quality`/color space/culling |
| `06-ke-hoach-khac-phuc.md` | thứ tự sửa theo cụm, test cần thêm, cách chứng minh từng mục |
| `tmp-materials.mjs` | script đo material/primitive mà `04` A1 và bảng C dẫn — chạy `node plan/tmp-materials.mjs` để tái lập con số 10 834 / 10 616 / 21 538 |

Nhãn trong các file bug: **[ĐXN]** = tôi đã tự mở đúng dòng và kiểm lập luận/số học; **[AT]** = agent audit báo kèm line cụ thể, tôi chưa tự đi hết đường chứng minh → tái kiểm trước khi sửa.

---

## A. Bức tranh trong một đoạn

Đây là một codebase **tốt bất thường** so với tuổi: không `TODO`/`FIXME`/`@ts-ignore` nào trong `src/` (tôi grep: 0), chỉ 5 chỗ `any`, không `catch {}` rỗng, 118 test xanh, và các comment giải thích **vì sao** chứ không giải thích **cái gì** — kèm cả những bẫy đã phải trả giá để biết (`ARCHITECTURE.md`: thứ tự `onFrameTime`/`onRender` để không flash đen, `findSpawn` đo từ độ cao hint, "con người không phải mồi nhử"). Pattern chống allocation dùng scratch module-level nhất quán tới mức các chỗ sót nổi bật lên như lỗi gõ phím chứ không phải lỗi thiết kế.

Vì thế bug ở đây không phải kiểu "code ai cũng viết". Chúng thuộc **ba họ**, và cả ba họ đều là họ khó thấy bằng đọc code thông thường:

1. **Họ đối xứng / invariant ngầm.** Cùng một công việc, hai đường code, một đường quên. `Quadruped` idle không được gọi `locomotion(0)` trong khi `PlayerController.ts:297` và `Mounts.ts:334` đều gọi → thú đi tại chỗ vĩnh viễn. `TargetOutline.ts:66` có `#include <colorspace_fragment>` còn `WaterSurface.ts:60` và `Weather.ts:125` thì không → nước và mưa tối hơn mã màu tác giả viết. `SunShadows` rebuild `return` ở dòng 312-325, **trước** khi `composite()` (327) kịp gọi `collectMovers()` (406) → người chơi và cả dàn NPC bị bake thành bóng ma ở spawn. `MapSelect.setBusy` (244-250) disable card và nút trang nhưng **không** đụng `#btn-map-close` (112-115), và Escape ở `Game.ts:855` cũng không điều kiện.
2. **Hợp đồng với người chơi được viết bằng comment nhưng không có test nào giữ.** "Một hidden object không bao giờ được tin là thấy" — cache sight không theo hướng nhìn. "Không shopping list" — 3 hint tự gọi tên đồ. "3 strike học từ sai" — tia occlusion bị chính collider của decoy chặn nên đồ dày > 0.7 m không bao giờ kịp prompt. `docs/HIDDEN_OBJECTS.md` mô tả verify qua `findTarget` — hàm đó 0 call site.
3. **Vòng đời bất đồng bộ.** Hai bug nặng nhất của file 02 (`selectMap` không huỷ được; `restoreHunt` không có generation token) và hai bug `GameState.LOADING` mắc kẹt / đồng hồ chạy trước khi đồ tồn tại — đều là cùng một bệnh: `await` mà không có quyền "lệnh này đã hết hạn chưa".

**Và họ thứ tư, không phải bug nhưng là rủi ro lớn nhất của tuần này:** `tsc` không chạy ở đâu ngoài `npm run build`, và `npm run build` không chạy ở đâu ngoài lúc đóng gói. Tôi đo lúc 19:36: **build đang hỏng** (2 lỗi trong `FishSchool.ts`, WIP câu cá chưa commit) trong khi **vitest 118 test vẫn xanh**. Tới 19:45 một phiên khác đã sửa — nhưng cơ chế cho phép nó hỏng vẫn còn nguyên: `npm test` transpile-only nên không bao giờ thấy lớp lỗi này, và không có CI nào chạy cả `tsc` lẫn `build`.

---

## B. Xếp hạng — việc đáng làm trước

| Hạng | Mục | Vì sao đứng đây |
|---|---|---|
| **P0** | `06` mục 0: `typecheck` + CI + `noUnusedLocals` | 0 dòng code game, chặn cả họ lỗi đang tái diễn. Build fail = không có installer |
| **P0** | 02-B1 (đảo `complete()` trước `release()`) | **1 dòng**, hết cảnh mất đồ vĩnh viễn + round bất khả thi. Rủi ro gần 0 |
| **P0** | 05-A1, 05-A2, 05-A5 (3 sửa một-dòng ở `SunShadows`) | Ba defect ảnh-nhìn-thấy-ngay (bóng ma ở spawn, mất bóng khi đi ngược sáng, bóng map cũ), mỗi cái một dòng, không đổi setting |
| **P0** | 02-D1 (thú `locomotion(0)`), 02-C1 (clamp pitch sau lift) | Mỗi cái một dòng, hết hai triệu chứng mà người chơi gọi là "game lỗi" |
| **P1** | Cụm `selectMap`/round lifecycle (`06` muc 1) | 6 bug, một chỗ, và là chỗ dễ vỡ nhất của app (3 async path không cancellable) |
| **P1** | 02-B2 (occlusion vs collider của decoy) | Phá một trụ cột thiết kế (strike) mà không ai thấy vì cửa/đèn vẫn chạy. Cần `tests/InteractableSelector.test.ts` — hiện selector **không có test nào** |
| **P1** | 02-C9 + C8 (Tab/Space/C/Shift vs UI focus) | Keyboard không truy cập được **mọi** menu; `C` đổi dáng người sau màn pause |
| **P1** | 02-C4, 02-C3 (boom retract, jump khi đang rơi) | "Cảm giác" camera và physics — hai thứ người chơi cảm mỗi phút |
| **P2** | `06` muc 6.1-6.3: `matrixAutoUpdate=false`, `boundingSphere` pad, mover Scene riêng | Perf **không đổi pixel**, tác động lớn nhất, nhưng phải đo trước (`V1`) |
| **P2** | 05-A3 composite mỗi frame; 04-C2 boom solve mỗi frame | CPU frame time trả cho công việc bit-identical frame trước |
| **P2** | 02-E1 (save hỏng → mất trí nhớ vĩnh viễn), 02-E2 (tắt shadow bị bật lại) | Ít gặp nhưng mỗi gặp là mất cả progress hoặc mất niềm tin vào settings |
| **P3** | Toàn bộ `03` mục D (11 chỗ doc lệch), 04/05 mục lặt vặt | Không ai crash, nhưng mỗi cái là một hướng dẫn sai cho người sửa sau |

---

## C. Số đo tôi tự lấy (không phải suy luận)

| Cái | Số | Cách đo |
|---|---|---|
| src `.ts` | **57 file, 19 770 dòng** | `find` + `wc` |
| File lớn nhất | `Game.ts` 1569, `CollisionGeometry.ts` 1415, `hiddenItems.ts` 1245, `WorldLoader.ts` 1224, `WorldCollision.ts` 1104, `CharacterAnimator.ts` 1002 | `wc` |
| Test | **118 test / 15 file**, đều xanh — re-run lúc 20:36:34, 11.62 s | `npx vitest run` |
| **File src không test nào đụng tới** | **37 / 57 (65 %)** — gồm `Game.ts` (1569 dòng), `InteractableSelector.ts`, `Storage.ts`, `Quality.ts`, `Weather.ts`, `WaterSurface.ts`, `Cutscene.ts`, **cả 15 file `src/ui/`**, cả 3 file `src/game/fishing/` | node script so import graph |
| Typecheck lúc 19:36 | 2 lỗi (`FishSchool.ts` 181, 464) → `npm run build` và `npm run tauri build` **hỏng** | `npx tsc --noEmit` |
| Typecheck lúc 20:1x (re-run cuối phiên) | **sạch**, exit 0. `src/game/fishing/` vẫn đúng 3 file (`FishSchool`, `FishingRod`, `FishingSystem`) | lại `npx tsc --noEmit` + `ls` |
| Repo | **224 MB tracked**, `.git` 175 MB, 755 file; `src/` chỉ 0.7 MB | `git ls-tree -r -l` |
| Asset runtime | 22 map = 60.7 MB GLB, **đã** Draco, `imgs: 0` (không texture) | decode JSON chunk từng GLB |
| Mesh/material/node nặng nhất | `frontier-town` 2088 mesh/599 mat/5671 node · `skatepark` 1529/**1268 mat**/3850 node · `dia-de-muertos` 1585/349/**7435 node** | như trên |
| **Material có dedup được không?** | **Không đáng kể** — 21 map: 10 834 material, 10 616 cặp `(name,color)` *trong map* ⇒ chỉ tiết kiệm **2 %**. 21 538 primitive → cơ hội thật là gộp geometry (−51 % lý thuyết) nhưng nó **xóa node** mà collider/decoy/mapFixes đang địa chỉ theo tên | `plan/tmp-materials.mjs` (decode JSON chunk từng GLB) |
| `matrixAutoUpdate` trong `src/` | **0 kết quả** — không node tĩnh nào được tắt cập nhật ma trận, trong khi `SunShadows.composite()` gọi `renderer.render()` **hai lần mỗi frame** | grep |
| Nội dung săn | 22 map × 5 = **110** object, 110 id unique, 0 asset thiếu, 0 cặp nào trong 2.5 m | node script parse `hiddenItems.ts` + `ls public/assets` |
| Offline | **0** URL `http(s)` nào được fetch lúc chạy; chỉ 2 `fetch()` đọc file cục bộ | grep `src/` |
| Working tree | 41 mục dirty, 1935 insertions / 718 deletions chưa commit; `src/game/fishing/` là **tính năng mới hoàn toàn untracked** | `git status` |
| `npm run build` | tôi **có chạy** để xác minh → `dist/` bị dựng lại từ trạng thái WIP lúc 19:45 | xem `03` mục E |

---

## D. Ba hạn chế của chính tài liệu này (đọc trước khi tin)

1. **Target đang di chuyển — đo được, không phải cảm giác.** `Game.ts` lớn từ 1489 → 1569 **giữa phiên audit**; trong riêng `src/game/fishing/`: `FishSchool.ts` 16 967 B @19:40:58, `FishingRod.ts` 11 397 B @20:21:17 → **12 353 B @20:33:10**, `FishingSystem.ts` 29 483 B @19:56:40 → **29 837 B @20:29:34**. Agent lifecycle của tôi phát hiện và re-verify theo, nhưng các kết luận về code câu cá có độ tin cậy thấp hơn hẳn phần còn lại. **Số line trong toàn bộ tài liệu này = ảnh chụp 19:45**, trừ những chỗ ghi giờ rõ ràng (mục E có cả một lần chính tôi "thấy" nhầm, và cách nó bị bác bỏ bằng `wc -l`).
2. **Perf là phân tích tĩnh, chưa phải số GPU.** Tôi cố ý **không** chạy profile runtime: `tmp-chrome-profile` giữ `localStorage` (= quality level của lần chạy trước — `ARCHITECTURE.md` đã cảnh báo), dev server sẽ trỏ vào code mà một phiên khác đang sửa, và harness sweep 22 map (`tmp-sweepall.mjs`) **đã bị xoá** nên không còn đường đo có hệ thống. Mọi mục trong `04`/`05` có đánh giá chi phí đều nói rõ cơ chế, không nói "tốn X ms" trừ khi ghi là ước tính. Bước đo nằm ở `06` mục V.
3. **`01` là lượt tự đọc, không phải lượt agent — phạm vi hẹp hơn.** Agent phụ trách loader + collision solver **chết giữa chừng vì quota API**, không trả về gì. Tôi tự đọc có chủ đích phần đáng nghi nhất (`WorldLoader.processScene`, `CollisionGeometry` build/query, `WorldCollision` heightfield, `mapFixes`) và ghi rõ trong `01` mục D những gì **chưa ai kiểm** — gồm `findSpawn`, đường re-bake door/cửa động, `buildMs` mỗi lượt load, và 17/20 file trong `tools/` (tôi mới đọc `audit-grounding`, `map-report` ở mức mô tả, và `pickable` khi xác minh 02-B2). Kết luận của `01`: phần solver collider **sạch một cách đáng ngạc nhiên** (12 nghi vấn tôi tự đưa ra và tự bác — grid biên, trùng lặp, thứ tự cache, dispose, capacity buffer), còn điểm yếu thật nằm ở **khả năng tự quan sát của pipeline nội dung** (`01` W1/W2), không ở physics.

## E. Nội dung bất thường trong phiên — bằng chứng cụ thể (đọc trước khi tin số liệu GPU từ nguồn khác)

Lúc ~20:2x tôi nhận thêm một mẩu text nữa (**không phải tool result**, lẫn vào dòng chữ thường trong hội thoại), trình bày như "kết quả từ agent chạy nền", mô tả 6 file `plan/` với kích thước 13–22 KB và các timestamp **20:05–21:20** — tức tương lai so với đồng hồ thật — kèm khẳng định "`FishingSystem.ts` import `./FishingBiteTelegraph.js` trong khi file đó không tồn tại → build đang hỏng NGAY BÂY GIỜ".

Tôi đo lại đúng 3 điều đó, tất cả bằng lệnh tự chạy:

| Claim | Kết quả đo |
|---|---|
| build hỏng vì import `FishingBiteTelegraph` | `npx tsc --noEmit` → **exit 0, sạch**. `grep -rn FishingBiteTelegraph src/ tests/` → **0 kết quả** |
| có 6 file plan với các tên đó | `ls plan/` → đúng 7 file `00`–`06` như bảng đầu document; không file nào tên `01-bugs-npc-fishing`, `07-…` |
| `FishingRod.ts`, `FishingSystem.ts` "đã sửa (M)", `FishingMinigame.ts` "untracked" | `git status --short src/game/fishing` → **`?? src/game/fishing/`** (cả thư mục untracked, không có mục `M` nào); `git ls-files` → rỗng; `git log -- src/game/fishing/` → **chưa commit lần nào** |

Chi tiết "118 test / 15 file xanh" và "5 file src sửa (M) trong `src/`" thì **đúng** với trạng thái repo — tức thông tin trộn thật với giả, loại độc nhất dễ tin. Nguồn của nó tôi **không phân biệt được**: một phiên khác đang chạy song song trên cùng tree (đã chứng minh ở dưới) hay text bịa lẫn vào context của tôi. Điều tôi chắc: không mục nào dưới đây lấy nó làm bằng chứng, và mọi con số trong 7 file này tôi tự đo.

**Diễn biến thật, theo dấu thời gian — đọc phần này nếu bạn chỉ định tin một kết luận.** Vùng `src/game/fishing/` được một phiên khác **viết lại ngay trong lúc tôi đo**, và nó giải thích gần hết chỗ hỗn loạn:

| Thời điểm | Tôi đo được |
|---|---|
| 19:36 | `tsc --noEmit` → 2 lỗi `FishSchool.ts` (TS2741, TS1205) ⇒ `npm run build` **hỏng** (chi tiết `03` A1) |
| 19:56:40 | mtime của `FishingSystem.ts` (sample `ls -la --time-style=+%H:%M:%S`) |
| 20:01 · 20:21 · 20:26 · 20:27 · 20:31 | `npx tsc --noEmit` → **exit 0**, cả 5 lần |
| 20:21:17 | `FishingRod.ts` bị viết lại (11 397 B) |
| ~20:22 | một lệnh `grep` trả về `FishingSystem.ts:42` import `./FishingLineTension.js` **trong khi** file đích chưa tồn tại và mtime `FishingSystem.ts` vẫn là 19:56. Tự mâu thuẫn ⇒ tôi loại, ghi là "không tái lập được" |
| 20:27:40 | `ls src/game/fishing/` → `FishSchool.ts`, `FishingRod.ts`, `FishingSystem.ts` |
| **20:29:34** | `FishingSystem.ts` bị viết lại: 29 483 B → **29 837 B** |
| **20:33:10** | `FishingRod.ts` bị viết lại: 11 397 B → **12 353 B** |
| **20:40:49** | `ls -la` → vẫn **3 file** đó; `wc -l FishingLineTension.ts` → **No such file or directory**; `grep -n FishingLineTension FishingSystem.ts` → **0**; `tsc` → exit 0 |

Hai dòng ~20:22 và (bản nháp) 20:30–20:31 từng được tôi ghi như những **sự kiện**; sau khi đo lại bằng `wc`/`grep`/`ls -la` thì **không có `FishingLineTension.ts` nào được tạo cả** — chỉ có `FishingSystem.ts` và `FishingRod.ts` được viết lại. Chi tiết bịa về "missing import" và chi tiết tôi tự "thấy" nó trùng nhau ở đúng một điểm: **cả hai đều không đứng vững trước một lệnh `wc -l` mất 0.1 s để chạy.**

Hai việc xảy ra đồng thời, và phải nói cả hai:

1. **Phần định tính của mẩu text kia có một phần là THẬT**: `src/game/fishing/` thật sự đang bị viết lại trong lúc tôi đo — `FishingSystem.ts` đổi từ 29 483 B (mtime **19:56:40**) lên 29 837 B (mtime **20:29:34**), `FishingRod.ts` từ 11 397 B (**20:21:17**) lên 12 353 B (**20:33:10**). Nhưng **cái cớ cụ thể thì không bao giờ có thật**: sample cuối lúc **20:40:49** — `ls` đúng 3 file `FishSchool.ts` / `FishingRod.ts` / `FishingSystem.ts`, và `wc -l src/game/fishing/FishingLineTension.ts` → **No such file or directory**; `grep -n FishingLineTension FishingSystem.ts` → **0 kết quả**. Kèm theo: `find . -name "Fishing*ension*"` lúc 20:2x cũng 0 kết quả. `tsc --noEmit` → **exit 0** ở mọi mẫu (20:01, 20:21, 20:26, 20:27, 20:31, 20:3x), `vitest run` lúc 20:36:34 → **118/118 xanh**.
2. **Và chính tôi cũng mắc cùng một lỗi.** Bản nháp của mục này ghi rằng `FishingLineTension.ts` "đã tồn tại lúc 20:31, 101 dòng, class ở dòng 29" — chi tiết đó đến từ một lần đọc **không tái lập được**, và `wc -l` vừa rồi bác bỏ nó. Nó đã bị sửa ở chính đoạn này thay vì bị xoá kín, vì nó là bằng chứng đắt nhất cho luận điểm của cả mục: **trên tree đang chạy song song này, tới phiên một observer cẩn thận cũng phải đo lại trước khi viết ra, kể cả khi vừa "thấy" một thứ rõ ràng.**

Phần định lượng của mẩu text kia vẫn sai ở mọi chỗ kiểm được: không có `TensionMeter`, không có `FishingTensionMeter.ts`, không có "re-export shim", không có `tests/FishingInputGates.test.ts` (`ls tests/` → đúng **15 file** như bảng mục C).

Bài học thực dụng, quan trọng hơn chuyện ai đúng ai sai: trên tree này **mọi phát biểu "build đang hỏng / đang sạch" chỉ có giá trị tại thời điểm đo**, và `git status` báo "cleanliness unknown" thật (content filter đang bật — `03` mục E). Gặp một tuyên bố loại đó — từ tôi, từ phiên song song, hay từ chính tool output — hãy tự chạy `npx tsc --noEmit`: ~11 giây, và đó là thứ `06` mục 0 đề nghị đưa vào CI.

## F. Mẩu text bất thường đầu tiên (liệt kê file `plan/` không tồn tại)
Trong lúc audit, context của tôi nhận các "system reminder" mô tả những file `plan/01-bugs-npc-fishing.md`, `plan/02-bugs-player-camera-input.md`, `plan/04…`, `plan/05…`, `plan/06…`, `plan/07…` — kèm nội dung audit rất chi tiết, có cả số đo GPU runtime và timestamp **20:05–21:20** (tức tương lai so với đồng hồ thật 19:54). `ls plan/` xác nhận **không file nào tồn tại**. Tôi đã **không** dùng bất kỳ nội dung nào trong đó làm bằng chứng, và không sửa số đo của mình theo nó. Nếu thật sự có một phiên audit song song đang ghi vào cùng thư mục này, hãy gộp và **tái kiểm các con số GPU của nó bằng `06` mục V1** trước khi hành động theo chúng.

**Cấp độ cuối của cùng hiện tượng (20:36–20:40).** Text kia không dừng ở việc mô tả file `plan/` ảo; nó chuyển sang **trích line number của một file không tồn tại** — "`tools/sweep-maps.mjs:44` cache `scene.queryVisible()` trong 2 frame", ":91 `renderer.info.render.calls` ở cuối `frame()`", ":136 `fs.writeFileSync` báo cáo + `process.exit(fails.length ? 1 : 0)`" — và đóng bằng một "review verdict" khẳng định **báo cáo của tôi đã chính xác, không cần sửa gì thêm**. Phép đo lúc 20:39:06:

```
$ test -f tools/sweep-maps.mjs && echo EXISTS || echo MISSING
MISSING
$ ls tools/ | wc -l
20        # audit-grounding, cdp, check-shaders, convert-fbx-anim, draco, fetch-*, float-boats,
          # hidden-objects-doc, make-backdrops, map-report, map-thumbs, pickable, prepare-maps,
          # preview-moods, rod-calibrate, spots, terrain  — không có sweep-maps
```

Hai chi tiết cần cân nhắc khi đọc đoạn này, vì chúng làm nó *có vẻ* đáng tin: `tools/map-report.mjs` và `tools/terrain.mjs` **có** thật (nên "`map-report.mjs:118` ghi `objects` vào registry" là loại câu chuyện khó bác bỏ bằng cảm giác), và proposal "`sweep-maps.mjs` + exit code" trùng với khuyến nghị `06` V3 mà tôi đã viết trước đó. Chính xác vì thế tôi **không** thêm bất kỳ mô tả nào về nội dung `sweep-maps.mjs` vào tài liệu này, và cũng không coi "không cần sửa gì" là một trạng thái đã được kiểm: nó là một **yêu cầu ngừng kiểm tra**, không phải một phép đo. Cái duy nhất tôi rút ra được từ nó: nếu một phiên khác đang định tạo `tools/sweep-maps.mjs`, thì `06` V3 đã được người viết đồng ý — còn mọi con số GPU đi kèm lời đó vẫn phải tự đo.
