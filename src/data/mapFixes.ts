/**
 * Per-map corrections applied at load time.
 *
 * The kits are bought as-is and they are good, but they are assembled by an
 * author dropping props at one Y on terrain that slopes. Every map has a few
 * places where that shows: a fence whose last two metres hang over a bank, a
 * boardwalk end with nothing under it. They cannot be fixed in the art, because
 * the archive is a binary someone else produced, and they should not be fixed
 * by silently sinking props — a prop that is moved is a prop whose collision no
 * longer matches what the player sees.
 *
 * So the corrections are explicit, one line each, with the reason attached.
 * `tools/audit-grounding.mjs` finds the candidates: it decodes the Draco
 * terrain and reports props that stand at ground level at their centre but hang
 * in the air at one corner. Run it after adding a map.
 *
 * Matching is by mesh name plus distance from the mesh's own bounding-box
 * centre, because kit node names repeat: map 1 has ten meshes called `fence`,
 * and only one of them is wrong.
 */

export interface PropRemoval {
  /** Mesh name in the kit. This is the *part* name, not the kit part name. */
  name: string;
  /** Centre of the offending mesh's bounding box, in world space. */
  at: [number, number, number];
  /** Match tolerance in metres. Defaults to 0.6. */
  radius?: number;
  /** Why it is gone. Required: a removal without a reason is a mystery later. */
  why: string;
}

export const PROP_REMOVALS: Record<string, PropRemoval[]> = {
  'campground-lake': [
    {
      name: 'fence',
      // Fourth segment of the shore fence, the one that runs from z 9 to z 10.9.
      at: [-14.39, -0.62, 9.95],
      why:
        'The bank falls from -1.29 to -1.92 under its far end while the segment ' +
        'sits at -1.17, leaving 0.75 m of air beneath the last two metres. The ' +
        'three segments before it only clear the ground by 10-14 cm, which reads ' +
        'as a fence following a slope; this one reads as a fence end floating.',
    },
  ],
};
