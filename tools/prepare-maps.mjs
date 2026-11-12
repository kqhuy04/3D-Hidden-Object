#!/usr/bin/env node
/**
 * Turns kit archives into playable maps.
 *
 * For every `maps/*.zip`:
 *   1. extract the assembled `scene.glb` (the kit's 100+ part files are not used
 *      at runtime — the map is a single baked scene)
 *   2. report every placed object's world bounding box (tools/map-report.mjs)
 *   3. Draco-compress the map into `public/assets/maps/<id>.glb`
 *   4. write `<id>.json` next to it: bounds, spawn point, object list
 *   5. regenerate `src/data/mapRegistry.ts`
 *
 * Idempotent: a map whose output is newer than its archive is skipped, so the
 * same command can be re-run as more kits arrive. `--refresh` recomputes the
 * report, the spawn point and the sidecar from the already-extracted source
 * without paying for the Draco pass again — that is what you want after
 * changing the spawn heuristic, since the payload has not changed.
 *
 *   node tools/prepare-maps.mjs [--force] [--only <substr>] [--no-compress] [--refresh]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { reportMap } from './map-report.mjs';

const ROOT = process.cwd();
const MAPS_DIR = path.join(ROOT, 'maps');
const WORK_DIR = path.join(MAPS_DIR, 'work');
const REPORT_DIR = path.join(MAPS_DIR, 'reports');
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'maps');
const REGISTRY = path.join(ROOT, 'src', 'data', 'mapRegistry.ts');

const args = process.argv.slice(2);
const force = args.includes('--force');
const noCompress = args.includes('--no-compress');
const refresh = args.includes('--refresh');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;

const log = (...a) => console.log(...a);
const mb = (n) => (n / 1048576).toFixed(2);

/** `kit-countryside-railway-9b4c57.zip` -> `countryside-railway` */
function idOf(zipName) {
  return zipName
    .replace(/\.zip$/i, '')
    .replace(/^kit-/, '')
    .replace(/-[0-9a-f]{6}$/i, '')
    .replace(/-kit$/, '')
    .replace(/-\d+$/, '');
}

/**
 * Names the automatic rule gets wrong.
 *
 * `dia-de-muertos` is a Spanish title, not three English words: uppercasing the
 * short ones (the rule that turns `3d` into `3D`) produced "Dia DE Muertos" on
 * the map card.
 */
/**
 * Names the word-splitter gets wrong: acronyms it would title-case, and the one
 * Spanish title. Everything else is `countryside-railway` -> `Countryside
 * Railway`.
 */
const LABEL_OVERRIDES = {
  'dia-de-muertos': 'Día de Muertos',
  'nyc-city': 'NYC City',
  // The kit is called "alpine and snow", which describes the contents of the
  // box, not the place. It is a working ski resort — chairlift, piste basher,
  // patrol hut, refuge — so the card says what the player is walking into.
  'alpine-and-snow': 'Alpine Ski Resort',
};

/** `countryside-railway` -> `Countryside Railway` */
function labelOf(id) {
  if (LABEL_OVERRIDES[id]) return LABEL_OVERRIDES[id];
  return id
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * The height the props were placed at.
 *
 * Every kit stands its props on a floor: tiles, slabs, a terrain sheet. So the
 * *most common* bottom edge across the object list is that floor, and the
 * height of the floor is the mode — not the minimum. Taking the minimum, as
 * this did first, finds whatever was buried deepest: the construction site has
 * an excavation whose floor is 3.2 m down, so every prop in the map was
 * measured against a pit and the spawn landed in it.
 *
 * Buckets are half a metre wide, and ties go to the lower level, because a
 * floor is always below the things standing on it.
 */
function groundLevel(objs) {
  const buckets = new Map();
  for (const o of objs) {
    const k = Math.round(o.aabb.min[1] * 2) / 2;
    buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  let level = 0;
  let count = -1;
  for (const [k, n] of buckets) {
    if (n > count || (n === count && k < level)) {
      level = k;
      count = n;
    }
  }
  return level;
}

/**
 * A spawn the body can actually stand on.
 *
 * The candidate is the centre of the union of the floor pieces — take the
 * union, not one tile: a single tile's centre is at the edge of the room, while
 * the union's centre is inside it. This is only a *hint*: the game re-checks it
 * against the collision resolver at load (`WorldCollision.findSpawn`) and walks
 * outwards until it finds ground a capsule fits on.
 */
function chooseSpawn(report) {
  const objs = report.objects.filter((o) => o.aabb);
  if (!objs.length) return { x: 0, y: 0.5, z: 0 };

  const level = groundLevel(objs);

  // Floor pieces: they sit on the level and stay low. A crate also starts at
  // the level, so the height cap is what separates a floor from a prop.
  const ground = objs.filter((o) => {
    const h = o.aabb.max[1] - o.aabb.min[1];
    return o.aabb.min[1] <= level + 0.3 && o.aabb.max[1] <= level + 0.6 && h <= 1.2;
  });
  const pool = ground.length ? ground : objs;

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const o of pool) {
    if (o.aabb.min[0] < minX) minX = o.aabb.min[0];
    if (o.aabb.max[0] > maxX) maxX = o.aabb.max[0];
    if (o.aabb.min[2] < minZ) minZ = o.aabb.min[2];
    if (o.aabb.max[2] > maxZ) maxZ = o.aabb.max[2];
  }

  let cx = (minX + maxX) / 2;
  let cz = (minZ + maxZ) / 2;

  // Snap onto an actual piece. The centre of the union is only floor when the
  // floor is one slab: the Día de Muertos map is a terraced hillside whose
  // pieces sit at half a dozen heights, and their union's centre is a point on
  // a slope between two terraces, 3 m below either of them.
  let snap = null;
  let snapDist = Infinity;
  for (const o of pool) {
    const px = (o.aabb.min[0] + o.aabb.max[0]) / 2;
    const pz = (o.aabb.min[2] + o.aabb.max[2]) / 2;
    const d = (px - cx) ** 2 + (pz - cz) ** 2;
    if (d < snapDist) {
      snapDist = d;
      snap = { px, pz };
    }
  }
  if (snap) {
    cx = snap.px;
    cz = snap.pz;
  }

  // Half a metre above the floor, so gravity settles the body onto it.
  const y = +(level + 0.5).toFixed(2);

  // The centre of the floor can still be inside a wall or a desk. Step outward
  // in a spiral until the point is clear of every object that spans that height.
  const blockers = objs.filter((o) => o.aabb.min[1] < y - 0.05 && o.aabb.max[1] > y + 0.4);
  const blocked = (x, z) =>
    blockers.some(
      (o) => x > o.aabb.min[0] - 0.4 && x < o.aabb.max[0] + 0.4 &&
             z > o.aabb.min[2] - 0.4 && z < o.aabb.max[2] + 0.4
    );
  if (blocked(cx, cz)) {
    let found = false;
    for (let r = 1; r <= 12 && !found; r += 1) {
      for (let a = 0; a < 12; a++) {
        const t = (a / 12) * Math.PI * 2;
        const px = cx + Math.cos(t) * r;
        const pz = cz + Math.sin(t) * r;
        if (!blocked(px, pz)) {
          cx = px; cz = pz; found = true; break;
        }
      }
    }
  }

  return {
    x: +cx.toFixed(2),
    y,
    z: +cz.toFixed(2),
    on: `${pool.length} floor pieces at y=${level}`,
  };
}

mkdirSync(WORK_DIR, { recursive: true });
mkdirSync(REPORT_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const zips = readdirSync(MAPS_DIR)
  .filter((f) => f.toLowerCase().endsWith('.zip'))
  .filter((f) => !only || f.includes(only))
  .sort();

if (!zips.length) {
  // No archives left is the normal end state, not an error: every map has been
  // prepared and its archive deleted. Fall through to the registry rebuild,
  // which reads the sidecars and must not be skipped.
  log(`no archives in ${path.relative(ROOT, MAPS_DIR)}/ — rebuilding the registry from sidecars`);
}

for (const zip of zips) {
  const zipPath = path.join(MAPS_DIR, zip);
  const id = idOf(zip);
  const workDir = path.join(WORK_DIR, id);
  const srcGlb = path.join(workDir, 'scene.glb');
  const outGlb = path.join(OUT_DIR, `${id}.glb`);
  // The sidecar lives outside `public/`: nothing fetches it at runtime — it is
  // build-time data for the photo-target pass — and 1.6 MB of JSON copied into
  // every installer for nobody to read is just weight.
  const outJson = path.join(REPORT_DIR, `${id}.json`);

  const zipTime = statSync(zipPath).mtimeMs;
  const upToDate =
    !force &&
    !refresh &&
    existsSync(outGlb) &&
    existsSync(outJson) &&
    statSync(outGlb).mtimeMs > zipTime;

  if (upToDate) {
    log(`= ${id} — up to date`);
    continue;
  }

  // 1. extract
  // `--refresh` keeps the extracted source and the compressed payload, and only
  // redoes the derived data below.
  const reusePayload = refresh && existsSync(srcGlb) && existsSync(outGlb);
  mkdirSync(workDir, { recursive: true });
  if (!reusePayload && (!existsSync(srcGlb) || statSync(srcGlb).mtimeMs < zipTime)) {
    try {
      execFileSync('unzip', ['-o', '-j', zipPath, 'scene.glb', '-d', workDir], {
        stdio: 'ignore',
      });
    } catch {
      throw new Error(`${zip}: no scene.glb inside`);
    }
  }
  const srcBytes = statSync(srcGlb).size;
  log(`\n> ${id}  (${mb(srcBytes)} MB)`);

  // 2. bounding boxes
  const report = reportMap(srcGlb);
  log(
    `  objects ${report.totals.objects}  keys ${report.totals.keys}  ` +
      `tris ${report.totals.triangles.toLocaleString()}` +
      (report.totals.withoutBounds ? `  NO-BOUNDS ${report.totals.withoutBounds}` : '')
  );

  // 3. compress
  if (!noCompress && !reusePayload) {
    // Run the CLI's entry script with the current node binary: `npx` on Windows
    // needs a shell, and a shell mangles the spaces in this project's path.
    const cli = path.join(ROOT, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');
    if (!existsSync(cli)) throw new Error('gltf-transform CLI missing — run npm i -D @gltf-transform/cli@4');
    try {
      execFileSync(process.execPath, [cli, 'draco', srcGlb, outGlb], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (err) {
      const detail = err.stderr ? err.stderr.toString().trim() : err.message;
      throw new Error(`${id}: draco failed — ${detail}`);
    }
  } else if (!existsSync(outGlb)) {
    throw new Error(`${id}: --no-compress needs an existing ${path.basename(outGlb)}`);
  }
  const outBytes = statSync(outGlb).size;

  // 4. sidecar: the bounding-box report plus everything the game needs to know
  // about this map. One file, in `maps/reports/`, never shipped.
  const spawn = chooseSpawn(report);
  const sidecar = {
    ...report,
    id,
    label: labelOf(id),
    file: `/assets/maps/${id}.glb`,
    sourceBytes: srcBytes,
    bytes: outBytes,
    spawn,
  };
  writeFileSync(outJson, JSON.stringify(sidecar, null, 1));
  log(
    `  ${mb(srcBytes)} MB -> ${mb(outBytes)} MB  (${(srcBytes / outBytes).toFixed(1)}x)  ` +
      `spawn (${spawn.x}, ${spawn.y}, ${spawn.z}) on ${spawn.on}`
  );
}

// 5. registry
//
// Built from the sidecars on disk, not from this run's `built` list. The
// archives are disposable — they are deleted once a map is prepared — while the
// sidecar is the record of what was prepared, so a run with no zips left must
// still emit the full registry instead of wiping it down to the built-in map.
const builtInGlb = path.join(ROOT, 'public', 'assets', 'environment', 'scene.glb');
const BUILT_IN = {
  id: 'campground-lake',
  label: 'Campground & Lake',
  file: '/assets/environment/scene.glb',
  spawn: { x: 0, y: 0.5, z: -2 },
  bytes: existsSync(builtInGlb) ? statSync(builtInGlb).size : 0,
};

const sidecars = existsSync(REPORT_DIR)
  ? readdirSync(REPORT_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(readFileSync(path.join(REPORT_DIR, f), 'utf8'));
        } catch {
          return null;
        }
      })
      // A sidecar without an id or without its payload is a leftover from an
      // interrupted run; the game could not load it, so it must not appear.
      .filter((j) => j && j.id && j.file && existsSync(path.join(ROOT, 'public', j.file.replace(/^\//, ''))))
  : [];

const entries = [BUILT_IN]
  .concat(
    sidecars
      .map((json) => ({
        id: json.id,
        // Derived, not read from the sidecar: a label is presentation, and a
        // stale one in an old sidecar would outlive the override that fixed it.
        label: labelOf(json.id),
        file: json.file,
        // Only x/y/z here: `on` is documentation, kept in the sidecar.
        spawn: {
          x: json.spawn.x,
          y: json.spawn.y,
          z: json.spawn.z,
        },
        // Shown on the map-select card: how big the place is, and what it costs
        // to download it.
        objects: json.totals?.objects ?? undefined,
        bytes: json.bytes ?? undefined,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );

const ts = `// Generated by tools/prepare-maps.mjs — do not edit by hand.
//
// One entry per map prepared from an archive in ./maps, rebuilt from the
// sidecars in ./maps/reports — the archives themselves are deleted once a map
// is prepared, so the sidecar is the record. \`spawn\` is the centre of the
// map's floor — the union of the flat pieces standing on the level most props
// were placed at — half a metre up. It is a hint, not a promise: at load the
// collision resolver re-checks it and walks outwards until it finds ground a
// capsule actually fits on (see \`WorldCollision.findSpawn\`).

export interface MapEntry {
  id: string;
  label: string;
  file: string;
  spawn: { x: number; y: number; z: number };
  /** Placed objects. Absent for the built-in map, which was never processed. */
  objects?: number;
  /** Compressed payload in bytes. */
  bytes?: number;
}

export const MAPS: MapEntry[] = ${JSON.stringify(entries, null, 2)};

export const DEFAULT_MAP_ID = 'campground-lake';

/** Map requested with ?map=<id>, falling back to the built-in one. */
export function resolveMap(id?: string | null): MapEntry {
  if (id) {
    const hit = MAPS.find((m) => m.id === id);
    if (hit) return hit;
  }
  return (
    MAPS.find((m) => m.id === DEFAULT_MAP_ID) ?? {
      id: DEFAULT_MAP_ID,
      label: 'Campground & Lake',
      file: '/assets/environment/scene.glb',
      spawn: { x: 0, y: 0.5, z: -2 },
    }
  );
}
`;
writeFileSync(REGISTRY, ts);
log(`\nregistry: ${entries.length} maps -> ${path.relative(ROOT, REGISTRY)}`);
