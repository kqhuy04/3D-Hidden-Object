/**
 * The shape of a per-map correction.
 *
 * The corrections themselves live one file per map, in this directory, and are
 * collected in `index.ts`. They used to share a single `mapFixes.ts`, which
 * made every map edit touch the same object literal — two people fixing two
 * different maps conflicted on the same lines for no reason.
 *
 * Matching is by mesh name plus distance from the mesh's own bounding-box
 * centre, because kit node names repeat: map 1 has ten meshes called `fence`,
 * and only one of them is wrong.
 */

export interface PropRemoval {
  /**
   * Mesh name in the kit. This is the *part* name, not the kit part name, and
   * the kits suffix repeated parts: the fourth `fence` in a run is `fence_3`.
   */
  name: string;
  /** Centre of the offending mesh's bounding box, in world space. */
  at: [number, number, number];
  /** Match tolerance in metres. Defaults to 0.6. */
  radius?: number;
  /** Why it is gone. Required: a removal without a reason is a mystery later. */
  why: string;
}

/**
 * A prop moved, rather than deleted.
 *
 * Only for whole *structures* — a bridge, a boardwalk, a fence run — where the
 * object is right and its height is wrong. A structure is one placement node
 * with a dozen parts under it, so it is addressed by that node's name and moved
 * as a unit; moving the parts one by one would pull the deck off its posts.
 */
export interface PropShift {
  /** Placement node in the kit, e.g. `creek-footbridge`. */
  node: string;
  /** Offset added to the node, in metres, in world axes. */
  by: [number, number, number];
  /** Why it moved. Same rule as a removal: no reason, no entry. */
  why: string;
}

/** Everything one map needs. Omit a list rather than exporting an empty one. */
export interface MapFixes {
  removals?: PropRemoval[];
  shifts?: PropShift[];
}
