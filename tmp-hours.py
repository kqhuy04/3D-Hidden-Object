import io

p = 'src/data/mapMood.ts'
s = io.open(p, encoding='utf-8').read()

# Sunrise 07:30 / sunset 20:30. Chosen so that no two maps land on the same sun
# elevation, which is what made four maps render identically before.
HOURS = {
    'campground-lake': 17.6,
    'chrome-arcology-transit': 20.2,
    'chronos-hearth': 19.4,
    'construction-site': 11.0,
    'coral-reef': 11.6,
    'countryside-railway': 7.8,
    'cozy-farm': 9.4,
    'dia-de-muertos': 20.0,
    'frontier-town': 15.4,
    'hospital': 9.0,
    'japanese-suburban-city-street': 18.4,
    'medieval-village': 8.6,
    'modern-restaurant-cafe': 20.4,
    'neighborhood-pathways': 10.6,
    'nyc-city': 20.0,
    'office': 16.6,
    'pirate-cove': 12.6,
    'skatepark': 17.0,
    'space-base': 12.0,
    'stadium': 19.8,
    'symphony-stagecraft': 19.6,
}

lines = s.split('\n')
current = None
count = 0
for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped.startswith("'") or (stripped and stripped[0].isalpha()):
        key = stripped.split(':')[0].strip("'\" ")
        if key in HOURS:
            current = key
    if current and 'timeOfDay:' in line:
        before, _, rest = line.partition('timeOfDay:')
        _, _, tail = rest.partition(',')
        lines[i] = before + 'timeOfDay: ' + str(HOURS[current]) + ',' + tail
        current = None
        count += 1

io.open(p, 'w', encoding='utf-8').write('\n'.join(lines))
print('replaced', count, 'of', len(HOURS))
