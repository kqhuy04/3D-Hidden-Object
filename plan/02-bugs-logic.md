# 02 — Bug logic (đã xác minh từng cái một)

Cách đọc file này:
- **[ĐXN]** = tôi đã tự mở đúng dòng code và kiểm chứng lập luận + số học, không tin tường.
- **[AT]** = do agent audit báo, có dẫn line cụ thể, tôi chưa tự đi hết đường chứng minh → nên tái kiểm trước khi sửa.
- Mọi line number là ảnh chụp working tree ~19:45 ngày 13-11-2026 (tree đang chuyển động — xem `03-ha-tang-build-repo-docs.md` mục E).

Nhóm: A = vòng đời game & state machine, B = luật đi săn (săn/nhận hint/strike), C = người chơi/camera/input, D = NPC/cưỡi/câu cá, E = lưu trữ/cài đặt.

---

## A. Vòng đời game & state machine

### A1. [HIGH][ĐXN] Nút đóng / Escape của bảng chọn map không bị khoá lúc đang load → đá người chơi vào một màn săn
`selectMap` (`Game.ts:618-665`) khoá **card** bằng `setBusy(true)`, nhưng không khoá đường thoát:
- `MapSelect.ts:112-115`: `this.element.querySelector('#btn-map-close')?.addEventListener('click', () => { ... this.onCloseCallback?.(); })` — handler này **không** kiểm tra `this.busy`. `setBusy` (dòng 244-250) chỉ disable `.map-card`, nút prev/next — không đụng `#btn-map-close`.
- `Game.ts:855-857`: `if (this.ui.mapSelect.isOpen) { this.closeMapSelect(); return; }` — Escape cũng không điều kiện.

`closeMapSelect` (`Game.ts:678-687`) lập tức lật `state` sang MENU/PAUSED, trong khi `selectMap` vẫn đang `await this.loadWorld(...)` (mất vài giây: parse + dựng collision). Khi load xong, các dòng 657-664 chạy **vô điều kiện**: `hideLoading(); await this.ensureCharacter(); this.startNewRound();`.

Triệu chứng: bấm X hoặc Esc giữa lúc load (người dùng mất kiên nhẫn với map 9 MB), rồi bị ném vào một màn săn mới toanh dưới một tấm pause card cũ. Clock chạy, nhân vật đứng giữa map mà họ vừa từ chối.

Sửa: hoặc disable `#btn-map-close` trong `setBusy`, hoặc (đúng hơn) cho `selectMap` một **generation token**: mỗi lần load tăng token, phần đuôi của `selectMap` chỉ chạy `startNewRound` nếu token không đổi; `closeMapSelect` giữa load thì huỷ/`return` sớm.

### A2. [MEDIUM][ĐXN] Load map thất bại bỏ `state === LOADING` vĩnh viễn với thế giới đã bị phá
`Game.ts:649-654` — nhánh catch của `selectMap`:
```ts
} catch (err) {
  console.error(`Failed to load map "${id}":`, err);
  this.ui.setLoadingText(`Could not load ${next.label}. Pick another map.`);
  this.ui.mapSelect.setBusy(false);
  this.switching = false;
  return;                       // <- không khôi phục this.state / this.isLoaded
}
```
`state` đã bị đặt `LOADING` ở dòng 635 và `isLoaded = false` ở 636 trước đó; thế giới cũ đã bị teardown ở `loadWorld` (dòng 352-361). Sau lỗi: `update()` return sớm ở `1260` (`if (!this.isLoaded) return;`), `render()` chỉ skip MENU nên nó **vẽ một cảnh trống mỗi frame** vĩnh viễn. Lối thoát duy nhất là chọn map khác.

Sửa: trong catch, khôi phục `this.state = this.pickerReturn` (và gọi `showMainMenu()`/`showPause()` như `closeMapSelect` làm), hoặc ít nhất đưa về MENU một cách có ý thức.

### A3. [HIGH][ĐXN] `restoreHunt` đang chạy không bị huỷ khi đổi map → object của map cũ rơi vào map mới
`Game.ts:988/996` fire `void this.restoreHunt(hunt.items)` (không await, không ghi lại ở đâu để huỷ). `HiddenItemSystem.load` (`59-74`) `await Promise.all(...)` rồi `this.items.push(item); this.group.add(item.object)` mà **không có generation token**; `clear()` (dòng 246) không thể thu hồi continuation đã scheduled.

Tái hiện trên giấy: bấm Retry ở thẻ kết quả (khởi động 5 lần fetch GLB) → ngay lập tức pause → chọn map khác. `loadWorld` gọi `hiddenItems.clear()` rồi `hiddenItems.load(newHunt)`; sau đó 5 GLB cũ resolve và **nối vào** `items` của map mới, và còn set `this.loading = false` (dòng 74) trong lúc load mới chưa xong (làm hỏng guard của `findTarget`).

Hệ quả dây chuyền với B1 dưới đây: object map cũ nằm trong map mới, bấm E vào nó → biến mất vĩnh viễn, không được tính, và màn săn còn 4/5 không thể thắng.

Sửa: `_loadToken` tăng trong `clear()`/`load()`; mỗi continuation chỉ được push nếu token của nó còn là token hiện hành.

### A4. [MEDIUM][ĐXN] world simulation vẫn chạy đầy đủ sau màn menu, trong khi menu cố tình không vẽ thế giới
`Game.ts:1259-1270` (`update`) chạy `atmosphere.update`, `npcs.update`, camera orbit; `render()` (1489) return với MENU. Lý do "giữ NPC sống sau pause menu" đúng với PAUSED (thế giới vẫn được vẽ) nhưng sai với MENU — mà MENU là màn người chơi ngồi lâu nhất. Đây là CPU đốt không đổi lấy pixel nào.
Sửa: skip `npcs`/`atmosphere` khi `state === MENU`. (Không phải downgrade hình ảnh — trên menu vốn chẳng có hình.)

### A5. [LOW][AT] resize lúc WebGL context bị lost vẫn gọi `render`
Handler `webglcontextlost` (`Game.ts:1541-1558`) dừng loop, nhưng listener `resize` (đăng ký ở `Game.ts:241`) vẫn sống và `onWindowResize` kết thúc bằng `this.render(true)` (1567) → mỗi sự kiện resize gọi `renderer.render` + `sun.update` trên context đã chết, đúng thứ mà doc comment của `bindContextLoss` nghiêm cấm. Ngoài ra `render(force)` có hợp đồng "resize thì phải vẽ lại" (comment 1479-1480) nhưng `if (this.state === GameState.MENU) return;` ở 1489 đặt trước kiểm tra `force` → buffer sau resize trên menu vẫn transparent black.
Sửa: `if (contextLost) return;` trong resize; kiểm `force` trước `MENU` return.

### A6. [LOW][ĐXN] `Game.pickupTarget` là state chỉ ghi, không đọc
`Game.ts:91`, ghi ở 369, 1018, 1216, 1372, 1388; `grep` toàn `src/` → 0 chỗ đọc. Tương tự `HiddenItemSystem.findTarget` (dòng 151) 0 call site nhưng `docs/HIDDEN_OBJECTS.md:442` vẫn bảo công cụ verify đi qua nó. Đây là tàn dư của thiết kế trước khi có `InteractableSelector`; nó nguy hiểm ở chỗ reviewer sẽ tin vào field "đích đang nhắm" này.
Sửa: xoá field và hàm, hoặc làm cho doc đúng với code thật.

---

## B. Luật đi săn

### B1. [HIGH][ĐXN] `handlePickup` huỷ hiển thị object **trước** khi round chấp nhận nó
```ts
const object = this.hiddenItems.release(item);                 // Game.ts:1211
const found = ...; const total = ...;
this.ui.foundScreen.show(object, item.placement.name, found, total);  // 1220
if (!this.roundManager.complete(item.placement.id)) return;     // 1222
```
`RoundManager.complete` (dòng 120-124) trả `false` khi id không thuộc round hiện tại hoặc `status !== 'playing'`. lúc đó object đã bị `release()` (found = true, gỡ khỏi scene, giao cho FoundStage và **dispose** khi veil tắt — `FoundStage.ts:186-200`).
Người chơi nhận một thẻ "Found" đẹp cho một thứ không được tính, một trong năm object đã biến mất khỏi thế giới, và round không thể thắng.
Sửa: `if (!this.roundManager.complete(id)) return;` rồi mới `release()` + `show()`.

### B2. [HIGH][ĐXN] Test "occlusion" cho decoy bị chính collider của decoy đánh bại → trụ cột strike chỉ hoạt động với đồ mỏng
`InteractableSelector.ts:312`:
```ts
const blocked = t !== null && t * sight < sight - 0.35;
```
with `sight = cameraPosition.distanceTo(candidate.centre)` và `t` từ `geometry.raycastSegment(camera → centre)`.

Chuỗi lập luận tôi đã kiểm từng mắt xích:
1. `PropTargets.ts:43-47` tự mô tả: props là "the same node whose children became collision parts ... the shape of this walk matches `CollisionGeometry.build`". → decoy là collision part.
2. `CollisionGeometry.raycastSegment` (dòng 959+) không nhận tham số nào để loại trừ đích; `best = 1`, nó lấy mọi part trong segment box. → tia dừng lại ở **mặt gần của chính cái prop**.
3. tâm prop là tâm bbox, nên mặt gần cách camera `sight − nửa-bề-dày`. `blocked` ⟺ nửa bề dày > 0.35 m ⟺ prop dày > 0.7 m theo hướng nhìn.
4. `MAX_PROP_SPAN = 2.0` (`PropTargets.ts:35`) — tức là prop tới 2 m được thu làm decoy, và đa số chúng dày hơn 0.7 m.

Triệu chứng: **không prompt E, và không thể tính strike** với sofa, tủ lạnh, thùng hàng, đàn piano, booth điện thoại, quầy chợ — nhưng vẫn hoạt động với cửa mỏng, biển chỉ, hàng rào (cánh cửa/đèn vốn là các verb `hinge`/`lamp` nên mọi người thấy "hệ thống chạm" chạy tốt và không nghi ngờ). Strike thì sao? `RoundManager.addStrike` (dòng 86-94) hết 3 strike là thua, và vì danh sách decoy bị lọc mất nhóm to nhất, việc "học từ sai" bị teo một nửa và phụ thuộc góc nhìn. Không test nào bắt được: `tests/` **không có** test cho `InteractableSelector`, và `tools/pickable.mjs` chỉ test hidden item (mà item thì cố tình không nằm trong collider — `HiddenItemSystem.ts:24-26`).
Sửa: bắn tia tới `centre − dir·radius` (bề mặt gần) thay vì tâm, hoặc so `hit_dist < sight − radius − 0.35`, hoặc truyền exclusion id vào `raycastSegment`. **Cần đo lại bằng runtime**: thêm `tools/selector-report.mjs` in ra số prop được phép chọn / tổng prop mỗi map; hôm nay con số đó là ẩn.

### B3. [MEDIUM][ĐXN] cache tầm nhìn 200 ms chỉ vô hiệu theo **vị trí**, không theo **hướng**
`InteractableSelector.ts:337-351` + 84-85 (`SIGHT_TTL`, `SIGHT_MOVE = 0.5 m`). Quay chuột 180° khi đứng yên: kết luận "clear/blocked" của hướng cũ bị dùng lại tới 12 frame. Comment ở dòng 66-70 hứa "một hidden object không bao giờ được tin theo" — lời hứa đó sai trong cửa sổ này; và một item `clear` thì không bao giờ được ray lại chừng nào cache còn hạn.
Sửa: lưu kèm yaw/pitch (hoặc dot của hướng nhìn) trong cache, vô hiệu khi lệch quá ~5°.

### B4. [MEDIUM][ĐXN] khi hết ngân sách ray, candidate được **ưa ái** cho qua, rồi E có thể tác động lên object khác với cái đang prompt
`InteractableSelector.ts:293-315`: `const mustAsk = candidate.kind === 'item' || rays < RAYS_PER_FRAME;` — quá ngân sách thì push vào `visible` mà không kiểm tra và không cache. `selectedKey = visible[0]` (dòng ~325) → một prop chưa từng được verify. Nhấn E chạy `selector.update` với ngân sách mới, prop đó có thể bị loại, và code chọn fallback kế cận — một cú E đốt strike vào thứ người chơi không nhắm và không thấy prompt (`Game.ts:1182-1205`).
Sửa: lúc nhấn, nếu selected chưa có câu trả lời sight trong cache thì bắt buộc ray fresh, và chấp nhận `selectedKey = null` thay vì âm thầm chọn lại.

### B5. [MEDIUM][ĐXN] một asset hidden tải lỗi = màn săn không thể thắng
`HiddenItemSystem.load` nuốt lỗi từng object (dòng 65-67, `console.error` rồi đi tiếp) → thế giới có thể chỉ còn 4; nhưng `Game.ts:979` `roundManager.startRound(hunt.items)` đăng ký đủ 5, và điều kiện thắng là `this.items.every(i => i.found)` (`RoundManager.ts:131`). Ngoài ra `Game.ts:986` (`getItems().length !== hunt.items.length`) sẽ **luôn đúng** → mỗi round start lại fire thêm một `restoreHunt` thừa.
Sửa: `startRound(hiddenItems.getItems().map(i => i.placement))` sau khi load, hoặc thử lại asset lỗi.

### B6. [MEDIUM][ĐXN] đồng hồ săn và state PLAYING bắt đầu **trước khi object tồn tại**
`Game.ts:1017` (`beginHunt`) đặt PLAYING đồng bộ, `roundManager.update(delta)` (1332) bắt đầu cộng `elapsed`, trong khi `restoreHunt` (988/996) load 5 GLB bất đồng bộ. Với đĩa chậm, vài giây đầu của mỗi lần chơi lại là thế giới rỗng, và thời gian chết đó bị ghi vào `bestSeconds` (879 → `Storage.ts:203-215`).
Sửa (một công ba việc): giữ clock dừng cho tới khi `restoreHunt` resolve — đồng thời đóng luôn cửa sổ A3.

### B7. [LOW][AT] round free-roam vẫn cộng strike và có thể "thua" một màn 0/0
`RoundManager.ts:86-94` + `Game.ts:973-976`: `startFreeRoam()` đặt `status = 'playing'`, nên `addStrike()` vẫn đếm, lần thứ 3 lật `'lost'` → thẻ kết quả in "found 0 / total 0" và ghi một trận thua cho map không có mục tiêu. Latent hôm nay (cả 22 map đều đã được author) nhưng free-roam chính là đường cho map chưa author.
Sửa: `addStrike` no-op khi `freeRoam`.

### B8. [LOW][AT] Ba hint tự gọi tên object, phá hợp đồng ghi ngay ở đầu file dữ liệu
`hiddenItems.ts:31` cam kết "describes the object without naming it". Vi phạm: `camp-sink` và `muertos-sink` (hint "…everything but **the kitchen sink**", tên "Kitchen sink"), `hearth-chair` ("**A chair** with five little wheels", tên "Office chair"). Đây là dạng biến màn săn thành shopping list — đúng điều `MEMORY.md:13-15` cấm.
Sửa: viết lại 3 hint (bỏ idiom, hoặc "a swivel seat with five little wheels").

---

## C. Người chơi, camera, input

### C1. [HIGH][ĐXN] Boost lift cộng vào pitch mà không clamp lại → camera vượt cực và lật 180°
```ts
const pitch = this.currentPitch + this.liftSqueeze * BOOM_LIFT_PITCH;  // CameraController.ts:431
```
`maxPitch = 1.35` (`gameConfig.ts:103`), `BOOM_LIFT_PITCH = 0.6` (dòng 22), `liftSqueeze` là 0→1 (dòng 130-138). `pitch` tối đa `1.95 rad > π/2`. Hệ quả: `dirX = Math.cos(pitch) * sinYaw` (432) đổi dấu → boom nhảy sang **phía đối diện** của nhân vật và trái/phải bị gương hoá; khi pitch cắt ngang π/2 thì trục song song `camera.up` nên `lookAt` (524) gây cú lật roll 180°. Chỉ cần `liftSqueeze > 0.37` (zoom 14 m bị ép xuống < 5 m — vào tường khi nhìn xuống là đủ).
`tests/Camera.test.ts` không phủ (nó dùng `defaultPitch 0.35`).
Sửa: `Math.min(currentPitch + squeeze * BOOM_LIFT_PITCH, maxPitch - 0.05)` và mirror cho `minPitch`.

### C2. [HIGH][ĐXN] Tia va chạm đi theo pitch của người dùng, camera đặt theo pitch đã lift → ống kính bị nhét vào geometry chưa từng được sample
Comment 415-421 gọi đây là "conservative ray", nhưng hướng đã lift (`dirX/dirY/dirZ`, 433-435) có thể đâm vào thứ mà tia (`rayX/rayY/rayZ`, 427-429) không đi qua: ở squeeze tối đa, ống kính bị nâng **qua** hàng rào mà tia chặn, đáp vào tường ngôi nhà phía sau; rồi khi "thông" nó duỗi ra 3.5 m/s **xuyên** vật thể đó. Triệu chứng: đứng sát tường, camera vào trong nhà và nhìn xuyên tường.
Sửa: cast thêm segment thứ hai từ `currentLookAt` theo `dir*` và lấy `Math.min` của hai kết quả — không tạo feedback loop vì `liftSqueeze` đã là state của frame trước (chính comment 130-138 nói vậy).

### C3. [HIGH][ĐXN] Nhảy khi đang rơi dịch chuyển thân nhân vật nguyên đoạn rơi trong một frame
```ts
if (jumpRequested && !this.animator.isJumping() && this.animator.startJump()) {
  this.takeoffY = this.groundY;   // PlayerController.ts:225-228 — ground, không phải feet
  this.fallSpeed = 0;
  this.falling = false;           // không kiểm tra contact nào
}
```
Frame kế, `resolveVertical` lấy nhánh `const arc = this.takeoffY + this.animator.getRootLift(); if (arc <= this.groundY) { this.feetY = this.groundY; ... }` (614-616) vì `getRootLift()` ~0 ở tư thế gather. Nhấn Space khi còn cách mặt nước 1.5 m → thân bị **kéo tụt** xuống nước rồi mới bật. Đang rising dưới gờ cũng bị kéo xuống.
Sửa: gate theo contact (`Math.abs(feetY - groundY) <= stepDown` hoặc coyote timer) và `takeoffY = Math.max(groundY, feetY)`.

### C4. [HIGH][ĐXN] `BOOM_IN_SPEED = 20` giữ camera trong tường tới 0.35 s, và sàn `MIN_BOOM` đảm bảo giao cắt khi áp tường
`step = BOOM_IN_SPEED * deltaSeconds` (dòng 470-473) với zoom mặc định 8 m: co về `MIN_BOOM` cần `6.9/20 ≈ 0.35 s`, trong lúc đó ống kính ở **phía bên kia** geometry mà tia đã báo. Cộng với `wanted = Math.min(ideal, Math.max(MIN_BOOM, allowed - BOOM_MARGIN))` (457): mỗi khi `allowed < MIN_BOOM` thì vật chắc chắn bị đâm — sàn áp dụng mà không có test nào theo sau. Lý do ban đầu (giệt bỏ judder 7.2 m) nằm phía **duỗi ra**, không phải phía co.
Sửa: co về tức thì (hoặc tỉ lệ `gap * 25`), giữ nguyên `BOOM_OUT_RATE` + `BOOM_OUT_DEADBAND` cho phía duỗi.

### C5. [MEDIUM][AT] Toàn bộ phần leo thang bỏ qua collision
`PlayerController.ts:514-557`: đoạn trượt vào rung ghi vị trí trực tiếp (`p.x += (offX / off) * slide; p.z += ...`) không qua `moveCapsule`, nên thang đặt phía sau hàng rào/crates/window kéo thân **xuyên** qua chúng. Sau đó `updateClimb` (539-547) đổi `feetY` mà không có test ceiling/support → leo qua balcony, deck tháp canh, chiếu cầu thang là chui xuyên ra phía bên kia.
Sửa: route slide qua `collision.moveCapsule`, và mỗi frame từ chối độ cao mới nếu `supportHeight(x, z, feetY)` tìm thấy mặt đứng được giữa `feetY` cũ và mới (đặt người lên đó).

### C6. [MEDIUM][AT] Giữa thang chỉ có một đường xuống; Space chết khi đang leo
Hai lối ra đều cần input có dấu: `if (this.feetY >= volume.top - 0.02 && up > 0)` / `else if (this.feetY <= this.climbFloor + 0.02 && up < 0)`. Buông W/S → `up === 0`; và `climbVolume` branch return (210-213) trước khối jump → gravity/jump/drop đều không có. Leo nửa silo 6 m thì phải tụt hết chiều cao để xuống.
Sửa: Space trong branch climb = "release" (`climbVolume = null; falling = true`), và cho phép ra ở đỉnh khi `feetY >= top - 0.02` bất kể `up`.

### C7. [MEDIUM][ĐXN] Rời thang ở đáy dùng `getGroundHeight` (chỉ địa hình) thay vì `groundAt`
`PlayerController.ts:554`: `this.groundY = this.collision.getGroundHeight(p.x, p.z);` — `getGroundHeight` là query địa hình thuần (kèm fallback raycast đắt, `WorldCollision.ts:731-738`); mọi call site khác khi đi dùng `groundAt(x, z, feetY)` (762-769) **chính vì** "deck không phải terrain" (comment 300-304). Thang dựa trên dock/boardwalk/platform → thả người **xuưới** sàn, rồi họ rơi/tái-resolve xuyên nó.
Sửa: `this.collision.groundAt(p.x, p.z, this.feetY)`.

### C8. [MEDIUM][ĐXN] `C` / `Shift` đổi dáng người và gear chạy **mọi lúc**, kể cả khi menu đang mở
`InputController.ts:125-138` lật `crawlLatched`/`runLatched` cho mọi keydown không điều kiện; và callback trong `Game.ts:822-824` là hai callback **duy nhất** không gate `state === PLAYING`:
```ts
this.input.onCrawl((crawling) => { this.player.getController()?.setCrawl(crawling); });
```
Triệu chứng: đang ở settings/map picker, vô tình chạm `C` → nhân vật về sau crawl hoặc sprint không lý do on-screen.
Sửa: gate như `interact`/`cycle`, hoặc gate trong `InputController` khi có UI focus.

### C9. [HIGH][ĐXN] `Tab` và `Space` bị `preventDefault` toàn cục, giết điều hướng bàn phím của mọi menu
```ts
if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.jumpQueued = true; }  // 99-103
if (e.code === 'Tab')  { e.preventDefault(); if (!e.repeat) this.triggerCycle(); }      // 117-120
```
đăng ký trên `window`, không kiểm tra `document.activeElement` hay state. `onCycle` (812-817) gate PLAYING → khi menu mở, Tab **không cycle mà cũng không chuyển focus**: mọi `<button>` trong overlay không tới được bằng bàn phím, focus ring kẹt trong modal. Space cũng vậy (nó là phím activate button chuẩn). Handler `pointerdown` ở dòng 67 **đã có** phép thử `closest('.interactive-ui')` — keydown thì không.
Sửa: `if ((e.target as HTMLElement)?.closest('.screen-overlay, #game-hud, #fishing-layer')) return;` trước `preventDefault` cho Space/Tab (giữ WASD/E/C/V).

### C10. [MEDIUM][AT] Teleport/reset xoá capsule crawl nhưng không xoá input latch → phải nhấn `C` hai lần
`PlayerController.ts:707-709` (`setPosition`) làm `crawlWanted = false; setCrawling(false)` trong khi `InputController.crawlLatched` vẫn `true`. Setter đối ngoại `InputController.setCrawling()` (226) — grep xác nhận **không ai gọi** (`setRunning` 218 cũng vậy). Mà `setPosition` chạy ở mọi map load, respawn, `Mounts.dismount()` (322). Sau đó nhấn `C`: latch lật về `false`, `setCrawl(false)` no-op → người chơi không crawl được cho tới lần bấm thứ hai; HUD indicator (nếu có) thì đảo ngược.
Sửa: `Game` gọi `input.setCrawling(controller.isCrawling())` sau mọi `setPosition`, hoặc bỏ phần reset trong `setPosition`.

### C11. [MEDIUM][AT] Space nhấn lúc pause biến thành cú nhảy ngay khoảnh khắc menu đóng; `interactQueued` là code chết
`consumeJump()` chỉ được gọi trong nhánh PLAYING → `jumpQueued` set từ pause screen sống tới lúc resume. `blur` clears (159) nhưng pause không gây blur. Cùng block có `private interactQueued = false;` (dòng 38) ghi ở 110, xoá ở 160, **không đọc** ở đâu — hợp đồng "giữ phím nhấn giữa hai frame" trong comment của nó không tồn tại.
Sửa: clear `jumpQueued` trong `togglePause()`/`resumeGame()`; xoá `interactQueued` hoặc viết reader `consumeInteract()`.

### C12. [MEDIUM][AT] Không có teardown ở `CameraController` và `InputController`; `onPointerLockLost` không ai đăng ký
Mọi listener ở hai file này đăng bằng arrow inline (`CameraController.ts:189,199,220`; 8 listener window trong `InputController.ts:63-169`) — không giữ handle nên **không thể** remove; `grep -rn removeEventListener src` chỉ ra `main.ts:19-20` và `MainMenu.ts:323`. Dưới Vite HMR (hoặc khi có `Game` thứ hai): hai InputController lật cùng latch mỗi lần bấm phím (C/Shift trông như chết), pause fire hai lần, mỗi mouse delta apply hai lần.
Đáng chú ý nhất: `onPointerLockLost` (dòng 326) **0 caller** → khi browser tự nhả pointer-lock (Alt-Tab), cursor tự do, **đồng hồ săn vẫn chạy**, đường pause duy nhất còn lại là `window` blur (`Game.ts:1528`).
Sửa: giữ bound handler, thêm `dispose()` cho hai class, gọi từ `Game.dispose()`, nối `onPointerLockLost(() => this.togglePause())`.

### C13. [LOW][AT] Chuột phải/middle cũng xoay camera; drag sống sót sau khi mất focus
`pointerdown` (189-197) không kiểm `e.button`; `isDragging` chỉ clear ở `pointerup`/`pointercancel`/`pointerlockchange`, không có `blur` → Alt-Tab khi đang giữ nút thì view tiếp tục theo con trỏ tới cú click kế.
Sửa: `if (e.button !== 0) return;` + clear `isDragging` trong blur.

### C14. [LOW][AT] `loadAnimations` chờ tuần tự 11 clip
`CharacterAnimator.ts:258-289`: `for (const name of clipNames) { const raw = await fetchClip(...) }` → 11 round-trip nối tiếp cho lần load nhân vật đầu (kể cả khi `RAW_CLIPS` đã cache cho các swap sau).
Sửa: `await Promise.all(clipNames.map(loadOne))` — an toàn vì mỗi vòng chỉ đụng `action` của chính nó.

---

## D. NPC, cưỡi ngựa, câu cá

### D1. [HIGH][ĐXN] Thú bốn chân đi tại chỗ vĩnh viễn sau khi đã bước một lần
`locomotion` cho animal **chỉ** được gọi trong `NpcCrowd.walk()` (dòng 566): `actor.animator.locomotion(actor.speed);`. Đường idle không bao giờ gọi `locomotion(0)`: `arrive()`/`startLeg()` gọi `animator.play('Idle')`, mà với `QuadrupedAnimator.play` là **no-op có chủ đích** (`Quadruped.ts:184-186`), nên `speed` module-scoped (dòng 180) giữ giá trị cuối → `wanted = speed > 0.05 ? min(1, speed/0.9) : 0` không về 0 → `motion` ≈1 và `phase += deltaSeconds * cadence * Math.PI * 2` (203) tiếp tục quay → bốn chân đập trong khi thân đứng nguyên.
Đối chứng rõ ràng: `PlayerController.ts:297` gọi `this.animator.locomotion(0, false, this.gait)` khi idle, và `Mounts.ts:334` gọi `mount.animator.locomotion(0)`. Chỉ `NpcCrowd` thiếu.
Sửa: gọi `actor.animator.locomotion(0)` trong các nhánh idle/search của `NpcCrowd.update()`.

### D2. [HIGH][AT] Đàn cá sống sót sau khi rời hồ → koi bơi trong thành phố
`prepare()` chạy mỗi `loadWorld` (`Game.ts:478`) và gọi `end(true)` (chỉ tản cá, không clear), rồi return sớm **trước** `populate()`/`clear()` tại `FishingSystem.ts:175`: `if (mapId !== FISHING_MAP || !water) return;`. `school.ready` vẫn `true`, ≤9 actor skinned clone vẫn trong group `fish-school`. Ở map khác, `fishing.update → school.update` (572) vẫn bơi không có nước (`heightAt` null nên bỏ qua depth clamp).
Sửa: `this.school.clear()` trước return sớm và mỗi khi `mapId !== FISHING_MAP`.

### D3. [MEDIUM][AT] Đoạn "về nhà" của NPC đi thẳng qua tường
`NpcCrowd.ts:618-625`: `actor.target = actor.home.clone()` với chỉ một mẫu `groundAt(home)` — không `isBlocked`, không test đường. Trong khi mọi leg thường được validate end-to-end bởi `legIsWalkable` (674, 641 dùng `collision.isBlocked`/`groundAt`). Wander là random walk nên đường thẳng về `home` hợp pháp cắt qua quầy/cầu thang mép hồ, và `walk()` lao mù theo target.
Sửa: chạy đích home qua `legIsWalkable`, hoặc fallback sang một leg ngẫu nhiên đã validate khi home bị chặn.

### D4. [MEDIUM][AT] `spawnAt` làm `actors` vượt `SCHOOL_SIZE` không trần
`FishSchool.ts:246-261`: `approach()` (236) fallback sang `spawnAt()` khi không có con nào trong 18 m; `spawnAt` push một actor clone mới và không bao giờ gỡ. Đường gỡ duy nhất là `updateLift` khi cá **bị câu** (415). Cá thua trên bar chỉ bị `scatter` về `free` → cast nhiều lần vào vùng vắng shoal, số cá và chi phí mixer/skinning mỗi frame tăng vô hạn, hồ visibly đầy.
Sửa: khi `actors.length` sắp vượt `SCHOOL_SIZE`, recycle một actor `free` thay vì clone.

### D5. [MEDIUM][AT] `clear()` dispose mixer nhưng không dispose skeleton clone → rỉ GPU
`FishSchool.ts:420-431`: `makeActor` clone rig bằng `SkeletonUtils.clone` (137) → mỗi con cá có `Skeleton` riêng (bone texture riêng). `clear()` làm `group.remove`, `mixer.stopAllAction()`, `mixer.uncacheRoot()` nhưng không `mesh.skeleton.dispose()`. Comment 425-427 đúng khi nói geometry dùng chung thì không được free — nhưng skeleton clone thì có. `populate()` (kéo theo `clear()`) còn chạy mỗi lần người chơi dời đàn (282).
Sửa: traverse root bị gỡ và `skeleton.dispose()` cho skinned mesh (để nguyên geometry/material).

### D6. [MEDIUM][AT] `dispose()` khi đang cưỡi ngựa bỏ người chơi lơ lửng ở yên
`Mounts.ts:414-420`: đặt `this.riding = null` và huỷ mounts nhưng **không** đi qua nhánh `dismount()` (320-322) vốn gọi `player.setPosition(..., ground + 0.05, ...)` và tắt pose ngồi. `Game.ts:364` chỉ gọi `mounts.dispose()`. Đổi map/restart khi đang cưỡi → player group giữ vị trí + chiều cao yên ngựa và pose `Driving`.
Sửa: `if (this.riding) this.dismount();` đầu `dispose()`.

### D7. [MEDIUM][AT] `Quadruped` tích pha theo **thời gian**, trái với hợp đồng "một chu kỳ phủ đúng quãng đã đi"
Header (13-18) và phép sải (200-201: `stride = speed/cadence`, `wantedAmp = asin(stride/(2·legLength))`) xây trên giả định đó, nhưng `phase += deltaSeconds * cadence * Math.PI * 2` (203) tích cadence theo thời gian. Khi Mounts feed `travelled` thực tế mỗi frame (370-371) — tức mọi tình huống tăng/giảm tốc và quay đầu của ngựa cưỡi — pha foot-fall và số mét đã đi lệch nhau và chân trượt. Với NPC đi đều thì gần đúng; với con ngựa người chơi điều khiển thì sai hệ thống.
Sửa: tiến pha theo `2π · distanceTravelled / stride` (cần stride chu kỳ trước) hoặc tích luỹ khoảng cách.

### D8. [MEDIUM][AT] Rod holder không bao giờ rời xương tay ngoài lúc dispose hẳn
`FishingRod.ts:127-148`: `begin() → attach()` parent `holder` vào bone `RightHand` (`FishingSystem.ts:255`). `end()/hide()` chỉ `holder.visible = false`; `body`, `tip` và mesh của chúng vẫn trong subtree xương của player qua cả session và cả map khác, vẫn được biến đổi theo tay mỗi frame. `detach()` tồn tại nhưng chỉ tới từ `dispose()`.
Sửa: gọi `detach()` (hoặc `holder.removeFromParent()`) trong `FishingSystem.end()`.

### D9. [MEDIUM][AT] Bầy người/hậu mãi chạy không nhìn khoảng cách, không nhìn Quality, và cố tình không bị cull
`Game.ts:1270` gọi `npcs.update()` **trước** gate `state === PLAYING` → cả crowd chạy trong pause menu, trong cutscene thiết lập, và khi người chơi cách 100 m. Không LOD, không cull theo frustum/khoảng cách, không hook Quality (`QUALITY_PRESETS` chỉ đụng shadows/pixel ratio — `Quality.ts:27`). Trầm trọng hơn, `attach` đặt `part.frustumCulled = false` (`NpcCrowd.ts:426`) và `stopCullingAnimatedParts(unit)` (427) cho **mọi** skinned part → NPC ngoài màn hình vẫn luôn được submit. Chi phí: ~5 người × ~5 skinned mesh + 4 quadruped, mỗi người chạy một `AnimationMixer` đầy đủ (~58 quaternion track/bone) mỗi frame.
Sửa: skip `animator.update`/`renderer` submit cho actor ngoài ngưỡng khoảng cách (đó là **bỏ công việc vô hình**, không hạ chất lượng — nằm trong `MEMORY.md:21`), và gate ngân sách crowd theo preset.

### D10. [LOW][AT] Một clip JSON thiếu là mất cả một nhân vật
`KitClips.ts:169`: `await Promise.all(clipNames.map(loadClip))` — `anim-idle/walk/talking.json` mà 404 một cái thì promise reject, `NpcCrowd.attach` catch (461-463) và **bỏ luôn người đó** (không đi, không hỏi được). Fail-soft đúng là degrade về Idle.
Sửa: `Promise.allSettled`, dựng track cho clip nào load được.

### D11. [LOW][ĐXN] Getter `actions` cấp phát mỗi lần gọi; vài allocation lặp lại
`Mounts.ts:135` `return this.mounts.map(...)` và `NpcCrowd.ts:272` — array mới mỗi access; selector đọc actions khi chọn đích → garbage đều đặn. `NpcCrowd.claimed` (`Mounts.ts:140`) tạo `new Set` mỗi lần; `nearestIdle` (`NpcCrowd.ts:597`) tạo `new THREE.Vector3()` **cho mỗi candidate**: `other.unit.getWorldPosition(new THREE.Vector3()).distanceTo(here)`; `Mounts.face()` (392) `parent.getWorldQuaternion(new THREE.Quaternion())` mỗi frame khi đang cưỡi — trong khi chính file NpcCrowd đã có pattern `_parentQuat` module-scratch (720).
Sửa: cache/lazily-rebuild mảng actions, dùng scratch.

---

## E. Save & settings

### E1. [MEDIUM][ĐXN] Một file save hỏng tắt **toàn bộ** khả năng lưu cho mọi session về sau
```ts
} catch {
  // Private mode, a full quota, or a value written by a different build.
  this.available = false;                 // Storage.ts:161-174
}
```
catch gộp hai trường hợp khác bản chất: "localStorage không đọc được" (đúng, nên tắt) và "blob đọc được nhưng parse lỗi / thiếu field" (sai khi tắt). Với case sau, `flush()` (264-272) bị `if (!this.available) return;` chặn vĩnh viễn — game chơi tiếp, không ghi gì, và **cái ghi duy nhất có thể sửa file hỏng chính là cái vừa bị tắt**. Người dùng có một file save cụt sẽ mất trí nhớ âm thầm mãi mãi.
Sửa: khi parse fail thì giữ `available = true`, dùng defaults, để `flush()` kế tiếp ghi đè.

### E2. [MEDIUM][ĐXN] Cài "tắt shadow" bị Auto âm thầm bật lại
`Game.applySettings` (`Game.ts:256-265`) honour toggle qua `quality.setShadows(settings.shadows)` (260), patch vào `preset.shadows` (`Quality.ts:177-181`). Nhưng mỗi lần scaler bước preset: `this.preset = { ...QUALITY_PRESETS[LADDER[this.autoStep]] }` (235, 241; tương tự `setLevel` 165) dựng preset từ bảng → `shadows: true` trở lại cho medium/high, và `Game` không hề được hỏi lại (`onPresetChange → applyPreset()` chỉ đưa cái preset đã mutate cho `sun.apply`).
Triệu chứng: tắt shadow trong settings, shadow tự về sau vài giây trong round.
Sửa: tách `shadowsOverride` khỏi preset và re-apply mỗi lần preset bị dựng lại.

### E3. [MEDIUM][ĐXN] Săn được đo bằng delta đã clamp, các timer khác dùng đồng hồ tường thuật
`GameLoop.ts:50`: `delta = Math.min(0.1, Math.max(0, frameMs / 1000))` — đúng cho vật lý, sai cho `roundManager.update(delta)` (1332) vì `elapsed` thành `bestSeconds` (879). Máy chạy một phần round dưới 10 fps sẽ có đồng hồ chậm hơn thực, và record time của nó **nhanh hơn một cách không thể tranh cãi** so với máy mượt. Cùng màn hình đó lại pha `titleUntil` (1276, 1063) so `performance.now()` thô — hai đồng hồ trong một màn.
Sửa: elapsed của round theo wall-clock trừ dần khoảng paused.

---

## Phụ: những chỗ tôi (và agent) đã tìm mà **không** có bug

Ghi lại để lần sau khỏi nghi ngờ lại:
- `GameLoop.ts:39-66`: delta clamp hai đầu, `start()` re-stamp `lastTime`, `onFrameTime` chạy trước render (đúng fix chống flash đen trong `ARCHITECTURE.md`) → không spiral-of-death, không delta âm frame đầu.
- Teardown map: `WorldLoader.ts:162-170, 257-288` + `Game.ts:352-361` traverse và dispose geometry/material/texture/skeleton/author lights, kèm `renderLists.dispose()` → không thấy VRAM leak theo map.
- Replay đúng map đang load (`Game.ts:624-631`) không double-load.
- `Storage.clamp`/`readSettings`/`readProgress` (93-149) dùng `Number.isFinite` khắp nơi → không NaN/Infinity lọt vào transform.
- Pickup trùng một item bị chặn ở **hai** tầng (`RoundManager.ts:123` `!i.found`, `InteractableSelector.ts:229` skip).
- TAB cycle (`InteractableSelector`) vẫn trong khoảng kể cả khi `selectedKey` null/ngoài danh sách (`findIndex === -1` → wrap 0).
- Strike lặp trên cùng một prop bị chặn bởi set `rejected`; hint không bao giờ cạn vì có line fallback (`Game.ts:1465-1471`) và `hinted` được clear ở `beginHunt` (1019).
- `NpcCrowd.walk()` guard `distance < 0.2` trước `dx/distance` (543-552); `legLength = max(0.01, …)`; `Quadruped` clamp mọi divisor và input `asin` (171, 200-201); `Mounts` chia cho `max(delta, 1e-4)`; `FishSchool.steer` guard `distance > 0.05`. Không có NaN từ chia 0 ở các đường này.
- `CharacterAnimator.play()` (652-671) đúng trên three r170: `AnimationAction.reset()` **không** xoá `timeScale` (đã mở `node_modules/three/src/animation/Action.js:90-101` kiểm), nên các rate ở 717/733/746/751 có hiệu lực. Mixer được update đúng **một** lần mỗi frame (212/221/318/452 loại trừ nhau).
- Mọi overlay ẩn bằng `display:none` (`.screen-overlay.hidden`, `#game-hud.hidden`, `.found-screen.hidden`, `.dialogue-panel.hidden`; `#fishing-layer`/`hud-container` `pointer-events:none`) → không có overlay `opacity:0` ăn click.
- `escapeHtml` được áp trước mọi `innerHTML` từ data; schema save không có field text tự do → đường XSS qua tên profile/map **không tồn tại** (nhưng xem 04 để biết vì sao nó dễ tái mở).
- Trạng thái fishing không vào được hai lần (`begin` gate bởi `animator.beginFishing()` ở `FishingSystem.ts:248`), và `retrieveAfter`'s `setTimeout` guard `phase === 'idle'` (402) → timer cũ không làm UI sai.
