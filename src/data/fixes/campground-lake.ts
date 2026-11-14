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
    {
      name: 'ladder-timber',
      // The boarding ladder hung off the swim raft at (27.5, 29).
      at: [27.98, -3.01, 30.49],
      why:
        'Two faults in one prop. A ladder on a floating raft has nothing to lead ' +
        'down to, and the raft is the shallowest-draft craft in the kit, so a ' +
        'ladder hanging a metre under the deck was also the lowest point on it — ' +
        'settleProps beds the *lowest vertex* at the waterline, which lifted the ' +
        'deck half a metre clear of the lake. Removing the ladder lets the float ' +
        'sit in the water where it belongs.',
    },
    {
      name: 'painter-rope',
      // Bow line of the skiff moored at (12.7, 30.6).
      at: [12.86, -3.37, 32.9],
      why:
        'A painter is the rope that ties a boat to something. This one ends in a ' +
        'mooring ring hanging over open water with nothing on the other end, so ' +
        'it reads as a rope tied to the air.',
    },
    {
      name: 'painter-rope_1',
      // Bow line of the second skiff, moored at (6.5, 34).
      at: [7.65, -3.37, 35.99],
      why:
        'Same defect as the first: a bow line with no bollard, cleat or ring to ' +
        'reach. Both are removed so the two skiffs match.',
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
    {
      node: 'swim-raft',
      by: [0, -0.35, 0],
      why:
        'SettleProps beds the raft\'s lowest vertex at the waterline, which is ' +
        'right for a hull and wrong for a pontoon: the whole platform then stood ' +
        'clear of the lake on top of the water rather than in it. Sinking it 35 ' +
        'cm puts the floats under the surface, where a pontoon belongs, and ' +
        'brings the deck down to a height you step onto from a boat. Tune this ' +
        'number here if it still reads high.',
    },
  ],
};

export default fixes;
