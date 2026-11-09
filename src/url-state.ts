/**
 * Shareable map state in the address bar.
 *
 * The URL is the canonical description of what the map is showing: active
 * location, zoom, weather layer, overlay raster, forecast hour, and layer
 * opacity. Writes are debounced and use replaceState for continuous changes
 * (pan/zoom/sliders) while a location change pushes a new history entry.
 */

import {
  activeHeatmapLayer,
  activeMapHourOffset,
  activeMapLayerOpacity,
  activeMapOverlayLayer,
  activeLocation,
  mapState,
} from "./state";
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from "./config";
import { getLayer } from "./map-layers";

export interface UrlState {
  latitude: number | null;
  longitude: number | null;
  zoom: number | null;
  layer: string | null;
  /** `undefined` = not in the URL; `null` = overlay explicitly disabled. */
  overlay: string | null | undefined;
  hour: number | null;
  opacity: number | null;
}

const SYNC_DEBOUNCE_MS = 300;
const LOCATION_EPSILON = 1e-4;

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPush = false;
let pushEnabled = false;

function parseNumber(value: string | null): number | null {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const rawLatitude = parseNumber(params.get("lat"));
  const rawLongitude = parseNumber(params.get("lon"));
  const latitude = rawLatitude !== null && rawLatitude >= -85 && rawLatitude <= 85 ? rawLatitude : null;
  const longitude = rawLongitude !== null && rawLongitude >= -180 && rawLongitude <= 180 ? rawLongitude : null;

  const rawZoom = parseNumber(params.get("z"));
  const zoom = rawZoom !== null ? Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, Math.round(rawZoom))) : null;

  const rawLayer = params.get("layer");
  const layer = rawLayer && getLayer(rawLayer) ? rawLayer : null;

  let overlay: string | null | undefined;
  if (params.has("overlay")) {
    const rawOverlay = params.get("overlay");
    overlay = rawOverlay && rawOverlay !== "none" && getLayer(rawOverlay) ? rawOverlay : null;
  }

  const rawHour = parseNumber(params.get("hour"));
  const hour = rawHour !== null ? Math.max(0, Math.min(23, Math.round(rawHour))) : null;

  const rawOpacity = parseNumber(params.get("opacity"));
  const opacity = rawOpacity !== null ? Math.max(0.05, Math.min(1, rawOpacity)) : null;

  return {
    // A location needs both coordinates to be usable.
    latitude: latitude !== null && longitude !== null ? latitude : null,
    longitude: latitude !== null && longitude !== null ? longitude : null,
    zoom,
    layer,
    overlay,
    hour,
    opacity,
  };
}

export function buildUrlQuery(): string {
  const params = new URLSearchParams();
  // A URL describes the selected location, not the current pan offset: a
  // shared link should reopen the same place even if it was panned around.
  const focus = activeLocation ?? mapState.center;
  if (Number.isFinite(focus.latitude) && Number.isFinite(focus.longitude)) {
    params.set("lat", focus.latitude.toFixed(5));
    params.set("lon", focus.longitude.toFixed(5));
  }
  params.set("z", String(Math.round(mapState.zoom)));
  params.set("layer", activeHeatmapLayer);
  params.set("overlay", activeMapOverlayLayer ?? "none");
  params.set("hour", String(activeMapHourOffset));
  params.set("opacity", activeMapLayerOpacity.toFixed(2));
  return params.toString();
}

function writeUrl(push: boolean): void {
  if (!Number.isFinite(mapState.center.latitude) || !Number.isFinite(mapState.center.longitude)) return;
  const query = buildUrlQuery();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (next === current) return;
  if (push && pushEnabled) {
    window.history.pushState({ precip: true }, "", next);
  } else {
    window.history.replaceState(window.history.state, "", next);
  }
}

/**
 * Debounce a URL write. `push` requests a history entry, but the entry is
 * only created once writes are enabled (after the initial deep link/boot
 * state has settled) and only when the URL actually changes.
 */
export function scheduleUrlSync(push = false): void {
  if (push) pendingPush = true;
  if (syncTimer !== null) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const shouldPush = pendingPush;
    pendingPush = false;
    writeUrl(shouldPush);
  }, SYNC_DEBOUNCE_MS);
}

/** Start recording shareable location changes after initial boot. */
export function enableUrlPush(): void {
  pushEnabled = true;
}

export function sameLocation(latitude: number, longitude: number): boolean {
  return (
    !!activeLocation &&
    Math.abs(activeLocation.latitude - latitude) < LOCATION_EPSILON &&
    Math.abs(activeLocation.longitude - longitude) < LOCATION_EPSILON
  );
}
