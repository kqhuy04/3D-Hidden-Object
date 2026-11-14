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
 * in the air at one corner. Run it after adding a map:
 *
 *   node tools/audit-grounding.mjs --map <id> --limit 0.15
 *
 * ## One file per map
 *
 * Each map's list lives in `./<map-id>.ts` and is registered below. Editing one
 * map touches one file plus one line here, so two people working on two maps do
 * not collide. Adding a map means: create the file, add the import, add the
 * entry.
 */

import type { MapFixes, PropRemoval, PropShift } from './types';
import campgroundLake from './campground-lake';

/** Every map that has corrections. Keys are registry ids from `mapRegistry`. */
const FIXES: Record<string, MapFixes> = {
  'campground-lake': campgroundLake,
};

export const PROP_REMOVALS: Record<string, PropRemoval[]> = {};
export const PROP_SHIFTS: Record<string, PropShift[]> = {};

for (const [mapId, fixes] of Object.entries(FIXES)) {
  // An empty array is not the same as no entry: `WorldLoader` skips the pass
  // entirely when the lookup misses, and a pointless empty pass is cheap but
  // noisy in a profile. Omit instead.
  if (fixes.removals?.length) PROP_REMOVALS[mapId] = fixes.removals;
  if (fixes.shifts?.length) PROP_SHIFTS[mapId] = fixes.shifts;
}
