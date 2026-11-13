import * as THREE from 'three';
import { FishingRod } from './FishingRod';
import { FishSchool } from './FishSchool';
import { WaterSurface } from '../world/WorldLoader';
import { Player } from '../player/Player';
import { CameraController } from '../player/CameraController';
import { InputController } from '../input/InputController';
import { SaveStore } from '../../app/Storage';
import { FishingMinigame, CatchReport } from '../../ui/FishingMinigame';
import { FoundScreen } from '../../ui/FoundScreen';
import {
  FISH,
  FishingSpot,
  FishSpecies,
  biteDelay,
  clamp,
  pickSpecies,
  spotForMap,
  xpForLevel,
  zoneHeight,
} from '../../data/fishing';

/**
 * Fishing, from the first cast to the card.
 *
 * This is a state machine with one job: keep the rod, the float, the fish and
 * the bar telling the same story. The states are the story —
 *
 *   idle    rod out, nothing in the air
 *   charge  the meter is filling and the arm is going back with it
 *   cast    the throw is playing; the float leaves when the arm snaps
 *   wait    the float is on the water and something is on its way
 *   bite    it took it; a short window to strike
 *   reel    the bar
 *   result  the card
 *
 * Everything else in the game is suspended while this is running: the body
 * cannot walk (the animator refuses to move), the camera cannot look around
 * (only during the reel), and the hunt's clock keeps running because fishing is
 * a thing you chose to do instead of hunting, not a menu.
 */

/** Seconds for the power meter to fill, start to full. */
const CHARGE_TIME = 1.15;

/** Cast distances at zero and full power, in metres. */
const CAST_MIN = 4;
const CAST_MAX = 16;

/** Water shallower than this is not a place to put a float. */
const MIN_CAST_DEPTH = 0.4;

/**
 * Water this deep, this close, is what makes the prompt appear.
 *
 * Lower than the cast depth on purpose: the player only has to be standing at
 * the water for E to be offered, and the first metre of a beach is ankle-deep.
 * The cast itself still needs `MIN_CAST_DEPTH` to find a place to land.
 */
const MIN_SHORE_DEPTH = 0.12;

/** How far from the player's feet water has to be for the prompt to appear. */
const SHORE_REACH = 3.2;

/** The strike window, in seconds. Long enough to react, short enough to miss. */
const BITE_WINDOW = 1.05;

/** Progress the bar starts at, and how fast it fills and drains. */
const PROGRESS_START = 0.3;
const PROGRESS_GAIN = 0.27;
const PROGRESS_LOSS = 0.185;

/** Zone physics: how hard it accelerates up, falls, and how fast it can go. */
const ZONE_UP = 3.3;
const ZONE_DOWN = 2.8;
const ZONE_MAX_SPEED = 1.45;

/** How long the catch card stays up before the rod is ready again. */
const RESULT_MS = 2600;

/**
 * Where the rod points, in the character's own frame.
 *
 * Degrees: elevation above the horizon, then azimuth with 0 straight ahead and
 * 90 over the right shoulder. The rod is aimed rather than carried by the
 * wrist, because the Mixamo cast rolls the wrist through 140° — see
 * `FishingRod`. These are the numbers that make the cast read as a cast:
 *
 * - it starts high and slightly right, where a rod is held at rest;
 * - it swings back over the right shoulder to 112°, which is the only place a
 *   2.2 m lever can go at the top of a back swing without entering the body;
 * - it comes forward through 20° at the release and settles at 8°, pointing
 *   out over the water the float is in.
 *
 * The wind-up peak is deliberately high (62°). Lower and the shaft passes
 * through the character's own head: the grip is 26 cm from the head bone at
 * that moment, so anything short of steep puts the rod inside the skull.
 */
const ROD_AIM = {
  idle: [58, 12] as const,
  reel: [46, 8] as const,
  cast: [
    [0.0, 58, 12],
    [0.55, 55, 18],
    [1.1, 48, 55],
    [1.55, 62, 112],
    [1.8, 58, 70],
    [1.95, 46, 20],
    [2.2, 48, 8],
    [2.75, 46, 8],
  ] as const,
};

/**
 * The curve at a moment of the cast clip.
 *
 * Smoothstepped rather than linear: the keys are beats, not samples, and a
 * straight line between two beats reads as a robot changing position. The
 * ease is what makes the wind-up look like it has weight behind it.
 */
function aimAt(t: number): readonly [number, number] {
  const keys = ROD_AIM.cast;
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2]];
  for (let i = 1; i < keys.length; i++) {
    const [t1, e1, a1] = keys[i];
    if (t > t1) continue;
    const [t0, e0, a0] = keys[i - 1];
    const k = (t - t0) / (t1 - t0);
    const s = k * k * (3 - 2 * k);
    return [e0 + (e1 - e0) * s, a0 + (a1 - a0) * s];
  }
  const last = keys[keys.length - 1];
  return [last[1], last[2]];
}

type Phase = 'off' | 'idle' | 'charge' | 'cast' | 'wait' | 'bite' | 'reel' | 'result';

const _tip = new THREE.Vector3();
const _castDir = new THREE.Vector3();
const _target = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _liftTo = new THREE.Vector3();
const _aimDir = new THREE.Vector3();

export class FishingSystem {
  private rod = new FishingRod();
  private school: FishSchool;

  private phase: Phase = 'off';
  private water: WaterSurface | null = null;
  private mapId = '';
  /** The water being fished, or null when this map has none. */
  private spot: FishingSpot | null = null;

  /** 0 … 1, filled by holding the button. */
  private power = 0;
  /** The float's world position while it is out. */
  private bobber = new THREE.Vector3();
  /** Where the cast is aimed, and the arc the float takes to get there. */
  private castFrom = new THREE.Vector3();
  private castTo = new THREE.Vector3();
  private flight = 0;
  private flightTime = 0.6;
  /** Seconds left before something takes the float. */
  private wait = 0;
  /** Seconds left in the strike window. */
  private biteLeft = 0;
  /** Seconds left on the catch card. */
  private resultLeft = 0;
  /** True once the float has been let go for the current cast. */
  private released = false;

  /** The fish that took the bait, and the bar's state. */
  private species: FishSpecies | null = null;
  private zoneY = 0.3;
  private zoneV = 0;
  private zoneH = 0.3;
  private fishY = 0.5;
  private fishTarget = 0.5;
  private fishTimer = 0;
  private progress = PROGRESS_START;
  private perfect = true;

  /** The float, the line and the transient rings, all in the scene. */
  private bobberMesh: THREE.Group;
  private line: THREE.Line;
  private linePoints = 16;
  private rings: { mesh: THREE.Mesh; t: number; big: boolean }[] = [];
  private drops: { mesh: THREE.Mesh; v: THREE.Vector3; t: number }[] = [];
  private effects = new THREE.Group();

  constructor(
    private scene: THREE.Scene,
    private player: Player,
    private cameraController: CameraController,
    private input: InputController,
    private save: SaveStore,
    private ui: FishingMinigame,
    private found: FoundScreen
  ) {
    this.school = new FishSchool(scene);

    this.bobberMesh = makeBobber();
    this.bobberMesh.visible = false;
    scene.add(this.bobberMesh);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.linePoints * 3), 3));
    this.line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: 0xf4ecd9, transparent: true, opacity: 0.85 })
    );
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);

    this.effects.name = 'fishing-effects';
    scene.add(this.effects);
  }

  /** True when this map is dressed for fishing. */
  public get isAvailableMap(): boolean {
    return this.spot !== null;
  }

  /**
   * Called once per map load.
   *
   * The rod is loaded even on maps without water — it is 93 kB and the player
   * will be back on the lake — but the school is only populated where there is
   * something to swim in.
   */
  public async prepare(mapId: string, water: WaterSurface | null): Promise<void> {
    this.mapId = mapId;
    this.water = water;
    this.spot = water ? spotForMap(mapId) : null;
    this.end(true);

    try {
      await this.rod.load();
    } catch (err) {
      console.warn('FishingSystem: the rod could not be loaded', err);
      return;
    }

    if (!this.spot || !water) return;

    // The school goes where the water is, not where the player spawns: the
    // campground's spawn is a clearing 25 m from the shore, and nine fish
    // dropped there would all fail the depth test and the lake would be empty.
    // The radius is generous because the canal runs under a railway and its
    // spawn point is a hundred metres up the embankment from it.
    const body = this.player.getPosition();
    const lake = water.nearestOpenWater(body.x, body.z, 320);
    if (!lake) return;
    await this.school.populate(water, new THREE.Vector3(lake.x, lake.y, lake.z), this.spot);
    this.ui.setChip(true, this.save.fishing.level, this.save.fishing.xp, xpForLevel(this.save.fishing.level));
  }

  public isActive(): boolean {
    return this.phase !== 'off';
  }

  /** True while the reel is running, i.e. the bar owns the mouse. */
  public isReeling(): boolean {
    return this.phase === 'reel';
  }

  /**
   * Is there water within arm's reach of where the player is standing?
   *
   * A ring of probes rather than a shoreline polygon: the sheet is a height
   * grid that wanders, and "how far to the water" is a question it can answer
   * eight times a frame for nothing. Depth is required, not just a wet cell —
   * the first metre of a beach is a centimetre deep, and a float there sits on
   * the sand.
   */
  public canFishHere(): boolean {
    if (this.phase !== 'off') return false;
    if (!this.isAvailableMap || !this.water) return false;

    const body = this.player.getPosition();
    // Sixteen directions, three rings. The probe is cheap (a bilinear read of
    // two grids) and the shoreline is not a circle: a bank that runs diagonally
    // past the player sits between two of eight directions, and the prompt
    // would blink on and off as they walked along it.
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      for (const radius of [1.2, 2.2, SHORE_REACH]) {
        if (this.water.depthAt(body.x + cos * radius, body.z + sin * radius) >= MIN_SHORE_DEPTH) {
          return true;
        }
      }
    }
    return false;
  }

  /** What the E prompt should say, or null when E does something else. */
  public getPromptLabel(): string | null {
    if (this.phase !== 'off') return 'Stop fishing';
    return this.canFishHere() ? 'Fish' : null;
  }

  /**
   * E: start fishing, or pack up.
   *
   * Returns true when the press was consumed, so the hunt's pickup handler does
   * not also run and charge the player a mistake for standing at the water.
   */
  public interact(): boolean {
    if (this.phase === 'off') {
      if (!this.canFishHere()) return false;
      this.begin();
      return true;
    }
    // Mid-reel the key is ignored: the player is holding a button and looking
    // at a bar, and a stray E should not throw the fish back.
    if (this.phase === 'reel') return true;
    this.end();
    return true;
  }

  private begin(): void {
    const animator = this.player.getAnimator();
    if (!animator || !animator.beginFishing()) return;

    const hand = animator.findBone('RightHand');
    if (!hand) {
      animator.endFishing();
      return;
    }
    // Both fists go on the rod. The idle and the cast were authored for a
    // two-handed hold, and the left hand is 22 cm across the shaft from the
    // right one — see `FishingRod`.
    this.rod.attach(hand, animator.findBone('LeftHand'));
    this.rod.show();

    // The rod is a two-handed, full-body performance. First person would put
    // the lens inside the character's own arm.
    this.cameraController.setMode('third');
    this.player.getGroup().visible = true;

    const yaw = this.cameraController.getYaw();
    this.player.getController()?.setFacing(yaw + Math.PI);

    this.phase = 'idle';
    this.power = 0;
    this.species = null;
    this.ui.setStatus('Hold the button to cast');
    this.ui.setPower(false);
    this.ui.showBite(false);
    this.ui.hideCard();
    this.ui.setChip(true, this.save.fishing.level, this.save.fishing.xp, xpForLevel(this.save.fishing.level));

    // The school is built once per map, around the nearest water to the spawn.
    // A player who walks a hundred metres up the bank and casts would be
    // fishing an empty stretch of lake, so the school moves with them — the
    // fish are a shoal you can see, not a global spawn table.
    const body = this.player.getPosition();
    if (this.water && this.spot && this.school.distanceTo(body) > 28) {
      const lake = this.water.nearestOpenWater(body.x, body.z, 60);
      if (lake) void this.school.populate(this.water, new THREE.Vector3(lake.x, lake.y, lake.z), this.spot);
    }
  }

  /**
   * Packs the rod away.
   *
   * `silent` is for a map change: the world under the player is about to be
   * replaced, and restoring the camera to a body that is being repositioned
   * would fight the spawn.
   */
  public end(silent = false): void {
    if (this.phase === 'off') {
      this.ui.hideAll();
      return;
    }
    this.phase = 'off';
    this.rod.hide();
    this.bobberMesh.visible = false;
    this.line.visible = false;
    this.school.scatter(this.bobber);
    this.ui.hideAll();
    this.found.hide();
    this.ui.setStatus(null);
    this.cameraController.setLookEnabled(true);
    this.player.getAnimator()?.endFishing();
    if (!silent) this.ui.setChip(true, this.save.fishing.level, this.save.fishing.xp, xpForLevel(this.save.fishing.level));
  }

  /** The left button went down. */
  public primaryDown(): void {
    switch (this.phase) {
      case 'idle':
        this.phase = 'charge';
        this.power = 0;
        this.ui.setStatus('Release to cast');
        this.ui.setPower(true, 0);
        break;
      case 'wait':
        // Reeling in an empty line is how you say "not here".
        this.retrieve('Nothing took it. Try another spot.');
        break;
      case 'bite':
        this.startReel();
        break;
    }
  }

  /** The left button came up. */
  public primaryUp(): void {
    if (this.phase !== 'charge') return;
    this.release();
  }

  private release(): void {
    const animator = this.player.getAnimator();
    if (!animator) return;

    const target = this.pickCastTarget(this.power);
    this.ui.setPower(false);
    this.ui.setStatus(null);

    if (!target) {
      this.power = 0;
      this.phase = 'idle';
      this.ui.setStatus('No water that way');
      this.retrieveAfter(1200);
      return;
    }

    this.castTo.copy(target);
    this.rod.getTip(this.castFrom);
    this.released = false;
    this.flight = 0;
    this.flightTime = 0.52 + this.castFrom.distanceTo(this.castTo) * 0.016;
    animator.releaseCast(this.power);
    this.phase = 'cast';
  }

  /**
   * Where the float lands, for a given power.
   *
   * Marched along the camera's forward, not thrown at the reticle: the reticle
   * is a pick-up cursor, and the cast is aimed by where the player is looking.
   * The march stops at the last deep-enough sample, so a cast at full power
   * towards a far bank lands in the water rather than in the reeds.
   */
  private pickCastTarget(power: number): THREE.Vector3 | null {
    if (!this.water) return null;
    const body = this.player.getPosition();
    const yaw = this.cameraController.getYaw();
    _castDir.set(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();

    const wanted = CAST_MIN + clamp(power, 0, 1) * (CAST_MAX - CAST_MIN);
    let best: THREE.Vector3 | null = null;

    for (let distance = 1.5; distance <= wanted + 0.01; distance += 0.5) {
      const x = body.x + _castDir.x * distance;
      const z = body.z + _castDir.z * distance;
      const surface = this.water.heightAt(x, z);
      // A gap in the sheet is the far side of the water, not the end of the
      // cast: the ray may cross a spit of land and reach open water beyond it,
      // and stopping there would refuse a cast that is perfectly possible.
      if (surface === null) continue;
      if (this.water.depthAt(x, z) < MIN_CAST_DEPTH) continue;
      best = new THREE.Vector3(x, surface, z);
    }

    return best;
  }

  private retrieve(message: string): void {
    this.school.scatter(this.bobber);
    this.bobberMesh.visible = false;
    this.line.visible = false;
    this.phase = 'idle';
    this.ui.showBite(false);
    this.ui.setStatus(message);
    this.ui.setPower(false);
    this.retrieveAfter(1500);
  }

  /** A message, then back to "hold to cast". */
  private retrieveAfter(ms: number): void {
    window.setTimeout(() => {
      if (this.phase !== 'idle') return;
      this.ui.setStatus('Hold the button to cast');
    }, ms);
  }

  private startReel(): void {
    const animator = this.player.getAnimator();
    if (!animator) return;

    const species = this.species ?? this.pickFish();
    this.species = species;
    const level = this.save.fishing.level;

    this.zoneH = zoneHeight(level, species);
    this.zoneY = 0.28;
    this.zoneV = 0;
    this.fishY = 0.5;
    this.fishTarget = 0.5;
    this.fishTimer = 0;
    this.progress = PROGRESS_START;
    this.perfect = true;

    this.phase = 'reel';
    this.ui.showBite(false);
    this.ui.startReel(species.name, level, this.zoneH);
    this.ui.setStatus(null);
    animator.startReel();
    // The bar is held with the same mouse that turns the view. Freezing the
    // look is what stops the camera drifting off the float mid-fight.
    this.cameraController.setLookEnabled(false);
    this.school.hook(this.bobber);
  }

  private finishCatch(): void {
    const species = this.species;
    if (!species) return;
    const animator = this.player.getAnimator();
    const level = this.save.fishing.level;

    const kg = +(species.kg[0] + Math.random() * (species.kg[1] - species.kg[0])).toFixed(1);
    const xp = Math.round(species.xp * (this.perfect ? 1.25 : 1));
    const before = this.save.fishing.level;
    const { level: newLevel } = this.save.recordCatch(species.id, kg, xp);

    this.rod.getTip(_liftTo);
    this.school.lift(this.bobber, _liftTo);
    this.splash(this.bobber.x, this.bobber.y, this.bobber.z);
    animator?.landCatch();
    this.bobberMesh.visible = false;
    this.line.visible = false;

    const report: CatchReport = {
      name: species.name,
      kg,
      xp,
      perfect: this.perfect,
      level: newLevel > before ? newLevel : null,
    };
    this.ui.endReel();
    this.ui.setChip(true, newLevel, this.save.fishing.xp, xpForLevel(newLevel));

    // The catch gets the same card a hidden object gets: the word, the model
    // turning on its own little stage, the name underneath. It is the same
    // event — something came out of the world and it is yours — and two
    // different-looking notifications for it would be two different feelings.
    const fish = this.school.displayClone(species.id);
    const line = [
      `${kg.toFixed(1)} kg`,
      `+${xp} XP`,
      report.perfect ? 'landed clean' : null,
      report.level ? `Level ${report.level}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    if (fish) {
      this.found.showObject(fish, 'Found', species.name, line, RESULT_MS - 520, undefined, false);
    } else {
      // No model means no card; the report still has to be readable.
      this.ui.showCatch(report);
    }

    this.phase = 'result';
    this.resultLeft = RESULT_MS / 1000;
    this.cameraController.setLookEnabled(true);
  }

  private finishEscape(): void {
    this.school.scatter(this.bobber);
    this.player.getAnimator()?.returnToHold();
    this.ui.endReel();
    this.ui.showEscape();
    this.ui.setChip(true, this.save.fishing.level, this.save.fishing.xp, xpForLevel(this.save.fishing.level));
    this.phase = 'result';
    this.resultLeft = 2200 / 1000;
    this.cameraController.setLookEnabled(true);
  }

  /**
   * One frame.
   *
   * Runs before the camera follows the body, so a float that is moving this
   * frame is where the lens will look for it this frame.
   */
  public update(delta: number): void {
    const animator = this.player.getAnimator();

    switch (this.phase) {
      case 'idle':
        // Standing with the rod up: the idle clip has its own sway, so nothing
        // here drives the arm until the player actually starts a cast.
        break;

      case 'charge': {
        this.power = Math.min(1, this.power + delta / CHARGE_TIME);
        this.ui.setPower(true, this.power);
        animator?.aimCast(this.power);
        break;
      }

      case 'cast': {
        const time = animator?.getCastTime() ?? null;
        if (!this.released && (time === null || time >= 2.02)) {
          this.released = true;
          this.bobberMesh.visible = true;
          this.line.visible = true;
        }
        if (this.released) {
          this.flight = Math.min(1, this.flight + delta / this.flightTime);
          this.bobber.lerpVectors(this.castFrom, this.castTo, this.flight);
          // A hard arc: up fast, down under gravity. It is the only parabola
          // in the game and it is what makes the cast read as thrown.
          this.bobber.y += Math.sin(this.flight * Math.PI) * (0.7 + this.power * 1.5);
          this.bobberMesh.position.copy(this.bobber);
          if (this.flight >= 1) this.landFloat();
        }
        break;
      }

      case 'wait': {
        this.wait -= delta;
        this.bobberMesh.position.y = this.bobber.y + Math.sin(performance.now() * 0.0016) * 0.012;
        this.bobberMesh.rotation.z = Math.sin(performance.now() * 0.0011) * 0.06;
        if (this.wait <= 0) {
          this.phase = 'bite';
          this.biteLeft = BITE_WINDOW;
          this.ui.showBite(true);
          this.ui.setStatus(null);
          this.school.hook(this.bobber);
          this.ripple(this.bobber.x, this.bobber.z, true);
        }
        break;
      }

      case 'bite': {
        this.biteLeft -= delta;
        // The float goes under and stays under: that is the whole tell.
        this.bobberMesh.position.y = this.bobber.y - 0.09 + Math.sin(performance.now() * 0.03) * 0.02;
        if (this.biteLeft <= 0) {
          this.ui.showBite(false);
          this.school.scatter(this.bobber);
          this.retrieve('Too slow — it spat the hook.');
        }
        break;
      }

      case 'reel': {
        this.updateReel(delta);
        break;
      }

      case 'result': {
        this.resultLeft -= delta;
        if (this.resultLeft <= 0) {
          this.ui.hideCard();
          this.found.hide();
          this.ui.endReel();
          this.phase = 'idle';
          this.ui.setStatus('Hold the button to cast');
          this.species = null;
        }
        break;
      }
    }

    // The line, the rings and the rod's crank run in every phase that has a
    // rod in hand: the line is drawn from the tip even while the float is in
    // the air.
    this.updateLine();
    this.updateEffects(delta);
    this.school.update(delta, this.player.getPosition());
  }

  /**
   * The rod's own per-frame work: where it points, and the reel crank.
   *
   * Called by the frame loop *after* the body has been posed. The rod hangs off
   * the hand bone, so its grip is only correct once this frame's arm is in
   * place — computing it earlier aims the rod at where the hand was.
   */
  public updateRod(deltaSeconds: number): void {
    this.aimRod();
    this.rod.update(deltaSeconds, this.phase === 'reel');
  }

  /** The next fish to take the bait, out of this map's roster. */
  private pickFish(): FishSpecies {
    if (!this.spot) return FISH[0];
    return pickSpecies(this.save.fishing.level, this.spot);
  }

  /** Turns the cast curve into a world direction and hands it to the rod. */
  private aimRod(): void {    const animator = this.player.getAnimator();
    const castTime = animator?.getCastClipTime() ?? null;
    const [elevation, azimuth] =
      this.phase === 'reel' ? ROD_AIM.reel : castTime != null ? aimAt(castTime) : ROD_AIM.idle;

    // The curve is written in the character's own frame — 0° is straight ahead,
    // 90° is over one shoulder — so it survives the player turning on the spot
    // without a second set of numbers. The roster's model faces +Z, which is
    // why this is (sin, ., cos) and not the (sin, ., -cos) the cast ray uses:
    // the ray works in camera yaw, and the body was turned to face it.
    const yaw = this.player.getGroup().rotation.y;
    const angle = yaw + THREE.MathUtils.degToRad(azimuth);
    const el = THREE.MathUtils.degToRad(elevation);
    const flat = Math.cos(el);
    _aimDir.set(Math.sin(angle) * flat, Math.sin(el), Math.cos(angle) * flat);
    this.rod.aim(_aimDir);
  }

  /** The float has landed: start the wait and call the fish over. */
  private landFloat(): void {
    if (!this.water) return;
    const surface = this.water.heightAt(this.bobber.x, this.bobber.z);
    this.bobber.y = (surface ?? this.bobber.y) + 0.02;
    this.bobberMesh.position.copy(this.bobber);
    this.ripple(this.bobber.x, this.bobber.z, true);
    this.player.getAnimator()?.holdLine();

    this.species = this.school.approach(this.bobber) ?? this.pickFish();
    this.wait = biteDelay(this.save.fishing.level);
    this.phase = 'wait';
    this.ui.setStatus('Wait for a bite');
  }

  /**
   * The bar.
   *
   * The zone accelerates rather than following the button: `v` is integrated,
   * so a tap is a nudge and a hold is a climb that overshoots. That is the
   * entire difficulty of the minigame — the fish is random, the zone is not.
   */
  private updateReel(delta: number): void {
    const held = this.input.isPrimaryHeld();
    this.zoneV += (held ? ZONE_UP : -ZONE_DOWN) * delta;
    this.zoneV = clamp(this.zoneV, -ZONE_MAX_SPEED, ZONE_MAX_SPEED);
    this.zoneY += this.zoneV * delta;

    if (this.zoneY < 0) {
      this.zoneY = 0;
      this.zoneV *= -0.3;
    }
    if (this.zoneY > 1 - this.zoneH) {
      this.zoneY = 1 - this.zoneH;
      this.zoneV = 0;
    }

    // The fish darts to a new depth every interval and eases towards it. The
    // ease is what makes it catchable: a fish that teleported would be a coin
    // toss, a fish that leans is a thing you can lead.
    const species = this.species ?? FISH[0];
    this.fishTimer -= delta;
    if (this.fishTimer <= 0) {
      this.fishTimer = species.interval * (0.75 + Math.random() * 0.6);
      this.fishTarget = 0.04 + Math.random() * 0.92;
    }
    const pull = clamp((this.fishTarget - this.fishY) * 4, -1, 1);
    this.fishY += pull * species.speed * delta * 1.55;
    this.fishY = clamp(this.fishY, 0.03, 0.97);

    const inZone = this.fishY >= this.zoneY && this.fishY <= this.zoneY + this.zoneH;
    this.progress += (inZone ? PROGRESS_GAIN : -PROGRESS_LOSS) * delta;
    if (!inZone) this.perfect = false;

    this.ui.updateReel({
      zoneY: this.zoneY,
      zoneH: this.zoneH,
      fishY: this.fishY,
      progress: this.progress,
      inZone,
    });

    // The float jumps with the fish while it is being fought.
    this.bobberMesh.position.x = this.bobber.x + Math.sin(performance.now() * 0.012) * (inZone ? 0.05 : 0.13);
    this.bobberMesh.position.y = this.bobber.y - 0.05 + Math.sin(performance.now() * 0.022) * 0.03;

    if (Math.random() < delta * 2.2) this.ripple(this.bobber.x, this.bobber.z, false);

    if (this.progress >= 1) this.finishCatch();
    else if (this.progress <= 0) this.finishEscape();
  }

  /** Draws the line from the rod tip to the float, with sag. */
  private updateLine(): void {
    if (!this.line.visible) return;
    this.rod.getTip(_tip);
    const position = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const tight = this.phase === 'reel' ? 0.06 : this.phase === 'bite' ? 0.25 : 0.85;
    const sag = sagFor(_tip.distanceTo(this.bobber)) * tight;

    for (let i = 0; i < this.linePoints; i++) {
      const k = i / (this.linePoints - 1);
      position.setXYZ(
        i,
        _tip.x + (this.bobber.x - _tip.x) * k,
        _tip.y + (this.bobber.y - _tip.y) * k - Math.sin(k * Math.PI) * sag,
        _tip.z + (this.bobber.z - _tip.z) * k
      );
    }
    position.needsUpdate = true;
  }

  /** A ring on the water. */
  private ripple(x: number, z: number, big: boolean): void {
    if (this.rings.length > 14) return;
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.16, 18),
      new THREE.MeshBasicMaterial({
        color: 0xf4ecd9,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, (this.water?.heightAt(x, z) ?? this.bobber.y) + 0.03, z);
    this.effects.add(mesh);
    this.rings.push({ mesh, t: 0, big });
  }

  /** A splash, when something is pulled out of the lake. */
  private splash(x: number, y: number, z: number): void {
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 5, 4),
        new THREE.MeshBasicMaterial({ color: 0xe8f2f2, toneMapped: false })
      );
      mesh.position.set(x, y, z);
      this.effects.add(mesh);
      this.drops.push({
        mesh,
        v: new THREE.Vector3((Math.random() - 0.5) * 2.4, 2.2 + Math.random() * 2.6, (Math.random() - 0.5) * 2.4),
        t: 0,
      });
    }
    this.ripple(x, z, true);
  }

  private updateEffects(delta: number): void {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.t += delta;
      const scale = 1 + ring.t * (ring.big ? 5 : 3.2);
      ring.mesh.scale.set(scale, scale, scale);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.75 - ring.t * (ring.big ? 0.85 : 1.3));
      if ((ring.mesh.material as THREE.MeshBasicMaterial).opacity <= 0) {
        this.effects.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        (ring.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      drop.t += delta;
      drop.v.y -= 11 * delta;
      drop.mesh.position.addScaledVector(drop.v, delta);
      const surface = this.water?.heightAt(drop.mesh.position.x, drop.mesh.position.z) ?? 0;
      if (drop.mesh.position.y < surface || drop.t > 2.5) {
        this.effects.remove(drop.mesh);
        drop.mesh.geometry.dispose();
        (drop.mesh.material as THREE.Material).dispose();
        this.drops.splice(i, 1);
      }
    }
  }

  /** A map change or a round restart: nothing of the last trip survives. */
  public reset(): void {
    this.end(true);
    this.school.clear();
    for (const ring of this.rings) {
      this.effects.remove(ring.mesh);
      ring.mesh.geometry.dispose();
      (ring.mesh.material as THREE.Material).dispose();
    }
    this.rings.length = 0;
    for (const drop of this.drops) {
      this.effects.remove(drop.mesh);
      drop.mesh.geometry.dispose();
      (drop.mesh.material as THREE.Material).dispose();
    }
    this.drops.length = 0;
  }

  public dispose(): void {
    this.reset();
    this.rod.dispose();
    this.school.dispose();
    this.scene.remove(this.bobberMesh);
    this.scene.remove(this.line);
    this.scene.remove(this.effects);
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }

  /** The debug handle's view of the state machine. */
  public get debugState(): Record<string, unknown> {
    return {
      phase: this.phase,
      power: +this.power.toFixed(2),
      bobber: [+this.bobber.x.toFixed(2), +this.bobber.y.toFixed(2), +this.bobber.z.toFixed(2)],
      species: this.species?.id ?? null,
      progress: +this.progress.toFixed(2),
      zone: [+this.zoneY.toFixed(2), +this.zoneH.toFixed(2)],
      fish: +this.fishY.toFixed(2),
      fishCount: this.school.count,
    };
  }
}

/** Sag scales with span: a 3 m line hangs a little, a 16 m line hangs a lot. */
function sagFor(span: number): number {
  return Math.min(1.6, 0.18 + span * 0.085);
}

/**
 * The float: a red top and a white bottom.
 *
 * Two hemispheres rather than a texture, because the game has no textures on
 * props and a float is the one object the player will stare at for six seconds
 * at a time.
 */
function makeBobber(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'fishing-bobber';
  const red = new THREE.MeshBasicMaterial({ color: 0xb0472a, toneMapped: false });
  const white = new THREE.MeshBasicMaterial({ color: 0xf4ecd9, toneMapped: false });
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), red);
  const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), white);
  group.add(top, bottom);
  return group;
}
