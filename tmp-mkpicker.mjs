// Builds a static copy of the map picker for layout review.
//
// No vite, no WebGL, no map load: just the real stylesheet, the real
// thumbnails and the markup `MapSelect` produces. A layout question does not
// need a 37-second world build to answer.
import fs from 'node:fs';

const css = fs.readFileSync('src/app/styles.css', 'utf8');
const cards = [
  ['campground-lake', 'Campground & Lake', 'Six campers, one lake, and five things that were never packed.'],
  ['cozy-farm', 'Cozy Farm', 'Eggs, hay and a tractor that has not moved in years.'],
  ['office', 'Office', 'Fluorescent light, dead plants, and a desk nobody clears.'],
  ['pirate-cove', 'Pirate Cove', 'Salt, rope and a chest that is already open.'],
  ['space-base', 'Space Base', 'Grey corridors, colder airlocks, one very lost toolbox.'],
  ['stadium', 'Stadium', 'Forty thousand empty seats and five wrong ones.'],
];
const records = ['Cleared · 2:14', '3 of 5 found', '', 'Cleared · 1:48', '', '1 of 5 found'];

const card = (i) => {
  const [id, label, brief] = cards[i];
  return `
    <button class="map-card interactive-ui${i === 0 ? ' is-current is-cleared' : ''}${i === 3 ? ' is-cleared' : ''}">
      <span class="map-card-frame">
        <img class="map-card-image" src="public/maps/${id}.jpg" alt="">
      </span>
      <span class="map-card-body">
        <span class="map-card-name">${label}</span>
        <span class="map-card-meta">${brief}</span>
        ${records[i] ? `<span class="map-card-record">${records[i]}</span>` : ''}
      </span>
      ${i === 0 ? '<span class="map-card-chip">PLAYING</span>' : ''}
    </button>`;
};

fs.writeFileSync(
  'tmp-picker.html',
  `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>${css}</style>
<style>body{background:var(--paper-deep);margin:0}
.screen-overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}</style>
</head><body>
<div class="screen-overlay">
  <div class="map-panel">
    <div class="map-panel-head">
      <span class="kicker">21 places</span>
      <h2 class="menu-title">Choose a map</h2>
      <p class="menu-hint">Every map is walkable &mdash; collision is built from its own geometry.</p>
    </div>
    <div class="map-grid">${cards.map((_, i) => card(i)).join('')}</div>
    <div class="map-panel-foot">
      <button class="btn btn-outline interactive-ui"><span class="btn-icon">&larr;</span> Back</button>
      <div class="map-pager">
        <button class="pager-btn interactive-ui" disabled>&lsaquo;</button>
        <span class="map-pager-label">1 / 4</span>
        <button class="pager-btn interactive-ui">&rsaquo;</button>
      </div>
    </div>
  </div>
</div>
</body></html>`
);
console.log('wrote tmp-picker.html');
