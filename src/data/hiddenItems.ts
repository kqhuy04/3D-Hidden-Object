// The "wrong thing in the wrong place" hunt.
//
// Each map hides five objects that do not belong to its theme. The player walks
// the map looking for things that feel off, presses E on one to pocket it, and
// the object disappears for good. Names are hidden until the object is found —
// the list shows `???` — so the hunt is "notice the odd thing", not "tick off a
// shopping list". The only nudge is a person in the map: ask one of the locals
// and they describe one still-missing object in vague terms.
//
// Coordinates come from the map's own scene graph (tools: tmp-props.mjs prints
// every named prop with its world bounds), so an object can be placed against a
// real table, crate or kiln rather than guessed. `y` is omitted where the object
// stands on the ground: the loader asks the collision resolver for the surface
// height and puts it there, which keeps it from floating or sinking on maps
// whose floor is not at zero.

export interface HiddenSpot {
  x: number;
  z: number;
  /** Explicit height for an object that sits on furniture. Omit for the ground. */
  y?: number;
}

export interface HiddenItemPlacement {
  /** Unique within a map; also the id the round manager tracks. */
  id: string;
  /** Polyfork asset id — the mesh lives at /assets/hidden/<asset>.glb. */
  asset: string;
  /** Shown only once found. */
  name: string;
  /** What a local says about it: describes the object without naming it. */
  hint: string;
  spot: HiddenSpot;
  /** Radians. Objects face +Z, so this is usually chosen to face a wall. */
  rotationY: number;
  scale?: number;
}

export interface HiddenItemMap {
  /** One line under the mission title, to set the tone. */
  brief: string;
  items: HiddenItemPlacement[];
}

export const HIDDEN_ITEMS: Record<string, HiddenItemMap> = {
  // ---------------------------------------------------------------------------
  // Campground & Lake — canvas, cordwood and cold water. Anything with a plug
  // is an intruder.
  // ---------------------------------------------------------------------------
  'campground-lake': {
    brief: 'Five things were left in this camp that no camper would pack.',
    items: [
      {
        id: 'camp-toaster',
        asset: 'toaster-0d6c5c',
        name: 'Toaster',
        hint: 'A box that browns bread and pops it up — and it wants a wall socket.',
        // On the camp kitchen table, half behind the water jug.
        spot: { x: 2.35, y: 0.76, z: 1.45 },
        rotationY: 0.55,
      },
      {
        id: 'camp-hydrant',
        asset: 'fire-hydrant-b68b17',
        name: 'Fire hydrant',
        hint: 'A squat iron post with two capped nozzles, painted red, in a clearing.',
        // On a low crate stack east of the kitchen, off the walking line.
        spot: { x: -3, y: 0, z: 6.5 },
        rotationY: 0.9,
      },
      {
        id: 'camp-meter',
        asset: 'parking-meter-e9cf71',
        name: 'Parking meter',
        hint: 'A thin post with a coin slot and a little window, waiting for a car.',
        // West of the tents, where the ground dips toward the treeline.
        spot: { x: -13, y: -0.42, z: -3.5 },
        rotationY: -0.5,
      },
      {
        id: 'camp-booth',
        asset: 'phone-booth-10967f',
        name: 'Phone booth',
        hint: 'A glass box with a handset inside, and no wire running to it.',
        // Far west, past the last pitch, facing the trees.
        spot: { x: -19.5, y: -0.64, z: 1 },
        rotationY: 1.5,
      },
      {
        id: 'camp-sink',
        asset: 'kitchen-sink-7ea438',
        name: 'Kitchen sink',
        hint: 'A basin with a tap and a drain — everything but the kitchen sink, and here it is.',
        // North-west of the camp, on the raised bank behind the woodpile.
        spot: { x: -10.5, y: 1.04, z: -11 },
        rotationY: 2.3,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Alpine Ski Resort — a lift base, a groomed piste and two metres of snow.
  // Nothing here grew, nothing was planted, and nothing was ever shipped in by
  // sea. An object that belongs to a lawn, a garden, a farm or a harbour is the
  // intruder; a snowboard would not be, so a snowboard is not used.
  // ---------------------------------------------------------------------------
  'alpine-and-snow': {
    brief: 'Five things were left on this mountain that the snow does not explain.',
    items: [
      {
        id: 'alpine-scarecrow',
        asset: 'scarecrow-334079',
        name: 'Scarecrow',
        hint: 'A figure in a coat and a straw hat, arms held out, guarding a field that is not there.',
        // Between the chalet's north wall and the log pile: tall enough to see
        // over both, but only once you have walked to the west end of the path.
        spot: { x: -7.6, z: 39.4 },
        rotationY: 0.4,
      },
      {
        id: 'alpine-toilet',
        asset: 'toilet-2edbd9',
        name: 'Toilet',
        hint: 'A white ceramic bowl with its cistern, standing in the snow behind the ski racks.',
        // Just past the west end of the ski racks, so the racks screen it from
        // the plaza and white-on-white does the rest.
        spot: { x: 11.0, z: 46.8 },
        rotationY: 1.5,
      },
      {
        id: 'alpine-piano',
        asset: 'upright-piano-c0b0ef',
        name: 'Upright piano',
        hint: 'A tall dark case with a row of keys, its back against the station wall.',
        // Against the lift station's west face, on the snow bank.
        spot: { x: 11.2, z: 35.4 },
        rotationY: -1.5,
      },
      {
        id: 'alpine-mower',
        asset: 'riding-lawn-tractor-09e93c',
        name: 'Riding mower',
        hint: 'A little tractor with a cutting deck, parked where the grass is under two metres of snow.',
        // West end of the cleared path, beside the log pile.
        spot: { x: -2.0, z: 40.0 },
        rotationY: 1.6,
      },
      {
        id: 'alpine-anchor',
        asset: 'admiralty-anchor-bd6882',
        name: 'Admiralty anchor',
        hint: 'A rusted iron hook on a wooden stock, taller than a person, beside the signpost.',
        // East of the station, by the wayfinder post at the top of the plaza.
        spot: { x: 23.0, z: 48.5 },
        rotationY: 0.8,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Chrome Arcology Transit — glass, neon and polished composite. Anything made
  // of staves, straw or stone is an intruder.
  // ---------------------------------------------------------------------------
  'chrome-arcology-transit': {
    brief: 'Five objects here were made by hands that never touched chrome.',
    items: [
      {
        id: 'arc-barrel',
        asset: 'wooden-barrel-ab50ca',
        name: 'Wooden barrel',
        hint: 'Staves and iron hoops, the kind you roll — in a city with no wood.',
        // Wedged in the gap between two stacked supply crates.
        spot: { x: 36.1, y: 0.06, z: -13.4 },
        rotationY: 0.9,
      },
      {
        id: 'arc-hay',
        asset: 'hay-bale-079e8c',
        name: 'Hay bale',
        hint: 'Dried grass, tied up with twine, dropped where a bus parks.',
        // Behind the articulated bus, on the far side from the plaza.
        spot: { x: 30, z: 11.4 },
        rotationY: 0.35,
      },
      {
        id: 'arc-well',
        asset: 'stone-well-b2dfcd',
        name: 'Stone well',
        hint: 'A ring of stone with a rope and a bucket, sunk where nobody digs.',
        // Tucked behind the sign pylon at the edge of the block.
        spot: { x: -6, z: -36.4 },
        rotationY: 0,
      },
      {
        id: 'arc-chest',
        asset: 'treasure-chest-c2ac4f',
        name: 'Treasure chest',
        hint: 'A curved lid, iron bands, a lock — the kind of thing pirates bury.',
        // Beside the recycling bin, half behind it.
        spot: { x: 16.5, z: 15.6 },
        rotationY: -0.7,
      },
      {
        id: 'arc-candle',
        asset: 'candle-spike-cluster-d7c566',
        name: 'Candle cluster',
        hint: 'Wax on iron spikes, waiting for a match nobody carries.',
        // On the service deck, at the foot of the lamp run.
        spot: { x: 44, y: 0.11, z: -12 },
        rotationY: 0,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Chronos Hearth — timber, clay and charcoal. Anything manufactured and
  // plastic is an intruder.
  // ---------------------------------------------------------------------------
  'chronos-hearth': {
    brief: 'Five things were carried into this settlement from a century it has never seen.',
    items: [
      {
        id: 'hearth-duck',
        asset: 'rubber-duck-e41831',
        name: 'Rubber duck',
        hint: 'Small, yellow, and it floats. It has never seen water here.',
        // Left on top of a boulder at the north edge, well away from the hearth
        // it would be funny to find on.
        spot: { x: -2.2, y: 0.58, z: -14.6 },
        rotationY: 0.6,
      },
      {
        id: 'hearth-microwave',
        asset: 'microwave-oven-7f60d4',
        name: 'Microwave',
        hint: 'A little oven with a numbered keypad and a glass door.',
        // On a cut stump, in among the woodworking.
        spot: { x: -6.6, y: 0.46, z: -7.8 },
        rotationY: -1.1,
      },
      {
        id: 'hearth-chair',
        asset: 'office-chair-7c9874',
        name: 'Office chair',
        hint: 'A chair with five little wheels and a lever underneath.',
        // Beside the boulder at the edge of the settlement.
        spot: { x: 17.6, z: 25.2 },
        rotationY: 2.4,
      },
      {
        id: 'hearth-vending',
        asset: 'vending-machine-471c29',
        name: 'Vending machine',
        hint: 'A lit box of snacks behind glass, humming to itself.',
        // Behind the charcoal kiln, front out, lit up in a place with no mains.
        spot: { x: 33.6, z: 16.2 },
        rotationY: 0.1,
      },
      {
        id: 'hearth-skateboard',
        asset: 'skateboard-667a82',
        name: 'Skateboard',
        hint: 'A board with four small wheels under it.',
        // Leaning in the gap behind the firewood wedge.
        spot: { x: 24.2, z: 22.6 },
        rotationY: 0.9,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // Construction Site — dirt, concrete and cranes. Nothing here was ever a home.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Coral Reef — six metres down, and everything dry-land is wrong.
  // ---------------------------------------------------------------------------
  'coral-reef': {
    brief: 'Five things sank here that were never meant to get wet.',
    items: [
      {
        id: 'reef-hydrant',
        asset: 'fire-hydrant-b68b17',
        name: 'Fire hydrant',
        hint: 'A squat iron post with two capped nozzles — for a street that is not down here.',
        // On the sand shelf east of the spawn, beside the drop-off.
        spot: { x: 13, y: -0.07, z: 2 },
        rotationY: 0.4,
      },
      {
        id: 'reef-meter',
        asset: 'parking-meter-e9cf71',
        name: 'Parking meter',
        hint: 'A thin post with a coin slot and a little window, waiting for a car that cannot come.',
        // Out past the eastern rocks, where the reef flattens out.
        spot: { x: 18, y: -0.31, z: 9.5 },
        rotationY: -0.6,
      },
      {
        id: 'reef-booth',
        asset: 'phone-booth-10967f',
        name: 'Phone booth',
        hint: 'A glass box with a handset inside, and no line to anywhere.',
        // On the raised rock west of the middle of the reef.
        spot: { x: -12.5, y: 1, z: -2 },
        rotationY: 1.2,
      },
      {
        id: 'reef-jukebox',
        asset: 'jukebox-1e2ea6',
        name: 'Jukebox',
        hint: 'A lit arch of glass and chrome that plays for coins. It has been quiet a long time.',
        // Far corner of the reef floor, north-west, behind the coral heads.
        spot: { x: -17, y: 0.67, z: -6.5 },
        rotationY: 2.4,
      },
      {
        id: 'reef-toilet',
        asset: 'toilet-2edbd9',
        name: 'Toilet',
        hint: 'Porcelain, a lid, a cistern — and absolutely nothing to plumb it into.',
        // South of the spawn, in the seagrass, half buried in sand.
        spot: { x: -7, y: -1.92, z: 19.5 },
        rotationY: 0.9,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Countryside Railway — a rural halt with steam and coal.
  // ---------------------------------------------------------------------------
  'countryside-railway': {
    brief: 'Five things came off a train that has never stopped here.',
    items: [
      {
        id: 'rail-sofa',
        asset: 'sofa-9c0e7e',
        name: 'Sofa',
        hint: 'Three cushions, two arms, upholstery — on a platform where people wait standing up.',
        // On the far platform, west end, where nobody queues.
        spot: { x: -2, y: 0, z: 2.5 },
        rotationY: 1.55,
      },
      {
        id: 'rail-espresso',
        asset: 'espresso-machine-a2db84',
        name: 'Espresso machine',
        hint: 'Chrome, a portafilter, a steam wand — it wants pressure and a power line.',
        // On the platform edge south of the station building.
        spot: { x: -5, y: 1.17, z: -8 },
        rotationY: -0.4,
      },
      {
        id: 'rail-piano',
        asset: 'upright-piano-c0b0ef',
        name: 'Upright piano',
        hint: 'Eighty-eight keys under a wooden lid, out in the weather.',
        // Down at the far end of the up platform, past the signal.
        spot: { x: 8.5, y: 1.21, z: -18.5 },
        rotationY: 0.25,
      },
      {
        id: 'rail-hammock',
        asset: 'hammock-on-posts-7d5c47',
        name: 'Hammock',
        hint: 'A canvas sling between two posts, for a nap nobody takes on a platform.',
        // On the grass east of the track, clear of the platform edge.
        spot: { x: 18, y: 0.05, z: 12.5 },
        rotationY: 0.7,
      },
      {
        id: 'rail-chair',
        asset: 'office-chair-7c9874',
        name: 'Office chair',
        hint: 'Five wheels, a gas lift, a lever underneath — on gravel.',
        // Beside the goods yard, past the end of the platform.
        spot: { x: 8, y: 0, z: 12.5 },
        rotationY: 2.1,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Cozy Farm — a working farm. The town arrived in the yard.
  // ---------------------------------------------------------------------------
  'cozy-farm': {
    brief: 'Five things were left in this yard that the farm has no use for.',
    items: [
      {
        id: 'farm-booth',
        asset: 'phone-booth-10967f',
        name: 'Phone booth',
        hint: 'A red glass box with a handset — the fields have no line.',
        // West of the yard, at the edge of the ploughed field.
        spot: { x: -13.5, y: 0, z: 6 },
        rotationY: 0.6,
      },
      {
        id: 'farm-vending',
        asset: 'vending-machine-471c29',
        name: 'Vending machine',
        hint: 'A lit cabinet of snacks behind glass, humming where there is no mains.',
        // East side of the yard, facing the barn.
        spot: { x: 11.5, y: 0, z: 6 },
        rotationY: -1.4,
      },
      {
        id: 'farm-jukebox',
        asset: 'jukebox-1e2ea6',
        name: 'Jukebox',
        hint: 'Chrome and glass, and a slot for coins, out among the crops.',
        // North-west corner of the yard, past the last fence post.
        spot: { x: -11, y: 0, z: -11.5 },
        rotationY: 1.9,
      },
      {
        id: 'farm-fridge',
        asset: 'fridge-freezer-fb9b5a',
        name: 'Fridge freezer',
        hint: 'A tall white cupboard that hums and keeps things cold. It needs a wall socket.',
        // South edge of the yard, by the gate.
        spot: { x: -1, y: 0, z: -11.5 },
        rotationY: 3.1,
      },
      {
        id: 'farm-meter',
        asset: 'parking-meter-e9cf71',
        name: 'Parking meter',
        hint: 'A coin slot on a post, in a field where nothing parks.',
        // East of the yard, near the track out.
        spot: { x: 9, y: 0, z: -1.5 },
        rotationY: -2.2,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Día de Muertos — a cemetery and a plaza. Domestic appliances are the intruder.
  // ---------------------------------------------------------------------------
  'dia-de-muertos': {
    brief: 'Five things were carried in with the flowers that belong to no altar.',
    items: [
      {
        id: 'muertos-toilet',
        asset: 'toilet-2edbd9',
        name: 'Toilet',
        hint: 'Porcelain, a lid and a cistern, standing among the graves.',
        // Down the lower terrace, west of the plaza steps.
        spot: { x: -5.5, y: -1.7, z: -6 },
        rotationY: 1.1,
      },
      {
        id: 'muertos-sofa',
        asset: 'sofa-9c0e7e',
        name: 'Sofa',
        hint: 'Three cushions and two arms, set out as if for a family that never sits.',
        // On the middle terrace, behind the arcade.
        spot: { x: -3, y: 3.19, z: 16.5 },
        rotationY: 2.6,
      },
      {
        id: 'muertos-sink',
        asset: 'kitchen-sink-7ea438',
        name: 'Kitchen sink',
        hint: 'A basin with a tap and a drain — everything but the kitchen sink, and here it is.',
        // Lower ground west of the plaza, past the last cypress.
        spot: { x: -10.5, y: -3.52, z: 9 },
        rotationY: -0.8,
      },
      {
        id: 'muertos-chair',
        asset: 'office-chair-7c9874',
        name: 'Office chair',
        hint: 'Five wheels and a gas lift, parked on a tiled landing.',
        // Up on the upper plaza, by the kiosk.
        spot: { x: 12, y: 7.19, z: 1.5 },
        rotationY: 0.3,
      },
      {
        id: 'muertos-postbox',
        asset: 'red-post-box-f12045',
        name: 'Post box',
        hint: 'A red iron pillar with a slot for letters, at the edge of the graves.',
        // On the middle terrace, north side, by the nicho wall.
        spot: { x: 4.5, y: 3.19, z: 16.5 },
        rotationY: -0.2,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Construction Site — dirt, concrete and cranes. Nothing here was ever a home.
  // ---------------------------------------------------------------------------
  'construction-site': {
    brief: 'Five things were unloaded here that no site ordered.',
    items: [
      {
        id: 'site-sofa',
        asset: 'sofa-9c0e7e',
        name: 'Sofa',
        hint: 'Three cushions and two arms, on a stack of pallets in the mud.',
        // On the loading deck east of the crane, out of the walking line.
        spot: { x: 12.5, y: -2.57, z: 3.5 },
        rotationY: 1.4,
      },
      {
        id: 'site-fridge',
        asset: 'fridge-freezer-fb9b5a',
        name: 'Fridge freezer',
        hint: 'A tall white cupboard that hums, standing where the power is a generator.',
        // Against the site cabins, east side.
        spot: { x: 15, y: 0.05, z: 18.5 },
        rotationY: -1.2,
      },
      {
        id: 'site-piano',
        asset: 'upright-piano-c0b0ef',
        name: 'Upright piano',
        hint: 'Eighty-eight keys under a wooden lid, out where the excavator turns.',
        // Far north-west, past the spoil heaps.
        spot: { x: -2.5, y: -5.72, z: 3.5 },
        rotationY: 0.4,
      },
      {
        id: 'site-birdbath',
        asset: 'garden-birdbath-9671de',
        name: 'Bird bath',
        hint: 'A little stone basin on a pedestal, for a garden that is not here.',
        // Deep in the north-east corner, behind the hoarding.
        spot: { x: 20, y: -0.34, z: 6 },
        rotationY: -0.3,
      },
      {
        id: 'site-postbox',
        asset: 'red-post-box-f12045',
        name: 'Post box',
        hint: 'A red iron pillar with a slot for letters, on a site with no address.',
        // South-east corner, by the gate where the lorries turn.
        spot: { x: 28.5, y: 0.4, z: -2.5 },
        rotationY: 2.8,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Frontier Town — 1880s. Anything with a plug is from the future.
  // ---------------------------------------------------------------------------
  'frontier-town': {
    brief: 'Five things were left on this street that were not made in this century.',
    items: [
      {
        id: 'frontier-vending',
        asset: 'vending-machine-471c29',
        name: 'Vending machine',
        hint: 'A lit cabinet of snacks behind glass, humming on a boardwalk.',
        // Under the saloon awning, facing the street.
        spot: { x: -3, y: 0.05, z: 13.5 },
        rotationY: 3.1,
      },
      {
        id: 'frontier-booth',
        asset: 'phone-booth-10967f',
        name: 'Phone booth',
        hint: 'A glass box with a handset, and no wire running out of it.',
        // West end of the street, behind the store.
        spot: { x: -11, y: 1.22, z: 3.5 },
        rotationY: 1.6,
      },
      {
        id: 'frontier-fridge',
        asset: 'fridge-freezer-fb9b5a',
        name: 'Fridge freezer',
        hint: 'A white cupboard that keeps things cold. It wants a wall socket.',
        // In the undertaker's doorway, which is the wrong joke entirely.
        spot: { x: 7, y: 0.29, z: 23.5 },
        rotationY: 0.2,
      },
      {
        id: 'frontier-jukebox',
        asset: 'jukebox-1e2ea6',
        name: 'Jukebox',
        hint: 'A lit arch of chrome and glass that plays for coins.',
        // Behind the livery stable, where the horses are kept.
        spot: { x: 7, y: 0.29, z: 3.5 },
        rotationY: -0.9,
      },
      {
        id: 'frontier-microwave',
        asset: 'microwave-oven-7f60d4',
        name: 'Microwave',
        hint: 'A little oven with a numbered keypad and a glass door.',
        // On the ground behind the church, north side.
        spot: { x: -3, y: 0.01, z: 23.5 },
        rotationY: 1.9,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Hospital — clinical, tiled, indoors. The outdoors is the intruder.
  // ---------------------------------------------------------------------------
  'hospital': {
    brief: 'Five things were brought into this building that belong outside it.',
    items: [
      {
        id: 'hospital-hay',
        asset: 'hay-bale-079e8c',
        name: 'Hay bale',
        hint: 'Dried grass, tied with twine, sitting on a bench in a corridor.',
        // On the planter bench by the entrance canopy.
        spot: { x: 12, y: 0.03, z: 1.5 },
        rotationY: 0.5,
      },
      {
        id: 'hospital-fire',
        asset: 'campfire-4390aa',
        name: 'Campfire',
        hint: 'A ring of stones with charred logs — indoors, on a vinyl floor.',
        // In the waiting area west of the entrance.
        spot: { x: -8, y: 0.04, z: 1.5 },
        rotationY: 0,
      },
      {
        id: 'hospital-scarecrow',
        asset: 'scarecrow-334079',
        name: 'Scarecrow',
        hint: 'A coat on crossed sticks with a sack for a head, out in the ambulance bay.',
        // Eastern end of the bay, past the last hatch marking.
        spot: { x: 17, y: 0.03, z: -3.5 },
        rotationY: -1.3,
      },
      {
        id: 'hospital-anvil',
        asset: 'anvil-0ad53c',
        name: 'Anvil',
        hint: 'A block of iron with a horn, heavy enough to need two people.',
        // By the generator enclosure, behind the annexe.
        spot: { x: -10.5, y: 0.04, z: -6 },
        rotationY: 0.9,
      },
      {
        id: 'hospital-rowboat',
        asset: 'rowboat-c42d85',
        name: 'Rowboat',
        hint: 'A wooden hull with two oars, parked where the trolleys go.',
        // North end of the site, on the paving behind the ward block.
        spot: { x: 17, y: 0.03, z: 6.5 },
        rotationY: 2.7,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Japanese Suburban City Street — a dense modern street.
  // ---------------------------------------------------------------------------
  'japanese-suburban-city-street': {
    brief: 'Five things were left on this street that the street has no place for.',
    items: [
      {
        id: 'jp-scarecrow',
        asset: 'scarecrow-334079',
        name: 'Scarecrow',
        hint: 'A coat on crossed sticks with a sack head, watching a pavement.',
        // North of the crossing, on the wide pavement by the shrine wall.
        spot: { x: -8.5, y: 0, z: 1.5 },
        rotationY: 2.2,
      },
      {
        id: 'jp-bale',
        asset: 'straw-bale-56facd',
        name: 'Straw bale',
        hint: 'A cube of dried stalks, tied with twine, on a tiled street.',
        // East side, in the alley behind the shophouses.
        spot: { x: 11.5, y: 0, z: 1.5 },
        rotationY: 0.8,
      },
      {
        id: 'jp-anvil',
        asset: 'anvil-0ad53c',
        name: 'Anvil',
        hint: 'A block of iron with a horn, dropped by a kerb.',
        // West side, under the tram wires, by the guardrail.
        spot: { x: -19, y: 0.41, z: -8.5 },
        rotationY: -0.5,
      },
      {
        id: 'jp-tractor',
        asset: 'riding-lawn-tractor-09e93c',
        name: 'Riding mower',
        hint: 'A little tractor with a cutting deck, parked across a tram track.',
        // Far west, past the last shophouse.
        spot: { x: -31, y: 0.36, z: 5 },
        rotationY: 1.1,
      },
      {
        id: 'jp-coffin',
        asset: 'coffin-prop-d62082',
        name: 'Coffin',
        hint: 'A tapered wooden box with brass handles, left on the far pavement.',
        // Far east end of the street, past the vending machines.
        spot: { x: 1.5, y: 0, z: 11.5 },
        rotationY: 0.15,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // Medieval Village — timber, thatch and a well. Consumer goods are the intruder.
  // ---------------------------------------------------------------------------
  'medieval-village': {
    brief: 'Five things appeared in this village that no trader could have carried here.',
    items: [
      {
        id: 'medieval-vending',
        asset: 'vending-machine-471c29',
        name: 'Vending machine',
        hint: 'A lit cabinet of snacks behind glass, humming beside the market stalls.',
        // On the raised edge of the market square, facing the stalls.
        spot: { x: 9, y: 0.61, z: 9.5 },
        rotationY: 2.9,
      },
      {
        id: 'medieval-chair',
        asset: 'office-chair-7c9874',
        name: 'Office chair',
        hint: 'Five little wheels and a lever underneath, on packed earth.',
        // West of the square, in the alley behind the cottages.
        spot: { x: -11, y: 0.04, z: -2 },
        rotationY: 1.3,
      },
      {
        id: 'medieval-microwave',
        asset: 'microwave-oven-7f60d4',
        name: 'Microwave',
        hint: 'A little oven with a numbered keypad and a glass door.',
        // South-west corner, by the blacksmith's back wall.
        spot: { x: -8.5, y: 0.06, z: -9.5 },
        rotationY: -0.7,
      },
      {
        id: 'medieval-cone',
        asset: 'traffic-cone-c421e4',
        name: 'Traffic cone',
        hint: 'Bright orange, meant for a road, standing in a lane with no road.',
        // South-east, at the edge of the track out of the village.
        spot: { x: 11.5, y: 0.04, z: -9.5 },
        rotationY: 0.4,
      },
      {
        id: 'medieval-espresso',
        asset: 'espresso-machine-a2db84',
        name: 'Espresso machine',
        hint: 'Chrome, a portafilter and a steam wand — it wants pressure and a cable.',
        // Far west, behind the well, where the path leaves the village.
        spot: { x: 14, y: 0.07, z: -2 },
        rotationY: 1.8,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Modern Restaurant Cafe — a city cafe. The farm is the intruder.
  // ---------------------------------------------------------------------------
  'modern-restaurant-cafe': {
    brief: 'Five things were left on this terrace that came in from a field.',
    items: [
      {
        id: 'cafe-bale',
        asset: 'straw-bale-56facd',
        name: 'Straw bale',
        hint: 'A cube of dried stalks tied with twine, beside a parasol.',
        // East end of the terrace, past the last banquette.
        spot: { x: 12.5, y: 0.05, z: 6 },
        rotationY: 0.9,
      },
      {
        id: 'cafe-anvil',
        asset: 'anvil-0ad53c',
        name: 'Anvil',
        hint: 'A block of iron with a horn, sitting where the plates go.',
        // On the service counter at the back.
        spot: { x: 9, y: 1.13, z: -3 },
        rotationY: -0.4,
      },
      {
        id: 'cafe-scarecrow',
        asset: 'scarecrow-334079',
        name: 'Scarecrow',
        hint: 'A coat on crossed sticks with a sack for a head, among the olive planters.',
        // West side of the room, by the planter divider.
        spot: { x: -7.5, y: 0.05, z: 3.5 },
        rotationY: 2.4,
      },
      {
        id: 'cafe-rowboat',
        asset: 'rowboat-c42d85',
        name: 'Rowboat',
        hint: 'A wooden hull with two oars, parked between the tables.',
        // Middle of the room, on the tiled floor.
        spot: { x: 0, y: 0.05, z: -4 },
        rotationY: 1.2,
      },
      {
        id: 'cafe-tractor',
        asset: 'riding-lawn-tractor-09e93c',
        name: 'Riding mower',
        hint: 'A little tractor with a cutting deck, parked at the back of the room.',
        // Back west corner, by the kitchen door.
        spot: { x: -7.5, y: 0.05, z: -4 },
        rotationY: -2.1,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Neighborhood Pathways — a suburb. Medieval and maritime things are wrong.
  // ---------------------------------------------------------------------------
  'neighborhood-pathways': {
    brief: 'Five things were left along these paths that this street never had.',
    items: [
      {
        id: 'hood-cannon',
        asset: 'deck-cannon-17849e',
        name: 'Deck cannon',
        hint: 'An iron barrel on a wooden carriage with small wheels, aimed at a hedge.',
        // On the corner lot east of the crossing, by the kerb.
        spot: { x: 13, y: 0.42, z: 10 },
        rotationY: 1.5,
      },
      {
        id: 'hood-well',
        asset: 'stone-well-b2dfcd',
        name: 'Stone well',
        hint: 'A ring of stone with a rope and a bucket, sunk into a front lawn.',
        // West of the crossing, between two driveways.
        spot: { x: -17, y: 0.53, z: 1 },
        rotationY: 0,
      },
      {
        id: 'hood-coffin',
        asset: 'coffin-prop-d62082',
        name: 'Coffin',
        hint: 'A tapered wooden box with brass handles, left on a garden path.',
        // East side, down the path behind the houses.
        spot: { x: 17.5, y: 0.42, z: 14.5 },
        rotationY: 0.6,
      },
      {
        id: 'hood-outhouse',
        asset: 'forest-outhouse-e968d1',
        name: 'Outhouse',
        hint: 'A little timber hut with a crescent moon cut in the door.',
        // Far south-west, at the end of the back path.
        spot: { x: -21.5, y: 0.45, z: -14 },
        rotationY: 1.9,
      },
      {
        id: 'hood-anvil',
        asset: 'anvil-0ad53c',
        name: 'Anvil',
        hint: 'A block of iron with a horn, sitting on the pavement.',
        // Far south, at the bottom of the long path.
        spot: { x: 1, y: 0.45, z: -26 },
        rotationY: -1.1,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // NYC City — a dense street grid.
  // ---------------------------------------------------------------------------
  'nyc-city': {
    brief: 'Five things were left on this block that came in from somewhere quieter.',
    items: [
      {
        id: 'nyc-well',
        asset: 'stone-well-b2dfcd',
        name: 'Stone well',
        hint: 'A ring of stone with a rope and a bucket, on a sidewalk.',
        // West of the crossing, in front of the tenement.
        spot: { x: -9, y: 0.57, z: 11 },
        rotationY: 0.2,
      },
      {
        id: 'nyc-rowboat',
        asset: 'rowboat-c42d85',
        name: 'Rowboat',
        hint: 'A wooden hull with two oars, pulled up where the taxis stop.',
        // West side of the block, against the kerb.
        spot: { x: -15, y: 0.96, z: -4 },
        rotationY: 2.5,
      },
      {
        id: 'nyc-cannon',
        asset: 'deck-cannon-17849e',
        name: 'Deck cannon',
        hint: 'An iron barrel on a wooden carriage, pointed down an avenue.',
        // Further west, in the loading bay.
        spot: { x: 7, y: 0, z: 6 },
        rotationY: -1.4,
      },
      {
        id: 'nyc-bale',
        asset: 'straw-bale-56facd',
        name: 'Straw bale',
        hint: 'A cube of dried stalks, tied with twine, on a city sidewalk.',
        // East side, by the corner shop.
        spot: { x: 12, y: 0, z: -6.5 },
        rotationY: 0.5,
      },
      {
        id: 'nyc-coffin',
        asset: 'coffin-prop-d62082',
        name: 'Coffin',
        hint: 'A tapered wooden box with brass handles, left in a doorway.',
        // South-west, at the far end of the block.
        spot: { x: -13.5, y: 0.35, z: -14.5 },
        rotationY: 1.7,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // Office — a workplace. The outdoors is the intruder.
  // ---------------------------------------------------------------------------
  'office': {
    brief: 'Five things were left in this building that were never part of the job.',
    items: [
      {
        id: 'office-bale',
        asset: 'straw-bale-56facd',
        name: 'Straw bale',
        hint: 'A cube of dried stalks, tied with twine, in a breakout area.',
        // East of the lifts, on the carpet.
        spot: { x: 5.5, y: 0.05, z: 2 },
        rotationY: 0.7,
      },
      {
        id: 'office-fire',
        asset: 'campfire-4390aa',
        name: 'Campfire',
        hint: 'A ring of stones with charred logs, burning on a carpet tile.',
        // West side, in the empty corner behind the partitions.
        spot: { x: -9, y: 0.77, z: 1 },
        rotationY: 0,
      },
      {
        id: 'office-anvil',
        asset: 'anvil-0ad53c',
        name: 'Anvil',
        hint: 'A block of iron with a horn, sitting on a desk where a monitor should be.',
        // On the reception counter by the entrance.
        spot: { x: 9, y: 1.2, z: -0.5 },
        rotationY: -0.6,
      },
      {
        id: 'office-tent',
        asset: 'camp-tent-3c5c89',
        name: 'Camp tent',
        hint: 'Poles, canvas and a zip door, pitched where a meeting table should be.',
        // Far east corner, in the room nobody books.
        spot: { x: 10.5, y: 0.05, z: 7 },
        rotationY: 1.1,
      },
      {
        id: 'office-scarecrow',
        asset: 'scarecrow-334079',
        name: 'Scarecrow',
        hint: 'A coat on crossed sticks with a sack for a head, standing by the windows.',
        // North-east corner, by the glazed wall.
        spot: { x: -2, y: 0.05, z: 4.5 },
        rotationY: 2.3,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Pirate Cove — sail, timber and sand. Modern goods are the intruder.
  // ---------------------------------------------------------------------------
  'pirate-cove': {
    brief: 'Five things washed up in this cove that no ship here ever carried.',
    items: [
      {
        id: 'cove-vending',
        asset: 'vending-machine-471c29',
        name: 'Vending machine',
        hint: 'A lit cabinet of snacks behind glass, humming on the boards.',
        // On the pier, facing the water.
        spot: { x: -1, y: 0.88, z: 10.5 },
        rotationY: 3.0,
      },
      {
        id: 'cove-laptop',
        asset: 'laptop-e775ba',
        name: 'Laptop',
        hint: 'A hinged slab that folds shut, the kind people type on.',
        // Further along the pier, by the mooring posts.
        spot: { x: 5, y: 0.88, z: 12 },
        rotationY: 2.2,
      },
      {
        id: 'cove-chair',
        asset: 'office-chair-7c9874',
        name: 'Office chair',
        hint: 'Five little wheels and a lever underneath, on wet sand.',
        // North of the cove, where the beach flattens out.
        spot: { x: 1.5, y: 0, z: -13 },
        rotationY: 1.4,
      },
      {
        id: 'cove-cone',
        asset: 'traffic-cone-c421e4',
        name: 'Traffic cone',
        hint: 'Bright orange, meant for a road, standing where there is only sand.',
        // East side of the cove, below the rocks.
        spot: { x: 9, y: 0, z: -10.5 },
        rotationY: 0.3,
      },
      {
        id: 'cove-jukebox',
        asset: 'jukebox-1e2ea6',
        name: 'Jukebox',
        hint: 'A lit arch of chrome and glass that plays for coins.',
        // Far west, at the top of the beach by the grass.
        spot: { x: 11.5, y: 0, z: -3 },
        rotationY: 2.6,
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Skatepark — concrete, plywood and paint.
  // ---------------------------------------------------------------------------
  'skatepark': {
    brief: 'Five things were dumped here that no skater brought.',
    items: [
      {
        id: 'skate-sofa',
        asset: 'sofa-9c0e7e',
        name: 'Sofa',
        hint: 'Three cushions and two arms, parked on a flat slab.',
        // West of the flat bank, beside the graffiti wall.
        spot: { x: -9, y: 0.05, z: 10.5 },
        rotationY: 1.2,
      },
      {
        id: 'skate-fridge',
        asset: 'fridge-freezer-fb9b5a',
        name: 'Fridge freezer',
        hint: 'A tall white cupboard that hums, standing by the rail.',
        // East side, near the kiosk.
        spot: { x: 8.5, y: 0.05, z: 8 },
        rotationY: -1.5,
      },
      {
        id: 'skate-piano',
        asset: 'upright-piano-c0b0ef',
        name: 'Upright piano',
        hint: 'Eighty-eight keys under a wooden lid, on a concrete deck.',
        // Far west edge, past the last transition.
        spot: { x: -14, y: 0.05, z: 5.5 },
        rotationY: 0.8,
      },
      {
        id: 'skate-toilet',
        asset: 'toilet-2edbd9',
        name: 'Toilet',
        hint: 'Porcelain, a lid, a cistern — and nothing to plumb it into.',
        // North end of the park, behind the ramp line.
        spot: { x: -1.5, y: 0.05, z: 18 },
        rotationY: 2.0,
      },
      {
        id: 'skate-sink',
        asset: 'kitchen-sink-7ea438',
        name: 'Kitchen sink',
        hint: 'A basin with a tap and a drain, sitting in the middle of the flat.',
        // East of the middle, on the open concrete.
        spot: { x: 3.5, y: 0.05, z: 13 },
        rotationY: -0.9,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // Space Base — a habitat on regolith. Anything grown or dug is the intruder.
  // ---------------------------------------------------------------------------
  'space-base': {
    brief: 'Five things were brought out here that this base has no use for.',
    items: [
      {
        id: 'space-hay',
        asset: 'hay-bale-079e8c',
        name: 'Hay bale',
        hint: 'Dried grass tied with twine, sitting on a service walkway.',
        // West of the landing pad, on the deck between two domes.
        spot: { x: -8.5, y: 0.67, z: -15.5 },
        rotationY: 0.5,
      },
      {
        id: 'space-well',
        asset: 'stone-well-b2dfcd',
        name: 'Stone well',
        hint: 'A ring of stone with a rope and a bucket, sunk into regolith.',
        // East of the pad, below the observation tower.
        spot: { x: 11, y: -0.75, z: -20 },
        rotationY: 0,
      },
      {
        id: 'space-outhouse',
        asset: 'forest-outhouse-e968d1',
        name: 'Outhouse',
        hint: 'A little timber hut with a crescent moon cut in the door.',
        // Far south, behind the depot, at the edge of the crater field.
        spot: { x: -1, y: -1.1, z: -30.5 },
        rotationY: 1.7,
      },
      {
        id: 'space-fire',
        asset: 'campfire-4390aa',
        name: 'Campfire',
        hint: 'A ring of stones with charred logs — in a place with no oxygen to burn.',
        // Deep south, out on the open regolith.
        spot: { x: 2, y: -0.44, z: -33.5 },
        rotationY: 0,
      },
      {
        id: 'space-anchor',
        asset: 'admiralty-anchor-bd6882',
        name: 'Ship anchor',
        hint: 'Two flukes and a shank, heavy enough to hold a ship — with no sea for miles.',
        // North-east, on the platform by the hangar.
        spot: { x: -6, y: 0, z: -6.5 },
        rotationY: 2.4,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // Stadium — a match day. Household things are the intruder.
  // ---------------------------------------------------------------------------
  'stadium': {
    brief: 'Five things were left in this ground that no team brought.',
    items: [
      {
        id: 'stadium-sofa',
        asset: 'sofa-9c0e7e',
        name: 'Sofa',
        hint: 'Three cushions and two arms, set down where the warm-up happens.',
        // Behind the goal line, east side of the pitch.
        spot: { x: 16.5, y: -0.06, z: 1 },
        rotationY: 1.6,
      },
      {
        id: 'stadium-fridge',
        asset: 'fridge-freezer-fb9b5a',
        name: 'Fridge freezer',
        hint: 'A tall white cupboard that hums, standing on the touchline.',
        // East side, past the dugouts.
        spot: { x: 16.5, y: -0.06, z: -9 },
        rotationY: -1.3,
      },
      {
        id: 'stadium-bale',
        asset: 'straw-bale-56facd',
        name: 'Straw bale',
        hint: 'A cube of dried stalks, tied with twine, on the turf.',
        // North end of the pitch, near the centre circle.
        spot: { x: 11.5, y: 0.05, z: 6 },
        rotationY: 0.4,
      },
      {
        id: 'stadium-piano',
        asset: 'upright-piano-c0b0ef',
        name: 'Upright piano',
        hint: 'Eighty-eight keys under a wooden lid, on the running track.',
        // South end, on the track behind the goal.
        spot: { x: 11.5, y: 0.05, z: -14 },
        rotationY: 2.7,
      },
      {
        id: 'stadium-rowboat',
        asset: 'rowboat-c42d85',
        name: 'Rowboat',
        hint: 'A wooden hull with two oars, pulled up in the long-jump pit.',
        // Far south, beyond the goal, at the edge of the track.
        spot: { x: 6.5, y: 0.05, z: -19 },
        rotationY: 0.9,
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // Symphony Stagecraft — a concert hall. The outdoors is the intruder.
  // ---------------------------------------------------------------------------
  'symphony-stagecraft': {
    brief: 'Five things were left in this hall that no orchestra carries.',
    items: [
      {
        id: 'symphony-bale',
        asset: 'hay-bale-079e8c',
        name: 'Hay bale',
        hint: 'Dried grass tied with twine, sitting on a riser in the stalls.',
        // On a seat row just in front of the stage.
        spot: { x: -6.5, y: 0.45, z: 0 },
        rotationY: 0.3,
      },
      {
        id: 'symphony-sink',
        asset: 'kitchen-sink-7ea438',
        name: 'Kitchen sink',
        hint: 'A basin with a tap and a drain, in the middle of the floor.',
        // East end of the hall, by the boxes.
        spot: { x: 7, y: 0.85, z: 7.5 },
        rotationY: 1.8,
      },
      {
        id: 'symphony-tractor',
        asset: 'riding-lawn-tractor-09e93c',
        name: 'Riding mower',
        hint: 'A little tractor with a cutting deck, parked between two seat rows.',
        // Far west, in the side aisle.
        spot: { x: -21.5, y: 0.73, z: 6 },
        rotationY: 0.6,
      },
      {
        id: 'symphony-vending',
        asset: 'vending-machine-471c29',
        name: 'Vending machine',
        hint: 'A lit cabinet of snacks behind glass, humming against the panelling.',
        // North aisle, west of the stage.
        spot: { x: -15.5, y: 0.85, z: -6 },
        rotationY: 1.4,
      },
      {
        id: 'symphony-chair',
        asset: 'office-chair-7c9874',
        name: 'Office chair',
        hint: 'Five wheels and a gas lift, on a stone floor built for pews.',
        // Far north, behind the last row.
        spot: { x: 1.5, y: 0.45, z: -2 },
        rotationY: -0.9,
      },
    ],
  },
};

/** The map's hunt, or null for a map that has not been authored yet. */
export function hiddenItemsFor(mapId: string): HiddenItemMap | null {
  return HIDDEN_ITEMS[mapId] ?? null;
}
