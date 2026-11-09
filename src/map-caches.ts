/**
 * Map bitmap caches, kept out of the renderer so cache budgets and eviction
 * policy live in one place. The maps themselves are module-level singletons
 * on purpose: tiles are shared across every render and cleared on teardown.
 */

// 256 tiles at 256x256 RGBA is roughly 67 MB of decoded bitmap memory.
export const TILE_CACHE_MAX = 256;

export const tileCache = new Map<string, HTMLImageElement>();

export function tileCacheSet(key: string, image: HTMLImageElement): void {
  if (tileCache.size >= TILE_CACHE_MAX) {
    const toDelete = Math.round(TILE_CACHE_MAX * 0.25);
    const keys = [...tileCache.keys()];
    for (let i = 0; i < toDelete && i < keys.length; i++) {
      tileCache.delete(keys[i]);
    }
  }
  tileCache.set(key, image);
}

/** Evict ~25% of the oldest-inserted entries (Map order is insertion order). */
function evictQuarter(cache: Map<unknown, unknown>, max: number): void {
  if (cache.size < max) return;
  const toDelete = Math.round(max * 0.25);
  const keys = [...cache.keys()];
  for (let i = 0; i < toDelete && i < keys.length; i++) {
    cache.delete(keys[i]);
  }
}

export function filteredTileCacheSet(key: string, canvas: HTMLCanvasElement): void {
  evictQuarter(filteredTileCache, FILTERED_TILE_CACHE_MAX);
  filteredTileCache.set(key, canvas);
}

export function filteredTileCacheGet(key: string): HTMLCanvasElement | undefined {
  return filteredTileCache.get(key);
}

// Each filtered tile is an offscreen 256x256 canvas (about 262 KB decoded);
// 128 entries keeps this under ~34 MB.
export const FILTERED_TILE_CACHE_MAX = 128;
export const TILE_FILTER = "brightness(0.48) saturate(0.6) contrast(1.25)";

const filteredTileCache = new Map<string, HTMLCanvasElement>();

export const labelPositionCache = new Map<string, { x: number; y: number }>();

export function clearMapCaches(): void {
  tileCache.clear();
  filteredTileCache.clear();
  labelPositionCache.clear();
}
