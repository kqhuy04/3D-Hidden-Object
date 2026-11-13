/**
 * What lives in the water, where it lives, and how hard it is to land.
 *
 * The hunt is about noticing; this is the one part of the game that is about
 * doing. The catalogue below is global — the collection screen shows all of it
 * — and each map that has water names a *roster* out of it, so the alpine tarn
 * and the reef do not fish the same.
 *
 * ## Why these fish
 *
 * A lake with a koi in it is a lake somebody stocked; a lake with a grouper and
 * a barracuda in it is a lake that does not exist. That is fine — the map is a
 * campground with a jetty and a canoe, and the fish are the same low-poly
 * animals the rest of the game is made of. What matters is that they read as
 * different *fights*: a slow fat one, a mid one, a fast thin one, a deep rare
 * one, and the thing you tell somebody about.
 *
 * Every species ships Idle / Swim / Swim fast from Polyfork, which is what lets
 * the school behave: the same clip that makes a koi drift under the jetty is
 * the one that makes it bolt when the float lands on its head. The two crabs
 * ship Idle / Walk / Run instead, and say so in `clips`.
 */

/** How rare a fish is. Drives the colour of its name in the collection. */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

/** Which of the model's clips stand in for the three the school expects. */
export interface ClipMap {
  idle: string;
  swim: string;
  fast: string;
}

export interface FishSpecies {
  id: string;
  name: string;
  /** GLB under `public/assets/fish/`. */
  model: string;
  /** Body length the model is scaled to, in metres. The shark is 1.15 m. */
  length: number;
  /**
   * How violently the fish crosses the bar, 0.5 … 1.4.
   *
   * This is the difficulty knob the player feels: it sets both how fast the
   * marker moves and how tall the green zone is (see `zoneHeight`).
   */
  speed: number;
  /** Seconds between new target depths. Lower is twitchier. */
  interval: number;
  /** How deep under the sheet it cruises, in metres. */
  depth: number;
  /** Experience for landing one. */
  xp: number;
  /** Weight range for the catch card, in kilograms. */
  kg: [number, number];
  rarity: Rarity;
  /**
   * True for things that walk the bed rather than swim over it.
   *
   * A crab held at a fixed depth under the surface hangs in the water like a
   * balloon; it has to be placed just above the sand wherever the sand is,
   * which is a question only the water grid can answer.
   */
  benthic?: boolean;
  /** Only for models whose clips are not Idle / Swim / Swim fast. */
  clips?: ClipMap;
}

/** The default three clips, which is what every Polyfork fish ships. */
export const DEFAULT_CLIPS: ClipMap = { idle: 'Idle', swim: 'Swim', fast: 'Swim fast' };

/**
 * Everything that can be caught, in the order the collection shows it.
 *
 * Ordered by rarity and then by size, so the catalogue reads as a progression:
 * the little reef fish first, the shark last.
 */
export const FISH: readonly FishSpecies[] = [
  {
    id: 'reef-fish-base',
    name: 'Reef Fish',
    model: '/assets/fish/reef-fish-base.glb',
    length: 0.32,
    speed: 0.58,
    interval: 1.3,
    depth: 0.4,
    xp: 12,
    kg: [0.1, 0.4],
    rarity: 'common',
  },
  {
    id: 'flame-angelfish-ce502b',
    name: 'Flame Angelfish',
    model: '/assets/fish/flame-angelfish-ce502b.glb',
    length: 0.3,
    speed: 0.66,
    interval: 1.2,
    depth: 0.5,
    xp: 18,
    kg: [0.1, 0.3],
    rarity: 'common',
  },
  {
    id: 'koi-base',
    name: 'Koi',
    model: '/assets/fish/koi-base.glb',
    length: 0.62,
    speed: 0.55,
    interval: 1.35,
    depth: 0.45,
    xp: 14,
    kg: [0.6, 3.2],
    rarity: 'common',
  },
  {
    id: 'jellyfish-base',
    name: 'Jellyfish',
    model: '/assets/fish/jellyfish-base.glb',
    length: 0.7,
    speed: 0.5,
    interval: 1.6,
    depth: 0.6,
    xp: 20,
    kg: [0.2, 1],
    rarity: 'common',
  },
  {
    id: 'shore-crab-base',
    name: 'Shore Crab',
    model: '/assets/fish/shore-crab-base.glb',
    length: 0.22,
    speed: 0.68,
    interval: 1.4,
    depth: 0.15,
    xp: 16,
    kg: [0.1, 0.4],
    rarity: 'common',
    benthic: true,
    clips: { idle: 'Idle', swim: 'Walk', fast: 'Run' },
  },
  {
    id: 'grouper-base',
    name: 'Grouper',
    model: '/assets/fish/grouper-base.glb',
    length: 0.72,
    speed: 0.7,
    interval: 1.1,
    depth: 0.8,
    xp: 24,
    kg: [1.5, 5.5],
    rarity: 'common',
  },
  {
    id: 'foxface-rabbitfish-6a7006',
    name: 'Foxface',
    model: '/assets/fish/foxface-rabbitfish-6a7006.glb',
    length: 0.34,
    speed: 0.72,
    interval: 1.15,
    depth: 0.55,
    xp: 22,
    kg: [0.2, 0.6],
    rarity: 'uncommon',
  },
  {
    id: 'firefish-base',
    name: 'Firefish',
    model: '/assets/fish/firefish-base.glb',
    length: 0.24,
    speed: 0.8,
    interval: 1,
    depth: 0.35,
    xp: 26,
    kg: [0.05, 0.15],
    rarity: 'uncommon',
  },
  {
    id: 'hermit-crab-base',
    name: 'Hermit Crab',
    model: '/assets/fish/hermit-crab-base.glb',
    length: 0.3,
    speed: 0.62,
    interval: 1.5,
    depth: 0.15,
    xp: 20,
    kg: [0.2, 0.6],
    rarity: 'uncommon',
    benthic: true,
    clips: { idle: 'Idle', swim: 'Walk', fast: 'Run' },
  },
  {
    id: 'barracuda-base',
    name: 'Barracuda',
    model: '/assets/fish/barracuda-base.glb',
    length: 1.05,
    speed: 0.92,
    interval: 0.95,
    depth: 0.65,
    xp: 38,
    kg: [1.2, 4.5],
    rarity: 'uncommon',
  },
  {
    id: 'moray-eel-base',
    name: 'Moray Eel',
    model: '/assets/fish/moray-eel-base.glb',
    length: 1.1,
    speed: 1,
    interval: 0.85,
    depth: 0.9,
    xp: 44,
    kg: [1.5, 6],
    rarity: 'rare',
  },
  {
    id: 'octopus-base',
    name: 'Octopus',
    model: '/assets/fish/octopus-base.glb',
    length: 0.85,
    speed: 0.9,
    interval: 0.95,
    depth: 1.2,
    xp: 52,
    kg: [1, 4],
    rarity: 'rare',
  },
  {
    id: 'coelacanth-base',
    name: 'Coelacanth',
    model: '/assets/fish/coelacanth-base.glb',
    length: 1,
    speed: 1.08,
    interval: 0.8,
    depth: 1.1,
    xp: 62,
    kg: [3, 9],
    rarity: 'rare',
  },
  {
    id: 'stingray-base',
    name: 'Stingray',
    model: '/assets/fish/stingray-base.glb',
    length: 0.95,
    speed: 1.12,
    interval: 0.78,
    depth: 1.3,
    xp: 68,
    kg: [3, 9],
    rarity: 'rare',
  },
  {
    id: 'sea-turtle-base',
    name: 'Sea Turtle',
    model: '/assets/fish/sea-turtle-base.glb',
    length: 1.1,
    speed: 0.62,
    interval: 1.5,
    depth: 0.7,
    xp: 58,
    kg: [8, 20],
    rarity: 'rare',
  },
  {
    id: 'reef-shark-base',
    name: 'Reef Shark',
    model: '/assets/fish/reef-shark-base.glb',
    length: 1.15,
    speed: 1.35,
    interval: 0.62,
    depth: 1.4,
    xp: 95,
    kg: [5, 13],
    rarity: 'legendary',
  },
];

/**
 * One place you can stand with a rod.
 *
 * `roster` is a weight table over `FISH` ids rather than a second copy of the
 * species: the weights are the only thing that differs between two lakes, and
 * two copies of a fish is two places to change its speed.
 */
export interface FishingSpot {
  /** Map id, as the map files name it. */
  map: string;
  /** What the water is called, for the prompt and the collection header. */
  label: string;
  roster: ReadonlyArray<{ id: string; weight: number }>;
}

/**
 * The four maps that have water deep enough to fish.
 *
 * Every other map in the game has either no water sheet or a puddle: the
 * survey in `docs/FISHING.md` counted cells at least half a metre deep within
 * forty metres of open water, and these four are the only ones that cleared
 * forty.
 */
export const FISHING_SPOTS: readonly FishingSpot[] = [
  {
    map: 'campground-lake',
    label: 'The lake',
    roster: [
      { id: 'koi-base', weight: 42 },
      { id: 'grouper-base', weight: 26 },
      { id: 'barracuda-base', weight: 17 },
      { id: 'coelacanth-base', weight: 10 },
      { id: 'reef-shark-base', weight: 5 },
    ],
  },
  {
    map: 'alpine-and-snow',
    label: 'The tarn',
    // Cold and deep and poor: the coelacanth is the everyday fish here and the
    // koi is the odd one out, which is the reverse of the campground.
    roster: [
      { id: 'coelacanth-base', weight: 34 },
      { id: 'koi-base', weight: 30 },
      { id: 'grouper-base', weight: 20 },
      { id: 'barracuda-base', weight: 10 },
      { id: 'reef-shark-base', weight: 6 },
    ],
  },
  {
    map: 'countryside-railway',
    label: 'The canal',
    // Eighteen metres of brown water under a railway: crabs on the piling,
    // eels in the silt, and one thing nobody has caught twice.
    roster: [
      { id: 'shore-crab-base', weight: 28 },
      { id: 'koi-base', weight: 26 },
      { id: 'grouper-base', weight: 20 },
      { id: 'barracuda-base', weight: 14 },
      { id: 'moray-eel-base', weight: 9 },
      { id: 'coelacanth-base', weight: 3 },
    ],
  },
  {
    map: 'coral-reef',
    label: 'The reef',
    // The full catalogue. Ten species, and the shark at the bottom of it.
    roster: [
      { id: 'reef-fish-base', weight: 24 },
      { id: 'flame-angelfish-ce502b', weight: 16 },
      { id: 'foxface-rabbitfish-6a7006', weight: 14 },
      { id: 'firefish-base', weight: 12 },
      { id: 'jellyfish-base', weight: 10 },
      { id: 'hermit-crab-base', weight: 8 },
      { id: 'octopus-base', weight: 6 },
      { id: 'moray-eel-base', weight: 5 },
      { id: 'stingray-base', weight: 4 },
      { id: 'sea-turtle-base', weight: 3 },
      { id: 'reef-shark-base', weight: 2 },
    ],
  },
];

/** The spot for a map, or null when that map has nothing to fish. */
export function spotForMap(mapId: string): FishingSpot | null {
  return FISHING_SPOTS.find((spot) => spot.map === mapId) ?? null;
}

/**
 * Experience needed to leave a level.
 *
 * Linear rather than exponential: the reward for a level is a wider bar, and a
 * curve that doubles turns a wide bar into something you see twice a session.
 * 60 XP is four koi; level 5 costs 240, which is one good afternoon.
 */
export function xpForLevel(level: number): number {
  return 60 + (level - 1) * 45;
}

/**
 * Height of the green zone, as a fraction of the bar.
 *
 * The fish's own speed takes the most away; the player's level gives it back a
 * little at a time, which is the whole progression. Clamped at both ends so a
 * shark at level 1 is hard rather than impossible, and a koi at level 20 is not
 * a free catch.
 */
export function zoneHeight(level: number, species: FishSpecies): number {
  return clamp(0.3 - species.speed * 0.055 + (level - 1) * 0.016, 0.2, 0.5);
}

/** How long the float sits before something takes it, in seconds. */
export function biteDelay(level: number): number {
  const hurry = 1 - Math.min(0.35, (level - 1) * 0.03);
  return (2.2 + Math.random() * 3.3) * hurry;
}

/**
 * Picks the fish that takes the bait, out of one spot's roster.
 *
 * Rare fish get *more* likely as the player levels, the way the reference
 * minigame does it: a level is not just a wider bar, it is a better lake.
 */
export function pickSpecies(level: number, spot: FishingSpot): FishSpecies {
  const boost = (fish: FishSpecies): number => (fish.rarity === 'common' ? 1 : 1 + (level - 1) * 0.06);
  const entryWeight = (id: string, weight: number): number => {
    const fish = speciesById(id);
    return fish ? weight * boost(fish) : 0;
  };

  const total = spot.roster.reduce((sum, e) => sum + entryWeight(e.id, e.weight), 0);
  let roll = Math.random() * total;
  for (const entry of spot.roster) {
    roll -= entryWeight(entry.id, entry.weight);
    if (roll < 0) return speciesById(entry.id) ?? FISH[0];
  }
  return speciesById(spot.roster[0].id) ?? FISH[0];
}

export function speciesById(id: string): FishSpecies | undefined {
  return FISH.find((fish) => fish.id === id);
}

/** The colour a rarity is printed in, as a stylesheet class suffix. */
export function rarityClass(rarity: Rarity): string {
  return `rarity-${rarity}`;
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
