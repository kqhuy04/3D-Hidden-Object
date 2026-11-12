/**
 * Time of day and weather, per map.
 *
 * Two rules shaped this.
 *
 * **A map is a place at an hour, not a screensaver.** The sun is not on a
 * fifteen-minute loop for its own sake: each map is pinned to the hour that
 * suits it, and only maps that gain something from a moving sun are allowed to
 * move. A hunt is a thing you do in one sitting, and a sky that changes under
 * you while you are counting deckchairs is a distraction, not atmosphere.
 *
 * **Night is a colour, not a difficulty.** The player has to find five small
 * objects. A map at true midnight is a map where the objects are invisible, and
 * "invisible" is not a mood. So the darkest hour here is blue hour — the sun
 * just under the horizon, the sky still lit, shadows long and soft — and the
 * ambient floor in `Atmosphere` guarantees the props stay legible whatever the
 * numbers below say.
 */

export type WeatherKind = 'clear' | 'overcast' | 'mist' | 'rain' | 'snow' | 'motes';

export interface MapMood {
  /** Hours on a 24-hour clock. 16.5 is half past four in the afternoon. */
  timeOfDay: number;
  /**
   * Seconds for a full day, or 0 to pin the sun.
   *
   * Only the outdoor maps that want it set this. Everything else leaves it at
   * zero: a moving sun means a moving shadow map, and the whole shadow budget
   * in `SunShadows` assumes the light is still.
   */
  dayLengthSeconds?: number;
  weather: WeatherKind;
  /** Extra haze on top of what the weather implies, 0…1. */
  haze?: number;
  /**
   * True for a map that is under water rather than under a sky.
   *
   * This is a *place*, not a weather, which is why it is not another
   * `WeatherKind`: a reef does not stop being under water when the sun comes
   * out. It replaces the sky with the water's own colour, thickens the fog to
   * the twenty-odd metres you can actually see in, and cools the sun to the
   * light that gets through the surface. Without it the reef map was a sand
   * desert with a sea turtle flying through a pale blue sky.
   */
  submerged?: boolean;
}

/**
 * Per map. The label after each comment is what the choice is for.
 *
 * These are deliberately not spread evenly across the clock. Eleven maps at
 * noon would be eleven maps that look the same, and the point of the system is
 * that a player remembers "the snowy one" and "the one at dusk".
 */
export const MAP_MOODS: Record<string, MapMood> = {
  // Mid-afternoon at a working ski resort: the sun is already low enough to
  // throw long blue shadows across the piste, which is the one thing a snowfield
  // needs to stop reading as a white void. It snows here, and it did not until
  // the player asked why the snowy map had no snow in it: the argument for
  // `clear` was that falling snow costs the map its shadows, and the answer is
  // that a map called "alpine and snow" that never snows costs it the whole
  // point. The tint below keeps enough sun for the shadows to survive.
  'alpine-and-snow': { timeOfDay: 15.2, weather: 'snow' },

  // Late afternoon on a lake: the hour that makes the water read as water.
  'campground-lake': { timeOfDay: 17.6, weather: 'clear' },

  // A transit hall at blue hour, and the only map where the sun moves. The
  // arcology is the one place whose whole idea is "a city that keeps running",
  // so a slow turn from dusk to night suits it — and the light is already low,
  // so the change is gentle.
  'chrome-arcology-transit': { timeOfDay: 20.2, weather: 'mist', dayLengthSeconds: 600 },

  // A hearth in the evening.
  'chronos-hearth': { timeOfDay: 19.4, weather: 'clear' },

  // High overcast and dust: concrete looks right under a flat white sky.
  'construction-site': { timeOfDay: 11.0, weather: 'overcast', haze: 0.25 },

  // Noon under water. The kit is a seabed — corals, seagrass, a research
  // habitat — so the map is not "a reef on a beach", it is twenty metres down,
  // and the sky and the fog have to say so before a single prop is lit.
  'coral-reef': { timeOfDay: 11.6, weather: 'motes', submerged: true },

  // Early train, morning mist in the cutting.
  'countryside-railway': { timeOfDay: 7.8, weather: 'mist' },

  // Mid-morning on a farm: long but not dramatic shadows.
  'cozy-farm': { timeOfDay: 9.4, weather: 'clear' },

  // Dusk with candles lit. Blue hour rather than night, because the whole map
  // is small paper decorations and they disappear in the dark.
  'dia-de-muertos': { timeOfDay: 20.0, weather: 'clear' },

  // Dust and heat.
  'frontier-town': { timeOfDay: 15.4, weather: 'overcast', haze: 0.3 },

  // Fluorescent light: flat, slightly cold, no drama.
  hospital: { timeOfDay: 9.0, weather: 'overcast' },

  // Golden hour down a shopping street.
  'japanese-suburban-city-street': { timeOfDay: 18.4, weather: 'clear' },

  // Morning market light.
  'medieval-village': { timeOfDay: 8.6, weather: 'clear' },

  // Evening service.
  'modern-restaurant-cafe': { timeOfDay: 20.4, weather: 'clear' },

  // Suburbia in the late morning.
  'neighborhood-pathways': { timeOfDay: 10.6, weather: 'clear' },

  // The one rainy map, and the one genuinely dark map: a city at night in rain,
  // which is the most recognisable city there is. It is the exception the whole
  // table is built to allow — every other map stops at dusk, because a hunt
  // needs its five objects to be visible, and this one earns the darkness by
  // being the only place where darkness is the subject. If it ever reads as too
  // dark to play, move the hour back toward 20 and nothing else has to change.
  'nyc-city': { timeOfDay: 21.4, weather: 'rain' },

  // An office at half past four, which is the least interesting light there is,
  // and therefore the correct one.
  office: { timeOfDay: 16.6, weather: 'overcast' },

  // Tropical noon.
  'pirate-cove': { timeOfDay: 12.6, weather: 'clear' },

  // Late sun on concrete.
  skatepark: { timeOfDay: 17.0, weather: 'clear' },

  // Interior. The weather is a formality here; the light comes from the lamps.
  'space-base': { timeOfDay: 12.0, weather: 'clear' },

  // Evening fixture under floodlights.
  stadium: { timeOfDay: 19.8, weather: 'clear' },

  // The one snowy map: an empty theatre in snow is a better image than an empty
  // theatre at noon.
  'symphony-stagecraft': { timeOfDay: 19.6, weather: 'snow' },
};

/** What a map with no entry gets. */
export const DEFAULT_MOOD: MapMood = { timeOfDay: 12.0, weather: 'clear' };

export function moodFor(mapId: string): MapMood {
  return MAP_MOODS[mapId] ?? DEFAULT_MOOD;
}
