/**
 * Mixamo FBX -> the compact JSON the game's CharacterAnimator loads.
 *
 * Usage:
 *   node tools/convert-fbx-anim.mjs raw-anims/Jumping.fbx jump
 *
 * Output: downloaded_anims/anim-<name>.json and public/assets/anims/anim-<name>.json
 *
 * Format (must stay in sync with CharacterAnimator.RawAnimTrackData):
 *   { name, times: number[], tracks: { [bone]: number[] /* quaternion xyzw *\/ },
 *     hips: number[] /* translation xyz in metres, per key *\/ }
 *
 * Bone names are stored without the `mixamorig` prefix because that is how the
 * character GLB names its bones. The game rebinds them by name, so the skeleton
 * this FBX was made for and the character must share Mixamo's bone naming.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * three's FBXLoader crashes on some Mixamo exports: `parseAnimationLayers`
 * assumes every animated curve node is parented through a property connection
 * (`parents.filter(p => p.relationship !== undefined)[0].ID`) and throws on the
 * T-pose curves that Mixamo leaves in the stack. It also uses relative imports
 * that only resolve inside three's own tree.
 *
 * Both are fixed in a generated copy rather than by editing node_modules, so
 * reinstalling dependencies cannot silently bring the crash back.
 */
async function loadPatchedFBXLoader() {
  const source = path.resolve('node_modules/three/examples/jsm/loaders/FBXLoader.js');
  const cacheDir = path.resolve('tools/.cache');
  const cached = path.join(cacheDir, 'FBXLoader.patched.mjs');

  let code = fs.readFileSync(source, 'utf8');

  code = code
    .replace(/from '\.\.\/libs\/fflate\.module\.js'/, "from 'three/examples/jsm/libs/fflate.module.js'")
    .replace(/from '\.\.\/curves\/NURBSCurve\.js'/, "from 'three/examples/jsm/curves/NURBSCurve.js'");

  const before = code;
  code = code.replace(
    /const modelID = connections\.get\( child\.ID \)\.parents\.filter\(([\s\S]*?)\)\[ 0 \]\.ID;/,
    (_m, body) =>
      'const __curveParent = ( connections.get( child.ID )?.parents ?? [] ).filter(' +
      body +
      ')[ 0 ];\n' +
      '\t\t\t\t\t\t\t\tconst modelID = __curveParent === undefined ? undefined : __curveParent.ID;'
  );
  if (code === before) {
    console.warn('warning: unused-curve guard no longer applies; FBXLoader source changed');
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cached, code);
  return import(pathToFileURL(cached).href);
}

const [, , inputPath, clipArg] = process.argv;
if (!inputPath || !clipArg) {
  console.error('usage: node tools/convert-fbx-anim.mjs <file.fbx> <clipName>');
  process.exit(1);
}

const raw = fs.readFileSync(inputPath);
const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);

// FBXLoader wants a manager/loading manager but works headless for geometry and
// animation; only embedded textures would need a DOM.
const { FBXLoader } = await loadPatchedFBXLoader();
const loader = new FBXLoader();
const fbx = loader.parse(buffer, path.dirname(inputPath) + '/');

const takes = fbx.animations || [];
if (takes.length === 0) {
  console.error('No animation found in', inputPath);
  process.exit(1);
}

/**
 * A Mixamo export normally has a single take called `mixamo.com`, but a file
 * that was re-saved in Blender/Maya often carries stale takes too — the
 * Jumping.fbx in this repo also contains a leftover 1 s "Walk". Taking
 * animations[0] therefore silently converts the wrong motion, so the take is
 * chosen explicitly: `--take=<name|index>`, else the Mixamo default, else the
 * only take, else refuse.
 */
const takeArg = process.argv.slice(4).find((a) => a.startsWith('--take='))?.slice(7);
let clip;
if (takeArg !== undefined) {
  clip = /^\d+$/.test(takeArg) ? takes[Number(takeArg)] : takes.find((t) => t.name === takeArg);
  if (!clip) {
    console.error(`Take "${takeArg}" not found. Available:`, takes.map((t, i) => `${i}:${t.name}`).join(', '));
    process.exit(1);
  }
} else {
  const mixamo = takes.filter((t) => t.name === 'mixamo.com');
  if (mixamo.length === 1) clip = mixamo[0];
  else if (takes.length === 1) clip = takes[0];
  else {
    console.error('Several takes found; pick one with --take=<name|index>:');
    takes.forEach((t, i) => console.error(`  ${i}: ${t.name}  ${t.duration.toFixed(2)}s  ${t.tracks.length} tracks`));
    process.exit(1);
  }
}

if (takes.length > 1) {
  console.log(`takes     : ${takes.map((t, i) => `${i}:${t.name}${t === clip ? ' <-' : ''}`).join(', ')}`);
}

/** FBX sanitises node names; Mixamo writes `mixamorig:Hips` -> `mixamorigHips`. */
function boneName(trackName) {
  const nodeName = trackName.split('.')[0];
  return nodeName.replace(/^mixamorig[:_]?/i, '');
}

/**
 * Hips translation is stored as an offset from the rig's *bind pose*, in
 * metres, because the game adds it to its own character's rest height. Reading
 * the bind pose from the file (rather than hard-coding Mixamo's 94.99 cm) keeps
 * a differently-scaled rig honest.
 */
const bindHips = fbx.getObjectByName('Hips');
if (!bindHips) {
  console.error('No Hips node in the scene graph; cannot normalise hip height');
  process.exit(1);
}
const baseHipY = bindHips.position.y;

/**
 * Tracks do not all share the same key count. Mixamo ships bones it never
 * animates (Face_Jaw is the usual one) as a single keyframe, while the body
 * tracks have 30-60. Emitting them on a shared time array produces a
 * QuaternionKeyframeTrack with 4 values and 58 times, and three derives
 * `valueSize = 4 / 58` from that: a fractional stride, a zero-length mixer
 * buffer, and `PropertyMixer.saveOriginalState` looping forever the first time
 * the action is played — a frozen tab, not an exception.
 *
 * So every track is resampled onto one master grid here. Quaternions use
 * shortest-path nlerp; a single-key track simply holds its value.
 */
function resampleTrack(srcTimes, srcValues, stride, dstTimes, isQuat) {
  const out = new Array(dstTimes.length * stride);

  if (srcTimes.length === 1) {
    for (let i = 0; i < dstTimes.length; i++) {
      for (let c = 0; c < stride; c++) out[i * stride + c] = srcValues[c];
    }
    return out;
  }

  let k = 0;
  for (let i = 0; i < dstTimes.length; i++) {
    const t = dstTimes[i];
    while (k < srcTimes.length - 2 && srcTimes[k + 1] < t) k++;

    const t0 = srcTimes[k];
    const t1 = srcTimes[k + 1];
    const span = t1 - t0;
    const a = span > 0 ? Math.min(1, Math.max(0, (t - t0) / span)) : 0;

    const o0 = k * stride;
    const o1 = (k + 1) * stride;
    let dot = 0;
    if (isQuat) {
      for (let c = 0; c < 4; c++) dot += srcValues[o0 + c] * srcValues[o1 + c];
    }

    let norm = 0;
    for (let c = 0; c < stride; c++) {
      // Shortest path: negate the second key when the pair is more than 180°
      // apart, otherwise the blend swings the long way round.
      const v1 = isQuat && dot < 0 ? -srcValues[o1 + c] : srcValues[o1 + c];
      const v = srcValues[o0 + c] + (v1 - srcValues[o0 + c]) * a;
      out[i * stride + c] = v;
      if (isQuat) norm += v * v;
    }

    if (isQuat) {
      norm = Math.sqrt(norm) || 1;
      for (let c = 0; c < stride; c++) out[i * stride + c] /= norm;
    }
  }
  return out;
}

const rawQuats = {};
let hipsRaw = null;
let hipsRawTimes = null;
let masterTimes = null;

for (const track of clip.tracks) {
  const nodeName = boneName(track.name);
  const isQuat = track.name.endsWith('.quaternion');
  const isPos = track.name.endsWith('.position');

  if (isQuat) {
    // The master grid is the densest quaternion track: everything else is
    // resampled onto it, so no track can end up shorter than the clip.
    if (!masterTimes || track.times.length > masterTimes.length) {
      masterTimes = Array.from(track.times);
    }
    rawQuats[nodeName] = { times: Array.from(track.times), values: Array.from(track.values) };
  } else if (isPos && /^Hips$/i.test(nodeName)) {
    hipsRaw = Array.from(track.values);
    hipsRawTimes = Array.from(track.times);
  }
}

if (!masterTimes) {
  console.error('Animation has no quaternion tracks');
  process.exit(1);
}

const times = masterTimes;
const quats = {};
for (const [name, t] of Object.entries(rawQuats)) {
  quats[name] = resampleTrack(t.times, t.values, 4, times, true);
}

let hips = [];
if (hipsRaw) {
  const shifted = hipsRaw.slice();
  for (let i = 1; i < shifted.length; i += 3) shifted[i] -= baseHipY;
  hips = resampleTrack(hipsRawTimes, shifted, 3, times, false);
}
// cm -> m, same convention as the existing clips.
for (let i = 0; i < hips.length; i++) hips[i] = hips[i] / 100;

/**
 * Vertical split. The animation's hip curve is the truth for how the body
 * moves, but the game owns the player's root height (ground + step). Writing
 * the whole curve into the skeleton *and* moving the root would double it.
 *
 *   airborne part (dy > 0) -> `rootLift`: the game raises the root, so the
 *                             camera follows and the capsule leaves the ground
 *   compression  (dy < 0)  -> `hips`    : the crouch and the landing absorb,
 *                             which must stay in the skeleton or the legs would
 *                             be bent for a height the hips are not at
 *
 * hips + rootLift always reconstructs the original curve, so the pose is
 * unchanged; only which node carries it differs.
 */
const rootLift = [];
for (let i = 0; i < hips.length; i += 3) {
  const dy = hips[i + 1];
  const lift = dy > 0 ? dy : 0;
  rootLift.push(lift);
  hips[i + 1] = dy - lift;
}
const hasLift = rootLift.some((v) => v > 0.001);

// Round to 5 decimals: 1e-5 on a quaternion component is far below any visible
// error and roughly halves the file size.
const round = (n) => Math.round(n * 1e5) / 1e5;
const roundAll = (arr) => arr.map(round);

const payload = {
  name: clipArg.charAt(0).toUpperCase() + clipArg.slice(1),
  duration: round(clip.duration),
  times: roundAll(times),
  tracks: Object.fromEntries(Object.entries(quats).map(([k, v]) => [k, roundAll(v)])),
  hips: roundAll(hips),
  ...(hasLift ? { rootLift: roundAll(rootLift) } : {}),
};

const text = JSON.stringify(payload);
const outName = `anim-${clipArg}.json`;
const targets = [
  path.join('downloaded_anims', outName),
  path.join('public', 'assets', 'anims', outName),
];
for (const t of targets) {
  fs.mkdirSync(path.dirname(t), { recursive: true });
  fs.writeFileSync(t, text);
}

console.log(`clip      : ${payload.name}  ${clip.duration.toFixed(3)}s  (take "${clip.name}")`);
console.log(`keys      : ${times.length}  (${(times.length / clip.duration).toFixed(1)} fps)`);
console.log(`bones     : ${Object.keys(quats).length}`);
console.log(`hips      : bind ${baseHipY.toFixed(2)}cm, ${hips.length / 3} keys, y ${Math.min(...hips.filter((_, i) => i % 3 === 1)).toFixed(3)}..${Math.max(...hips.filter((_, i) => i % 3 === 1)).toFixed(3)} m (compression only)`);
console.log(`rootLift  : ${hasLift ? `0..${Math.max(...rootLift).toFixed(3)} m (airborne, the game moves the root)` : 'none (grounded clip)'}`);
console.log(`tracks    : ${Object.keys(quats).length} quaternion + ${hips.length ? 1 : 0} hips, all ${times.length} keys`);
console.log(`missing   : ${['Hips', 'Spine', 'Head', 'LeftUpLeg', 'RightUpLeg'].filter((b) => !quats[b]).join(', ') || 'none'}`);
console.log(`written   : ${targets.join(', ')}  (${(text.length / 1024).toFixed(0)} KB)`);
