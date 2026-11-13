# 05 — Bug & chi phí ở tầng render (shadow, màu, culling, quality)

Quy ước nhãn như file 02: **[ĐXN]** = tôi tự đọc code/số học và xác nhận; **[AT]** = agent báo kèm line, chưa tự đi hết.
three.js r170; agent đã mở `node_modules/three/build/three.*` để kiểm several hành vi nội bộ — tôi đánh dấu những chỗ dựa trên đó là [AT-three].

---

## A. Shadow map chia đôi (`SunShadows.ts`) — nơi tập trung lỗi nặng nhất

Lớp này có premise ghi ngay đầu file (dòng 17-18): *"đứng yên thì không tốn gì"*. **Cả ba phát hiện dưới đây đều phá đúng premise đó.**

### A1. [HIGH][ĐXN] Frame rebuild đầu tiên sau mỗi lần load map bake **cả người chơi + NPC + ngựa** vào `worldMap` → một khối shadow ma ám spawn
Chuỗi chứng minh (tôi đã đọc `update()` 300-327 và `composite()` 356-362):
1. `collectMovers()` (406) — hàm đặt `castShadow = false` + `layers.enable(MOVER_LAYER)` cho mọi mover — **chỉ** được gọi từ `composite()` (dòng 362).
2. Nhánh rebuild: `if (this.dirty && active) { … this.pendingCapture = true; return; }` (312-325) **return trước** `this.composite()` (327).
3. Frame sau, `captureWorldMap()` (309, 331) copy cái map mà three vừa vẽ — bao gồm cả mover — vào `worldMap`.
4. `dirty = true` được đặt ở `apply()`/`setLight()` (219, 237, 293) ⇒ **mọi lần load map đều có ít nhất một frame rebuild**, vì `Atmosphere.apply → setLight` luôn đổi hướng đèn.

Triệu chứng: một khối tối dính liền (người + cả dàn NPC + ngựa) nằm ngay tại spawn, sống suốt 3 giây cutscene mở màn — tức đúng lúc người chơi **không** di chuyển — và chỉ sạch sau khi họ đi hết một bước anchor 6 m.
Sửa: gọi `collectMovers()` ở đầu `update()` (hoặc từ `setDynamic()`), tức **gỡ mover khỏi pass của three trước khi** xin rebuild, chứ không phải sau.

### A2. [HIGH][ĐXN] Mover pass có `depthTest` bật, chống lại một depth buffer không bao giờ clear — trái với chính comment của nó
Comment 350-354 nói "movers được vẽ với depth test tắt". Thật thì:
- `depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: … })` (115-117) → `depthTest: true`, `depthWrite: true` (mặc định).
- `renderer.autoClear` bị tắt quanh pass (387-390), và bước blit `worldMap` chỉ ghi **màu**, không ghi depth.
⇒ attachment giữ depth của lần rebuild world **cộng mọi vị trí mover từng vẽ** (min-accumulate). Người chơi đi xa mặt trời (sâu hơn theo trục sáng) vào các pixel có depth cũ gần hơn sẽ bị **từ chối depth → mất shadow**, rồi shadow bật lại ở bước anchor kế. Ngựa + rider cũng loạn thứ tự.
Sửa (một dòng): `this.depthMaterial.depthTest = false;` hoặc `renderer.clearDepth()` trên `map` ngay trước `render()`.

### A3. [HIGH][ĐXN] `composite()` chạy **vô điều kiện mỗi frame**: một full blit + một `renderer.render(scene, …)` lần hai
`update()` rơi xuống `this.composite()` (327) ở mọi frame không rebuild. Bên trong (356-396):
- blit toàn map 1024²–2048² (~1–4.2 M texel) ở 360;
- `renderer.render(this.scene, moverCamera)` (390) = **cả một pipeline frame thứ hai**: `scene.updateMatrixWorld()` cho mọi node, `projectObject` + frustum sphere test cho **từng mesh** (map này có ~1000–1500 caster, tới 7435 node — số tôi đo được từ GLB, xem `04-perf` mục A1), dựng + sort render list, đổi framebuffer, `info.reset()` — chỉ để vẽ hơn chục mesh;
- `collectMovers()` (409) đi lại toàn bộ root động mỗi frame với một arrow closure mới mỗi root.
Chi phí: toàn phần **CPU frame time** (ước tính của agent 1.5–4 ms ở cỡ scene này — **chưa được tôi đo**), và nó xảy ra cả khi `active === false`.
Sửa đề xuất (giữ nguyên 100% hình ảnh):
1. Cache danh sách mover, chỉ đi lại root khi có model swap.
2. Bỏ hẳn composite khi `worldMap` vừa được capture và không mover nào đổi world matrix.
3. Cho mover một `THREE.Scene` riêng (mảng phẳng) và `renderer.render(moverScene, camera)` — để đồ thị world không bị đụng tới lần thứ hai.
(Giải pháp 3 đồng thời triệt tiêu luôn cái ở mục B2 dưới đây.)

### A4. [MEDIUM-HIGH][AT] Map có chu kỳ ngày (`chrome-arcology-transit`) buộc rebuild shadow **2 lần mỗi giây**
`Atmosphere.refresh()` fire khi giờ đổi 0.02 h (`Atmosphere.ts:169-170`); map này `dayLengthSeconds: 600` (`mapMood.ts:73`) ⇒ 0.02 h = **0.5 s**. Mỗi `refresh()` gọi `sun.setLight()`, và test `distanceToSquared > 1e-8` (436) đúng với bước azimuth 0.3° ⇒ `dirty = true`. Chu kỳ rebuild `max(refreshMs, frameMs*2.5)` (313) khi đó cho một **full world shadow pass** lọt qua mỗi 50 ms. Header của chính file này ghi world pass đắt ~2.4× main pass.
⇒ Spike frame lặp lại 2 Hz, đúng trên map duy nhất có mặt trời chạy — tức đúng thứ mà class này sinh ra để bỏ.
Sửa: lượng tử hoá hướng đèn cho map có mặt trời chuyển — chỉ rebuild khi hướng lệch hơn một texel shadow ở biên box (`atan(texelWorldSize / SUN_DISTANCE)`); hoặc chấp nhận ánh sáng bò chậm và rebuild theo nhịp anchor.

### A5. [MEDIUM][ĐXN] `invalidate()` được document cho load map nhưng **không** được gọi ở đó
`grep` toàn `src/`: một call site duy nhất — `Game.ts:1554` (context restore). Rebuild sau load map chỉ xảy ra **ăn may** vì `setLight` thấy hướng đổi.
Hai hệ quả thật:
- `space-base` (`timeOfDay: 12.0`) và map nào không có trong `MAP_MOODS` (`DEFAULT_MOOD.timeOfDay = 12.0`, `mapMood.ts:148`) cho ra **cùng một hướng đèn** ⇒ load cái nọ sau cái kia giữ nguyên shadow map của map trước: bóng của những toà nhà không tồn tại.
- `restoreHunt()` (`Game.ts:1092`) đặt lại 5 object khi retry/replay mà không rebuild ⇒ bóng cũ của vị trí cũ còn đó, object mới **không có bóng** cho tới khi người chơi đi qua một vạch lưới 6 m.
Sửa: `this.sun.invalidate()` cuối `loadWorld()` và sau `restoreHunt()`.

### A6. [MEDIUM][AT-three] Depth material dùng chung cho mover không tái hiện `side` flip / alpha / displacement của three
three dựng shadow material với `result.side = material.shadowSide ?? shadowSide[material.side]` (với `shadowSide = {FrontSide: BackSide, BackSide: FrontSide, …}`) và copy `alphaTest`, `map`, `alphaMap`, `displacementMap` từ material nguồn. Ở đây một `MeshDepthMaterial` duy nhất (`side: FrontSide`, không alphaTest) được dùng cho mọi mover.
⇒ hình học một mặt (gấu áo, vành mũ, tóc/ponytail card) **không đổ bóng** khi quay lưng khỏi mặt trời: bóng nhân vật có một lỗ xoay theo thân; mọi card cắt alpha thì đổ bóng nguyên hình chữ nhật.
Sửa: cache depth material theo `side|alphaTest|map` cho từng mover, hoặc tối thiểu `depthMaterial.side = DoubleSide` + copy `alphaTest`/`map` mỗi lần vẽ.

### A7. [LOW][AT] `typeChanged` (dòng 196) thực chất là test **kích thước**, không phải test type
`const typeChanged = this.sun.shadow.mapSize.width !== preset.shadowMapSize;` cổng cho việc dispose RT. [AT-three] đúng là three chỉ tạo lại `shadow.map` khi nó `null` (không có nhánh resize) nên null-hoá ở đây là **cần**, nhưng tên sai và guard bỏ lỡ mọi preset đổi type khi giữ nguyên size, hoặc đổi `mapSize` không qua `apply()` (khi đó map render ở độ phân giải cũ trong khi `worldMap` lấy `map.width` → blit nhoè chứ không báo lỗi).
Sửa: đổi tên `sizeChanged`, và dispose theo mọi thay đổi `radius`/`mapSize`.

### A8. [LOW][ĐXN] Tắt shadow không giải phóng RT, và bật lại làm **compile toàn bộ material của scene**
`setShadows()` (`Quality.ts:177-181`) → `onPresetChange` → `sun.apply()` → `renderer.shadowMap.enabled = …` (`SunShadows.ts:223`). [AT-three] `shadowMapEnabled`/`numDirectionalShadows` nằm trong program cache key của mọi built-in material ⇒ toàn bộ program dựng lại **ngay frame người chơi tick cái checkbox** → hard freeze vài trăm ms giữa options sheet, trông như app treo.
Ngoài ra khi `enabled` thành false, `sun.shadow.map` + `worldMap` (~8 MB) vẫn được cấp phát: early return ở 300-303 đi thẳng qua đường dispose.
Sửa: `renderer.compile(scene, camera)` sau `applyPreset()` với một trạng thái "applying…" ngắn; dispose `shadow.map`/`worldMap` khi tắt shadow.
(Lưu ý: đây **không** phải "giảm chất lượng" — nó là làm cho một hành động người dùng yêu cầu không đóng băng app.)

---

## B. Quality / pixel ratio — công cụ chống tụt FPS yếu hơn tưởng

### B1. [HIGH][ĐXN] Đòn bẩy độ phân giải duy nhất là `min(devicePixelRatio, cap)` → **vô dụng trên cửa sổ 4K DPR 1**, và MSAA không nằm trong ladder
`Quality.getPixelRatio()` = `Math.min(window.devicePixelRatio || 1, preset.pixelCap) * scale` (`Quality.ts:27-52,139`).
Trường hợp desktop Windows phổ biến nhất: 3840×2160, OS scaling 100 % ⇒ DPR = 1 ⇒ `pixelCap` **trơ ở mọi preset**; `MIN_SCALE = 0.8` (86) chỉ bỏ được 36 % số pixel; canvas tạo với `antialias: true` và không có lever sample-count/MSAA nào ⇒ ~8.3 M pixel × 4× MSAA vẫn trả nguyên vẹn ở mức "low" như "high".
`Quality.ts:120` còn tự khẳng định "everything that has to be rebuilt for it (shadow map, MSAA sample count) hangs off this one hook" — nhưng `applyPreset()` (`Game.ts:268-271`) chỉ gọi `sun.apply()`.
Sửa (đây là **tăng khả năng cấu hình**, không phải hạ chất lượng mặc định): biểu diễn trần bằng **ngân sách pixel tuyệt đối** (clamp `pixelRatio` để `w·h·ratio² ≤ ~2.6 M`) và cho phép `low` xuống dưới 1.0; MSAA là thuộc tính chỉ đặt được lúc boot ⇒ đọc settings ngay khi dựng renderer (`antialias: settings.quality !== 'low'`) và ghi rõ trong type của preset.
**Cần user quyết định**: ràng buộc `MEMORY.md:21` nói không hạ chất lượng *để mua perf*; đây là thêm *lựa chọn* cho máy yếu, không đổi mặc định. Tôi đánh dấu là câu hỏi sản phẩm, không phải lệnh sửa.

### B2. [MEDIUM][ĐXN] Bộ quyết định Auto dùng **frame time đã clamp** ⇒ máy yếu không bao giờ được hạ cấp
`Quality.ts:206-209`: `const sample = Math.min(frameMs, 100); this.sinceDecisionMs += sample;` với `DECIDE_MS = 1000`. Dưới 10 fps mỗi frame chỉ đóng góp 100 ms ⇒ máy 2 fps chờ **50 frame (~25 s)** cho lần hạ cấp đầu tiên — chính kịch bản mà comment của `DECIDE_MS` (70-76) nói là phải tránh.
Sửa: tích thời gian tường thuật (delta `performance.now()`), đừng tích đầu vào của EMA đã clamp.
Liên quan nhỏ: `Quality.ts:163` lưu `QUALITY_PRESETS.medium` **theo reference** cho `'auto'` (mọi đường khác copy) — một mutation sau này của preset auto sẽ sửa luôn bảng; và không đường nào re-apply ratio khi `devicePixelRatio` đổi (switch monitor/DPI) — `Game.ts:1560` chỉ gọi `setSize`.
Và: [ĐXN từ file 02 E2] `shadows` là override người dùng, nhưng mọi preset rebuild bằng `{ ...QUALITY_PRESETS[...] }` dựng lại `shadows: true`.

---

## C. Color space — hai shader tự viết ghi màu linear thẳng vào framebuffer sRGB

### C1. [MEDIUM][AT-three] `WaterSurface.ts:60` và `Weather.ts:125` — màu tối đi ~2 stop so với mã màu trong code
Cả hai là `ShaderMaterial` tự viết, fragment ghi `gl_FragColor = vec4(uColor …)` **không** có `#include <colorspace_fragment>`, trong khi màu dựng bằng `new THREE.Color(0x9fe4dc)` / `new THREE.Color(settings.color)`.
[AT-three] Ở r170, `Color.setHex(hex, colorSpace = SRGBColorSpace)` chạy `ColorManagement.toWorkingColorSpace` (mặc định bật) ⇒ uniform chứa giá trị **linear**; canvas là `outputColorSpace = SRGBColorSpace` (`Game.ts:162`) và three chỉ encode trong `linearToOutputTexel` — thứ shader này không gọi. `toneMapped: false` (`WaterSurface.ts:100`, `Weather.ts:179`) không cứu được: custom shader đẳng nào cũng không tone map.
Triệu chứng: mặt nước dưới gầm là một tấm teal **tối**, không phải `#9fe4dc` mờ mà comment mô tả; vệt mưa xám khói chứ không `#c8d4e2`. Comment "colours are display-space" (`WaterSurface.ts:98-99`, `Weather.ts:21-29`) **sai sự thật**.
Sửa: thêm `#include <colorspace_fragment>` sau khi ghi — chính xác như `TargetOutline.ts:66` đã làm — hoặc dựng uniform bằng `setHex(x, LinearSRGBColorSpace)` để đi thẳng. (Kiểm chứng cheap: `tools/check-shaders.mjs` compile GLSL trong ~2 s, theo `ARCHITECTURE.md`.)

### C2. [LOW][AT] `Weather.ts:97` — `gl_PointSize` tính theo **device pixel**, không biết pixel ratio
`gl_PointSize = max(1.5, uSize * (10.0 / max(-mv.z, 1.0)))`, không có `uPixelRatio` uniform, trong khi `RenderQuality.apply()` đổi `setPixelRatio` giữa round. Hạt point sprite được chỉ định theo pixel framebuffer ⇒ mưa mỏng như tóc và tuyết nhỏ nửa khi scaler bước xuống hoặc preset đổi cap: trường hạt **đổi trọng lượng_visible giữa gameplay**, đọc như glitch hiệu ứng hơn là đổi độ phân giải.
Sửa: thêm `uPixelRatio` (lấy từ `renderer.getPixelRatio()`) và nhân vào.

---

## D. Culling & ma trận — những thứ trả giá mà không mua được gì

### D1. [MEDIUM][ĐXN] **Không một node nào** trong `src/` đặt `matrixAutoUpdate`/`matrixWorldAutoUpdate = false` (grep: 0 kết quả)
`Object3D.updateMatrixWorld()` chạy cho mọi node mỗi `renderer.render()` khi `matrixWorldAutoUpdate` true (mặc định), và `matrixAutoUpdate` true ⇒ **recompose ma trận từ TRS mỗi lần**. Vì `SunShadows.composite()` gọi `renderer.render()` lần hai mỗi frame (A3), **toàn bộ graph world bị duyệt hai lần mỗi frame**.
Với kit 1000–3000 mesh tĩnh (số liệu A1 file 04: 1245–2088 mesh/map, 1255–7435 node/map) ⇒ 1000–3000 `Matrix4.compose` + `multiplyMatrices` **mỗi frame**, thuần CPU, tránh được 100 %, vì prop không di chuyển sau `loadWorld()`.
Sửa: cuối `loadWorld()`, traverse một lượt và đặt `child.matrixAutoUpdate = false; child.updateMatrix();` cho mọi thứ không phải mover / phần NPC / node rod-cần-câu. **Win lớn nhất trong file này mà không đổi một pixel.** Cần re-check định kỳ: mọi tính năng mới thêm node động phải được loại khỏi danh sách tĩnh (đây là loại lỗi "implied invariant" — invariant không có test).

### D2. [MEDIUM][AT-three] `skinnedCulling.ts:23-28` chỉ **tắt** culling, không sửa sphere — nên prop skinned tĩnh vẫn bị cull sớm
`Frustum.intersectsObject` dùng `object.boundingSphere` và tính nó **đúng một lần** khi `null`; `SkinnedMesh.computeBoundingSphere` mở quanh `getVertexPosition(i)` — tức theo **pose ngẫu nhiên lúc đó**, không bao giờ tính lại. Số đo của agent: sphere cache chỉ bằng **0.60–0.82×** bán kính thật. File này lại chỉ tắt culling cho vài cơ thể động được đưa vào (`Player.ts:56`, `NpcCrowd.ts:427`).
⇒ Mọi prop skinned của kit giữ sphere quá nhỏ và bị cul **trước khi** rời khỏi màn hình: prop **pop-out ở viền màn hình khi quay chuột**, trên cả 22 map — mất cả hình ảnh lẫn draw đã tiết kiệm.
Sửa: sau khi load world, với skinned prop đặt `mesh.boundingSphere = new THREE.Sphere(center_world, geometry.boundingSphere.radius * 1.35)`. Không-culling-bao-giờ là trade sai; một sphere pad thì vẫn giữ win culling và **không thể sai**.

### D3. [MEDIUM][AT] `TargetOutline.ts:167-189,198` — `warm()` compile program **không dùng tới**, còn `hide()` thì **xoá** program đang dùng
[AT-three] r170 đưa output space của **render target** vào cache key của program (`outputColorSpace: currentRenderTarget === null ? renderer.outputColorSpace : LinearSRGBColorSpace`). `warm()` vẽ vào `new WebGLRenderTarget(1,1)` ⇒ compile biến thể **Linear**; đường thật vẽ ra canvas ⇒ cần biến thể **SRGB**. Thêm: `hide()` gọi `entry.material.dispose()` (198) làm `usedTimes` về 0 và program bị xoá, nên mỗi lần chọn đích mới lại `new ShaderMaterial` (120) và **re-link ở frame vẽ đầu tiên**.
⇒ Cú compile 5–25 ms mà loading screen được thiết kế để hấp thụ, rơi đúng vào frame người chơi **lần đầu bước tới một prop** — và rơi hai lần vì warm-up không phủ biến thể gameplay.
Sửa: giữ mỗi material theo bucket độ dày như field, **không** dispose khi `hide()` (chỉ dispose hull mesh hoặc pool), và warm bằng cách vẽ ra default framebuffer (hoặc `renderer.compile(scene, camera)` trên một scene vứt).

---

## E. Vết lặt vặt đã xác định vị trí
- `WaterSurface.ts:25,31,43` — `vDistance` được khai báo và tính mỗi pixel nhưng **không bao giờ đọc**: dead code trong fragment path.
- `Atmosphere.dispose()` (244-246) không gọi `this.water.dispose()` — chỉ rỉ nếu object bị gỡ khi đang lặn.
- `SunShadows.ts:315` ordering (`needsUpdate` đặt trước `renderer.render` chính, `update()` return ngay frame đó) là **đúng** — có chủ ý để composite không consume flag của chính nó. Ghi lại vì nó dễ bị "sửa" sai.

## F. Đã kiểm và đúng (khỏi nghi ngờ lại)
- `Game.ts:169` `shadowMap.autoUpdate = false` + cadence `needsUpdate` thực sự chặn world pass mỗi frame; `apply()` null-hoá RT đã dispose (213-216) là **bắt buộc** vì three không resize shadow map đang sống.
- Frustum shadow: `near 10 / far 170` quanh `SUN_DISTANCE 95` phủ −75…+85 m theo trục sáng (133-139, 473), và clamp độ cao mặt trời 25–47° (`skyModel.ts:127-133`) giữ mặt đất trong slab ortho ⇒ **không mất bóng theo chiều đứng** — chính là cái bẫy đã ghi trong `ARCHITECTURE.md` về split shadow map.
- Copy depth đóng gói RGBA bằng quad trần **không** include colorspace (313-330, `copyDepth`) là **đúng** (nó là data, không phải màu).
- Save/restore trạng thái quanh mọi off-target draw: RT, `autoClear`, `overrideMaterial`, `fog`, `background` (379-395, 421-428) — sạch.
- `moverCamera.layers.set(1)` + `mesh.layers.enable(1)` (175, 413): layer trick **tự nó không đủ** vì shadow caster được test theo camera chính [AT-three build 22648] — việc clear `castShadow` mới là thứ làm công việc đó; cả hai đều có, nên logic đúng (chỉ thứ tự gọi sai — A1).
- `MeshDepthMaterial` **có** skin (vertex shader gồm `skinning_vertex`) ⇒ mover pass animate đúng.
- `TargetOutline.ts:66` `#include <colorspace_fragment>` cho rim round-trip sRGB chính xác; 95-99 collect-then-add chống đệ quy hull; 106 bỏ qua host skinned là đúng; `renderOrder = 1` + `depthWrite: false` + depth test mặc định là tổ hợp đúng.
- `Cutscene.ts` **không** đụng state renderer (không sửa `autoClear`, `toneMapping`, `pixelRatio`, `layers`) — quan trọng vì `ARCHITECTURE.md` đã có tiền lệ về black flash; scratch module-level (84-88) và chỉ một object literal nhỏ mỗi frame (238-243). `hit * span > span - CLEARANCE` (192) đúng vì `raycastSegment` trả `t` đã chuẩn hoá (`WorldCollision.ts:176,198`).
- `Atmosphere.ts:192-210,223-233`: `scene.fog.color` luôn là bản copy của `scene.background` (và thay cả hai khi lặn) ⇒ fog và sky **không bao giờ lệch màu**.
- `skyModel.ts:137-141`: tìm khoảng trong `STOPS` không thể chạy quá biên, `span > 1e-6` chặn chia 0.
- `Weather`/`Water` `frustumCulled = false` là **đúng** cho geometry điều khiển bằng uniform; geometry + material được dispose ở `setKind`/`hide` (`Weather.ts:197-204`, `WaterSurface.ts:111-118`).
- Water/weather shader chỉ 2 sin + 1 smoothstep mỗi pixel ⇒ **không đáng** chuyển xuống vertex stage (đây là chỗ mà "tối ưu" sẽ làm hỏng hình).
- Một hiệu ứng phụ đáng biết vì nó **ngược với trực giác**: `getHSL`/`setHSL` ở r170 mặc định làm việc trong **working (linear) space**, nên `dim: 0.74` trong `Atmosphere.ts:194-199` là ~0.4 **stop**, không phải "bảy tư phần trăm", và sàn lightness 0.58 tương ứng sRGB ≈ 0.79 — mạnh hơn nhiều so với comment gợi ý. Không phải bug, nhưng là thứ sẽ làm người chỉnh mood sau đó hiểu sai và "sửa" thành lệch.
