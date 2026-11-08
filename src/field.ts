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
  /** Geographic bounds covered by this grid: [west, south, east, north]. */
  bbox: [number, number, number, number];
  /** Client receive time (ms) — used for stale-while-revalidate refreshes. */
  fetchedAt: number;
}

export interface FieldRequest {
  /** Server cache key fragment: "layer:hour:bbox:colsXrows". */
  key: string;
  layer: string;
  hour: number;
  /** Padded/snapped bounds requested from the proxy. */
  bbox: [number, number, number, number];
  /** Visible viewport bounds used for cache-coverage checks. */
  viewport: [number, number, number, number];
  /** Request grid dimensions (cover the padded bbox). */
  cols: number;
  rows: number;
  /** Grid dimensions needed to keep visible-area density adequate. */
  visibleCols: number;
  visibleRows: number;
}

const FIELD_CACHE_MAX = 32;
const FIELD_REFRESH_MS = 10 * 60 * 1000;
/**
 * Request extra area around the viewport (per side) so small pans reuse the
 * existing grid instead of triggering a brand-new upstream fetch every time.
 */
const FIELD_COVER_MARGIN = 0.4;
const BBOX_EPSILON = 1e-4;

const fieldCache = new Map<string, FieldData>();
// Open-Meteo's 600-locations/minute budget makes concurrent grids unsafe, so
// only one field fetch runs at a time; newer requests wait for the latest one.
let activeFieldKey: string | null = null;
let queuedFieldRequest: FieldRequest | null = null;
let fieldRetryAfter = 0;

let redrawHandler: (() => void) | null = null;

export function registerFieldRedrawHandler(handler: () => void): void {
  redrawHandler = handler;
}

/**
 * Adaptive grid spec, bounded by upstream cost. Open-Meteo counts one call
 * per grid location against a 600/minute and 5,000/hour limit, so keep the
 * request well under those while still giving the bilinear renderer a useful
 * node spacing on phones through 4K (340–390 points; the proxy rejects
 * grids above 480).
 */
export function getFieldGridSpec(zoom: number, width: number, height: number): { cols: number; rows: number } {
  const aspect = Math.max(0.6, Math.min(3, width / Math.max(1, height)));
  const budget = 340 + Math.min(50, Math.max(0, zoom - 8) * 12);
  let rows = Math.round(Math.sqrt(budget / aspect));
  let cols = Math.round(rows * aspect);
  cols = Math.min(26, Math.max(8, cols));
  rows = Math.min(18, Math.max(6, rows));
  return { cols, rows };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Work out the snapped grid bounds for the current viewport. The request is
 * deliberately larger than the viewport (40% on each side) and snapped to
 * whole cells, so ordinary pans are served from the existing grid.
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
  const left = centerWorld.x - width / 2;
  const right = centerWorld.x + width / 2;
  const top = centerWorld.y - height / 2;
  const bottom = centerWorld.y + height / 2;

  const viewport = boundsToBbox(left, top, right, bottom, zoom);

  // Expand beyond the viewport and snap to whole grid cells. A full-cell snap
  // keeps the bbox stable across sub-cell pans; the extra margin covers pans
  // up to ~40% of a screen without a refetch.
  const marginX = (right - left) * FIELD_COVER_MARGIN;
  const marginY = (bottom - top) * FIELD_COVER_MARGIN;
  const cellX = (right - left) / Math.max(1, cols - 1);
  const cellY = (bottom - top) / Math.max(1, rows - 1);
  const reqLeft = Math.floor((left - marginX) / cellX) * cellX;
  const reqRight = Math.ceil((right + marginX) / cellX) * cellX;
  const reqTop = Math.floor((top - marginY) / cellY) * cellY;
  const reqBottom = Math.ceil((bottom + marginY) / cellY) * cellY;
  const bbox = boundsToBbox(reqLeft, reqTop, reqRight, reqBottom, zoom);

  // Keep the request's location count near the visible budget: the bbox is
  // wider than the viewport, so the smoothed interpolation absorbs the
  // slightly larger node spacing. Scaling the grid with the padding tripled
  // the upstream cost and blew through Open-Meteo's rate limit.
  const reqCols = cols;
  const reqRows = rows;

  const key = `${layer}:${hour}:${bbox.join(",")}:${reqCols}x${reqRows}`;
  return {
    key,
    layer,
    hour,
    bbox,
    viewport,
    cols: reqCols,
    rows: reqRows,
    visibleCols: cols,
    visibleRows: rows,
  };
}

/** World-pixel viewport bounds → clamped [west, south, east, north]. */
function boundsToBbox(
  left: number,
  top: number,
  right: number,
  bottom: number,
  zoom: number,
): [number, number, number, number] {
  const nw = worldToLatLon(left, top, zoom);
  const se = worldToLatLon(right, bottom, zoom);
  return [
    round4(Math.max(-180, nw.longitude)),
    round4(Math.max(-85, se.latitude)),
    round4(Math.min(180, se.longitude)),
    round4(Math.min(85, nw.latitude)),
  ];
}

function bboxContains(outer: [number, number, number, number], inner: [number, number, number, number]): boolean {
  return (
    outer[0] <= inner[0] + BBOX_EPSILON &&
    outer[1] <= inner[1] + BBOX_EPSILON &&
    outer[2] >= inner[2] - BBOX_EPSILON &&
    outer[3] >= inner[3] - BBOX_EPSILON
  );
}

/** Newest cached grid (same layer/hour) whose bounds fully cover the viewport. */
function findCoveringField(request: FieldRequest): FieldData | null {
  let best: FieldData | null = null;
  for (const field of fieldCache.values()) {
    if (field.layer !== request.layer || field.hour !== request.hour) continue;
    if (field.cols < request.visibleCols - 1 || field.rows < request.visibleRows - 1) continue;
    if (!bboxContains(field.bbox, request.viewport)) continue;
    if (!best || field.fetchedAt > best.fetchedAt) best = field;
  }
  return best;
}

/**
 * Fetch a field grid, serving any cached grid that covers the viewport.
 * A stale-but-covering grid is returned immediately while a fresh copy is
 * fetched in the background (stale-while-revalidate).
 */
export function requestField(request: FieldRequest): FieldData | null {
  const cached = getCachedField(request);
  if (cached && Date.now() - cached.fetchedAt < FIELD_REFRESH_MS) return cached;
  if (Date.now() < fieldRetryAfter) return cached;
  if (activeFieldKey === request.key) return cached;
  if (activeFieldKey !== null) {
    // Remember only the newest request; intermediate pan positions are stale.
    queuedFieldRequest = request;
    return cached;
  }
  startFieldFetch(request);
  return cached;
}

function startFieldFetch(request: FieldRequest): void {
  activeFieldKey = request.key;
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
        bbox: request.bbox,
        fetchedAt: Date.now(),
      };
      if (
        field.lats.length !== request.rows ||
        field.lons.length !== request.cols ||
        field.values.length !== request.cols * request.rows
      ) {
        return; // malformed payload: ignore
      }
      fieldRetryAfter = 0;
      fieldCache.set(request.key, field);
      if (fieldCache.size >= FIELD_CACHE_MAX) {
        const first = fieldCache.keys().next();
        if (!first.done) fieldCache.delete(first.value);
      }
      redrawHandler?.();
    })
    .catch(() => {
      // Upstream failure / rate limit: keep any covering grid on screen and
      // pause retries so a stuck viewport cannot hammer Open-Meteo.
      fieldRetryAfter = Date.now() + 15_000;
    })
    .finally(() => {
      activeFieldKey = null;
      const next = queuedFieldRequest;
      queuedFieldRequest = null;
      if (next) requestField(next);
    });
}

/** Return an exact or covering cached field for this request, if present. */
export function getCachedField(request: FieldRequest): FieldData | null {
  return fieldCache.get(request.key) ?? findCoveringField(request);
}

/** Drop the client cache (used by the refresh timer, if any). */
export function clearFieldCache(): void {
  fieldCache.clear();
  fieldRetryAfter = 0;
}

// Re-exported so renderers can project grid nodes without importing geo.
export { latLonToWorld, worldToLatLon, MAP_TILE_SIZE };
