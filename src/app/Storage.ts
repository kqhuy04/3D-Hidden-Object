/**
 * What survives closing the tab.
 *
 * Two things only: the settings, because nobody wants to re-pick their quality
 * and sensitivity every session, and how each map went, because a hidden-object
 * game without a record of which places you have cleared is a game that forgets
 * why you were playing.
 *
 * Everything is versioned and defensive. localStorage can be disabled, full, or
 * holding a value from an older build, and none of those may stop the game from
 * booting — a corrupt settings blob is worth a shrug, not a black screen.
 */

const KEY = 'odd-objects:v1';

export type QualityLevel = 'auto' | 'low' | 'medium' | 'high';

export interface Settings {
  quality: QualityLevel;
  shadows: boolean;
  /** Field of view, degrees. */
  fov: number;
  /** Mouse look multiplier, 0.4 … 2.5. */
  sensitivity: number;
  /** Master volume, 0 … 1. */
  volume: number;
  showFps: boolean;
  /**
   * Which character the player picked on the start screen.
   *
   * Kept in settings rather than progress because it is a preference, not an
   * achievement — resetting progress must not change who you are. An id that no
   * longer exists in the roster falls back to the default in `characterFor()`
   * rather than being validated here, so removing a character cannot strand a
   * save.
   */
  character: string;
}

export interface MapRecord {
  /** Best number found in a single round, 0 … 5. */
  found: number;
  /** Fastest complete clear, in seconds. Null until the map is cleared. */
  bestSeconds: number | null;
}

export interface Progress {
  lastMap: string;
  maps: Record<string, MapRecord>;
}

export interface SaveData {
  settings: Settings;
  progress: Progress;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  shadows: true,
  // These two match what the game shipped with, so a player who never opens the
  // settings gets exactly the framing and the loudness the maps were tuned for.
  fov: 60,
  sensitivity: 1,
  volume: 0.85,
  showFps: false,
  // The one every map was tested with. `DEFAULT_CHARACTER_ID` lives in the
  // roster; this is the same id, written out so a save can be read without
  // pulling in the character data.
  character: 'family-road-tripper-247570',
};

const DEFAULT_PROGRESS: Progress = { lastMap: '', maps: {} };

function clamp(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function readSettings(raw: unknown): Settings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const quality: QualityLevel =
    src.quality === 'low' || src.quality === 'medium' || src.quality === 'high'
      ? src.quality
      : 'auto';
  return {
    quality,
    shadows: typeof src.shadows === 'boolean' ? src.shadows : DEFAULT_SETTINGS.shadows,
    fov: clamp(src.fov, 55, 85, DEFAULT_SETTINGS.fov),
    sensitivity: clamp(src.sensitivity, 0.4, 2.5, DEFAULT_SETTINGS.sensitivity),
    volume: clamp(src.volume, 0, 1, DEFAULT_SETTINGS.volume),
    showFps: typeof src.showFps === 'boolean' ? src.showFps : DEFAULT_SETTINGS.showFps,
    character:
      typeof src.character === 'string' && src.character
        ? src.character
        : DEFAULT_SETTINGS.character,
  };
}

function readProgress(raw: unknown): Progress {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<Progress>;
  const maps: Record<string, MapRecord> = {};
  if (src.maps && typeof src.maps === 'object') {
    for (const [id, rec] of Object.entries(src.maps)) {
      if (!rec || typeof rec !== 'object') continue;
      const r = rec as Partial<MapRecord>;
      maps[id] = {
        found: Math.round(clamp(r.found, 0, 5, 0)),
        bestSeconds:
          typeof r.bestSeconds === 'number' && Number.isFinite(r.bestSeconds)
            ? Math.max(0, r.bestSeconds)
            : null,
      };
    }
  }
  return {
    lastMap: typeof src.lastMap === 'string' ? src.lastMap : '',
    maps,
  };
}

export class SaveStore {
  private data: SaveData;
  private available = true;

  constructor() {
    this.data = { settings: { ...DEFAULT_SETTINGS }, progress: { ...DEFAULT_PROGRESS, maps: {} } };
    try {
      const text = window.localStorage.getItem(KEY);
      if (text) {
        const parsed = JSON.parse(text) as Partial<SaveData>;
        this.data = {
          settings: readSettings(parsed.settings),
          progress: readProgress(parsed.progress),
        };
      }
    } catch {
      // Private mode, a full quota, or a value written by a different build.
      // Defaults are a perfectly good game; a crash on boot is not.
      this.available = false;
    }
  }

  public get settings(): Settings {
    return this.data.settings;
  }

  public get progress(): Progress {
    return this.data.progress;
  }

  public get isAvailable(): boolean {
    return this.available;
  }

  /**
   * Merges a patch into the settings.
   *
   * `persist` is false while a slider is being dragged: the effect has to be
   * live, but writing localStorage sixty times a second for a value the player
   * has not settled on yet is both wasteful and a source of jank on the exact
   * frame the player is judging the change by.
   */
  public updateSettings(patch: Partial<Settings>, persist = true): Settings {
    this.data.settings = readSettings({ ...this.data.settings, ...patch });
    if (persist) this.flush();
    return this.data.settings;
  }

  public recordMap(mapId: string, found: number, total: number, seconds: number): void {
    const prev = this.data.progress.maps[mapId];
    const cleared = found >= total && total > 0;
    this.data.progress.maps[mapId] = {
      found: Math.max(prev?.found ?? 0, Math.min(found, total)),
      bestSeconds:
        cleared && (prev?.bestSeconds == null || seconds < prev.bestSeconds)
          ? Math.round(seconds)
          : prev?.bestSeconds ?? null,
    };
    this.data.progress.lastMap = mapId;
    this.flush();
  }

  public rememberMap(mapId: string): void {
    if (this.data.progress.lastMap === mapId) return;
    this.data.progress.lastMap = mapId;
    this.flush();
  }

  public recordFor(mapId: string): MapRecord | undefined {
    return this.data.progress.maps[mapId];
  }

  /**
   * Forgets every map record.
   *
   * Settings are deliberately untouched: "reset progress" is about the hunt,
   * and a player who wants to start over does not also want their quality and
   * sensitivity thrown away.
   */
  public resetProgress(): void {
    this.data.progress = { lastMap: '', maps: {} };
    this.flush();
  }

  private flush(): void {
    if (!this.available) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Quota or private mode: keep playing, just stop promising to remember.
      this.available = false;
    }
  }
}
