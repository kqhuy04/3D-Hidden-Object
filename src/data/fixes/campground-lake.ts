import type { MapFixes } from './types';

/**
 * Campground & Lake.
 *
 * The shore fence and the creek footbridge were the two grounding failures
 * `tools/audit-grounding.mjs` found first; they are what the whole mechanism
 * was built for. The rest of this map's list is hand-found — things a walk
 * turns up that no bounding-box test can see: a painter rope left hanging in
 * the air, a ladder bolted to a raft, a lily pad floating over dry grass.
 */
const fixes: MapFixes = {
  removals: [
    {
      name: 'fence_3',
      // Fourth segment of the shore fence, the one that runs from z 9 to z 10.9.
      at: [-14.39, -0.62, 9.95],
      why:
        'The bank falls from -1.29 to -1.92 under its far end while the segment ' +
        'sits at -1.17, leaving 0.75 m of air beneath the last two metres. The ' +
        'three segments before it only clear the ground by 10-14 cm, which reads ' +
        'as a fence following a slope; this one reads as a fence end floating.',
    },
  ],
  shifts: [
    {
      node: 'creek-footbridge',
      by: [0, -0.32, 0],
      why:
        'The bridge spans the dry creek from x -19.75 to -15.75 at z 1, and its ' +
        'underside sits at -0.93 while the two banks it lands on are at -1.14 ' +
        'and -1.24. Both ends therefore hang a hand-span clear of the ground — ' +
        'the "two corners in the air". Dropping it 32 cm beds the abutments into ' +
        'the banks, which is how a footbridge over a 30 cm gully is built.',
    },
  ],
};

export default fixes;
