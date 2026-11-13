# 01 — World loader, collision, pipeline nội dung

## Đọc phần đầu này trước

Agent phụ trách vùng này **chết giữa lúc chạy** (lỗi quota API: `agent execution exceeded timed out after 1800000ms`, và `API Error: 118`), nên nó **không trả về kết quả nào**. File này là lượt tự đọc **của tôi**, chủ động, trong `WorldLoader.ts` (1264 dòng), `CollisionGeometry.ts` (1415), `WorldCollision.ts` (1104), `mapFixes.ts`, và cấu trúc asset trên đĩa.

Phạm vi tôi đã thực sự đọc kỹ ở đây **hẹp hơn** các file 02/04/05. Danh sách những gì **chưa ai kiểm** nằm ở mục D cuối file — coi đó là món nợ của lượt audit này, không phải "đã kiểm và sạch".

Nhãn: [ĐXN] = tôi tự đọc và xác nhận; [?]= đặt câu hỏi, chưa kết luận.

---

## A. Bug đã xác minh

### W1. [MEDIUM-HIGH][ĐXN] `timings` trộn **count** và **millisecond** dưới cùng một key namespace → pipeline nội dung tự bịt mắt nó
`WorldLoader.processScene` ghi kết quả mỗi bước vào `this.timings` (`WorldLoader.ts:15`, in ra ở `Game.ts:508`):

| Dòng | Code | Giá trị thật |
|---|---|---|
| 77 | `this.timings.removals = removeProps(root, removals)` | **count** — số node đã gỡ |
| 90 | `this.timings.dredge = Math.round(dredgeWaterBeds(…))` | **ms nếu có đào, 0 nếu không** (`:931`) — đơn vị đổi theo dữ liệu |
| 93 | `this.timings.terrain = Math.round(performance.now() - tTerrain)` | ms ✓ |
| 101 | `this.timings.scatter = Math.round(conformGroundScatter(…))` | ms ✓ (`:416`) — **số node đã uốn bị vứt** |
| 109 | `this.timings.settle = Math.round(settleProps(…))` | **ms nếu có settle, 0 nếu không** (`:1110`) — đơn vị đổi theo dữ liệu |
| 112 | `applyPropShifts(root, shifts);` | hàm trả **count** (`:1131`) — **bị bỏ hoàn toàn, không ghi vào đâu** |
| 125 | `this.timings.collision = this.collisionGeometry.stats.buildMs` | ms ✓ |
| 138 | `this.timings.arms = Math.round(relaxPosedArms(…))` | ms ✓ (`:1264`) — số xương đã đổi bị vứt |

Cái pattern gây hại nhất nằm ở `dredgeWaterBeds:931` và `settleProps:1110`, giống hệt nhau:
```ts
return moved === 0 ? 0 : performance.now() - started;
```
Nó trả **0 khi không làm gì**, và **số millisecond khi có làm gì**. Kết quả:
1. Đơn vị của một key thay đổi theo dữ liệu — `settle: 0` nghĩa là "không moved" chứ không phải "mất 0 ms"; `settle: 41` nghĩa là "mất 41 ms" và **số node bị moved bị vứt đi**.
2. Người đọc dòng debug (`Game.ts:508`) không thể biết một bước có thật sự tác động hay không, **đúng vào cái bước họ đang nghi**.
3. Đây là cơ chế khiến **nội dung mục ruỗng mà không ai thấy** (W2): mọi `SETTLE_RULES`, `PROP_SHIFTS`, `PROP_REMOVALS` đều khớp **theo tên node**; khi kit đổi tên node, hàm vẫn chạy, `moved = 0`, trả `0`, in ra `0` — trông hệt như " mau lắm, không có gì để sửa".

Sửa (rẻ, và mở đường cho W2): tách hai thứ thành hai loại —
```ts
export interface FixReport { moved: number; ms: number; unmatched: string[] }
```
`unmatched` = danh sách rule/shift/shift-node **không khớp gì** trong map này. Ghi vào `timings` chỉ số ms, và để `Game.ts:508` in riêng `unmatched`.

### W2. [MEDIUM][ĐXN] Không có gì kiểm một `mapFix` còn tác dụng; test chỉ phủ `removeProps`
- `tests/MapFixes.test.ts` có 5 test, **tất cả** về `removeProps` (khớp tên, trong/b ngoài bán kính, honour radius, gỡ cả subtree). `applyPropShifts` — hàm đẩy cả cầu/vật thể vào vị trí đúng — **không có test nào**, và return value của nó bị bỏ ở `WorldLoader.ts:112`.
- `PROP_SHIFTS` địa chỉ bằng **tên node placement** (comment dòng 1116-1119 ghi rõ chủ ý), `PROP_REMOVALS` bằng tên + toạ độ + bán kính. Cả hai im lặng khi không khớp.
- Chiều ngược lại cũng im lặng: `applyPropShifts` (`:1122-1130`) duyệt **toàn bộ root cho từng shift** và cộng offset vào **mọi** node trùng tên, không có guard "chỉ node ngoài cùng" như `settleProps` (`:1098-1104`), và không có assertion "khớp đúng một node". Tên kiểu kit (`Cube.014`, `Table.003`) hoàn toàn có thể lặp lại trong một map — khi đó cầu bị đẩy hai lần và không ai thấy gì.
- `tests/Content.test.ts` kiểm tra **săn** (map↔item, id unique, asset tồn tại, bán kính 60 m) và **xanh thật** (tôi đã chạy) — nhưng nó **không** đọc `mapFixes.ts`.
- Tiền lệ đã có trong `ARCHITECTURE.md`: tác vụ này từng có "hand-kept map lists" khiến map mới **âm thầm không được audit**, và đã được sửa bằng cách "đọc registry hoặc directory". Cùng bài học, áp dụng cho `mapFixes`, chưa được áp dụng.
  **Tôi tự bắt lỗi mình ở đây.** Bản nháp của mục này viết "không có cổng 22 map nào" — sai. `tools/audit-grounding.mjs` **có tồn tại** (và đang được git theo dõi), deterministic, Node-only, ~2 s/map, duyệt `public/assets/maps/*.glb` **từ đĩa** thay vì một danh sách ghi tay (comment `:30-33` giải thích đúng cái bẫy hand-kept list), decode terrain bằng Draco và đo từng prop xem nó có đứng đất không. Đó là cổng 22 map **duy nhất còn trên đĩa** — cổng browser sweep (`tmp-sweepall.mjs`) thì thật sự đã bị xoá (`tools/` hiện có 20 file, không có `sweep-maps.mjs`).
  **Vấn đề còn lại hẹp hơn nhưng thật, và hai bên không gặp nhau:** audit-grounding đo **file GLB trên đĩa**, tức đo *trạng thái trước khi sửa*; còn `settleProps`/`applyPropShifts`/`conformGroundScatter` chạy **lúc load trong browser**, trên chính cái defect chưa được bake. audit-grounding không biết gì về `mapFixes` (`grep -l "PROP_SHIFTS|settleProps" tools/*.mjs` → chỉ `float-boats.mjs`), và nó **chỉ in** (`console.log` dòng 159-165, không `process.exit(1)`) → không phải gate theo nghĩa CI. Hệ quả: một entry `PROP_SHIFTS` chết vì đổi tên node thì **cả hai phía đều im lặng** — asset vẫn báo lỗi float như cũ (nên không ai để ý số khác đi), còn runtime thì không còn sửa được nữa.
  → Cách rẻ hơn nhiều so với "viết gate mới": thêm vào `tests/MapFixes.test.ts` (vitest đã import được TS trong `src/`) một test chạy `applyPropShifts` + `removeProps` trên **danh sách node thật** của từng map — mà `maps/reports/*.json` đã ghi lại sẵn từ `prepare-maps.mjs`. Không cần GLB, không cần browser, và nó biến mỗi entry `mapFixes` thành một assertion có tên.

Sửa: (a) `applyPropShifts` trả `unmatched`; (b) một assertion trong `tools/map-report.mjs` (hoặc `tests/Content.test.ts`) chạy trên `maps/reports/*.json` hoặc trên GLB đã build, fail khi một `PROP_SHIFTS`/`PROP_REMOVALS` entry không match node nào; (c) test `applyPropShifts` tối thiểu 3 case (match, tên không tồn tại, nhiều node trùng tên).

### W3. [? — ĐO TRƯỚC KHI SỬA] Cửa sổ `supportHeight` 0.6 m dưới chân vs quãng rơi mỗi frame
```ts
public supportHeight(x, z, feetY, stepHeight) {   // CollisionGeometry.ts:710
  const lo = feetY - 0.6;
  const hi = feetY + stepHeight + Math.max(part.stepBonus, carry) + 0.02;
```
`delta` bị clamp 0.1 s (`GameLoop.ts:50`) và gravity 18 (`gameConfig`). Sau ~5 frame rơi tự do, v ≈ 9 m/s ⇒ quãng rơi mỗi frame ≈ **0.9 m > 0.6 m**. Liệu thân có đi xuyên một sàn mỏng (ván chèo, boong cầu gỗ, tấm scaterry) khi rơi đủ lâu không?
Tôi **không kết luận** được bằng đọc code: đường rơi dùng `resolveVertical` + `getGroundHeight` (`WorldCollision.ts:731-738` có fallback raycast chính xác cho địa hình), và tôi chưa lần theo hết thứ tự `supportHeight` được gọi với `feetY` nào trong frame va chạm.
Test rẻ để đóng câu hỏi này (đặt vào `tests/Collision.test.ts`, nơi đã có 19 test Capsule/regression): thả một capsule từ 12 m xuống trên một box dày 0.2 m, `dt` clamp 0.1, kỳ vọng frame đầu tiên `feetY >= box.top`. Nếu fail → đây là bug **high**.
Cảnh báo khi đọc: `ARCHITECTURE.md` và `tests/Collision.test.ts:303` ("stops dead at a rail that sits just under the step height, on a slope") cho thấy vùng này đã được đi qua có chủ ý — nên rất có thể đã ổn, và câu hỏi chỉ là cửa sổ 0.6 m cho **rơi dài**, không phải cho bước.
Chi tiết phụ, chắc chắn đúng: con số `0.6` ở `:710` là **literal**, trùng giá trị và gần trùng ý nghĩa với `STANDING_DEPTH = 0.6` đã có doc tử tế ở `CollisionGeometry.ts:256-261`. Hai nơi cùng một khái niệm, một nơi có tên một nơi không — nếu chúng nên là một thì dùng constant, nếu khác nhau thì đặt tên, vì người sửa `STANDING_DEPTH` (hammock sag) sẽ không nghĩ tới cửa sổ chống xuyên sàn.

### W4. [LOW][ĐXN] `root.updateMatrixWorld(true)` ba lần trong một lượt load
`WorldLoader.ts:71`, `:108`, `:113` — mỗi lần là một pass **cưỡng bức** toàn bộ graph (tới 7435 node — số tôi đo từ `dia-de-muertos.glb`). Hai cái giữa là cần thật (vị trí thay đổi sau `scatter`/`settle`, và sau `applyPropShifts`), nhưng `settleProps`/`conformGroundScatter`/`applyPropShifts` đều **biết chính xác node nào mình đổi** (chúng đếm `moved`); chúng có thể gọi `node.updateMatrixWorld()` trên từng node đã đổi thay vì force cả graph.
Chi phí: load-time, cỡ ms — **không phải bug perf**, nhưng nó là thứ khiến người ta quen với "cứ force cả graph cho chắc" và rồi… xem W5.

### W5. [MEDIUM][ĐXN] Không node nào trong game tắt `matrixAutoUpdate`, kể cả sau khi loader đã force mọi thứ một lần (= `05` D1)
`grep matrixAutoUpdate src/` → **0 kết quả** (tôi tự chạy). `loadWorld` kết thúc bằng một `updateMatrixWorld(true)`; từ lúc đó mọi prop, mọi đá, mọi hàng rào của một map 1245–2088 mesh **đứng yên vĩnh viễn**, nhưng vẫn được recompose từ TRS và human lại ma trận **mỗi frame** — và `SunShadows.composite()` gọi `renderer.render()` lần hai mỗi frame (`05` A3) nên graph bị duyệt **hai lần**.
Chi tiết phân tích và cách sửa ở `05` D1 (finding chính), `04-perf` A1-mục-2, và `06` mục 6.1. Ghi lại ở đây vì **chỗ đặt mã sửa đúng nhất là cuối `processScene`** (loader là nơi duy nhất biết node nào là động).

---

## B. Đã kiểm và **sạch** (đây là phần đáng tiền nhất của file này)

Tôi tới tay vào từng nghi vấn sau và cả đều **không phải bug**. Ghi lại để lần sau khỏi mất công nghi ngờ lại — và để nói đúng: phần collider của codebase này được viết có suy nghĩ hơn mức trung bình.

| Nghi vấn | Kết luận |
|---|---|
| Buffer `_candidates` (khởi tạo 256) tràn khi một truy vấn lưới trả về nhiều hơn 256 part? `Int32Array` ghi quá dài là **no-op thầm lặng** ⇒ mất part ⇒ đâm xuyên đồ vật ở một số vị trí | **Sạch.** `build()` grow nó lên `parts.length` ở `CollisionGeometry.ts:648`, nên nhánh lưới (`:539-553`, không tự grow) vẫn luôn đủ chỗ vì `n <= parts.length` |
| Heightfield một lớp Y cho mỗi ô XZ — map hai tầng (cầu vượt đường, toà văn phòng nhiều tầng) có sập không? Đây là nghi vấn đáng tiền nhất tôi tự đặt ra | **Sạch, về bản chất.** Chỉ mesh khớp `/-terrain$/i` / `/^terrain$/i` (`CollisionGeometry.ts:91`, chọn bởi `findTerrainMeshes`) vào heightfield; sàn tầng 2 là **prop collider** chứ không phải terrain, nên không tranh ô. Việc "surface cao nhất thắng" (`WorldCollision.ts:1000-1002, 1060-1061`) là **chủ ý**, để slab lát trên sheet vẫn đi được (`construction-site` có chín slab `ground` cạnh sheet — `:121-125`). Residual: xem mục D |
| Part grid bỏ sót part nằm vắt ngang biên ô? | **Sạch.** Cả lúc dựng (`:352-362`) và lúc hỏi (`:533-553`) đều duyệt **inclusive** `x0..x1`, `z0..z1`, và part được ghi vào **mọi** ô mà bbox của nó chạm — không có "cell của tâm" |
| Hai ô cùng chứa một part → part bị tính hai lần, contacts bị lặp? | **Sạch.** `_candidateStamp` + `_candidateQuery` stamp (`:541-549`) khử trùng lặp mỗi truy vấn |
| Thứ tự thăm grid khác thứ tự scan tuyến tính, làm đổi kết quả `collectContacts` (nó giữ "sâu nhất vài contact" và phá hoà theo thứ tự gặp)? | **Sạch, và có chủ ý** — có comment giải thích (`:519-523`), và insertion sort `:556+` trả lại thứ tự part. Đây là kiểu comment mà tôi muốn thấy ở mọi nơi khác |
| Loader cache scene/kit dùng chung giữa các map (⇒ mutation rỉ sang map khác)? | **Sạch.** `grep -i cache src/game/world/WorldLoader.ts` = **0**; mỗi map parse mới, nên `applyPropShifts`/`settleProps` không thể apply hai lần lên cùng một node |
| Map nào giữ cả 22 map resident (unbounded cache)? | **Sạch.** `CollisionGeometry` có một cache cho door re-bake, không phải cache đa map |
| Teardown map có dispose đủ? | **Sạch** theo agent lifecycle (`02` mục Phụ): `WorldLoader.ts:162-170, 257-288` traverse dispose geometry/material/texture/skeleton/author lights + `renderLists.dispose()`. Comment ở `:155-159` còn ghi rõ cái nó chống lại ("a few maps in, the tab is holding half a gigabyte") |
| Scatter/grass tạo từng mesh riêng làm phình draw call? | **Có chủ đích và có trần:** `mesh.castShadow = isShadowCaster(mesh)` với cutoff 40 cm (`:140-151`) — 400 viên sỏi và decal sỏi bị loại khỏi depth pass vì chúng chiếm dưới một texel. Hướng xử lý đúng, comment giải thích **vì sao** |
| `settleProps` đệ quy cả node con của cùng tên (thuyền bị settle hai lần)? | **Sạch** — `visit` `return` sau khi settle node ngoài cùng khớp (`:1098-1104`), kèm `NOT_A_CRAFT` guard |
| `insideTriangle` (rasterise mặt nước xuống lưới) sai dấu? | **Sạch** — test cross-product hai phía, chuẩn |
| Draco/asset pipeline | **Sạch và tốt**: 21/21 map GLB dùng `KHR_draco_mesh_compression`, `imgs: 0` (không texture ⇒ không có KTX2/webp để lo), payload map 60.7 MB cho 22 map |

**Số đo của chính tôi cho phần asset pipeline** (bảng đầy đủ trong `04-perf` A1): 21 map có **10 834 material / 21 538 primitive**, và chỉ **10 616** cặp `(name,color)` khác nhau *trong từng map* — tức dedup màu chỉ tiết kiệm ~2 %, nhận định "kit chưa dedup material" của tôi lúc đầu là **sai**. Cơ hội thật là gộp *geometry theo material* (−51 % draw call trên lý thuyết), nhưng nó **xóa node**, mà toàn bộ `mapFixes` / `isPickablePart` / collider part đều địa chỉ theo tên node — nên chỉ áp dụng được cho decoration không có tên ở đâu, kèm báo cáo những gì bị bỏ qua. Đây là chỗ mà một lệnh merge "vô hại lúc build" có thể phá pipeline nội dung mà không ai thấy (đúng cơ chế W1/W2 ở trên).

---

## C. Đề xuất sửa, theo thứ tự trong vùng này
1. `FixReport { moved, ms, unmatched }` cho `removeProps`/`settleProps`/`conformGroundScatter`/`applyPropShifts`/`relaxPosedArms` (W1).
2. `applyPropShifts` return không bị bỏ nữa (W1/W2) — `WorldLoader.ts:112`.
3. Assertion "mọi entry mapFixes khớp **đúng một** node" chạy trên reports đã build (W2) — bắt cả no-match lẫn multi-match.
4. Test 3 case cho `applyPropShifts`; mở rộng `tests/MapFixes.test.ts` (hiện chỉ có `removeProps`).
5. Đo W3 bằng một unit test thả rơi — **trước khi** thay đổi cửa sổ 0.6 m.
6. `matrixAutoUpdate = false` cho đồ tĩnh, đặt cuối `processScene` (W5) + test invariant (`06` V4).
7. Bỏ 1-2 trong 3 lần `updateMatrixWorld(true)` bằng cách cập nhật theo node đã đổi (W4).

## D. Những gì **chưa ai** kiểm trong vùng này (món nợ)
- Toạ độ và thứ tự `build()`: tam giác nào bị **bỏ** (`skippedMeshes`), tiêu chí "thing vs ground/water" (dòng 229), và `stepBonus` suy ra từ gì — chỉ đọc tên thì hợp lý, nhưng tôi chưa kiểm với dữ liệu thật.
- Đường đi của `re-bake` door/prop động (`:660+`): một cửa mở có làm lộ phần collider cũ không, và `stepBonus`/ground per triangle có giữ đúng sau re-bake không.
- `WorldCollision.findSpawn` — `ARCHITECTURE.md` ghi nó là chỗ từng sinh bug ("hint `y` thấp hơn ground thật ⇒ spawn inside paving"); tôi chưa lần lại toàn bộ `placeAtSpawn`.
- `terrainHeight`/heightfield rasterisation: **cơ chế đã kiểm và đúng** (mục B), nhưng chưa kiểm trên **dữ liệu thật** — chưa map nào trong 22 map được đo để xác nhận không có hai mesh terrain cách nhau quá một bậc bước ở cùng một ô. Đây là cửa hỏng còn lại duy nhất của thiết kế một-lớp: nếu một tác giả sau này đặt tên tầng trên là `plaza-terrain` hay `bridge-terrain`, nó sẽ **nuốt** toàn bộ mặt đất bên dưới thành trần, và không có dòng log nào báo. Đề xuất rẻ (10 dòng trong `buildHeightField`): đếm số ô có hai surface chênh > `stepHeight` và in ra cùng `skippedMeshes` — biến một thiết kế hợp lý thành một thiết kế khó dùng sai.
- 4 file `tools/*.mjs` quyết định nội dung map (`prepare-maps`, `terrain`, `pickable`, `spots`) — mới chỉ đọc `pickable` khi xác minh 02-B2.
- Chi phí dựng collider mỗi lần load: `buildMs` có in ra (`:125`) nhưng tôi không có baseline; nếu nó 2-4 s thì việc chuẩn hoá collider **lúc build map** (sidecar `maps/reports/*.json` — `ARCHITECTURE.md` nói sidecar là record) là một trong những win lớn nhất chưa được đo tới.
