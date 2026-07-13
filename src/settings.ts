import type { Location, AppSettings, ForecastSnapshot, WatchlistItem } from "./types";
import { addLog, formatLocationLabel } from "./ui";

export function buildSettingsPreset(
  getForecastHistory: () => ForecastSnapshot[],
  getWatchlist: () => Location[],
  getPreferredLocation: () => Location | null,
  getAppSettings: () => AppSettings,
): Record<string, unknown> {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    preferredLocation: getPreferredLocation(),
    settings: getAppSettings(),
    watchlist: getWatchlist(),
    history: getForecastHistory(),
  };
}

export function exportSettingsPreset(
  getForecastHistory: () => ForecastSnapshot[],
  getWatchlist: () => Location[],
  getPreferredLocation: () => Location | null,
  getAppSettings: () => AppSettings,
  eventLogEl?: HTMLElement | null,
): void {
  try {
    const preset = buildSettingsPreset(getForecastHistory, getWatchlist, getPreferredLocation, getAppSettings);
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `precip-preset-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    addLog("Settings preset exported.", eventLogEl);
  } catch {
    addLog("Settings preset export failed.", eventLogEl);
  }
}

function isLocationLike(value: unknown): value is Location {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).name === "string" &&
    Number.isFinite(Number((value as Record<string, unknown>).latitude)) &&
    Number.isFinite(Number((value as Record<string, unknown>).longitude))
  );
}

export async function importSettingsPreset(
  file: File | undefined,
  eventLogEl?: HTMLElement | null,
  getForecastHistory?: () => ForecastSnapshot[],
  getWatchlist?: () => Location[],
  getPreferredLocation?: () => Location | null,
  getAppSettings?: () => AppSettings,
  saveAppSettings?: (partial: Partial<AppSettings>) => AppSettings,
  savePreferredLocation?: (location: Location) => void,
  removeCookieValue?: (name: string) => void,
  saveForecastHistory?: (history: ForecastSnapshot[]) => void,
  saveWatchlist?: (items: Location[]) => void,
  setActiveHeatmapLayer?: (layer: string, options?: { persist?: boolean }) => void,
  setActiveMapHourOffset?: (offset: number, options?: { persist?: boolean }) => void,
  updateSettingsUI?: () => void,
  formatSavedLocation?: (location: Location | string | null) => string,
  elements?: Record<string, HTMLElement | null>,
): Promise<void> {
  if (!file) return;
  try {
    const raw = await file.text();
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== "object") throw new Error("Preset file is invalid.");

    const settingsPayload = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
    const nextSettings = saveAppSettings?.({
      mapLayer: settingsPayload.mapLayer,
      mapHourOffset: settingsPayload.mapHourOffset,
    });

    if (payload.preferredLocation && isLocationLike(payload.preferredLocation)) {
      savePreferredLocation?.(payload.preferredLocation);
    } else if (payload.preferredLocation === null) {
      removeCookieValue?.("precip.preferredLocation.v1");
    }

    if (Array.isArray(payload.watchlist)) {
      saveWatchlist?.(payload.watchlist.filter(isLocationLike));
    }

    if (Array.isArray(payload.history)) {
      saveForecastHistory?.(payload.history.slice(0, 12));
    }

    if (nextSettings) {
      setActiveHeatmapLayer?.(nextSettings.mapLayer);
      setActiveMapHourOffset?.(nextSettings.mapHourOffset);
    }

    updateSettingsUI?.();

    const preferredLocation = getPreferredLocation?.() ?? null;
    const preferredLocationLabel = preferredLocation ? formatLocationLabel(preferredLocation) : "";
    if (preferredLocation && elements?.locationInput) {
      (elements.locationInput as HTMLInputElement).value = preferredLocationLabel;
    }

    addLog("Settings preset imported.", eventLogEl);
  } catch (error) {
    addLog((error as Error).message || "Settings preset import failed.", eventLogEl);
  }
}
