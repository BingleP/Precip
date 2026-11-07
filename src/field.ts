/**
 * Scalar field layer (Phase 5).
 *
 * Dense, adaptive lat/lon grids from /api/field, rendered as a crisp
 * interpolated colour field (bilinear + per-layer LUT) with isotherms,
 * isobars and wind streamlines. The legacy coarse fog overlay stays as
 * the first-paint fallback while the field is loading.
 */

import type { MapState } from "./types";
import { MAP_TILE_SIZE } from "./config";
import { latLonToWorld, worldToLatLon } from "./geo";
import { buildApiUrl } from "./api";

export interface FieldData {
  layer: string;
  hour: number;
  cols: number;
  rows: number;
  /** Grid-node latitudes, north edge first (length rows). */
  lats: number[];
  /** Grid-node longitudes, west edge first (length cols). */
  lons: number[];
  /** Row-major values, top row first (null where the source has no data). */
  values: (number | null)[];
  /** Wind components in km/h (eastward / northward), when layer === "wind". */
  u?: (number | null)[];
  v?: (number | null)[];
  validTime: string;
  unit: string;
}

export interface FieldRequest {
  /** Server cache key fragment: "layer:hour:bbox:colsXrows". */
  key: string;
  layer: string;
  hour: number;
  /** Snapped grid bounds in degrees (west, south, east, north). */
  bbox: [number, number, number, number];
  cols: number;
  rows: number;
}

const FIELD_CACHE_MAX = 24;
const fieldCache = new Map<string, FieldData>();
const fieldInFlight = new Set<string>();

let redrawHandler: (() => void) | null = null;

export function registerFieldRedrawHandler(handler: () => void): void {
  redrawHandler = handler;
}

/**
 * Adaptive grid spec: finer grids at higher zoom, bounded so one request
 * stays near the proxy chunk size (~100 points per Open-Meteo call).
 */
export function getFieldGridSpec(zoom: number, width: number, height: number): { cols: number; rows: number } {
  const zoomSteps = Math.max(0, Math.min(4, zoom - 6)) * 1.25;
  const cols = Math.round(Math.min(28, Math.max(10, width / 120)) + zoomSteps);
  const rows = Math.round(Math.min(22, Math.max(8, height / 120)) + zoomSteps * 0.75);
  return { cols: Math.min(28, Math.max(4, cols)), rows: Math.min(22, Math.max(4, rows)) };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Work out the snapped grid bounds for the current viewport. Bounds are
 * snapped to half a grid cell so small pans reuse the server cache.
 */
export function buildFieldRequest(
  layer: string,
  hour: number,
  mapState: MapState,
  zoom: number,
  width: number,
  height: number,
): FieldRequest {
  const { cols, rows } = getFieldGridSpec(zoom, width, height);
  const centerWorld = latLonToWorld(mapState.center.latitude, mapState.center.longitude, zoom);
  const padX = width / (cols - 1) / 2;
  const padY = height / (rows - 1) / 2;
  const left = centerWorld.x - width / 2 - padX;
  const right = centerWorld.x + width / 2 + padX;
  const top = centerWorld.y - height / 2 - padY;
  const bottom = centerWorld.y + height / 2 + padY;

  const worldToLatLonLocal = (x: number, y: number) => worldToLatLon(x, y, zoom);
  const snapped = {
    west: Math.floor(left / (padX || 1)) * (padX || 1),
    east: Math.ceil(right / (padX || 1)) * (padX || 1),
    north: Math.floor(top / (padY || 1)) * (padY || 1),
    south: Math.ceil(bottom / (padY || 1)) * (padY || 1),
  };
  const nw = worldToLatLonLocal(snapped.west, snapped.north);
  const se = worldToLatLonLocal(snapped.east, snapped.south);
  const bbox: [number, number, number, number] = [
    round4(Math.max(-180, nw.longitude)),
    round4(Math.max(-85, se.latitude)),
    round4(Math.min(180, se.longitude)),
    round4(Math.min(85, nw.latitude)),
  ];
  const key = `${layer}:${hour}:${bbox.join(",")}:${cols}x${rows}`;
  return { key, layer, hour, bbox, cols, rows };
}

/** Fetch a field grid, serving the client cache when possible. */
export function requestField(request: FieldRequest): FieldData | null {
  const cached = fieldCache.get(request.key);
  if (cached) return cached;
  if (fieldInFlight.has(request.key)) return null;
  fieldInFlight.add(request.key);
  const url = buildApiUrl("/field");
  url.searchParams.set("layer", request.layer);
  url.searchParams.set("hour", String(request.hour));
  url.searchParams.set("bbox", request.bbox.join(","));
  url.searchParams.set("cols", String(request.cols));
  url.searchParams.set("rows", String(request.rows));
  fetch(url, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`field request failed: ${response.status}`);
      return response.json();
    })
    .then((data: Record<string, unknown>) => {
      const field: FieldData = {
        layer: request.layer,
        hour: request.hour,
        cols: request.cols,
        rows: request.rows,
        lats: (data.lats as number[]) || [],
        lons: (data.lons as number[]) || [],
        values: ((data.values as (number | null)[]) || []) as FieldData["values"],
        u: (data.u as (number | null)[]) || undefined,
        v: (data.v as (number | null)[]) || undefined,
        validTime: typeof data.validTime === "string" ? data.validTime : "",
        unit: typeof data.unit === "string" ? data.unit : "",
      };
      if (
        field.lats.length !== request.rows ||
        field.lons.length !== request.cols ||
        field.values.length !== request.cols * request.rows
      ) {
        return; // malformed payload: ignore
      }
      fieldCache.set(request.key, field);
      if (fieldCache.size >= FIELD_CACHE_MAX) {
        const first = fieldCache.keys().next();
        if (!first.done) fieldCache.delete(first.value);
      }
      redrawHandler?.();
    })
    .catch(() => {
      // Transient upstream failure: the fog fallback stays on screen.
    })
    .finally(() => fieldInFlight.delete(request.key));
  return null;
}

/** Return the cached field for this exact request, if present. */
export function getCachedField(request: FieldRequest): FieldData | null {
  return fieldCache.get(request.key) ?? null;
}

/** Drop the client cache (used by the refresh timer, if any). */
export function clearFieldCache(): void {
  fieldCache.clear();
}

// Re-exported so renderers can project grid nodes without importing geo.
export { latLonToWorld, worldToLatLon, MAP_TILE_SIZE };
