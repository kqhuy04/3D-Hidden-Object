import * as THREE from 'three';

/**
 * Something in the map the player can act on with E.
 *
 * Two systems produce these now — the people who can be asked (`NpcCrowd`) and
 * the animals that can be ridden (`Mounts`) — and the selector treats them all
 * the same way. It used to live beside the door/lamp/wheel verbs; those are
 * gone, but the shape they defined is what the other two fill in, so it stays.
 */
export interface InteractableAction {
  key: string;
  object: THREE.Object3D;
  centre: THREE.Vector3;
  radius: number;
  /** What E will do, in the imperative. Changes as the thing changes state. */
  label(): string;
  use(): void;
  /**
   * False while the action makes no sense, e.g. "Ride" offered for a horse you
   * are already sitting on a different one of. The selector skips it entirely,
   * so the prompt cannot offer something that is not on.
   */
  enabled?(): boolean;
  /**
   * True when the thing walks. A horse ridden across the map and a person
   * strolling home cannot be filed in a spatial hash at load time, because a
   * cell key worked out then is a lie two seconds later. Moving actions are
   * held in a flat list and re-measured every frame — there are a handful of
   * them, so the cost is a few distance checks rather than a second hash.
   */
  moving?: boolean;
  /**
   * True when the highlight should leave this alone.
   *
   * A person is not a prop: lighting one up to say "you can talk to this" makes
   * the map feel like a vending machine. The prompt alone is enough.
   */
  quiet?: boolean;
}
