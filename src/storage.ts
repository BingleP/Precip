import type { Location, AppSettings, ForecastSnapshot } from "./types";
import { SETTINGS_KEY, PREFERRED_LOCATION_KEY, WATCHLIST_KEY, HISTORY_KEY, MAX_HISTORY_ITEMS, DEFAULT_APP_SETTINGS } from "./config";

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
  const validLayers = [
    "temperature", "feels", "dewpoint", "humidity",
    "precipitation", "precipProbability", "wind", "gusts",
    "pressure", "cloud", "visibility", "cape",
  ];
  return value && validLayers.includes(value) ? value : DEFAULT_APP_SETTINGS.mapLayer;
}

export function normalizeMapHourOffset(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_APP_SETTINGS.mapHourOffset;
  return Math.max(0, Math.min(23, Math.round(value)));
}

export function getAppSettings(): AppSettings {
  const parsed = readCookieJSON<Partial<AppSettings>>(SETTINGS_KEY);
  return {
    mapLayer: normalizeMapLayer(parsed?.mapLayer),
    mapHourOffset: normalizeMapHourOffset(parsed?.mapHourOffset ?? DEFAULT_APP_SETTINGS.mapHourOffset),
    useImperial: parsed?.useImperial === true,
  };
}

export function saveAppSettings(partial: Partial<AppSettings>): AppSettings {
  const next = {
    ...getAppSettings(),
    ...partial,
  };
  next.mapLayer = normalizeMapLayer(next.mapLayer) as AppSettings["mapLayer"];
  next.mapHourOffset = normalizeMapHourOffset(next.mapHourOffset);
  writeCookieJSON(SETTINGS_KEY, next);
  return next;
}

export function getPreferredLocation(): Location | null {
  return readCookieJSON<Location>(PREFERRED_LOCATION_KEY);
}

export function savePreferredLocation(location: Location): void {
  writeCookieJSON(PREFERRED_LOCATION_KEY, location);
}

export function formatSavedLocation(location: Location | string | null): string {
  if (!location) return "Not set";
  if (typeof location === "string") return location;
  return [location.name, location.admin, location.country].filter(Boolean).join(", ");
}

export function getWatchlist(): Location[] {
  const parsed = readStorageJSON<Location[]>(WATCHLIST_KEY);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveWatchlist(items: Location[]): void {
  const next = items.slice(0, 8);
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
