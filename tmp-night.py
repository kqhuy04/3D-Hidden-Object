import io

p = 'src/data/mapMood.ts'
s = io.open(p, encoding='utf-8').read()

old = """  // The one rainy map. A city in rain is the most recognisable city there is,
  // and rain at sunset is bright enough to hunt in.
  'nyc-city': { timeOfDay: 20.0, weather: 'rain' },"""

new = """  // The one rainy map, and the one genuinely dark map: a city at night in rain,
  // which is the most recognisable city there is. It is the exception the whole
  // table is built to allow — every other map stops at dusk, because a hunt
  // needs its five objects to be visible, and this one earns the darkness by
  // being the only place where darkness is the subject. If it ever reads as too
  // dark to play, move the hour back toward 20 and nothing else has to change.
  'nyc-city': { timeOfDay: 21.4, weather: 'rain' },"""

assert old in s
s = s.replace(old, new)
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
