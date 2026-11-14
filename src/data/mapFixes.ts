/**
 * Re-export shim.
 *
 * The fix tables were split into `./fixes/`, one file per map, so that editing
 * one map does not touch the same lines as editing another. This module keeps
 * the old import path working — `WorldLoader` and the tests still say
 * `data/mapFixes` — so the split did not have to be a rename as well.
 *
 * New work should import from here anyway: the shape of the data is what
 * callers care about, and where the entries are stored is an implementation
 * detail of this folder.
 */

export type { MapFixes, PropRemoval, PropShift } from './fixes/types';
export { PROP_REMOVALS, PROP_SHIFTS } from './fixes/index';
