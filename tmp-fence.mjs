// Prints the terrain height under each end of every fence segment, next to the
// segment's own bottom and top. A segment whose bottom is above the ground at
// one end and below it at the other is a segment on a slope; one whose bottom
// is above the ground at *both* ends is floating.
import { readFileSync } from 'node:fs';
const src = readFileSync('tmp-ground.mjs', 'utf8');
