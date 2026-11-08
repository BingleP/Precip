import type { HeatmapViewport, HeatmapSample, HeatmapResult } from "./types";
import { HEATMAP_VIEW_PADDING, HEATMAP_MIN_COLUMNS, HEATMAP_MAX_COLUMNS, HEATMAP_MIN_ROWS, HEATMAP_MAX_ROWS, MAP_DEFAULT_ZOOM } from "./config";
import { latLonToWorld, worldToLatLon } from "./geo";
import { buildApiUrl, getCachedHeatmap, setCachedHeatmap } from "./api";

export function getMapViewportSize(
  canvas: HTMLCanvasElement,
): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    width: Math.max(320, Math.round(rect.width || canvas.clientWidth || 920)),
    height: Math.max(260, Math.round(rect.height || canvas.clientHeight || 560)),
  };
}

export function getHeatmapViewportDefinition(
  center: { latitude: number; longitude: number },
  zoom: number,
  canvas: HTMLCanvasElement,
): HeatmapViewport {
  const { width, height } = getMapViewportSize(canvas);
  const centerWorld = latLonToWorld(center.latitude, center.longitude, zoom);
  // Overscan the viewport so pans smaller than the padding reuse the same
  // sample grid instead of firing a fresh upstream request.
  const padding = Math.max(60, Math.min(HEATMAP_VIEW_PADDING, Math.round(Math.min(width, height) * 0.4)));
  const left = centerWorld.x - width / 2 - padding;
  const right = centerWorld.x + width / 2 + padding;
  const top = centerWorld.y - height / 2 - padding;
  const bottom = centerWorld.y + height / 2 + padding;

  return {
    zoom,
    width,
    height,
    padding,
    left,
    right,
    top,
    bottom,
    columns: getHeatmapColumnCount(width, zoom),
    rows: getHeatmapRowCount(height, zoom),
  };
}

function getHeatmapColumnCount(width: number, zoom: number): number {
  const zoomBias = Math.max(0, zoom - MAP_DEFAULT_ZOOM);
  return Math.max(HEATMAP_MIN_COLUMNS, Math.min(HEATMAP_MAX_COLUMNS, Math.round(width / 220) + Math.min(2, zoomBias)));
}

function getHeatmapRowCount(height: number, zoom: number): number {
  const zoomBias = Math.max(0, zoom - MAP_DEFAULT_ZOOM);
  return Math.max(HEATMAP_MIN_ROWS, Math.min(HEATMAP_MAX_ROWS, Math.round(height / 180) + Math.min(1, zoomBias)));
}

export function buildHeatmapPoints(viewport: HeatmapViewport): HeatmapSample[] {
  const points: HeatmapSample[] = [];
  const rowStep = viewport.rows > 1 ? (viewport.bottom - viewport.top) / (viewport.rows - 1) : 0;
  const columnStep = viewport.columns > 1 ? (viewport.right - viewport.left) / (viewport.columns - 1) : 0;

  for (let row = 0; row < viewport.rows; row += 1) {
    for (let column = 0; column < viewport.columns; column += 1) {
      const world = {
        x: viewport.left + column * columnStep,
        y: viewport.top + row * rowStep,
      };
      const projected = worldToLatLon(world.x, world.y, viewport.zoom);
      points.push({
        row,
        column,
        latitude: projected.latitude,
        longitude: projected.longitude,
      });
    }
  }

  return points;
}

/** In-memory viewport-coverage cache, so small pans reuse a fetched grid. */
const HEATMAP_COVER_CACHE_MAX = 8;
const heatmapCoverCache: HeatmapResult[] = [];

function findCoveringHeatmap(viewport: HeatmapViewport): HeatmapResult | null {
  // Compare the *visible* new viewport against the old (padded) bounds.
  const visibleLeft = viewport.left + viewport.padding;
  const visibleRight = viewport.right - viewport.padding;
  const visibleTop = viewport.top + viewport.padding;
  const visibleBottom = viewport.bottom - viewport.padding;
  for (const result of heatmapCoverCache) {
    const meta = result.meta;
    if (meta.zoom !== viewport.zoom) continue;
    if (
      meta.left <= visibleLeft &&
      meta.top <= visibleTop &&
      meta.right >= visibleRight &&
      meta.bottom >= visibleBottom
    ) {
      return result;
    }
  }
  return null;
}

export async function fetchHeatmap(
  center: { latitude: number; longitude: number },
  zoom: number,
  canvas: HTMLCanvasElement,
): Promise<HeatmapResult> {
  const viewport = getHeatmapViewportDefinition(center, zoom, canvas);

  const covering = findCoveringHeatmap(viewport);
  if (covering) return covering;

  const cacheKey = [viewport.zoom, viewport.columns, viewport.rows, center.latitude.toFixed(2), center.longitude.toFixed(2)].join(":");
  const cached = getCachedHeatmap(cacheKey) as HeatmapResult | null;
  if (cached) {
    rememberCovering(cached);
    return cached;
  }

  const points = buildHeatmapPoints(viewport);
  const lats = points.map((p) => p.latitude.toFixed(2)).join(",");
  const lons = points.map((p) => p.longitude.toFixed(2)).join(",");
  if (lats.length > 800 || lons.length > 800) {
    throw new Error("Heatmap grid too large for URL request");
  }
  const url = buildApiUrl("/forecast");
  url.searchParams.set("latitude", lats);
  url.searchParams.set("longitude", lons);
  url.searchParams.set("scope", "heatmap");

  const response = await fetch(url);
  if (!response.ok) throw new Error("Regional heatmap request failed");

  const data = (await response.json()) as Record<string, unknown>[];
  const rows = Array.isArray(data) ? data : [data];
  const result: HeatmapResult = {
    points: points.map((point, index) => ({
      ...point,
      hourly: (rows[index]?.hourly || {}) as HeatmapSample["hourly"],
    })),
    meta: { ...viewport, cacheKey, fetchedAt: Date.now() },
  };

  setCachedHeatmap(cacheKey, result);
  rememberCovering(result);
  return result;
}

function rememberCovering(result: HeatmapResult): void {
  const existing = heatmapCoverCache.findIndex((entry) => entry.meta.cacheKey === result.meta.cacheKey);
  if (existing >= 0) heatmapCoverCache.splice(existing, 1);
  heatmapCoverCache.unshift(result);
  if (heatmapCoverCache.length > HEATMAP_COVER_CACHE_MAX) heatmapCoverCache.length = HEATMAP_COVER_CACHE_MAX;
}
