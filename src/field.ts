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
  /** Server cache key fragment: "layer:bbox:colsXrows". */
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

/**
 * One upstream fetch now carries the whole 24-hour timeline. Open-Meteo
 * charges per location, not per hour, so this turns 24 hourly fetches into
 * one without increasing quota usage.
 */
interface FieldGrid {
  layer: string;
  cols: number;
  rows: number;
  lats: number[];
  lons: number[];
  bbox: [number, number, number, number];
  fetchedAt: number;
  unit: string;
  /** ISO UTC hour for each entry in valuesByHour. */
  times: string[];
  /** UTC hour number of times[0], used to index the current timeline hour. */
  baseEpochHour: number;
  valuesByHour: (number | null)[][];
  uByHour?: (number | null)[][];
  vByHour?: (number | null)[][];
}

const FIELD_CACHE_MAX = 12;
const FIELD_REFRESH_MS = 10 * 60 * 1000;
const FIELD_SPAN_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;
/**
 * Request extra area around the viewport (per side) so small pans reuse the
 * existing grid instead of triggering a brand-new upstream fetch every time.
 */
const FIELD_COVER_MARGIN = 0.4;
const BBOX_EPSILON = 1e-4;

const fieldCache = new Map<string, FieldGrid>();
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

  const key = `${layer}:${bbox.join(",")}:${reqCols}x${reqRows}`;
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

/** UTC hour number (ms / 3600000) for indexing forecast hours. */
function currentUtcHour(): number {
  return Math.floor(Date.now() / HOUR_MS);
}

function epochHourFromIso(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? Math.floor(parsed / HOUR_MS) : null;
}

/** Newest cached grid (same layer) whose bounds cover the viewport and hour. */
function findCoveringGrid(request: FieldRequest): FieldGrid | null {
  const targetHour = currentUtcHour() + request.hour;
  let best: FieldGrid | null = null;
  for (const grid of fieldCache.values()) {
    if (grid.layer !== request.layer) continue;
    if (grid.cols < request.visibleCols - 1 || grid.rows < request.visibleRows - 1) continue;
    if (!bboxContains(grid.bbox, request.viewport)) continue;
    const index = targetHour - grid.baseEpochHour;
    if (index < 0 || index >= grid.valuesByHour.length) continue;
    if (!best || grid.fetchedAt > best.fetchedAt) best = grid;
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
  const grid = fieldCache.get(request.key) ?? findCoveringGrid(request);
  if (grid && Date.now() - grid.fetchedAt < FIELD_REFRESH_MS) return cached;
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
  // Always fetch the whole timeline from "now" so the cache covers every
  // slider position regardless of which hour triggered the fetch.
  url.searchParams.set("hour", "0");
  url.searchParams.set("span", String(FIELD_SPAN_HOURS));
  url.searchParams.set("bbox", request.bbox.join(","));
  url.searchParams.set("cols", String(request.cols));
  url.searchParams.set("rows", String(request.rows));
  fetch(url, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) {
        if (response.status === 429) {
          // The proxy forwards Open-Meteo's retry_after; honour it so an
          // exhausted quota does not turn every pan into another 429.
          return response.json().then(
            (body: { retry_after?: unknown }) => {
              const seconds = Number(body?.retry_after);
              const waitMs = Number.isFinite(seconds) && seconds > 0
                ? Math.min(10 * 60_000, Math.max(15_000, seconds * 1000))
                : 60_000;
              fieldRetryAfter = Date.now() + waitMs;
              throw new Error("field rate limited");
            },
            () => {
              fieldRetryAfter = Date.now() + 60_000;
              throw new Error("field request failed: 429");
            },
          );
        }
        throw new Error(`field request failed: ${response.status}`);
      }
      return response.json();
    })
    .then((data: Record<string, unknown>) => {
      const lats = (data.lats as number[]) || [];
      const lons = (data.lons as number[]) || [];
      const valuesByHour = Array.isArray(data.valuesByHour)
        ? (data.valuesByHour as (number | null)[][])
        : [((data.values as (number | null)[]) || [])];
      const uByHour = Array.isArray(data.uByHour)
        ? (data.uByHour as (number | null)[][])
        : data.u
          ? [data.u as (number | null)[]]
          : undefined;
      const vByHour = Array.isArray(data.vByHour)
        ? (data.vByHour as (number | null)[][])
        : data.v
          ? [data.v as (number | null)[]]
          : undefined;
      const times = Array.isArray(data.times) ? (data.times as string[]) : [];
      const pointCount = request.cols * request.rows;
      const valuesValid = valuesByHour.length > 0 && valuesByHour.every(
        (hour) => Array.isArray(hour) && hour.length === pointCount,
      );
      const windValid =
        !uByHour || (uByHour.length === valuesByHour.length && uByHour.every((hour) => Array.isArray(hour) && hour.length === pointCount));
      const malformed =
        lats.length !== request.rows ||
        lons.length !== request.cols ||
        !valuesValid ||
        !windValid;
      if (malformed) return; // malformed payload: ignore

      const grid: FieldGrid = {
        layer: request.layer,
        cols: request.cols,
        rows: request.rows,
        lats,
        lons,
        bbox: request.bbox,
        fetchedAt: Date.now(),
        unit: typeof data.unit === "string" ? data.unit : "",
        times,
        baseEpochHour: epochHourFromIso(times[0]) ?? currentUtcHour(),
        valuesByHour,
        uByHour,
        vByHour,
      };
      fieldRetryAfter = 0;
      fieldCache.set(request.key, grid);
      if (fieldCache.size >= FIELD_CACHE_MAX) {
        const first = fieldCache.keys().next();
        if (!first.done) fieldCache.delete(first.value);
      }
      redrawHandler?.();
    })
    .catch(() => {
      // Upstream failure / rate limit: keep any covering grid on screen and
      // pause retries so a stuck viewport cannot hammer Open-Meteo.
      fieldRetryAfter = Math.max(fieldRetryAfter, Date.now() + 15_000);
    })
    .finally(() => {
      activeFieldKey = null;
      const next = queuedFieldRequest;
      queuedFieldRequest = null;
      if (next) requestField(next);
    });
}

/** Materialise the requested hour from an exact or covering cached grid. */
export function getCachedField(request: FieldRequest): FieldData | null {
  const grid = fieldCache.get(request.key) ?? findCoveringGrid(request);
  if (!grid) return null;
  const index = currentUtcHour() + request.hour - grid.baseEpochHour;
  if (index < 0 || index >= grid.valuesByHour.length) return null;
  return {
    layer: grid.layer,
    hour: request.hour,
    cols: grid.cols,
    rows: grid.rows,
    lats: grid.lats,
    lons: grid.lons,
    values: grid.valuesByHour[index],
    u: grid.uByHour?.[index],
    v: grid.vByHour?.[index],
    validTime: grid.times[index] || "",
    unit: grid.unit,
    bbox: grid.bbox,
    fetchedAt: grid.fetchedAt,
  };
}

/** Drop the client cache (used by the refresh timer, if any). */
export function clearFieldCache(): void {
  fieldCache.clear();
  fieldRetryAfter = 0;
}

// Re-exported so renderers can project grid nodes without importing geo.
export { latLonToWorld, worldToLatLon, MAP_TILE_SIZE };
