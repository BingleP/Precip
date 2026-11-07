import type { Location, AppSettings, ForecastSnapshot } from "./types";
import { SETTINGS_KEY, PREFERRED_LOCATION_KEY, WATCHLIST_KEY, HISTORY_KEY, MAX_HISTORY_ITEMS, DEFAULT_APP_SETTINGS } from "./config";
import { withNormalizedCountryCode } from "./location";
import { isLayerId, getLayer, DEFAULT_LAYER_ID } from "./map-layers";

export function getCookieValue(name: string): string | null {
  const row = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`));
  return row ? row.slice(name.length + 1) : null;
}

export function setCookieValue(name: string, value: string, maxAge = 31536000): void {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax`;
}

export function removeCookieValue(name: string): void {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

export function readCookieJSON<T>(name: string): T | null {
  const value = getCookieValue(name);
  if (!value) return null;
  try {
    return JSON.parse(decodeURIComponent(value)) as T;
  } catch {
    return null;
  }
}

export function writeCookieJSON<T>(name: string, value: T): boolean {
  try {
    setCookieValue(name, encodeURIComponent(JSON.stringify(value)));
    return true;
  } catch {
    return false;
  }
}

export function readStorageJSON<T>(name: string): T | null {
  try {
    const value = window.localStorage.getItem(name);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

export function writeStorageJSON<T>(name: string, value: T): boolean {
  try {
    window.localStorage.setItem(name, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function normalizeMapLayer(value: string | undefined): string {
  return isLayerId(value) ? (value as string) : DEFAULT_LAYER_ID;
}

export function normalizeMapOverlayLayer(value: string | null | undefined): string | null {
  const layer = getLayer(value);
  return layer && layer.kind === "raster" ? layer.id : null;
}

export function normalizeMapLayerOpacity(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_APP_SETTINGS.mapLayerOpacity;
  return Math.max(0.1, Math.min(1, Math.round((value as number) * 100) / 100));
}

export function normalizeMapHourOffset(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_APP_SETTINGS.mapHourOffset;
  return Math.max(0, Math.min(23, Math.round(value)));
}

/**
 * Cookie → app value for the hazard max-age filters. 0 means the user
 * chose "All" (null); anything else absent/junk resolves to the default.
 */
function normalizeStoredMaxAge(value: unknown, fallback: number | null): number | null {
  if (typeof value === "number" && value > 0) return value;
  if (value === 0) return null;
  return fallback;
}

export function getAppSettings(): AppSettings {
  const parsed = readCookieJSON<Partial<AppSettings>>(SETTINGS_KEY);
  return {
    mapLayer: normalizeMapLayer(parsed?.mapLayer),
    mapOverlayLayer: normalizeMapOverlayLayer(parsed?.mapOverlayLayer),
    mapLayerOpacity: normalizeMapLayerOpacity(parsed?.mapLayerOpacity),
    mapHourOffset: normalizeMapHourOffset(parsed?.mapHourOffset ?? DEFAULT_APP_SETTINGS.mapHourOffset),
    useImperial: parsed?.useImperial === true,
    showAlerts: parsed?.showAlerts !== false,
    showWildfires: parsed?.showWildfires !== false,
    // One-week default for both hazard age filters (recent-only by
    // default, per user request). In the cookie, 0 encodes an explicit
    // "All" choice; anything absent/junk (including a legacy null from
    // before the setting existed) falls back to the default.
    earthquakeMaxAgeHours: normalizeStoredMaxAge(parsed?.earthquakeMaxAgeHours, DEFAULT_APP_SETTINGS.earthquakeMaxAgeHours),
    wildfireMaxAgeHours: normalizeStoredMaxAge(parsed?.wildfireMaxAgeHours, DEFAULT_APP_SETTINGS.wildfireMaxAgeHours),
  };
}

export function saveAppSettings(partial: Partial<AppSettings>): AppSettings {
  const next = {
    ...getAppSettings(),
    ...partial,
  };
  next.mapLayer = normalizeMapLayer(next.mapLayer) as AppSettings["mapLayer"];
  next.mapOverlayLayer = normalizeMapOverlayLayer(next.mapOverlayLayer);
  next.mapLayerOpacity = normalizeMapLayerOpacity(next.mapLayerOpacity);
  next.mapHourOffset = normalizeMapHourOffset(next.mapHourOffset);
  next.earthquakeMaxAgeHours = typeof next.earthquakeMaxAgeHours === "number" && next.earthquakeMaxAgeHours > 0
    ? next.earthquakeMaxAgeHours : null;
  next.wildfireMaxAgeHours = typeof next.wildfireMaxAgeHours === "number" && next.wildfireMaxAgeHours > 0
    ? next.wildfireMaxAgeHours : null;
  // An explicit "All" (null) is written as 0 so it survives the default
  // applied on read; absence stays absent until the user touches it.
  writeCookieJSON(SETTINGS_KEY, {
    ...next,
    earthquakeMaxAgeHours: next.earthquakeMaxAgeHours ?? 0,
    wildfireMaxAgeHours: next.wildfireMaxAgeHours ?? 0,
  });
  return next;
}

export function getPreferredLocation(): Location | null {
  const location = readCookieJSON<Location>(PREFERRED_LOCATION_KEY);
  if (!location) return null;
  const healed = withNormalizedCountryCode(location);
  if (healed !== location) writeCookieJSON(PREFERRED_LOCATION_KEY, healed);
  return healed;
}

export function savePreferredLocation(location: Location): void {
  writeCookieJSON(PREFERRED_LOCATION_KEY, withNormalizedCountryCode(location));
}

export function formatSavedLocation(location: Location | string | null): string {
  if (!location) return "Not set";
  if (typeof location === "string") return location;
  return [location.name, location.admin, location.country].filter(Boolean).join(", ");
}

export function getWatchlist(): Location[] {
  const parsed = readStorageJSON<Location[]>(WATCHLIST_KEY);
  if (!Array.isArray(parsed)) return [];
  let healedAny = false;
  const items = parsed.map((location) => {
    const healed = withNormalizedCountryCode(location);
    if (healed !== location) healedAny = true;
    return healed;
  });
  if (healedAny) writeStorageJSON(WATCHLIST_KEY, items);
  return items;
}

export function saveWatchlist(items: Location[]): void {
  const next = items.slice(0, 8).map(withNormalizedCountryCode);
  writeStorageJSON(WATCHLIST_KEY, next);
}

export function getForecastHistory(): ForecastSnapshot[] {
  const parsed = readStorageJSON<ForecastSnapshot[]>(HISTORY_KEY);
  return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY_ITEMS) : [];
}

export function saveForecastHistory(history: ForecastSnapshot[]): void {
  writeStorageJSON(HISTORY_KEY, history.slice(0, MAX_HISTORY_ITEMS));
}

export function getCachedApiResponse<T>(
  namespace: string,
  cacheKey: string,
  ttlMs: number,
  options: { allowStale?: boolean } = {},
): { data: T; age: number; stale: boolean } | null {
  const entry = readStorageJSON<{ savedAt: number; data: T }>(`${namespace}:${cacheKey}`);
  if (!entry?.savedAt || !entry?.data) return null;
  const age = Date.now() - entry.savedAt;
  if (!options.allowStale && age > ttlMs) return null;
  return { data: entry.data, age, stale: age > ttlMs };
}

export function setCachedApiResponse<T>(namespace: string, cacheKey: string, data: T): void {
  writeStorageJSON(`${namespace}:${cacheKey}`, {
    savedAt: Date.now(),
    data,
  });
}
