import * as THREE from 'three';
import { HiddenItem } from './HiddenItemSystem';
import { PropTarget } from './PropTargets';
import { InteractableAction } from '../interact/InteractableAction';
import { WorldCollision } from '../world/WorldCollision';

/** Anything the player can point at and press E on. */
export interface Candidate {
  /** Stable identity across frames, so a selection can survive a re-sort. */
  key: string;
  /**
   * `item` is one of the five, `decoy` is a prop that costs a mistake, and
   * `action` is a prop that answers — a door, a wheel, a lantern.
   */
  kind: 'item' | 'decoy' | 'action';
  object: THREE.Object3D;
  centre: THREE.Vector3;
  radius: number;
  /** Distance from the player's chest to the object's centre, in metres. */
  distance: number;
  /** The hunt item, when this candidate is one. */
  item?: HiddenItem;
  /** The verb, when this candidate is something that answers. */
  action?: InteractableAction;
}

const _projected = new THREE.Vector3();
const _toTarget = new THREE.Vector3();

/**
 * How far off the screen centre a target may be and still be selectable.
 *
 * Loose on purpose. The crosshair no longer picks the target — the nearest
 * object does — so a tight cone would make the thing at your elbow
 * unselectable just because you are looking past it. What is left of this gate
 * is "is it on screen", which is what stops the prompt appearing for something
 * behind the player.
 */
const MAX_OFF_AXIS = 0.55;

/**
 * Spatial hash for the prop list, in metres per cell.
 *
 * Every small prop on the map is a candidate, and the biggest maps have nearly
 * nine hundred of them. Testing all of them every frame — a projection each,
 * plus a triangle-soup raycast for the ones in reach — was the frame drop the
 * player felt whenever they walked past a market stall. A cell size of four
 * metres puts a reach of three metres inside a 3×3 block of cells, so the loop
 * sees a dozen props instead of nine hundred.
 */
const CELL = 4;

/** How many candidates Tab can walk through in one spot. */
const MAX_CANDIDATES = 6;

/**
 * Fresh occlusion rays allowed in one frame.
 *
 * A ray through a whole map is about three quarters of a millisecond here, and
 * the old budget of ten let a crowded corner spend seven of them in a single
 * frame — half a 60 fps budget, on the frame the player happened to walk into a
 * market stall. The answer only has to be right within a couple of frames,
 * because the player is not pressing E faster than that, so the rest of the
 * candidates are taken on trust for a frame or two and asked about next frame:
 * an answered candidate is cached for `SIGHT_TTL`, so the backlog drains at two
 * per frame and the steady state is zero rays.
 *
 * A hidden object is never taken on trust. It is the one candidate the whole
 * hunt is about, there is at most one of them within reach, and a prompt for an
 * object that is actually behind a wall would be the game lying to the player.
 */
const RAYS_PER_FRAME = 2;

/**
 * How long a Tab choice survives the nearest-wins rule, in milliseconds.
 *
 * The player deliberately stepped off the nearest object; snapping back to it
 * on the next frame would make Tab look broken.
 */
const CYCLE_GRACE = 3000;

/** How long an occlusion answer stands, in milliseconds. */
const SIGHT_TTL = 200;
/** How far the camera may move before that answer is stale, in metres. */
const SIGHT_MOVE = 0.5;

/**
 * Decides which single object the player is currently pointing at.
 *
 * The rule is the one a hand follows: *the nearest thing within reach*. Screen
 * position only decides whether the object is in front of the player at all.
 * Scoring by how close an object is to the centre of the screen was the wrong
 * question — it made a distant crate dead ahead beat the can at your feet, and
 * it made the answer move every time the mouse did.
 *
 * The selection is still sticky, but only for a moment after Tab: the sort is
 * by distance, which does not jitter, so there is nothing to protect the
 * selection from except the player walking closer to something else.
 */
export class InteractableSelector {
  private props: PropTarget[] = [];
  private actions: InteractableAction[] = [];
  private grid = new Map<string, PropTarget[]>();
  private actionGrid = new Map<string, InteractableAction[]>();
  /**
   * The actions that walk: horses under a rider, people.
   *
   * Not in the grid, because their centres change and a cell key is a snapshot.
   * There are never more than a handful, so testing them outright every frame
   * costs less than keeping their keys honest would.
   */
  private movingActions: InteractableAction[] = [];
  private maxRadius = 0.5;
  private selectedKey: string | null = null;
  private candidates: Candidate[] = [];
  /** Wall-clock time until which a Tab choice outranks "nearest". */
  private stickyUntil = 0;
  /**
   * Props already tried and found wanting.
   *
   * A rejected prop stops being a candidate. Without this, pressing E on a
   * barrel costs a strike and then the barrel is still the nearest thing in
   * reach, so the next press costs another one for the same mistake — the
   * player is punished for the game's refusal to remember.
   */
  private rejected = new Set<string>();

  /**
   * Last occlusion answer per candidate, and where the camera stood for it.
   *
   * A ray through a whole map costs about three quarters of a millisecond here,
   * so ten of them is half a frame — which is exactly the stutter reported when
   * walking past a crowded stall. The answer only changes when the camera
   * moves, so it is kept until the camera has moved half a metre or a fifth of
   * a second has passed. Behind a table edge nothing changes in 200 ms.
   */
  private sight = new Map<string, { x: number; y: number; z: number; at: number; clear: boolean }>();

  public setProps(props: PropTarget[]): void {
    this.props = props;
    this.sight.clear();
    this.grid.clear();
    this.maxRadius = 0.5;
    for (const prop of props) {
      if (prop.radius > this.maxRadius) this.maxRadius = prop.radius;
      const key = this.cellKey(prop.centre.x, prop.centre.z);
      const bucket = this.grid.get(key);
      if (bucket) bucket.push(prop);
      else this.grid.set(key, [prop]);
    }
    this.selectedKey = null;
    this.candidates = [];
    this.rejected.clear();
    this.stickyUntil = 0;
  }

  /**
   * The props that answer to E, indexed the same way as the decoys.
   *
   * Kept in their own grid rather than merged into the prop list because the
   * two answer E differently: one costs a mistake, the other opens.
   */
  public setActions(actions: readonly InteractableAction[]): void {
    this.actions = [...actions];
    this.actionGrid.clear();
    this.movingActions = [];
    for (const action of this.actions) {
      if (action.radius > this.maxRadius) this.maxRadius = action.radius;
      if (action.moving) {
        this.movingActions.push(action);
        continue;
      }
      const key = this.cellKey(action.centre.x, action.centre.z);
      const bucket = this.actionGrid.get(key);
      if (bucket) bucket.push(action);
      else this.actionGrid.set(key, [action]);
    }
  }

  public getProps(): readonly PropTarget[] {
    return this.props;
  }

  private cellKey(x: number, z: number): string {
    return `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
  }

  /**
   * Rebuilds the candidate list for this frame and resolves the selection.
   *
   * @param items the hunt's objects; found ones are skipped by the caller
   * @param reachFrom the player's chest — see `HiddenItemSystem.findTarget`
   */
  public update(
    items: readonly HiddenItem[],
    camera: THREE.PerspectiveCamera,
    cameraPosition: THREE.Vector3,
    reachFrom: THREE.Vector3,
    collision: WorldCollision,
    maxDistance: number
  ): void {
    const geometry = collision.getCollisionGeometry();
    const scored: Candidate[] = [];

    const consider = (
      object: THREE.Object3D,
      centre: THREE.Vector3,
      radius: number,
      key: string,
      kind: 'item' | 'decoy' | 'action',
      item?: HiddenItem,
      action?: InteractableAction
    ): void => {
      // Measured to the centre, and only the centre. This is the whole rule:
      // an arm's length of the object's own surface is what counts, so a sofa
      // you are standing beside is in reach even though its middle is a metre
      // away.
      const distance = reachFrom.distanceTo(centre);
      if (distance - radius > maxDistance) return;

      _projected.copy(centre).project(camera);
      if (_projected.z < -1 || _projected.z > 1) return;
      if (Math.max(Math.abs(_projected.x), Math.abs(_projected.y)) > MAX_OFF_AXIS) return;

      scored.push({ key, kind, object, centre, radius, distance, item, action });
    };

    for (const item of items) {
      if (item.found) continue;
      consider(item.object, item.centre, item.radius, `item:${item.placement.id}`, 'item', item);
    }

    // Only the cells the reach can actually touch. `maxRadius` is added because
    // a prop's *centre* may sit outside the reach while its body does not.
    const reach = maxDistance + this.maxRadius;
    const minX = Math.floor((reachFrom.x - reach) / CELL);
    const maxX = Math.floor((reachFrom.x + reach) / CELL);
    const minZ = Math.floor((reachFrom.z - reach) / CELL);
    const maxZ = Math.floor((reachFrom.z + reach) / CELL);

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const key = `${cx}:${cz}`;
        const bucket = this.grid.get(key);
        if (bucket) {
          for (const prop of bucket) {
            // Keyed by uuid, not by name: a kit names every chair `chair-mesh`,
            // and two props sharing a key makes the selection jump between them.
            const propKey = `prop:${prop.object.uuid}`;
            if (this.rejected.has(propKey)) continue;
            consider(prop.object, prop.centre, prop.radius, propKey, 'decoy');
          }
        }

        // The props that answer. They sort into the same list as everything
        // else, so the nearest thing in reach wins whether it opens, rings or
        // costs a mistake.
        const answering = this.actionGrid.get(key);
        if (answering) {
          for (const action of answering) {
            // An action that says it is not available right now — "Ride" for a
            // horse you are already riding another of — is not a candidate at
            // all, so the prompt cannot offer it.
            if (action.enabled && !action.enabled()) continue;
            consider(action.object, action.centre, action.radius, action.key, 'action', undefined, action);
          }
        }
      }
    }

    // The things that walk. Read from their live centres, which their owners
    // wrote this frame, so "Ask" follows the person and "Get off" follows the
    // horse instead of waiting for the player back at the stable.
    for (const action of this.movingActions) {
      if (action.enabled && !action.enabled()) continue;
      consider(action.object, action.centre, action.radius, action.key, 'action', undefined, action);
    }

    scored.sort((a, b) => a.distance - b.distance);

    // Nearest first, and the first one that is not behind something wins. The
    // raycast is the expensive part of this function, so it is spent in that
    // order, on a budget, and stops as soon as there are enough candidates for
    // Tab.
    const visible: Candidate[] = [];
    const now = performance.now();
    let rays = 0;
    for (const candidate of scored) {
      if (visible.length >= MAX_CANDIDATES) break;
      if (geometry) {
        const sighted = this.sightedRecently(candidate, cameraPosition, now);
        if (sighted === false) continue;
        if (sighted === null) {
          // Out of budget: keep the candidate for this frame and ask about it
          // on a later one. Dropping it instead would make the prompt flicker
          // off while the player walks, which reads as the game refusing E.
          const mustAsk = candidate.kind === 'item' || rays < RAYS_PER_FRAME;
          if (mustAsk) {
            rays++;
            _toTarget.copy(candidate.centre);
            const sight = cameraPosition.distanceTo(_toTarget);
            const t = geometry.raycastSegment(
              cameraPosition.x,
              cameraPosition.y,
              cameraPosition.z,
              _toTarget.x,
              _toTarget.y,
              _toTarget.z
            );
            // Same 0.35 m near-miss the hunt allows: a prop behind a table edge
            // is still a prop the player can see and mean.
            const blocked = t !== null && t * sight < sight - 0.35;
            this.rememberSight(candidate.key, cameraPosition, now, !blocked);
            if (blocked) continue;
          }
        }
      }
      visible.push(candidate);
    }

    this.candidates = visible;

    if (visible.length === 0) {
      this.selectedKey = null;
      return;
    }

    const sticky = performance.now() < this.stickyUntil;
    const stillThere = visible.some((c) => c.key === this.selectedKey);
    if (!sticky || !stillThere) this.selectedKey = visible[0].key;
  }

  /**
   * The cached occlusion answer for one candidate: `true` clear, `false`
   * blocked, `null` when it has to be asked again.
   */
  private sightedRecently(
    candidate: Candidate,
    cameraPosition: THREE.Vector3,
    now: number
  ): boolean | null {
    const cached = this.sight.get(candidate.key);
    if (!cached) return null;
    if (now - cached.at > SIGHT_TTL) return null;
    const moved =
      (cached.x - cameraPosition.x) ** 2 +
      (cached.y - cameraPosition.y) ** 2 +
      (cached.z - cameraPosition.z) ** 2;
    if (moved > SIGHT_MOVE * SIGHT_MOVE) return null;
    return cached.clear;
  }

  private rememberSight(
    key: string,
    cameraPosition: THREE.Vector3,
    now: number,
    clear: boolean
  ): void {
    // Bounded: a long round walks past hundreds of props, and an unbounded map
    // would turn a memory saving into a leak.
    if (this.sight.size > 256) this.sight.clear();
    this.sight.set(key, {
      x: cameraPosition.x,
      y: cameraPosition.y,
      z: cameraPosition.z,
      at: now,
      clear,
    });
  }

  /**
   * Moves to the next nearby candidate, wrapping.
   *
   * This is what makes a crowded corner playable: a market stall with nine
   * objects on it is nine tab presses instead of nine mouse corrections.
   */
  public cycle(): void {
    if (this.candidates.length < 2) return;
    const index = this.candidates.findIndex((c) => c.key === this.selectedKey);
    const next = this.candidates[(index + 1) % this.candidates.length];
    this.selectedKey = next.key;
    this.stickyUntil = performance.now() + CYCLE_GRACE;
  }

  public getSelected(): Candidate | null {
    if (!this.selectedKey) return null;
    return this.candidates.find((c) => c.key === this.selectedKey) ?? null;
  }

  public getCandidates(): readonly Candidate[] {
    return this.candidates;
  }

  /** Drops the selection, e.g. after a pickup or on a new round. */
  public clearSelection(): void {
    this.selectedKey = null;
    this.stickyUntil = 0;
  }

  /** Remembers that this prop was wrong, so it stops offering itself. */
  public reject(key: string): void {
    this.rejected.add(key);
    if (this.selectedKey === key) this.selectedKey = null;
    this.candidates = this.candidates.filter((c) => c.key !== key);
  }

  /**
   * Forgets every rejection but keeps the prop list: a retry replays the same
   * map, and a prop that was wrong last time is a fair guess again.
   */
  public resetRound(): void {
    this.rejected.clear();
    this.sight.clear();
    this.selectedKey = null;
    this.candidates = [];
    this.stickyUntil = 0;
  }

  public reset(): void {
    this.props = [];
    this.actions = [];
    this.movingActions = [];
    this.grid.clear();
    this.actionGrid.clear();
    this.maxRadius = 0.5;
    this.selectedKey = null;
    this.candidates = [];
    this.rejected.clear();
    this.sight.clear();
    this.stickyUntil = 0;
  }
}
