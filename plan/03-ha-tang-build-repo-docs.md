# 03 — Hạ tầng, build, repo, tài liệu

Phạm vi: `package.json`, `tsconfig.json`, `vite.config.ts`, `src-tauri/`, `.gitignore`, `.git`, `README.md`, `docs/`, `.workbuddy-ai/memory/`.
Tất cả số liệu dưới đây do tôi chạy trực tiếp trên máy (read-only, trừ việc tôi chạy `npm run build` nên `dist/` bị dựng lại — xem ghi chú cuối file).

---

## A. Build & chất lượng cổng kiểm tra

### A1. [HIGH] Không có CI, và không bước nào chạy `tsc` ngoài `npm run build`
- `package.json` scripts: `dev`, `build` (`tsc && vite build`), `preview`, `test` (`vitest run`), `tauri`.
- `npm test` = vitest, **transpile-only, không type-check**. Toàn bộ 118 test xanh trong khi code không compile được.
- Không tồn tại `.github/`, không `.gitlab-ci.yml`, không workflow nào.
- Hệ quả thực đo được trong phiên audit này: lúc 19:36 `npx tsc --noEmit` báo **2 lỗi** trong `src/game/fishing/FishSchool.ts` (`TS2741` tại 181, `TS1205` tại 464) → `npm run build` fail → `npm run tauri build` fail (vì `beforeBuildCommand: "npm run build"` trong `src-tauri/tauri.conf.json`). Đến 19:45 một phiên làm việc khác đã sửa 2 lỗi đó trong lúc tôi đang audit, nên hiện tại `tsc` sạch.
- Nói cách khác: **một lỗi làm hỏng hoàn toàn việc đóng gói có thể nằm trên `master` bao lâu cũng được, vì không ai chạy build.**

Phục vụ:
```jsonc
// package.json
"scripts": {
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "check": "npm run typecheck && npm run test",
  "build": "tsc && vite build"
}
```
Kèm một CI tối giản (2 job: `npm ci && npm run typecheck && npm run test`, và `npm run build`) — với game desktop, build fail là lỗi nghiêm trọng nhất có thể lọt.

### A2. [MEDIUM] Không có lint/format
Không có ESLint/Prettier/Biome config nào (`ls` không tìm thấy). `noUnusedLocals` và `noUnusedParameters` đều đang `false` trong `tsconfig.json`, nên biến chết không bị báo. Đây không phải lý thuyết: `InputController.interactQueued` và `Game.pickupTarget` được ghi nhưng không đọc ở đâu trong `src/` (xem 02-bugs-logic.md); không công cụ nào bắt được.

Đề xuất: bật `"noUnusedLocals": true` — đây là cờ rẻ nhất để bắt đúng lớp lỗi này. (Lưu ý: có thể phải xoá vài biến chết trước khi nó xanh.)

### A3. [LOW] Không có `vitest.config.*`, test và build dùng chung `vite.config.ts`
`vite.config.ts` chứa cấu hình Tauri (`strictPort`, `hmr`, `TAURI_DEV_HOST`). Không hỏng, nhưng test chạy trong cùng cấu hình đó; nếu sau này cần environment jsdom cho UI test thì sẽ phải tách. Đáng cân nhắc khi bắt đầu test tầng UI (hiện tại 15 file test **không có** test cho `src/ui/*` và không có test cho `InteractableSelector`).

---

## B. Kích thước repo và asset

Số đo từ `git ls-tree -r -l HEAD`:

| Đường dẫn | Dung lượng track trong git | Bản chất |
|---|---|---|
| `public/` | **76.7 MB** | thứ game thật sự cần |
| `assets-source/` | **58.9 MB** | trung gian, không cần lúc chạy |
| `extracted_kit/` | **39.9 MB** | trung gian, không cần lúc chạy |
| `docs/` | **34.6 MB** | ảnh screenshot minh hoạ |
| `raw-anims/` | 5.9 MB | FBX nguồn |
| `maps/` | 3.3 MB | (`maps/work/` đã ignore) |
| `src/` | **0.7 MB** | code |
| **Tổng** | **224 MB** | `.git` = 175 MB |

### B1. [MEDIUM] Git LFS đã cài nhưng không dùng; không có `.gitattributes`
- `git config` có `filter.lfs.clean/smudge/process` và `filter.lfs.required true`, nhưng `git lfs ls-files` trả về **rỗng**.
- `.gitattributes` không tồn tại (file trống).
- Kết quả: 3 file `.glb` ~20 MB nằm thẳng trong object database (`extracted_kit/scene.glb`, `assets-source/scene-floated.glb`, `assets-source/scene-kit-original.glb`), và `extracted_kit/scene.glb` trùng blob với `assets-source/scene-kit-original.glb` (git dedup nên chỉ mất một lần — may, nhưng không phải chủ ý).
- Clone/fetch của bất kỳ ai kéo theo ~175 MB lịch sử. Với team 2 người + một game desktop, đây là chi phí thật mỗi lần setup.

### B2. [MEDIUM] `assets-source/` + `extracted_kit/` = 99 MB trung gian đang được track
`.gitignore` giải thích rất đúng rằng `maps/work/` (807 MB) là đầu ra trung gian của `tools/prepare-maps.mjs` và không nên vào repo — nhưng lại quên mất đúng hai thư mục cùng loại ở cấp cao hơn. Đây là điểm mù "ignore theo tiền lệ" chứ không phải theo quy tắc: quy tắc là *đầu ra sinh lại được thì không track*, và `prepare-maps.mjs` sinh lại được cả hai thư mục này từ các archive trong `maps/`.

Đề xuất (cân nhắc, vì xoá lịch sử là thao tác không đảo ngược):
1. Thêm `assets-source/`, `extracted_kit/`, `raw-anims/` (nếu FBX có thể tải lại) vào `.gitignore` và `git rm -r --cached` — từ nay repo mới nhẹ đi ~105 MB.
2. Nếu muốn giữ bằng chứng nguồn: chuyển sang LFS thật (thêm `.gitattributes` với `*.glb filter=lfs diff=lfs merge=lfs -text`, `*.fbx`, `*.zip`) **trước** khi các file mới hơn được commit.
3. Không `filter-repo`/`gc --aggressive` để "làm sạch" lịch sử nếu chưa backup — đây là thao tác phá huỷ, chỉ làm khi cả team đồng ý.

### B3. [LOW] Ảnh minh hoạ nằm sai chỗ
- `docs/` chứa **34.6 MB** PNG, gồm cả những loạt ảnh so sánh before/after của một lần sửa đã xong (`boats-1-canoe-after.png`, `hammock-1-stand.png`, `collision-debug-tower.png`, hàng loạt `docs/hunt/*.png`). Chúng là evidence của commit, không phải tài liệu sống.
- Ảnh screenshot UI từng nằm ở thư mục gốc (`ui-1-menu.png` … `ui-7-hudstate.png`, `flow-*.png`) — hiện đã được xoá trong working tree (`git status` báo `D`), hướng đi đúng.
- `docs/bench-1-midjump.png` và các file `tmp-*.png` ở gốc: `tmp-*` đã ignore, nhưng file này thì không.

Đề xuất: giữ ảnh trong `docs/` nhưng nén (PNG → WebP/AVIF lossless thường giảm 60–70%), hoặc chuyển sang release/attachment. Không ảnh hưởng game, nhưng ảnh hưởng tốc độ clone.

### B4. [INFO] Payload thật của game
- 22 map = 60.7 MB GLB (21 file `public/assets/maps/*.glb` + 1 `environment/scene.glb` cho `campground-lake`), **đã** dùng `KHR_draco_mesh_compression`, `imgs: 0` (không texture, chỉ màu vật liệu) → đã tối ưu đúng hướng.
- `dist/` = 78 MB, `index.js` = 864 KB (232 KB gzip) — Vite cảnh báo chunk > 500 KB. Với app Tauri offline thì gần như vô nghĩa; **đừng** code-split cho vui, chỉ đáng tách nếu sau này có thứ load theo từng map.
- Kiểm tra offline: `grep` toàn `src/` → **0** URL `http(s)://` nào được fetch lúc chạy; chỉ 2 chỗ `fetch()` là KitClips và CharacterAnimator đọc clip JSON cục bộ. Đúng cam kết "offline, casual" trong README.

---

## C. Cấu hình Tauri / đóng gói Windows

`src-tauri/tauri.conf.json`:

### C1. [MEDIUM] Thương hiệu lệch ba nơi
`productName: "Photo Hunt"`, `identifier: "com.photohunt.game"`, window `title: "Photo Hunt"` — trong khi `index.html` là `<title>Odd Objects</title>` và README là **Odd Objects**. Người dùng Windows thấy taskbar/Alt-Tab và tên file MSI là "Photo Hunt".
Quan trọng hơn: `identifier` **là** đường đăng ký app và vị trí dữ liệu trên Windows; đổi nó về sau nghĩa là mất vị trí save cũ. Nếu còn định đổi tên thì đổi **bây giờ**, trước khi có người dùng thật.

### C2. [MEDIUM] Không có lựa chọn toàn màn hình, và cửa sổ không cấu hình `devtools`
- `grep "fullscreen"` trong `src/` và `src-tauri/src/`: **0 kết quả** (chỉ xuất hiện trong `src-tauri/gen/schemas/*.json` sinh tự động). `lib.rs` không có command nào. `"fullscreen": false` cứng trong config.
- Settings (`Storage.ts:20-40`) chỉ có `quality, shadows, fov, sensitivity, volume, showFps, character`. Một game desktop Windows không có fullscreen (hay biên độ cửa sổ không viền) là thiếu sót UX, không phải bug.
- `minWidth/minHeight` 800×600 hợp lý.

### C3. [LOW] `security.csp: null` + `withGlobalTauri: true`
`csp: null` nghĩa là không có Content-Security-Policy. Với app load `devUrl`/asset cục bộ, không mạng, rủi ro thấp. Nhưng `withGlobalTauri: true` exposes `window.__TAURI__` cho **mọi** script chạy trong webview, và code chỉ dùng nó ở đúng một chỗ (`Game.ts:727` — `import('@tauri-apps/api/window')`, thực ra không cần global). Chuỗi tấn công giả định: một tên map/character từ file save được ghép vào `innerHTML` → gọi IPC. **Tôi kiểm tra và chưa tìm thấy đường injection nào đang mở**: mọi chuỗi từ data đi vào `innerHTML` đều qua `escapeHtml`, và schema save không có trường text tự do nào. Vì vậy đây là phòng ngừa, không phải sửa gấp.
Đề xuất rẻ: `withGlobalTauri: false` (app dùng ESM import, không dùng global), và đặt CSP `'self'` cho hết.

### C4. [LOW] Bundle targets `["msi", "nsis"]` nhưng README chỉ hướng dẫn MSI
`npm run tauri build -- --bundles msi` trong README; config build cả hai. Không sao, chỉ là tài liệu lệch với cấu hình.

---

## D. Tài liệu lệch với mã thật (doc drift)

Đây là loại lỗi "không ai bị crash nhưng mọi người đọc sai". Tôi kiểm từng claim:

| Nơi | Nói | Thật |
|---|---|---|
| `README.md:45` | "56 automated unit tests" | **118 test / 15 file** (đo bằng `vitest run`) |
| `docs/TEST_REPORT.md:26-27` | "4 files passed (4), 22 tests passed" | 15 / 118 |
| `docs/TEST_REPORT.md:70` | "`tsc --noEmit`: Clean, 0 errors" | Đúng lúc tôi viết file này thì đúng; nhưng báo cáo đóng băng một trạng thái đã sai hồi 19:36 — xem A1 |
| `README.md:98` | "where all **fifteen** objects are" | **110** object / 22 map (`tests/Content.test.ts` cũng ghi 110) |
| `README.md:99-102` | link `file:///docs/ASSET_INVENTORY.md` v.v. | Link tuyệt đối kiểu máy cục bộ; trên mọi máy khác và trên GitHub đều **gãy**. Phải để `docs/ASSET_INVENTORY.md` |
| `docs/HIDDEN_OBJECTS.md:442-444` | công cụ verify dùng `findTarget` của game | `HiddenItemSystem.findTarget` (dòng 151) **0 call site** trong `src/`; đường thật là `InteractableSelector` với cách chấm điểm khác |
| `docs/HIDDEN_OBJECTS.md:456` | "Hint appears at 5:01 of hunt time" | Hints đến từ NPC, đồng hồ hint đã bỏ (commit `f3348ce`, và `MEMORY.md:20` ghi rõ) |
| `MEMORY.md:26-28` | mô tả `Interactions.ts` | File đã **xoá** (`git status`: `D src/game/interact/Interactions.ts`), thay bằng `src/game/interact/InteractableAction.ts` |
| `ARCHITECTURE.md:272-275` | "All 22 maps sweep clean via `tmp-sweepall.mjs`", "`tmp-climbcheck.mjs` is the ladder gate" | **Cả hai harness không còn tồn tại** trên đĩa. Tuyên bố "sweep clean" hiện không tái lập được |
| `hiddenItems.ts:10` | dẫn `tools: tmp-props.mjs` | Không tồn tại |

Hai mục cuối đáng chú ý hơn một typo: **bộ cổng kiểm chứng (gate) mà memory coi là chuẩn đã bị xoá theo chính sách `tmp-*`**. `ARCHITECTURE.md` tự viết "A harness worth kept graduates to `tools/`" — `tmp-sweepall.mjs` là thứ nên tốt nghiệp nhất (nó là regression sweep 22 map duy nhất) nhưng vẫn nằm ở prefix `tmp-` rồi bị dọn. Đề xuất: tái sinh nó trong `tools/sweep-maps.mjs` và gọi từ CI/local trước khi sửa collision.

Chính xác hoá (tôi viết lại đoạn này sau khi tự kiểm `ls tools/` — 20 file, không có `sweep-maps.mjs`): cổng **grounding** thì đã tốt nghiệp và vẫn còn — `tools/audit-grounding.mjs`, Node-only, ~2 s/map, đọc danh sách map từ đĩa. Hai thứ còn thiếu của nó: (a) nó **chỉ in**, không `process.exit(1)`, nên không thể làm gate CI; (b) nó đo **GLB trên đĩa**, tức trạng thái *trước* khi `settleProps`/`applyPropShifts` sửa lúc load — nên nó không biết một authored fix có còn khớp node nào không (chi tiết trong `01` W2). Cái mất thật là cổng **browser sweep** (spawn đứng được + thân di chuyển + 5 item pickable).

---

## E. Trạng thái working tree (cảnh báo khi đọc cả 4 file còn lại)

Version audit này chạy trên một **tree đang chuyển động**:

- `git status` = 41 mục: 18 file `src/` đã sửa, `Interactions.ts` và 7 ảnh bị xoá, và **cả một tính năng câu cá chưa commit**: `src/game/fishing/` (FishSchool, FishingRod, FishingSystem — ~53 KB), `src/data/fishing.ts`, `src/ui/FishingMinigame.ts`, `DialoguePanel.ts`, `PortraitBooth.ts`, `InteractableAction.ts`, `public/assets/fish/`, `public/assets/props/`, `public/assets/anims/anim-fishCast.json`.
- Chênh lệch chưa commit: **1935 insertions / 718 deletions / 27 file**.
- `Game.ts` lớn từ 1489 → 1569 dòng **ngay giữa phiên audit** (tôi phát hiện và agent lifecycle đã re-verify theo).
- Vì vậy: **mọi số dòng trong các file này là ảnh chụp lúc ~19:45 ngày 13-11-2026**, và các kết luận về code câu cá có độ tin cậy thấp hơn phần còn lại — nên re-check trước khi sửa.
- `git status` của harness đầu phiên báo "working-tree cleanliness is unknown" vì có git content filter (`filter.lfs.required true`) được bật.

### Ghi chú về thao tác của tôi
- Tôi **không** sửa file nào trong `src/`, `docs/`, `public/`.
- Tôi **có** chạy `npm run build` để xác minh A1 → `dist/` bị dựng lại từ trạng thái WIP lúc 19:45. Nếu có phiên khác đang đo đạc trên `dist/` cũ, nó đã bị thay. Chạy `npm run build` lại sau khi WIP ổn định là đủ.
