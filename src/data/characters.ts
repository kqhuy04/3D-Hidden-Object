/**
 * Who the player is.
 *
 * Every one of these is a Polyfork character: the same 22-bone Mixamo rig plus
 * nine face joints, resting on y=0 between the heels. That shared rig is the
 * whole reason a roster is possible at all — `CharacterAnimator` drives the
 * body by bone *name*, so a character is a costume rather than a new system.
 *
 * The cast is deliberately mixed. Seven look like someone who could plausibly
 * have wandered in — a backpacker, a commuter, a nurse — and five plainly could
 * not, because a knight standing in a ski lift queue is the same joke the hunt
 * itself is built on. All twelve suit all twenty-two maps, which is the only
 * requirement: none of them is dressed for one particular place.
 *
 * Height is normalised to `GAME_CONFIG.player.capsuleHeight` on load, so the
 * capsule, the step height, the camera and the 3.2 m reach stay the numbers
 * they were tuned to. A 1.92 m knight and a 1.61 m porter both play identically.
 */

export interface CharacterDef {
  /** Polyfork asset id; the mesh lives at /assets/characters/<id>.glb. */
  id: string;
  name: string;
  /** One line under the name on the start screen. */
  blurb: string;
}

export const CHARACTERS: CharacterDef[] = [
  // --- Someone you could actually meet --------------------------------
  {
    id: 'family-road-tripper-247570',
    name: 'Road-Tripper',
    blurb: 'Maps folded, snacks gone, still smiling.',
  },
  {
    id: 'backpacker-f56207',
    name: 'Backpacker',
    blurb: 'Everything they own, on their back.',
  },
  {
    id: 'city-commuter-52a53f',
    name: 'Commuter',
    blurb: 'Wrong platform, wrong town, right on time.',
  },
  {
    id: 'forest-ranger-6906b0',
    name: 'Forest Ranger',
    blurb: 'Knows the woods. Does not know this place.',
  },
  {
    id: 'student-in-a-hoodie-7c8223',
    name: 'Student',
    blurb: 'Should be revising.',
  },
  {
    id: 'ward-nurse-84b61d',
    name: 'Nurse',
    blurb: 'Off shift, still carrying the calm.',
  },
  {
    id: 'farmer-304a43',
    name: 'Farmer',
    blurb: 'Up before the sun, wherever the sun is.',
  },

  // --- Plainly somebody else's century --------------------------------
  {
    id: 'astronaut-explorer-323482',
    name: 'Astronaut',
    blurb: 'Trained for vacuum. Filed no complaint.',
  },
  {
    id: 'armoured-knight-hero-07121f',
    name: 'Knight',
    blurb: 'The armour fits. The century does not.',
  },
  {
    id: 'skeleton-mariachi-c1b4d5',
    name: 'Mariachi',
    blurb: 'Keeps playing. Nobody asks why.',
  },
  {
    id: 'prospector-69a481',
    name: 'Prospector',
    blurb: 'Still looking for the seam.',
  },
  {
    id: 'stage-magician-2ecd48',
    name: 'Magician',
    blurb: 'Nothing up either sleeve.',
  },
];

/** The Road-Tripper, because it is the one every map was tested with. */
export const DEFAULT_CHARACTER_ID = 'family-road-tripper-247570';

/** A saved id that no longer exists — an old save, a removed character — falls
 *  back rather than leaving the player with no body at all. */
export function characterFor(id?: string | null): CharacterDef {
  if (id) {
    const hit = CHARACTERS.find((c) => c.id === id);
    if (hit) return hit;
  }
  return CHARACTERS.find((c) => c.id === DEFAULT_CHARACTER_ID) ?? CHARACTERS[0];
}

/** The next character in the roster, wrapping. `step` is -1 for the left arrow. */
export function stepCharacter(id: string, step: number): CharacterDef {
  const at = CHARACTERS.findIndex((c) => c.id === id);
  const from = at < 0 ? 0 : at;
  const next = (from + step + CHARACTERS.length) % CHARACTERS.length;
  return CHARACTERS[next];
}

export function characterModelUrl(id: string): string {
  return `/assets/characters/${id}.glb`;
}
