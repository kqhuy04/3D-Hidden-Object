import * as THREE from 'three';
import { GameState } from './GameState';
import { GameLoop } from './GameLoop';
import { WorldLoader } from '../world/WorldLoader';
import { WorldCollision } from '../world/WorldCollision';
import { CollisionDebugView } from '../world/CollisionDebugView';
import { Player } from '../player/Player';
import { CameraController } from '../player/CameraController';
import { InputController } from '../input/InputController';
import { RoundManager, RoundStatus, MAX_STRIKES } from '../missions/RoundManager';
import { HiddenItemSystem, HiddenItem } from '../missions/HiddenItemSystem';
import { InteractableSelector, Candidate } from '../missions/InteractableSelector';
import { collectPropTargets } from '../missions/PropTargets';
import { RenderQuality } from '../render/Quality';
import { SunShadows } from '../render/SunShadows';
import { Atmosphere } from '../render/Atmosphere';
import { TargetGlow } from '../render/TargetGlow';
import { NpcCrowd } from '../npc/NpcCrowd';
import { moodFor } from '../../data/mapMood';
import { HiddenItemPlacement, hiddenItemsFor } from '../../data/hiddenItems';
import { UIManager } from '../../ui/UIManager';
import { GAME_CONFIG } from '../../data/gameConfig';
import { MapEntry, resolveMap } from '../../data/mapRegistry';
import { SaveStore, Settings } from '../../app/Storage';
import { characterFor, characterModelUrl } from '../../data/characters';
import { AudioEngine } from '../../app/audio/AudioEngine';

/** Seconds of hunting before the first vague hint appears. */
const HINT_FIRST_AT = 300;
/** Seconds between the following hints. */
const HINT_INTERVAL = 75;
/**
 * Height above the body's feet that counts as "the player" for reach.
 *
 * Chest height, not eye height: the arms are what pick the thing up, and the
 * body position the player controller reports is the soles.
 */
const REACH_CHEST_HEIGHT = 1.1;
/**
 * How far a hand reaches, in metres, measured from the chest.
 *
 * 2.8 m is an arm plus a stride — the distance at which something is at your
 * fingertips rather than across the room. Shared by the hunt objects and the
 * decoys: if a prop were reachable and the five were not, the reach itself
 * would give the answer away.
 */
const REACH_DISTANCE = 2.8;

const _reachOrigin = new THREE.Vector3();

export class Game {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private worldLoader: WorldLoader;
  private collision: WorldCollision;
  private collisionDebug: CollisionDebugView;

  private player: Player;
  private cameraController: CameraController;
  private input: InputController;

  private roundManager: RoundManager;
  private hiddenItems: HiddenItemSystem;
  private ui: UIManager;
  private loop: GameLoop;

  private state: GameState = GameState.MENU;
  private isLoaded = false;

  /** The map this session is playing, chosen in the picker or with ?map=<id>. */
  private map: MapEntry;
  /** The scene graph of the current map, so a swap can remove it again. */
  private worldGroup: THREE.Group | null = null;
  /** The character is loaded once and kept across map changes. */
  private playerReady = false;
  /** Which roster entry the loaded body is actually wearing. */
  private characterId = '';
  /** An in-flight model swap, so two rounds cannot start two loads. */
  private characterSwap: Promise<void> | null = null;
  /** Where to go back to when the map picker closes. */
  private pickerReturn: GameState = GameState.MENU;
  /** Guards against a second click while a map is still loading. */
  private switching = false;
  /** Object under the crosshair, refreshed once per frame. */
  private pickupTarget: HiddenItem | null = null;
  /** Objects whose hint has already been revealed, in reveal order. */
  private hinted = new Set<string>();
  /** Elapsed seconds at which the next hint is due. */
  private nextHintAt = HINT_FIRST_AT;
  /** Guards a second restore while the five meshes are still loading. */
  private restoring = false;
  /**
   * Everything the player can point at, and which one E will act on.
   *
   * The hunt's five objects are only part of the list now: every small prop in
   * the map answers to the same prompt, which is what stops the prompt from
   * being a giveaway.
   */
  private selector = new InteractableSelector();

  /** Everything that survives closing the tab: settings and per-map records. */
  private save = new SaveStore();
  /** Owns pixel ratio, shadows and the adaptive resolution ladder. */
  private quality: RenderQuality;
  /** The sun, and the shadow map that follows the player. */
  private sun: SunShadows;
  /** Sky, fog and weather for the map that is loaded. */
  private atmosphere: Atmosphere;
  /** Makes the object under the reticle glow, in the scene itself. */
  private glow = new TargetGlow();
  /** The people the kit already placed in the map, walking about. */
  private npcs: NpcCrowd;
  /** Where the settings sheet was opened from, so closing it goes back there. */
  private settingsReturn: GameState = GameState.MENU;
  /** Smoothed frame rate for the HUD readout. */
  private fpsSmoothed = 60;
  private audio = AudioEngine.getInstance();

  constructor(container: HTMLElement) {
    this.container = container;
    const params = new URLSearchParams(window.location.search);
    // ?map= wins, then wherever the player left off, then the first map. A
    // returning player should not have to find their place again every session.
    this.map = resolveMap(params.get('map') ?? (this.save.progress.lastMap || null));

    // 1. Three.js Renderer setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // Shadow maps are rebuilt on demand rather than every frame: a shadow map
    // lives in light space and does not depend on the camera, so redrawing it
    // sixty times a second was redrawing an unchanged picture. `SunShadows`
    // decides when it is actually stale.
    this.renderer.shadowMap.autoUpdate = false;
    this.container.appendChild(this.renderer.domElement);

    // 2. Scene & Camera setup
    this.scene = new THREE.Scene();
    // Background and fog are set by `Atmosphere`, immediately below, from the
    // loaded map's hour and weather. There is deliberately no default here: two
    // places writing the sky is how they end up disagreeing.

    this.camera = new THREE.PerspectiveCamera(
      GAME_CONFIG.camera.fov,
      window.innerWidth / window.innerHeight,
      0.1,
      300
    );

    // 3. Subsystem initialization
    this.collision = new WorldCollision();
    this.npcs = new NpcCrowd(this.collision);
    this.worldLoader = new WorldLoader();
    this.collisionDebug = new CollisionDebugView(this.scene);

    this.player = new Player();
    this.cameraController = new CameraController(this.camera, this.renderer.domElement);
    this.cameraController.setCollision(this.collision);
    this.input = new InputController();

    // Lights belong to the scene, not to the loaded map: they outlive every
    // world swap, and the sun's shadow map is 8 MB that should not be freed and
    // reallocated every time the player changes location.
    this.sun = new SunShadows(this.renderer, this.scene);
    this.atmosphere = new Atmosphere(this.scene, this.sun);

    this.roundManager = new RoundManager();
    this.hiddenItems = new HiddenItemSystem();
    this.ui = new UIManager(this.container);

    // 4. Quality ladder. Constructed before the settings are applied, because
    // applying them is what picks the starting level.
    this.quality = new RenderQuality(
      this.renderer,
      () => this.onRenderScaleChange(),
      () => this.applyPreset()
    );

    // 5. Apply what the player chose last time.
    //
    // `setLevel` is what pushes the first pixel ratio into the renderer, so it
    // runs once unconditionally: `applySettings` deliberately skips it when the
    // level has not changed, and at boot it never has.
    this.quality.setLevel(this.save.settings.quality);
    this.applySettings(this.save.settings);

    // 6. Hook up Input & UI events
    this.bindEvents();

    // 7. Game Loop
    this.loop = new GameLoop(this.update.bind(this), this.render.bind(this));
    this.loop.onFrame((frameMs) => this.onFrameTime(frameMs));
    this.loop.start();

    // 8. Responsive resize, focus and GPU-context handling
    window.addEventListener('resize', this.onWindowResize.bind(this));
    window.addEventListener('blur', () => this.onWindowBlur());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.onWindowBlur();
    });
    this.bindContextLoss();
  }

  /**
   * Pushes the saved settings into everything that obeys them.
   *
   * One function, called once at boot and again on every change from the
   * options sheet, so there is exactly one definition of what "quality: high"
   * means and no way for the menu and the renderer to disagree.
   */
  private applySettings(settings: Settings): void {
    if (this.quality.getLevel() !== settings.quality) {
      this.quality.setLevel(settings.quality);
    }
    this.quality.setShadows(settings.shadows);
    this.cameraController.setSensitivity(settings.sensitivity);
    this.cameraController.setBaseFov(settings.fov);
    this.audio.setMasterVolume(settings.volume);
    this.ui.hud.setFpsVisible(settings.showFps);
  }

  /** Applies the current preset to the shadow rig and the post buffer. */
  private applyPreset(): void {
    const preset = this.quality.getPreset();
    this.sun.apply(preset);
  }

  /**
   * The internal resolution moved.
   *
   * Nothing to do. `setPixelRatio` resizes the canvas itself, and the highlight
   * is DOM, so it is laid out in CSS pixels and does not care what the drawing
   * buffer is doing. This hook stays because the shadow rig may want it again
   * and because a silent no-op is clearer than a dangling callback.
   */
  private onRenderScaleChange(): void {}

  /**
   * A new frame interval arrived.
   *
   * Only counted while a map is actually playable — and "playable" is the whole
   * condition, not just "loaded". A map load blocks the main thread for
   * seconds, so feeding that interval to the scaler would drop the resolution
   * to its floor on the first loading screen. The same is true of the start
   * screen: it draws a second WebGL context for the portrait and composites a
   * full-screen backdrop, none of which says anything about how the *game*
   * runs. Counting it there is how a fast machine talked itself down to the
   * lowest preset before the player had pressed Play.
   */
  private onFrameTime(frameMs: number): void {
    if (this.state === GameState.PLAYING && this.isLoaded && !this.switching) {
      this.quality.tick(frameMs);
    }
    if (this.ui.settings.isOpen) this.ui.settings.setAutoStep(this.quality.getAutoStep());

    if (!this.save.settings.showFps) return;
    const fps = 1000 / Math.max(1, frameMs);
    this.fpsSmoothed = this.fpsSmoothed * 0.9 + fps * 0.1;
    this.ui.hud.updateFps(this.fpsSmoothed);
  }

  public async initialize(onProgress?: (status: string) => void): Promise<void> {
    this.state = GameState.LOADING;

    try {
      await this.loadWorld(this.map, onProgress);

      this.isLoaded = true;
      this.state = GameState.MENU;
      this.ui.mainMenu.setMap(this.map.id, this.map.label);
      // The roster remembers, so the start screen opens on whoever the player
      // left it on rather than resetting to the default every launch.
      this.ui.mainMenu.setCharacter(this.save.settings.character);
      this.save.rememberMap(this.map.id);
      this.ui.showMainMenu();
      this.exposeDebugHandle();
    } catch (err) {
      console.error('Game initialization failed:', err);
      throw err;
    }
  }

  /**
   * Loads a map into the running scene, replacing whatever was there.
   *
   * Called once at boot and again on every map change, so everything that
   * belongs to a map — its geometry, its collision parts, its five odd objects —
   * is torn down at the top rather than assumed to be empty. The character is
   * the one thing that survives: it is re-placed, not reloaded.
   */
  private async loadWorld(
    map: MapEntry,
    onProgress?: (status: string) => void
  ): Promise<void> {
    const t0 = performance.now();

    if (this.worldGroup) {
      this.scene.remove(this.worldGroup);
      this.worldLoader.unload();
      // Render lists cache the previous world's objects, materials and their
      // shadow flags. They are rebuilt on demand, so dropping them here is
      // free — and it keeps the old map's materials from being kept alive by
      // the renderer after their geometry is gone.
      this.renderer.renderLists.dispose();
      this.worldGroup = null;
    }
    this.collision.clear();
    this.npcs.dispose();
    this.hiddenItems.clear();
    this.pickupTarget = null;
    this.map = map;

    // Before the world is built, so the loading screen already fades into the
    // right sky rather than flashing the previous map's weather.
    this.atmosphere.apply(moodFor(map.id));

    onProgress?.(`Loading ${map.label} (0%)...`);
    // Load environment world scene
    const worldGroup = await this.worldLoader.load(
      map.file,
      this.collision,
      (percent) => {
        onProgress?.(`Loading ${map.label} (${percent}%)...`);
      },
      map.id
    );
    this.worldGroup = worldGroup;
    this.scene.add(worldGroup);
    const tWorld = performance.now();

    // Visualise exactly the triangles the player collides with.
    const collisionGeometry = this.worldLoader.getCollisionGeometry();
    this.collisionDebug.setCollisionGeometry(collisionGeometry, this.collision);
    const stats = collisionGeometry.stats;
    const tDebug = performance.now();
    console.info(
      `[collision] parts=${stats.parts} meshes=${stats.meshes} tris=${stats.triangles} ` +
        `skipped=${stats.skippedMeshes} build=${stats.buildMs}ms`
    );

    // Every small prop becomes a decoy: clickable, outlined, and wrong. Read
    // from the scene graph rather than the collider because the outline pass
    // needs the render objects, and a collision part is an anonymous soup.
    const props = collectPropTargets(worldGroup, collisionGeometry.getPartContainerName());
    this.selector.setProps(props);
    console.info(`[hunt] ${props.length} decoy props on ${map.id}`);

    let playerMs = 0;
    if (!this.playerReady) {
      onProgress?.('Loading 3D Character (0%)...');
      // Load player character — whoever the start screen last showed.
      const chosen = characterFor(this.save.settings.character);
      const playerGroup = await this.player.load(
        characterModelUrl(chosen.id),
        this.collision,
        (percent) => {
          onProgress?.(`Loading 3D Character (${percent}%)...`);
        }
      );
      this.scene.add(playerGroup);
      this.playerReady = true;
      this.characterId = chosen.id;
      playerMs = Math.round(performance.now() - tDebug);
    }
    const tPlayer = performance.now();

    // The odd objects go in last: their height is resolved against the collision
    // triangles, so they can only be placed once the map's geometry is built.
    const hunt = hiddenItemsFor(map.id);
    if (hunt) {
      onProgress?.('Hiding the odd objects (0/5)...');
      await this.hiddenItems.load(hunt, this.scene, this.collision, (loaded, total) =>
        onProgress?.(`Hiding the odd objects (${loaded}/${total})...`)
      );
      this.collisionDebug.setInteractionBounds(this.hiddenItems.getBounds());
    }

    onProgress?.('Setting up spawn position...');
    this.placeAtSpawn();

    // The kit's own cast, given something to do. After the spawn, because the
    // nearest few to it are the ones worth animating, and before the shader
    // warm-up so anything they touch is compiled behind the loading screen.
    onProgress?.('Waking the locals...');
    await this.npcs.attach(worldGroup, this.player.getPosition().clone());
    const tSpawn = performance.now();

    // Compile every material now, behind the loading screen.
    //
    // Three compiles a program the first time a material is actually drawn, and
    // on a 400k-triangle kit that is not one frame: the first camera turn after
    // a map loads sweeps a dozen new props into view and compiles each one as
    // it arrives, which is the stutter reported on entering a map. `compile`
    // walks the whole scene regardless of the frustum, so the cost lands in the
    // loading screen instead — a place the player already expects to wait.
    onProgress?.('Warming up the shaders...');
    const tWarm = performance.now();
    this.renderer.compile(this.scene, this.camera);
    const warmMs = Math.round(performance.now() - tWarm);

    // One line per map: where the seconds went. A 400k-triangle kit that loads
    // in under ten seconds here is fine; one that takes a minute is a bug, and
    // this is the only place that says which stage is at fault.
    console.info(
      `[load] ${map.id} total=${Math.round(performance.now() - t0)}ms ` +
        `world=${Math.round(tWorld - t0)}ms (${JSON.stringify(this.worldLoader.timings)}) ` +
        `debug=${Math.round(tDebug - tWorld)}ms ` +
        `player=${playerMs}ms (${JSON.stringify(this.player.timings)}) ` +
        `spawn=${Math.round(tSpawn - tPlayer)}ms warm=${warmMs}ms`
    );
  }

  private exposeDebugHandle(): void {
    // Debug handle, only under ?debug=1: lets the collision test harness read
    // exact positions and probe the resolver without synthetic key timing.
    if (new URLSearchParams(window.location.search).get('debug') !== '1') return;
    const self = this;

    (window as unknown as { __hunt?: unknown }).__hunt = {
      game: this,
      collision: this.collision,
      player: this.player,
      camera: this.camera,
      cameraController: this.cameraController,
      hiddenItems: this.hiddenItems,
      // The render path, so a profiler can time the two branches separately and
      // read the draw-call counters without guessing at private fields.
      renderer: this.renderer,
      quality: this.quality,
      sun: this.sun,
      // Sky, fog and weather. Exposed so a probe can read the hour the light
      // was actually built for, rather than inferring it from a pixel colour.
      atmosphere: this.atmosphere,
      // What the reticle is currently lighting up, so a probe can confirm the
      // highlight follows the selection rather than a stale object.
      glow: this.glow,
      // The animated cast, so a probe can watch them move and check they stay
      // on the ground instead of judging it from a screenshot.
      npcs: this.npcs,
      save: this.save,
      // A getter, not a snapshot: `selectMap` replaces the collider, and a
      // harness that held the old one measured the previous map's geometry
      // without noticing — every probe came back empty instead of wrong.
      get geometry() {
        return self.worldLoader.getCollisionGeometry();
      },
      // Which costume the body is actually wearing, and how tall it ended up.
      // A roster is only cosmetic if the normalisation worked, and "cosmetic"
      // is not something a screenshot can confirm.
      get characterId() {
        return self.characterId;
      },
      get characterHeight() {
        const box = new THREE.Box3().setFromObject(self.player.getGroup());
        return +(box.max.y - box.min.y).toFixed(3);
      },
    };
  }

  /**
   * Swaps in another map and starts a round on it.
   *
   * The picker is a UI concern; this is the part that knows how to take a world
   * down and put another one up, so the same path serves the main menu and the
   * pause menu.
   */
  /**
   * Puts the character the player chose on the start screen into the world.
   *
   * Deferred until a round is about to start rather than run on every click of
   * the roster arrows: each swap re-parses a ~0.8 MB GLB and rebuilds the
   * animator, which is a visible hitch for a character the player may not keep.
   * By the time a map is picked, the choice is final and the map load is already
   * covering the seconds.
   */
  private async ensureCharacter(): Promise<void> {
    const wanted = characterFor(this.save.settings.character).id;
    if (!this.playerReady || wanted === this.characterId) return;
    if (this.characterSwap) await this.characterSwap;
    if (wanted === this.characterId) return;

    this.characterSwap = this.player
      .swapModel(characterModelUrl(wanted))
      .then(() => {
        this.characterId = wanted;
        this.placeAtSpawn();
      })
      .catch((err) => {
        // A model that will not load must not cost the player their round: the
        // previous body is still standing, and it still works.
        console.warn(`Could not switch to character "${wanted}":`, err);
      })
      .finally(() => {
        this.characterSwap = null;
      });
    await this.characterSwap;
  }

  public async selectMap(id: string): Promise<void> {
    if (this.switching) return;
    const next = resolveMap(id);

    // Same map: nothing to load. From the start screen that still means "play
    // this one", which is the whole point of pressing Play.
    if (next.id === this.map.id && this.isLoaded) {
      const fromMenu = this.pickerReturn === GameState.MENU;
      this.closeMapSelect();
      if (fromMenu) {
        await this.ensureCharacter();
        this.startNewRound();
      }
      return;
    }

    this.switching = true;
    this.state = GameState.LOADING;
    this.isLoaded = false;
    this.roundManager.pause();
    this.ui.mapSelect.setBusy(true);
    this.ui.showLoading(`Loading ${next.label}…`);

    // Two frames, so the overlay is actually painted before the main thread
    // disappears into parse + collision build for several seconds.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

    try {
      await this.loadWorld(next, (status) => this.ui.setLoadingText(status));
    } catch (err) {
      console.error(`Failed to load map "${id}":`, err);
      this.ui.setLoadingText(`Could not load ${next.label}. Pick another map.`);
      this.ui.mapSelect.setBusy(false);
      this.switching = false;
      return;
    }

    this.switching = false;
    this.isLoaded = true;
    this.ui.mapSelect.hide();
    this.ui.hideLoading();
    this.ui.mainMenu.setMap(this.map.id, this.map.label);
    this.save.rememberMap(this.map.id);
    await this.ensureCharacter();
    this.startNewRound();
  }

  private openMapSelect(): void {
    this.pickerReturn = this.state;
    if (this.state === GameState.PLAYING) {
      this.state = GameState.PAUSED;
      this.roundManager.pause();
    }
    this.ui.hidePause();
    // The records make the picker a map of what is done, not a list of places.
    this.ui.showMapSelect(this.map.id, this.save.progress.maps);
  }

  private closeMapSelect(): void {
    this.ui.hideMapSelect();
    if (this.pickerReturn === GameState.PLAYING || this.pickerReturn === GameState.PAUSED) {
      this.state = GameState.PAUSED;
      this.ui.showPause();
    } else {
      this.state = GameState.MENU;
      this.ui.showMainMenu();
    }
  }

  /**
   * Opens the options sheet over whatever is already on screen.
   *
   * Opening it mid-hunt pauses the clock first: the player is about to spend
   * a minute dragging sliders, and a hunt that loses five minutes to that is a
   * hunt that punishes looking at the settings.
   */
  private openSettings(from: GameState): void {
    this.settingsReturn = from;
    if (this.state === GameState.PLAYING) {
      this.state = GameState.PAUSED;
      this.roundManager.pause();
    }
    this.ui.hidePause();
    this.ui.showSettings(this.save.settings, this.quality.getAutoStep());
  }

  private closeSettings(): void {
    this.ui.hideSettings();
    if (this.settingsReturn === GameState.PLAYING || this.settingsReturn === GameState.PAUSED) {
      this.state = GameState.PAUSED;
      this.ui.showPause();
      return;
    }
    this.state = GameState.MENU;
    this.ui.showMainMenu();
  }

  private bindEvents(): void {
    // Main Menu events. Play opens the map picker rather than dropping straight
    // into a hunt: the picker is the only place the records are visible, so it
    // is also the only place a returning player can see what is left to do.
    this.ui.mainMenu.onPlay(() => this.openMapSelect());
    this.ui.mainMenu.onCharacter((id) => {
      this.save.updateSettings({ character: id });
    });
    this.ui.mainMenu.onExit(() => {
      // In Tauri, close window; in browser, alert or close
      if ((window as unknown as { __TAURI__?: unknown }).__TAURI__) {
        import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
          getCurrentWindow().close();
        }).catch(() => {});
      } else {
        window.close();
      }
    });

    // Pause events
    this.ui.pauseMenu.onResume(() => this.resumeGame());
    this.ui.pauseMenu.onRetry(() => this.retryCurrentRound());
    this.ui.pauseMenu.onMenu(() => this.returnToMainMenu());
    this.ui.pauseMenu.onMapSelect(() => this.openMapSelect());

    // Map picker
    this.ui.mapSelect.onSelect((id) => {
      void this.selectMap(id);
    });
    this.ui.mapSelect.onClose(() => this.closeMapSelect());

    // Options sheet. Reachable from both menus; opening it mid-hunt pauses the
    // clock, for the same reason the pause menu does.
    this.ui.mainMenu.onSettings(() => this.openSettings(GameState.MENU));
    this.ui.pauseMenu.onSettings(() => this.openSettings(this.state));
    this.ui.settings.onChange((patch, persist) => {
      // `applySettings` is idempotent, so a live drag does not reset the
      // adaptive resolution or reallocate the shadow map on every pixel.
      this.applySettings(this.save.updateSettings(patch, persist));
    });
    this.ui.settings.onReset(() => {
      this.save.resetProgress();
      // Re-open so the sheet repaints from the cleared store instead of
      // showing the numbers it was handed on the way in.
      this.ui.showSettings(this.save.settings, this.quality.getAutoStep());
    });
    this.ui.settings.onClose(() => this.closeSettings());

    // Results events
    this.ui.resultsScreen.onNextRound(() => this.startNewRound());
    this.ui.resultsScreen.onRetry(() => this.retryCurrentRound());
    this.ui.resultsScreen.onMenu(() => this.returnToMainMenu());

    // Gameplay HUD events
    this.ui.hud.onPause(() => this.togglePause());

    // Keyboard: E picks up whatever the crosshair is on.
    this.input.onInteract(() => {
      if (this.state === GameState.PLAYING) {
        this.handlePickup();
      }
    });

    // Same action on a click, because the prompt says "pick up" and half the
    // people who read it reach for the mouse.
    this.input.onPickupClick(() => {
      if (this.state === GameState.PLAYING) {
        this.handlePickup();
      }
    });

    // Tab walks the selection to the next object within reach. Deliberately not
    // gated on the game state: tabbing through the HUD while paused is what the
    // browser would do anyway, and the handler only moves a selection that is
    // empty when nothing is in reach.
    this.input.onCycle(() => {
      if (this.state === GameState.PLAYING) {
        this.selector.cycle();
        this.refreshPickupPrompt();
      }
    });

    // C toggles the crawl. The controller decides whether the body is allowed
    // to stand back up: under a vent it is not, and the input stays latched so
    // the player does not have to press it again.
    this.input.onCrawl((crawling) => {
      this.player.getController()?.setCrawl(crawling);
    });

    // Shift swaps gear. Nothing here changes the clip: the controller reports
    // the speed it actually moved at and the animator picks Walk or Run from
    // that same number, so the two can never disagree.
    this.input.onRun((running) => {
      this.player.getController()?.setRunning(running);
    });

    // V, or the button in the corner, swaps the view.
    this.input.onViewToggle(() => this.toggleView());
    this.ui.hud.onViewToggle(() => this.toggleView());

    this.input.onPause(() => {
      // The options sheet and the map picker sit on top of the pause menu and
      // answer to the same key. Handling all three here, in one place, is what
      // keeps Escape from closing a panel and un-pausing the game in the same
      // keypress.
      if (this.ui.settings.isOpen) {
        this.closeSettings();
        return;
      }
      if (this.ui.mapSelect.isOpen) {
        this.closeMapSelect();
        return;
      }
      if (this.state === GameState.PLAYING || this.state === GameState.PAUSED) {
        this.togglePause();
      }
    });

    // Round state change listener
    this.roundManager.onStateChange((status: RoundStatus) => {
      const found = this.roundManager.getFoundCount();
      const total = this.roundManager.getTotal();
      const elapsed = this.roundManager.getElapsed();

      // The previous best is read *before* recording, because afterwards it is
      // this round's time and "did I beat it?" becomes unanswerable.
      const previousBest = this.save.recordFor(this.map.id)?.bestSeconds ?? null;
      let bestSeconds = previousBest;
      let isNewBest = false;

      if (status === 'won' || status === 'lost') {
        // Recorded before the card is shown, so a player who closes the tab on
        // the results screen still keeps what they earned.
        this.save.recordMap(this.map.id, found, total, elapsed);
        bestSeconds = this.save.recordFor(this.map.id)?.bestSeconds ?? null;
        isNewBest = status === 'won' && (previousBest == null || elapsed < previousBest);
      }

      if (status === 'won') {
        this.state = GameState.RESULTS;
        this.ui.hud.setPickupPrompt(false);
        this.glow.hide();
        this.ui.showResults(
          true,
          found,
          total,
          this.roundManager.getElapsedLabel(),
          this.roundManager.getItems(),
          bestSeconds,
          isNewBest
        );
        return;
      }

      if (status === 'lost') {
        // Three wrong objects. The results card already knows how to present a
        // hunt that did not finish — it has said "HUNT OVER" since the mode was
        // built — so a loss is the same card with the same numbers.
        this.state = GameState.RESULTS;
        this.ui.hud.setPickupPrompt(false);
        this.glow.hide();
        this.ui.showResults(
          false,
          found,
          total,
          this.roundManager.getElapsedLabel(),
          this.roundManager.getItems(),
          bestSeconds,
          false
        );
      }
    });

    // A found object leaves the world the moment it is pocketed, so the HUD is
    // the only thing that has to be told.
    this.roundManager.onItemFound(() => {
      this.ui.hud.updateItems(this.roundManager.getItems());
    });
  }

  /**
   * Put the body at this map's spawn.
   *
   * The registry's spawn sits half a metre above the map's lowest surface, so
   * the body always drops onto the real floor rather than guessing it — but if
   * a terrain mesh puts the ground higher at that spot, start there instead of
   * falling through it.
   */
  /**
   * Puts the body on walkable ground.
   *
   * The spawn in the map registry comes from bounding boxes, so it can land
   * inside a wall, on a crate or at the bottom of an excavation — the
   * construction site's hint was 3.2 m below its own floor. The resolver is
   * asked instead: `findSpawn` returns the nearest point where a real capsule
   * overlaps nothing, and the registry value becomes just a hint.
   */
  private placeAtSpawn(): void {
    const { x, y, z } = this.map.spawn;
    const spot = this.collision.findSpawn({ x, y, z });
    if (spot) {
      // Re-resolve the surface under the spot we actually landed on.
      // `findSpawn` measures support from the *hint's* height, so on a map
      // whose sidecar `y` sits a step below the real ground it can return the
      // terrain while a kerb is 16 cm above it — `neighborhood-pathways`
      // spawned the body with its feet inside the paving until the first move
      // lifted it. Asking again from the landing height settles it properly.
      const settled = this.collision.groundAt(spot.x, spot.z, spot.y);
      this.player.setPosition(spot.x, settled + 0.05, spot.z);
    } else {
      // Nothing walkable anywhere near the hint: fall back to the raw data.
      const ground = this.collision.getGroundHeight(x, z);
      this.player.setPosition(x, Math.max(y, ground), z);
    }

    // A spawn is a teleport — up to a hundred metres on a map change — so the
    // camera is placed, not damped towards the new position.
    const controller = this.player.getController();
    this.cameraController.snap(this.player.getPosition(), controller?.getGroundY());
  }

  public startNewRound(): void {
    if (!this.isLoaded) return;

    // A map gets a hunt once its five objects are authored. Until then there is
    // nothing to find, so walk it freely rather than throw.
    const hunt = hiddenItemsFor(this.map.id);
    if (!hunt) {
      this.roundManager.startFreeRoam();
      this.beginHunt();
      return;
    }

    this.roundManager.startRound(hunt.items);
    this.beginHunt(hunt.brief);

    // A second hunt on the same map starts with an empty world: the objects were
    // removed as they were pocketed, and nothing puts them back on its own.
    if (
      this.hiddenItems.getFoundCount() > 0 ||
      this.hiddenItems.getItems().length !== hunt.items.length
    ) {
      void this.restoreHunt(hunt.items);
    }
  }

  public retryCurrentRound(): void {
    if (!this.isLoaded) return;

    const hunt = hiddenItemsFor(this.map.id);
    if (hunt) void this.restoreHunt(hunt.items);

    this.roundManager.retryRound();
    this.beginHunt(hiddenItemsFor(this.map.id)?.brief ?? '');
  }

  /** Shared tail of "start" and "retry": reset the body and the panels. */
  private beginHunt(brief = ''): void {
    this.placeAtSpawn();

    this.state = GameState.PLAYING;
    this.pickupTarget = null;
    this.hinted.clear();
    this.nextHintAt = HINT_FIRST_AT;

    // A retry puts back the props that were struck off as well as the objects
    // that were found: the map is the same, the guesses are fresh.
    this.selector.resetRound();
    this.glow.hide();

    this.ui.showGameplay();
    this.ui.hud.setBrief(brief);
    this.ui.hud.updateItems(this.roundManager.getItems());
    this.ui.hud.updateTimer(this.roundManager.getElapsedLabel(), this.roundManager.isFreeRoam());
    this.ui.hud.setStrikes(0, this.roundManager.isFreeRoam() ? 0 : MAX_STRIKES);
    this.ui.hud.hideHint();
    this.ui.hud.setPickupPrompt(false);
    this.ui.hud.setViewMode(this.cameraController.isFirstPerson());
  }

  /**
   * Puts the five objects back in the world.
   *
   * Called before a retry and before a replay: the meshes are gone from the
   * scene once they have been picked up, and the round data alone cannot bring
   * them back.
   */
  private async restoreHunt(items: HiddenItemPlacement[]): Promise<void> {
    if (this.restoring) return;
    this.restoring = true;
    try {
      this.hiddenItems.clear();
      await this.hiddenItems.load({ brief: '', items }, this.scene, this.collision);
      this.collisionDebug.setInteractionBounds(this.hiddenItems.getBounds());
    } finally {
      this.restoring = false;
    }
  }

  /**
   * Swaps between the boom and a lens in the head.
   *
   * The body is hidden in first person — a camera at eye height inside a
   * character model is a screen full of the inside of a hat — but the model
   * stays in the scene so its shadow does not blink out. Only `visible` is
   * flipped, which is free.
   */
  public toggleView(): void {
    const mode = this.cameraController.toggleMode();
    const first = mode === 'first';
    this.player.getGroup().visible = !first;
    this.ui.hud.setViewMode(first);
  }

  public togglePause(): void {    if (this.state === GameState.PLAYING) {
      this.state = GameState.PAUSED;
      this.roundManager.pause();
      this.ui.showPause();
    } else if (this.state === GameState.PAUSED) {
      this.resumeGame();
    }
  }

  public resumeGame(): void {
    if (this.state === GameState.PAUSED) {
      this.state = GameState.PLAYING;
      this.roundManager.resume();
      this.ui.hidePause();
    }
  }

  public returnToMainMenu(): void {
    this.state = GameState.MENU;
    this.roundManager.pause();
    this.ui.showMainMenu();
  }

  /**
   * Pockets the object under the crosshair — or records the mistake.
   *
   * The target is resolved here rather than read from the last frame: the key
   * can arrive between two frames, and a stale target would pick up the object
   * the player was looking at a moment ago. Resolving again also keeps Tab
   * honest, because the selection the player cycled to is the one that acts.
   */
  private handlePickup(): void {
    if (this.state !== GameState.PLAYING) return;

    this.refreshPickupPrompt();
    const selected = this.selector.getSelected();
    if (!selected) return;

    if (selected.kind === 'decoy') {
      this.rejectDecoy(selected);
      return;
    }

    const item = selected.item;
    if (!item) return;

    this.hiddenItems.take(item);
    this.selector.clearSelection();
    this.pickupTarget = null;
    this.ui.hud.setPickupPrompt(false);
    this.glow.hide();

    if (!this.roundManager.complete(item.placement.id)) return;

    const found = this.roundManager.getFoundCount();
    const total = this.roundManager.getTotal();
    this.ui.hud.showFeedback(
      `${item.placement.name.toUpperCase()}  —  ${found} of ${total}`,
      true
    );
  }

  /**
   * An object that was not one of the five.
   *
   * The prop is struck off the candidate list as well as costing a strike, so
   * the same mistake cannot be made twice in a row: with the object still the
   * most central thing on screen, the next press would have charged for it
   * again.
   */
  private rejectDecoy(selected: Candidate): void {
    this.selector.reject(selected.key);
    this.selector.clearSelection();

    const strikes = this.roundManager.addStrike();
    if (strikes === null) return;

    this.ui.hud.setStrikes(strikes, MAX_STRIKES);

    const left = MAX_STRIKES - strikes;
    if (left > 0) {
      this.ui.hud.showFeedback(
        `THAT BELONGS HERE  —  ${left} ${left === 1 ? 'mistake' : 'mistakes'} left`,
        false
      );
    }
    // The third strike ends the round through `onStateChange`, which puts the
    // results card up; a banner on top of it would only be covered.
  }

  private update(delta: number): void {
    if (!this.isLoaded) return;

    // Weather and the moving sun. Outside the PLAYING branch on purpose: the
    // rain should keep falling behind the pause menu, and freezing it makes the
    // world look like a screenshot the moment the player stops to think.
    this.atmosphere.update(delta, this.player.getPosition());
    // The glow breathes whether or not the player is moving, so it reads as a
    // live highlight rather than a painted-on tint.
    this.glow.update(delta);
    // The people keep walking behind the pause menu, like the weather does.
    this.npcs.update(delta);

    if (this.state === GameState.PLAYING) {
      // 1. Player movement
      const moveVec = this.input.getMovementVector();
      const cameraYaw = this.cameraController.getYaw();
      const controller = this.player.getController();
      controller?.update(moveVec, cameraYaw, delta, this.input.consumeJump());

      // 2. Camera follow & orbit. The surface height is passed separately: the
      // camera settles onto the ground rather than riding the jump arc.
      this.cameraController.update(
        this.player.getPosition(),
        delta,
        controller?.getGroundY()
      );

      // 3. Hunt clock, the crosshair prompt, and the five-minute nudge
      this.roundManager.update(delta);
      this.ui.hud.updateTimer(
        this.roundManager.getElapsedLabel(),
        this.roundManager.isFreeRoam()
      );
      this.refreshPickupPrompt();
      this.revealDueHint();
    } else if (this.state === GameState.MENU) {
      // Idle camera slow orbit for aesthetic menu background
      const playerPos = this.player.getPosition();
      this.cameraController.update(playerPos, delta * 0.3);
    }

    // Collision debug view (no-op unless enabled with ?debug=1 or F3)
    if (this.collisionDebug.isEnabled) {
      const controller = this.player.getController();
      this.collisionDebug.update(
        this.player.getPosition(),
        GAME_CONFIG.player.capsuleHeight,
        this.collision.getGroundHeight(this.player.getPosition().x, this.player.getPosition().z),
        controller ? controller.getLastContacts() : []
      );
    }

    // Diagnostics overlay
    this.ui.debugOverlay.update(
      this.renderer,
      this.player,
      this.cameraController,
      this.roundManager,
      this.hiddenItems
    );
  }

  /**
   * Shows "E — Pick up" while something is in reach.
   *
   * The check is a projection, so it runs against the camera as it is this frame,
   * after the follow has moved it — the same view the player is looking at.
   */
  private refreshPickupPrompt(): void {
    this.selector.update(
      this.hiddenItems.getItems(),
      this.camera,
      this.camera.position,
      this.getReachOrigin(),
      this.collision,
      REACH_DISTANCE
    );

    const selected = this.selector.getSelected();
    this.pickupTarget = selected?.item ?? null;

    const visible = selected !== null;
    const canCycle = this.selector.getCandidates().length > 1;
    this.ui.hud.setPickupPrompt(visible, canCycle);

    // The object itself glows, rather than a bracket drawn over it. Framed from
    // the candidate's own bounding sphere — the sphere was measured once at
    // load and is the only thing that describes "the space this object
    // occupies" for a skinned prop whose bind pose is nowhere near where it is
    // standing. It also handles decoys and hidden objects alike, which reading
    // `selected.item` did not: that silently dropped the mark on every decoy,
    // so the prompt appeared, E cost a strike, and nothing was marked on screen.
    if (visible && selected) {
      this.glow.show(selected.object);
    } else {
      this.glow.hide();
    }
  }

  /**
   * The point reach is measured from: the body's chest.
   *
   * Not the camera. The boom trails up to fourteen metres behind the player, so
   * a camera-relative reach is a reach that never arrives — see `findTarget`.
   */
  private getReachOrigin(): THREE.Vector3 {
    const body = this.player.getPosition();
    return _reachOrigin.set(body.x, body.y + REACH_CHEST_HEIGHT, body.z);
  }

  /**
   * After five minutes, describe one still-missing object in vague terms.
   *
   * One hint at a time, and only for objects that have not been found, so the
   * nudge always points at something that is actually still out there. A further
   * hint arrives every `HINT_INTERVAL` seconds after that, which keeps a player
   * who is completely lost moving instead of quitting.
   */
  private revealDueHint(): void {
    if (this.roundManager.getStatus() !== 'playing') return;
    if (this.roundManager.getElapsed() < this.nextHintAt) return;

    const next = this.roundManager
      .getItems()
      .find((item) => !item.found && !this.hinted.has(item.placement.id));
    if (!next) return;

    this.hinted.add(next.placement.id);
    this.nextHintAt += HINT_INTERVAL;
    this.ui.hud.showHint(next.placement.hint);
    this.ui.hud.showFeedback('HINT UNLOCKED', true);
  }

  private render(): void {
    // The start screen is opaque and full-bleed, so a frame of the world behind
    // it is a frame nobody sees — and it is not free: a 300k-triangle map, its
    // shadow pass and its weather, drawn every frame underneath a menu, is
    // enough GPU to make the menu itself stutter on a laptop. The canvas keeps
    // its last frame, which is still there if the menu is dismissed without
    // starting a round.
    if (this.state === GameState.MENU) return;

    // Before the draw, never after: moving a light once the shadow map has been
    // built leaves the previous anchor's shadows on screen for a frame.
    this.sun.update(
      this.player.getPosition(),
      performance.now(),
      this.state === GameState.PLAYING,
      this.quality.getFrameMs()
    );

    // One path, always. The outline used to branch here into an
    // `EffectComposer`, which meant two render paths that had to be kept
    // colour-identical and a set of off-screen targets allocated the first time
    // the player walked up to something. The highlight is DOM now — see
    // `TargetFrame` — so the frame is the frame whether or not anything is
    // selected.
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * The tab lost focus, or the window was hidden.
   *
   * A hunt that keeps counting while the player is answering the door is a hunt
   * that punishes them for having a life. Pausing is also what stops the GPU
   * from rendering a background tab at full rate.
   */
  private onWindowBlur(): void {
    if (this.state !== GameState.PLAYING) return;
    this.togglePause();
  }

  /**
   * The GPU dropped the context.
   *
   * three rebuilds its own programs and textures on restore, but the buffers
   * this game allocated by hand — the shadow map, the post-processing targets —
   * were sized and sampled against the old context, and the frame loop has to
   * stop or every frame becomes a page of WebGL errors.
   */
  private bindContextLoss(): void {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('webglcontextlost', (event) => {
      // Without this the context is never restorable, which is why a driver
      // reset normally means a page reload.
      event.preventDefault();
      this.loop.stop();
      this.ui.showContextLost();
    });

    canvas.addEventListener('webglcontextrestored', () => {
      this.ui.hideContextLost();
      this.sun.invalidate();
      this.onRenderScaleChange();
      this.loop.start();
    });
  }

  private onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // `setSize` resets the drawing buffer, and a resize arrives between frames
    // rather than inside one — so without this the window is briefly presented
    // as an empty canvas before the next rAF paints it.
    this.render();
  }
}
