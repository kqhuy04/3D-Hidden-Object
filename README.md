# Odd Objects 🔍

> Low-Poly 3D Hidden-Object Hunt for Windows Desktop (MSI First)

Odd Objects is an offline, casual 3D exploration game built with **Three.js**, **TypeScript**, **Vite**, and **Tauri 2**. Each map hides five objects that do not belong to it — a toaster in a forest, a wooden barrel in a chrome arcology, a vending machine in a timber settlement. The player walks the map, notices what is wrong, and pockets it. Twenty-two maps ship, and every one of them hides five objects.

---

## 🎮 Core Gameplay

1. **Five intruders per map:** every authored map hides exactly five objects taken from a different theme. They are placed against real furniture — on a picnic table, in a kayak, wedged between crates — so the challenge is noticing, not pixel-hunting.
2. **No shopping list:** the HUD shows five `???` slots. An object's name is revealed only once it is in your pocket, so you are hunting *wrongness*, not ticking off nouns.
3. **Pick up with E:** walk within reach, put the crosshair on the object, press **E**. It disappears from the world for good and the slot flips to its name.
4. **No countdown:** the clock counts *up*. Rushing past the thing you are meant to notice is the wrong instinct, so nothing is timing you.
5. **Ask a local:** the people in a map are not scenery. Walk up to one and press **E** — they stop, turn, and describe one still-missing object without naming it ("A box that browns bread and pops it up — and it wants a wall socket"). Each of the five is described once, nearest first, so nobody is stuck forever. Two maps ship no rigged people at all — **Chronos Hearth** and the **Japanese street** — so there the hunt is eyes only.
6. **Touch the world:** doors open, wheels turn, lanterns light, bells ring, and a saddled horse can be ridden around the map with its own gait.
7. **Finish:** when the fifth object is pocketed the results card shows the time you took and the names of all five.

---

## 🕹️ Controls

| Input | Action |
|---|---|
| **W / S / A / D** or **Arrow Keys** | Walk Forward / Backward / Left / Right in 3D |
| **Pointer Drag** (Mouse or Touch) | Orbit / Aim Camera (Yaw & Pitch) |
| **Mouse Wheel** | Zoom Camera In / Out (3m to 14m) |
| **SPACEBAR** | Jump |
| **E** | Pick up the object nearest in reach — or open a door, light a lantern, ride a horse, ask a person |
| **TAB** | Cycle between the things in reach when several are close |
| **SHIFT** | Toggle between walking and running |
| **C** | Toggle the crawl |
| **V** | Toggle first / third person |
| **ESCAPE** or **Pause Button** | Pause / Resume (stops the hunt clock) |

---

## 🛠️ Tech Stack & Architecture

- **Rendering:** Three.js (v0.170+)
- **Language:** TypeScript (v5.7+)
- **Frontend Tooling:** Vite (v6.0+)
- **Desktop Packaging:** Tauri 2 (Windows MSI & NSIS)
- **Audio Engine:** Procedural Web Audio API synthesizer (zero external sound files)
- **Testing:** Vitest (56 automated unit tests across collision, camera, movement, jump and the hunt's round state)
- **3D Assets:** 21 Polyfork kits (see [Asset Inventory](docs/ASSET_INVENTORY.md)), the Family Road-Tripper (`family-road-tripper-247570`), and 37 CC BY props in `public/assets/hidden/` (credits in `public/assets/hidden/CREDITS.md`)

---

## 📦 Getting Started

### Prerequisites
- Node.js >= 18 (recommended Node.js 22+)
- Rust & Cargo (for Tauri desktop builds)
- WiX Toolset v3.11+ (for Windows MSI packaging)

### Installation
```bash
# Clone the repository
git clone <repo-url>
cd "Photo Hunt"

# Install dependencies
npm install
```

### Running Development Server
```bash
npm run dev
```
Open `http://localhost:1420` in your web browser. Append `?debug=1` for real-time diagnostic telemetry (FPS, coordinates, object distances, draw calls). No desktop runtime is needed — this is the only way to run the game.

### Running Automated Unit Tests
```bash
npm test
```

### Production Frontend Build
```bash
npm run build
```

### Building Windows Executable & MSI
The Tauri desktop shell was removed — the game runs in the browser. `npm run
build` produces a static site in `dist/`; serve it with any static host (or
`npm run preview` to check it locally).

### The gacha mini-game
`gacha/` is a separate app in the same repo (its own port, its own assets, its
own README). It has no `package.json` of its own — it borrows the root
`node_modules`:

```bash
npm run dev:gacha     # -> http://127.0.0.1:5180
npm run build:gacha   # -> gacha/dist/
npm run typecheck     # both apps
```

---

## 📄 Documentation

- [Hidden Objects](docs/HIDDEN_OBJECTS.md): the hunt's data model, where all fifteen objects are, and how to author a new map.
- [Asset Inventory](file:///docs/ASSET_INVENTORY.md): Comprehensive inventory of models, skeletons, and animation tracks.
- [Technical Decisions](file:///docs/TECHNICAL_DECISIONS.md): Architectural evaluation of starter repos, physics, and Polyfork integration.
- [Third-Party Notices](file:///docs/THIRD_PARTY_NOTICES.md): Open source licenses and Polyfork asset credits.
- [Test Report](file:///docs/TEST_REPORT.md): Build results, automated unit test verification, and test checklist.

---

## ⚖️ License
Game codebase is licensed under the MIT License. Polyfork 3D assets are used in accordance with the Polyfork Commercial License and CC BY 4.0; the credit lines for the free meshes are listed in `public/assets/hidden/CREDITS.md`.
