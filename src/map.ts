import type { HeatmapSample, MapState } from "./types";
import { MAP_TILE_SIZE, MAP_MIN_ZOOM, MAP_MAX_ZOOM, MAP_DEFAULT_ZOOM, HEATMAP_SCALE, INITIAL_MAP_CENTER } from "./config";
import { latLonToWorld, worldToLatLon, projectToMapScreen, projectToMapScreenFast, screenToMapLocation, setMapCenterFromWorld, clampMapZoom } from "./geo";
import { normalizeValue, formatHeatmapValue, getHeatmapTitle } from "./weather";
import { isInsideAlertPolygonSpatial, getWildfireAtPoint, getEarthquakes, showEarthquakes } from "./alerts";
import { getEarthquakeAtPoint } from "./earthquakes";
import { escapeHTML } from "./ui";
import { getLayer, type MapLayer } from "./map-layers";
import { drawRadarLayer, formatRadarRelativeTime, type RadarStatus } from "./radar";
import { drawCloudLayer, type CloudStatus } from "./cloud";
import { drawForecastRasterLayer, type ForecastRasterStatus } from "./forecast-raster";
import type { FieldData } from "./field";

const TILE_CACHE_MAX = 500;

export const tileCache = new Map<string, HTMLImageElement>();

function tileCacheSet(key: string, image: HTMLImageElement): void {
  if (tileCache.size >= TILE_CACHE_MAX) {
    const toDelete = Math.round(TILE_CACHE_MAX * 0.25);
    const keys = [...tileCache.keys()];
    for (let i = 0; i < toDelete && i < keys.length; i++) {
      tileCache.delete(keys[i]);
    }
  }
  tileCache.set(key, image);
}

// Heatmap memoization state
let lastHeatmapSamplesKey = "";
let lastHeatmapLayer = "";
let cachedHeatmapSamples: (HeatmapSample & { value: number; normalized: number; x: number; y: number })[] | null = null;
let cachedInterpolationGrid: Float32Array | null = null;
let cachedGridWidth = 0;
let cachedGridHeight = 0;
let lastGridCacheKey = "";
const INTERPOLATION_GRID_STEP = 4; // Sample every 4th pixel for grid

// Tile filter pre-compositing cache
const filteredTileCache = new Map<string, HTMLCanvasElement>();
const FILTERED_TILE_CACHE_MAX = 320;
const TILE_FILTER = "brightness(0.48) saturate(0.6) contrast(1.25)";

// Label position memoization cache
const labelPositionCache = new Map<string, { x: number; y: number }>();

export function getMapState(center = INITIAL_MAP_CENTER): MapState {
  return {
    center: { latitude: center.latitude, longitude: center.longitude },
    zoom: MAP_DEFAULT_ZOOM,
    drag: null,
    selected: null,
    renderQueued: false,
  };
}

export function zoomMap(
  delta: number,
  mapState: MapState,
  onRender: () => void,
  onScheduleRefresh: () => void,
): void {
  const nextZoom = clampMapZoom(mapState.zoom + delta, MAP_MIN_ZOOM, MAP_MAX_ZOOM);
  if (nextZoom === mapState.zoom) return;
  mapState.zoom = nextZoom;
  onRender();
  onScheduleRefresh();
}

export function queueMapRender(mapState: MapState, renderFn: () => void): void {
  if (mapState.renderQueued) return;
  mapState.renderQueued = true;
  requestAnimationFrame(() => {
    mapState.renderQueued = false;
    renderFn();
  });
}

export function drawMapTiles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  center: { latitude: number; longitude: number },
  zoom: number,
  onTileLoad: () => void,
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#080c14";
  ctx.fillRect(0, 0, width, height);

  const centerWorld = latLonToWorld(center.latitude, center.longitude, zoom);
  const topLeft = {
    x: centerWorld.x - width / 2,
    y: centerWorld.y - height / 2,
  };
  const firstTileX = Math.floor(topLeft.x / MAP_TILE_SIZE);
  const firstTileY = Math.floor(topLeft.y / MAP_TILE_SIZE);
  const lastTileX = Math.floor((topLeft.x + width) / MAP_TILE_SIZE);
  const lastTileY = Math.floor((topLeft.y + height) / MAP_TILE_SIZE);
  const tileCount = 2 ** zoom;

  for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
    for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
      if (tileY < 0 || tileY >= tileCount) continue;

      const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;
      const image = getMapTile(zoom, wrappedTileX, tileY, onTileLoad);
      const x = Math.round(tileX * MAP_TILE_SIZE - topLeft.x);
      const y = Math.round(tileY * MAP_TILE_SIZE - topLeft.y);

      if (image.complete && image.naturalWidth) {
        // Use pre-filtered tile from cache
        const filteredTile = getFilteredTile(image, zoom, wrappedTileX, tileY);
        ctx.drawImage(filteredTile, x, y, MAP_TILE_SIZE, MAP_TILE_SIZE);
      } else {
        ctx.fillStyle = (tileX + tileY) % 2 ? "#0c111c" : "#0e141f";
        ctx.fillRect(x, y, MAP_TILE_SIZE, MAP_TILE_SIZE);
      }
    }
  }

  ctx.fillStyle = "rgba(5, 7, 12, 0.24)";
  ctx.fillRect(0, 0, width, height);
}

function getFilteredTile(
  image: HTMLImageElement,
  zoom: number,
  x: number,
  y: number
): HTMLCanvasElement {
  const key = `${zoom}/${x}/${y}`;
  let filtered = filteredTileCache.get(key);
  if (!filtered) {
    filtered = document.createElement("canvas");
    filtered.width = MAP_TILE_SIZE;
    filtered.height = MAP_TILE_SIZE;
    const fctx = filtered.getContext("2d")!;
    fctx.filter = TILE_FILTER;
    fctx.drawImage(image, 0, 0, MAP_TILE_SIZE, MAP_TILE_SIZE);
    if (filteredTileCache.size >= FILTERED_TILE_CACHE_MAX) {
      const removeCount = Math.round(FILTERED_TILE_CACHE_MAX * 0.25);
      const keys = [...filteredTileCache.keys()];
      for (let i = 0; i < removeCount && i < keys.length; i++) {
        filteredTileCache.delete(keys[i]);
      }
    }
    filteredTileCache.set(key, filtered);
  }
  return filtered;
}

let tileLoadTimer: ReturnType<typeof setTimeout> | null = null;

let offscreenCanvas: HTMLCanvasElement | null = null;
let offscreenCtx: CanvasRenderingContext2D | null = null;
let heatmapImageData: ImageData | null = null;
let lastOverlayWidth = 0;
let lastOverlayHeight = 0;

export function getMapTile(
  zoom: number,
  x: number,
  y: number,
  onTileLoad: () => void,
): HTMLImageElement {
  const key = `${zoom}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key)!;

  const image = new Image();
  image.decoding = "async";
  image.crossOrigin = "anonymous";
  image.src = `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
  image.addEventListener(
    "load",
    () => {
      if (tileLoadTimer) clearTimeout(tileLoadTimer);
      tileLoadTimer = setTimeout(() => {
        tileLoadTimer = null;
        onTileLoad();
      }, 200);
    },
    { once: true },
  );
  image.addEventListener("error", () => tileCache.delete(key), { once: true });
  tileCacheSet(key, image);
  return image;
}

export function drawMapOverlayText(ctx: CanvasRenderingContext2D, _width: number, text: string): void {
  ctx.fillStyle = "#f3f5f8";
  ctx.font = "900 15px system-ui";
  ctx.fillText(text, 34, 28);
}

export function drawMapPlaces(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  activeLocation: { latitude: number; longitude: number; name?: string; admin?: string; country?: string } | null,
  mapState: MapState,
  centerWorld?: { x: number; y: number },
): void {
  const location = activeLocation || mapState.selected;
  if (!location) return;
  const selected = mapState.selected || location;
  const zoomRound = Math.round(mapState.zoom);
  const cw = centerWorld || latLonToWorld(mapState.center.latitude, mapState.center.longitude, zoomRound);

  // Memoize label position by viewport (including map center)
  const cacheKey = `${selected.latitude.toFixed(4)}:${selected.longitude.toFixed(4)}:${zoomRound}:${width}:${height}:${cw.x.toFixed(2)}:${cw.y.toFixed(2)}`;
  let position = labelPositionCache.get(cacheKey);
  if (!position) {
    position = projectToMapScreenFast(selected.latitude, selected.longitude, width, height, cw, zoomRound);
    if (position.x >= -80 && position.x <= width + 80 && position.y >= -80 && position.y <= height + 80) {
      labelPositionCache.set(cacheKey, position);
    }
  }
  if (!position || position.x < -80 || position.x > width + 80 || position.y < -80 || position.y > height + 80) return;

  ctx.fillStyle = "#090a10";
  ctx.strokeStyle = "#f3f5f8";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(position.x, position.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.font = "900 12px system-ui";
  const label = [selected.name, selected.admin, selected.country].filter(Boolean).join(", ");
  const labelWidth = ctx.measureText(label).width;
  const labelX = Math.max(8, Math.min(width - labelWidth - 14, position.x + 10));
  const labelY = Math.max(18, Math.min(height - 14, position.y + 4));
  ctx.fillStyle = "rgba(9, 11, 18, 0.78)";
  ctx.fillRect(labelX - 4, labelY - 12, labelWidth + 8, 17);
  ctx.fill();
  ctx.fillStyle = "#f3f5f8";
  ctx.fillText(label, labelX, labelY);
}

export function drawHeatmapOverlay(
  ctx: CanvasRenderingContext2D,
  points: HeatmapSample[],
  values: (number | undefined)[],
  layer: string,
  min: number,
  max: number,
  width: number,
  height: number,
  mapState: MapState,
  center: { latitude: number; longitude: number },
  zoom: number,
  alpha = 0.52,
): void {
  const alphaByte = Math.round(Math.max(0.1, Math.min(1, alpha)) * 255);
  const centerKey = `${center.latitude.toFixed(2)},${center.longitude.toFixed(2)}`;
  const samplesKey = `${centerKey}:${zoom}:${width}:${height}:${layer}:${min.toFixed(1)}:${max.toFixed(1)}`;
  let samples: (HeatmapSample & { value: number; normalized: number; x: number; y: number })[];

  // Check if we can use cached samples
  if (samplesKey === lastHeatmapSamplesKey && cachedHeatmapSamples) {
    samples = cachedHeatmapSamples;
  } else {
    mapState.samples = [];
    samples = points
      .map((point, index) => {
        const value = values[index];
        if (!Number.isFinite(value)) return null;
        const position = projectToMapScreen(point.latitude, point.longitude, width, height, center.latitude, center.longitude, zoom);
        const sample: HeatmapSample & { value: number; normalized: number; x: number; y: number } = {
          ...point,
          value: value!,
          normalized: normalizeValue(value!, min, max),
          x: position.x,
          y: position.y,
        };

        if (position.x > -30 && position.x < width + 30 && position.y > -30 && position.y < height + 30) {
          (mapState.samples as HeatmapSample[]).push(sample);
        }

        return sample;
      })
      .filter(Boolean) as (HeatmapSample & { value: number; normalized: number; x: number; y: number })[];

    cachedHeatmapSamples = samples;
    lastHeatmapSamplesKey = samplesKey;
    lastHeatmapLayer = layer;
    // Invalidate interpolation grid when samples change
    cachedInterpolationGrid = null;
  }

  if (!samples.length) return;

  const smoothing = Math.max(width, height) / 18;
  const overlayWidth = Math.max(72, Math.round(width * HEATMAP_SCALE));
  const overlayHeight = Math.max(44, Math.round(height * HEATMAP_SCALE));

  if (!offscreenCanvas || !offscreenCtx) {
    offscreenCanvas = document.createElement("canvas");
    offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true })!;
  }
  if (overlayWidth !== lastOverlayWidth || overlayHeight !== lastOverlayHeight) {
    offscreenCanvas.width = overlayWidth;
    offscreenCanvas.height = overlayHeight;
    heatmapImageData = null;
    lastOverlayWidth = overlayWidth;
    lastOverlayHeight = overlayHeight;
  }
  if (!heatmapImageData) {
    heatmapImageData = offscreenCtx.createImageData(overlayWidth, overlayHeight);
  }
  const data = heatmapImageData.data;

  // Check if we can reuse cached interpolation grid
  const gridWidth = Math.ceil(overlayWidth / INTERPOLATION_GRID_STEP);
  const gridHeight = Math.ceil(overlayHeight / INTERPOLATION_GRID_STEP);
  const gridCacheKey = `${overlayWidth}:${overlayHeight}:${smoothing.toFixed(2)}:${layer}:${lastHeatmapLayer}`;

  let useCachedGrid = false;
  if (
    cachedInterpolationGrid &&
    gridWidth === cachedGridWidth &&
    gridHeight === cachedGridHeight &&
    gridCacheKey === lastGridCacheKey
  ) {
    useCachedGrid = true;
  }

  if (useCachedGrid) {
    // Use cached interpolation grid
    for (let y = 0; y < overlayHeight; y += 1) {
      for (let x = 0; x < overlayWidth; x += 1) {
        const gx = Math.floor(x / INTERPOLATION_GRID_STEP);
        const gy = Math.floor(y / INTERPOLATION_GRID_STEP);
        const normalized = cachedInterpolationGrid![gy * gridWidth + gx];
        const color = getHeatmapChannels(normalized, layer);
        const offset = (y * overlayWidth + x) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
        data[offset + 3] = alphaByte;
      }
    }
  } else {
    // Compute new interpolation grid
    const grid = new Float32Array(gridWidth * gridHeight);
    for (let gy = 0; gy < gridHeight; gy += 1) {
      for (let gx = 0; gx < gridWidth; gx += 1) {
        const screenX = (gx * INTERPOLATION_GRID_STEP / overlayWidth) * width;
        const screenY = (gy * INTERPOLATION_GRID_STEP / overlayHeight) * height;
        grid[gy * gridWidth + gx] = interpolateHeatmapAt(screenX, screenY, samples, smoothing);
      }
    }
    cachedInterpolationGrid = grid;
    cachedGridWidth = gridWidth;
    cachedGridHeight = gridHeight;
    lastGridCacheKey = gridCacheKey;

    // Render from new grid
    for (let y = 0; y < overlayHeight; y += 1) {
      for (let x = 0; x < overlayWidth; x += 1) {
        const gx = Math.floor(x / INTERPOLATION_GRID_STEP);
        const gy = Math.floor(y / INTERPOLATION_GRID_STEP);
        const normalized = grid[gy * gridWidth + gx];
        const color = getHeatmapChannels(normalized, layer);
        const offset = (y * overlayWidth + x) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
        data[offset + 3] = alphaByte;
      }
    }
  }

  offscreenCtx.putImageData(heatmapImageData, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.filter = "blur(6px)";
  ctx.drawImage(offscreenCanvas, -10, -10, width + 20, height + 20);
  ctx.restore();

  ctx.fillStyle = "rgba(5, 7, 12, 0.04)";
  ctx.fillRect(0, 0, width, height);
}

function interpolateHeatmapAt(
  x: number,
  y: number,
  samples: { x: number; y: number; normalized: number }[],
  smoothing: number,
): number {
  let weightedValue = 0;
  let weightTotal = 0;

  samples.forEach((sample) => {
    const sampleValue = sample.normalized;
    if (!Number.isFinite(sampleValue)) return;
    const distanceSquared = (sample.x - x) ** 2 + (sample.y - y) ** 2;
    const weight = 1 / (distanceSquared + smoothing ** 2);
    weightedValue += sampleValue * weight;
    weightTotal += weight;
  });

  return weightTotal ? weightedValue / weightTotal : 0;
}

export function getHeatmapChannels(value: number, layer: string): [number, number, number] {
  if (layer === "precipitation" || layer === "precipProbability" || layer === "humidity" || layer === "cloud") {
    return interpolateColor(
      [
        [129, 197, 171],
        [114, 174, 230],
        [181, 171, 141],
        [207, 109, 114],
      ],
      value,
    );
  }

  if (layer === "wind" || layer === "gusts" || layer === "cape") {
    return interpolateColor(
      [
        [114, 174, 230],
        [129, 197, 171],
        [216, 160, 106],
        [207, 109, 114],
      ],
      value,
    );
  }

  return interpolateColor(
    [
      [114, 174, 230],
      [129, 197, 171],
      [216, 160, 106],
      [207, 109, 114],
    ],
    value,
  );
}

export function getHeatmapColor(value: number, layer: string, alpha = 1): string {
  const [r, g, b] = getHeatmapChannels(value, layer);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function interpolateColor(colors: [number, number, number][], value: number): [number, number, number] {
  const scaled = value * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const start = colors[index];
  const end = colors[index + 1];
  return [
    Math.round(start[0] + (end[0] - start[0]) * mix),
    Math.round(start[1] + (end[1] - start[1]) * mix),
    Math.round(start[2] + (end[2] - start[2]) * mix),
  ];
}

// ---------------------------------------------------------------------------
// Phase 5 scalar field rendering: bilinear interpolation + per-layer LUT,
// marching-squares isotherms/isobars, wind streamlines.
// ---------------------------------------------------------------------------

type LUTStops = ReadonlyArray<readonly [number, number, number, number]>; // [pos, r, g, b]
type LUT = Uint8ClampedArray; // 256 * 3

interface FieldLUTSpec {
  stops: LUTStops;
  /** Data value that normalizes to 0 / 1. */
  low: number;
  high: number;
  /** Alpha scales with the normalized value (precip, cloud). */
  alphaByValue?: boolean;
}

const TEMPERATURE_STOPS: LUTStops = [
  [0, 90, 60, 170], [0.2, 90, 130, 230], [0.35, 80, 190, 220],
  [0.5, 90, 200, 130], [0.65, 240, 210, 80], [0.8, 240, 140, 50],
  [1, 210, 50, 50],
];
const WIND_STOPS: LUTStops = [
  [0, 40, 150, 160], [0.35, 80, 190, 150], [0.55, 160, 200, 100],
  [0.75, 240, 160, 60], [1, 210, 60, 60],
];

const FIELD_LUTS: Record<string, FieldLUTSpec> = {
  temperature: { stops: TEMPERATURE_STOPS, low: -15, high: 35 },
  feels: { stops: TEMPERATURE_STOPS, low: -15, high: 35 },
  dewpoint: { stops: TEMPERATURE_STOPS, low: -15, high: 30 },
  humidity: {
    stops: [[0, 235, 225, 200], [0.4, 150, 190, 220], [0.7, 80, 140, 220], [1, 50, 90, 200]],
    low: 0, high: 100,
  },
  precipitation: {
    stops: [
      [0, 20, 20, 160], [0.15, 0, 0, 230], [0.3, 60, 160, 230],
      [0.45, 60, 230, 230], [0.6, 120, 230, 110], [0.75, 240, 230, 50],
      [0.87, 240, 110, 30], [1, 160, 10, 10],
    ],
    low: 0, high: 12, alphaByValue: true,
  },
  precipProbability: {
    stops: [[0, 220, 225, 210], [0.4, 140, 190, 200], [0.7, 90, 160, 150], [1, 200, 80, 80]],
    low: 0, high: 100,
  },
  wind: { stops: WIND_STOPS, low: 0, high: 90 },
  gusts: { stops: WIND_STOPS, low: 0, high: 110 },
  pressure: { stops: TEMPERATURE_STOPS, low: 978, high: 1042 },
  cloud: {
    stops: [[0, 110, 115, 125], [0.5, 165, 172, 182], [1, 235, 240, 245]],
    low: 0, high: 100, alphaByValue: true,
  },
  visibility: {
    stops: [[0, 200, 60, 60], [0.3, 240, 140, 60], [0.6, 200, 200, 110], [1, 90, 210, 130]],
    low: 0, high: 25000,
  },
  cape: {
    stops: [[0, 190, 195, 200], [0.4, 120, 200, 140], [0.65, 230, 210, 90], [0.85, 230, 130, 60], [1, 200, 80, 160]],
    low: 0, high: 2500,
  },
};

const fieldLUTCache = new Map<string, LUT>();

function getFieldLUT(layer: string): LUT {
  const cached = fieldLUTCache.get(layer);
  if (cached) return cached;
  const spec = FIELD_LUTS[layer] ?? { stops: TEMPERATURE_STOPS, low: 0, high: 1 };
  const lut = new Uint8ClampedArray(256 * 3);
  const stops = spec.stops;
  for (let i = 0; i < 256; i++) {
    const pos = i / 255;
    let seg = 0;
    while (seg < stops.length - 2 && pos > stops[seg + 1][0]) seg++;
    const a = stops[seg];
    const b = stops[seg + 1];
    const mix = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (pos - a[0]) / (b[0] - a[0])));
    lut[i * 3] = Math.round(a[1] + (b[1] - a[1]) * mix);
    lut[i * 3 + 1] = Math.round(a[2] + (b[2] - a[2]) * mix);
    lut[i * 3 + 2] = Math.round(a[3] + (b[3] - a[3]) * mix);
  }
  fieldLUTCache.set(layer, lut);
  return lut;
}

/** Bilinear sample of a row-major field array at fractional grid coords. */
function sampleBilinear(
  array: (number | null)[],
  cols: number,
  rows: number,
  fx: number,
  fy: number,
): number | null {
  if (fx < 0 || fy < 0 || fx > cols - 1 || fy > rows - 1) return null;
  const x0 = Math.min(cols - 2, Math.floor(fx));
  const y0 = Math.min(rows - 2, Math.floor(fy));
  const v00 = array[y0 * cols + x0];
  const v10 = array[y0 * cols + x0 + 1];
  const v01 = array[(y0 + 1) * cols + x0];
  const v11 = array[(y0 + 1) * cols + x0 + 1];
  if (v00 == null || v10 == null || v01 == null || v11 == null) return null;
  const tx = fx - x0;
  const ty = fy - y0;
  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
}

let fieldCanvas: HTMLCanvasElement | null = null;
let fieldCtx: CanvasRenderingContext2D | null = null;

/**
 * Draw the crisp Phase 5 field: per-pixel bilinear + LUT into an offscreen
 * buffer, upscaled with smoothing, then isotherms/isobars (temperature,
 * pressure) or wind streamlines (wind) on top.
 */
export function drawFieldOverlay(
  ctx: CanvasRenderingContext2D,
  field: FieldData,
  width: number,
  height: number,
  mapState: MapState,
  zoom: number,
  opacity: number,
): void {
  const { cols, rows, values, lats, lons } = field;
  if (cols < 2 || rows < 2 || lats.length !== rows || lons.length !== cols) return;
  if (!fieldCanvas || !fieldCtx) {
    fieldCanvas = document.createElement("canvas");
    fieldCtx = fieldCanvas.getContext("2d")!;
  }
  const scaleFactor = 0.75;
  const renderW = Math.max(64, Math.round(width * scaleFactor));
  const renderH = Math.max(64, Math.round(height * scaleFactor));
  if (fieldCanvas.width !== renderW || fieldCanvas.height !== renderH) {
    fieldCanvas.width = renderW;
    fieldCanvas.height = renderH;
  }

  const spec = FIELD_LUTS[field.layer] ?? { stops: TEMPERATURE_STOPS, low: 0, high: 1 };
  const lut = getFieldLUT(field.layer);
  const span = Math.max(1e-9, spec.high - spec.low);
  const baseAlpha = Math.max(0.1, Math.min(1, opacity)) * 255;

  const imageData = fieldCtx.createImageData(renderW, renderH);
  const data = imageData.data;

  // Grid nodes sit at the bbox edges; pixel x is linear in lon, and row
  // latitude is evaluated per scanline (Mercator rows are not linear).
  const centerWorld = latLonToWorld(
    mapState.center.latitude, mapState.center.longitude, zoom,
  );
  const geoToGridX = (lon: number) => ((lon - lons[0]) / (lons[cols - 1] - lons[0])) * (cols - 1);
  const geoToGridY = (lat: number) => ((lats[0] - lat) / (lats[0] - lats[rows - 1])) * (rows - 1);
  const topLeftX = centerWorld.x - width / 2;
  const topLeftY = centerWorld.y - height / 2;
  // Screen x is linear in longitude and scanline latitude depends only on
  // screen y (Web Mercator), so per-pixel work is one multiply + bilinear.
  const worldSize = MAP_TILE_SIZE * 2 ** zoom;
  const lonOfX = (x: number) => ((topLeftX + x / scaleFactor) / worldSize) * 360 - 180;
  const lonStep = (1 / scaleFactor / worldSize) * 360;
  fieldCtx.canvas.width = renderW; // no-op, sized above
  for (let y = 0; y < renderH; y += 1) {
    const worldY = topLeftY + (y + 0.5) / scaleFactor;
    const lat = worldToLatLon(centerWorld.x, worldY, zoom).latitude;
    const fy = Math.max(0, Math.min(rows - 1.0001, geoToGridY(lat)));
    const row0 = Math.floor(fy);
    const ty = fy - row0;
    let lon = lonOfX(0);
    for (let x = 0; x < renderW; x += 1) {
      const fx = geoToGridX(lon);
      const value = sampleBilinear(values, cols, rows, fx, row0 + ty);
      const offset = (y * renderW + x) * 4;
      if (value == null) {
        data[offset + 3] = 0;
        lon += lonStep;
        continue;
      }
      const normalized = Math.max(0, Math.min(1, (value - spec.low) / span));
      const lutIndex = Math.round(normalized * 255) * 3;
      data[offset] = lut[lutIndex];
      data[offset + 1] = lut[lutIndex + 1];
      data[offset + 2] = lut[lutIndex + 2];
      data[offset + 3] = Math.round(baseAlpha * (spec.alphaByValue ? Math.sqrt(normalized) : 1));
      lon += lonStep;
    }
  }
  fieldCtx.putImageData(imageData, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fieldCanvas, 0, 0, width, height);
  ctx.restore();

  // Grid-node screen positions (for contours / streamlines).
  const nodeCenterWorld = latLonToWorld(
    mapState.center.latitude, mapState.center.longitude, zoom,
  );
  const nodeX = new Float32Array(cols * rows);
  const nodeY = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const p = projectToMapScreenFast(lats[r], lons[c], width, height, nodeCenterWorld, zoom);
      nodeX[r * cols + c] = p.x;
      nodeY[r * cols + c] = p.y;
    }
  }

  if (field.layer === "temperature" || field.layer === "pressure") {
    drawFieldContours(ctx, field, nodeX, nodeY);
  }
  if (field.layer === "wind" && field.u && field.v) {
    drawFieldStreamlines(ctx, field, nodeX, nodeY);
  }
}

/** Marching-squares isotherms (2 °C) / isobars (4 hPa) on the grid. */
function drawFieldContours(
  ctx: CanvasRenderingContext2D,
  field: FieldData,
  nodeX: Float32Array,
  nodeY: Float32Array,
): void {
  const { cols, rows, values } = field;
  const step = field.layer === "pressure" ? 4 : 2;
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value == null) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return;
  ctx.save();
  ctx.strokeStyle = field.layer === "pressure" ? "rgba(15, 25, 45, 0.4)" : "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 1;
  for (let level = Math.ceil(min / step) * step; level <= max; level += step) {
    ctx.beginPath();
    for (let r = 0; r < rows - 1; r += 1) {
      for (let c = 0; c < cols - 1; c += 1) {
        const vA = values[r * cols + c];
        const vB = values[r * cols + c + 1];
        const vC = values[(r + 1) * cols + c + 1];
        const vD = values[(r + 1) * cols + c];
        if (vA == null || vB == null || vC == null || vD == null) continue;
        let code = 0;
        if (vA >= level) code |= 1;
        if (vB >= level) code |= 2;
        if (vC >= level) code |= 4;
        if (vD >= level) code |= 8;
        if (code === 0 || code === 15) continue;
        const xA = nodeX[r * cols + c], yA = nodeY[r * cols + c];
        const xB = nodeX[r * cols + c + 1], yB = nodeY[r * cols + c + 1];
        const xC = nodeX[(r + 1) * cols + c + 1], yC = nodeY[(r + 1) * cols + c + 1];
        const xD = nodeX[(r + 1) * cols + c], yD = nodeY[(r + 1) * cols + c];
        // Edge crossing points (top AB, right BC, bottom CD, left DA).
        const edge = (v0: number, v1: number, x0: number, y0: number, x1: number, y1: number): [number, number] => {
          const t = (level - v0) / ((v1 - v0) || 1e-9);
          return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
        };
        const pts = {
          T: edge(vA, vB, xA, yA, xB, yB),
          R: edge(vB, vC, xB, yB, xC, yC),
          B: edge(vC, vD, xC, yC, xD, yD),
          L: edge(vD, vA, xD, yD, xA, yA),
        };
        const SEGMENTS: Record<number, [keyof typeof pts, keyof typeof pts][]> = {
          1: [["L", "T"]], 2: [["T", "R"]], 3: [["L", "R"]], 4: [["R", "B"]],
          5: [["L", "T"], ["R", "B"]], 6: [["T", "B"]], 7: [["L", "B"]],
          8: [["L", "B"]], 9: [["T", "B"]], 10: [["L", "T"], ["R", "B"]],
          11: [["R", "B"]], 12: [["L", "R"]], 13: [["T", "R"]], 14: [["L", "T"]],
        };
        for (const [p, q] of SEGMENTS[code] ?? []) {
          ctx.moveTo(pts[p][0], pts[p][1]);
          ctx.lineTo(pts[q][0], pts[q][1]);
        }
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** RK2 wind streamlines seeded on the grid, alpha-faded tails. */
function drawFieldStreamlines(
  ctx: CanvasRenderingContext2D,
  field: FieldData,
  nodeX: Float32Array,
  nodeY: Float32Array,
): void {
  const { cols, rows, u, v } = field;
  if (!u || !v) return;
  const sample = (fx: number, fy: number, arr: (number | null)[]) =>
    sampleBilinear(arr, cols, rows, fx, fy);
  const toScreen = (fx: number, fy: number): [number, number] => {
    const c = Math.max(0, Math.min(cols - 1.0001, fx));
    const r = Math.max(0, Math.min(rows - 1.0001, fy));
    const r0 = Math.floor(r);
    const c0 = Math.floor(c);
    const tx = c - c0;
    const ty = r - r0;
    const i = r0 * cols + c0;
    const x = nodeX[i] + (nodeX[i + 1] - nodeX[i]) * tx + (nodeX[i + cols] - nodeX[i]) * ty;
    const y = nodeY[i] + (nodeY[i + 1] - nodeY[i]) * tx + (nodeY[i + cols] - nodeY[i]) * ty;
    return [x, y];
  };
  const step = 0.35; // grid cells per integration step
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
  ctx.lineWidth = 1.2;
  ctx.lineCap = "round";
  for (let r = 1; r < rows - 1; r += 2) {
    for (let c = 1; c < cols - 1; c += 2) {
      let fx = c + ((r * 7 + c * 13) % 3 - 1) * 0.3;
      let fy = r + ((r * 5 + c * 11) % 3 - 1) * 0.3;
      let u0 = sample(fx, fy, u);
      let v0 = sample(fx, fy, v);
      if (u0 == null || v0 == null) continue;
      const speed = Math.hypot(u0, v0);
      if (speed < 2) continue; // dead calm: no line
      ctx.beginPath();
      // Trace backwards and forwards so lines pass through the seed.
      for (const dir of [-1, 1]) {
        fx = c + ((r * 7 + c * 13) % 3 - 1) * 0.3;
        fy = r + ((r * 5 + c * 11) % 3 - 1) * 0.3;
        let uu: number | null = u0;
        let vv: number | null = v0;
        const start = toScreen(fx, fy);
        ctx.moveTo(start[0], start[1]);
        for (let i = 0; i < 46; i += 1) {
          if (uu == null || vv == null) break;
          const len = Math.hypot(uu, vv) || 1;
          const ux = (uu / len) * step * dir;
          const uy = (vv / len) * step * dir;
          // RK2 midpoint step.
          const mx = fx + ux / 2;
          const my = fy + uy / 2;
          const mu = sample(mx, my, u);
          const mv = sample(mx, my, v);
          if (mu == null || mv == null) break;
          const mlen = Math.hypot(mu, mv) || 1;
          fx += (mu / mlen) * step * dir;
          fy += (mv / mlen) * step * dir;
          if (fx < 0.5 || fy < 0.5 || fx > cols - 1.5 || fy > rows - 1.5) break;
          const p = toScreen(fx, fy);
          ctx.lineTo(p[0], p[1]);
          uu = sample(fx, fy, u);
          vv = sample(fx, fy, v);
        }
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function updateMapTooltip(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  mapState: MapState,
  activeHeatmapLayer: string,
  activeMapHourOffset: number,
  elements: {
    mapTooltip: HTMLElement | null;
    mapHoverIndicator: HTMLElement | null;
  },
): void {
  if (!mapState.samples?.length || mapState.drag) return;

  const rect = canvas.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const location = screenToMapLocation(
    pointerX,
    pointerY,
    rect.width,
    rect.height,
    mapState.center.latitude,
    mapState.center.longitude,
    Math.round(mapState.zoom),
  );
  const samples = mapState.samples as (HeatmapSample & { x: number; y: number; value: number })[];
  const smoothing = Math.max(rect.width, rect.height) / 18;

  let weightedValue = 0,
    weightTotal = 0,
    weightedTemp = 0,
    weightedPrecip = 0,
    weightedWind = 0;

  samples.forEach((sample) => {
    const sv = sample.value;
    if (!Number.isFinite(sv)) return;
    const dx = sample.x - pointerX,
      dy = sample.y - pointerY;
    const weight = 1 / (dx * dx + dy * dy + smoothing * smoothing);
    weightedValue += sv * weight;
    weightTotal += weight;
    const t = sample.hourly?.temperature_2m?.[activeMapHourOffset];
    if (t != null && Number.isFinite(t)) weightedTemp += t * weight;
    const p = sample.hourly?.precipitation?.[activeMapHourOffset];
    if (p != null && Number.isFinite(p)) weightedPrecip += p * weight;
    const w = sample.hourly?.wind_speed_10m?.[activeMapHourOffset];
    if (w != null && Number.isFinite(w)) weightedWind += w * weight;
  });

  let layerValue: number | null = null,
    temperature: number | null = null,
    precipitation: number | null = null,
    wind: number | null = null;

  if (weightTotal) {
    layerValue = weightedValue / weightTotal;
    temperature = weightedTemp / weightTotal;
    precipitation = weightedPrecip / weightTotal;
    wind = weightedWind / weightTotal;
  }

  const alertPoly = isInsideAlertPolygonSpatial(pointerX, pointerY);
  const wildfire = getWildfireAtPoint(pointerX, pointerY);

  const primaryLayerForTooltip = getLayer(activeHeatmapLayer);
  const rasterPrimaryTooltip = primaryLayerForTooltip?.kind === "raster";
  let tooltipHTML =
    (rasterPrimaryTooltip
      ? `<strong>${escapeHTML(primaryLayerForTooltip!.label)} · ${primaryLayerForTooltip!.timeMode}</strong>`
      : `<strong>${formatHeatmapValue(layerValue ?? undefined, activeHeatmapLayer)}</strong>`) +
    `<span>${location.latitude.toFixed(3)}, ${location.longitude.toFixed(3)}</span>` +
    `<span>Temp: ${formatHeatmapValue(temperature ?? undefined, "temperature")}</span>` +
    `<span>Rain: ${formatHeatmapValue(precipitation ?? undefined, "precipitation")}</span>` +
    `<span>Wind: ${formatHeatmapValue(wind ?? undefined, "wind")}</span>`;

  if (alertPoly) {
    tooltipHTML += `<div class="tooltip-alert ${alertPoly.severity.toLowerCase()}"><strong>⚠ ${escapeHTML(alertPoly.event)}</strong><small>${escapeHTML((alertPoly.headline || alertPoly.description || "").slice(0, 180))}</small></div>`;
  }

  if (wildfire) {
    const wp = wildfire.properties;
    let detail = "";
    if (wp.featureType === "hotspot") {
      detail += `<strong>🔥 ${wp.source} Hotspot</strong>`;
      if (wp.date) detail += `<span>${new Date(wp.date).toLocaleString()}</span>`;
      if (wp.sensor || wp.satellite) detail += `<span>${wp.satellite || ""}${wp.sensor ? " — " + wp.sensor : ""}</span>`;
      if (wp.confidence) detail += `<span>Confidence: ${wp.confidence}</span>`;
      if (wp.temperature != null) detail += `<span>Brightness: ${wp.temperature.toFixed(0)}K</span>`;
    } else {
      detail += `<strong>🔥 ${wp.source} Fire Perimeter</strong>`;
      if (wp.firstDate && wp.lastDate) {
        detail += `<span>${new Date(wp.firstDate).toLocaleDateString()} – ${new Date(wp.lastDate).toLocaleDateString()}</span>`;
      }
      if (wp.hotspotCount != null) detail += `<span>Hotspots: ${wp.hotspotCount}</span>`;
      if (wp.areaHa != null) detail += `<span>Area: ${wp.areaHa.toLocaleString()} ha</span>`;
    }
    tooltipHTML += `<div class="tooltip-wildfire">${detail}</div>`;
  }

  if (showEarthquakes) {
    const eq = getEarthquakeAtPoint(
      pointerX, pointerY,
      getEarthquakes(),
      rect.width, rect.height,
      latLonToWorld(mapState.center.latitude, mapState.center.longitude, Math.round(mapState.zoom)),
      Math.round(mapState.zoom),
    );
    if (eq) {
      const time = eq.time ? new Date(Number(eq.time) || eq.time).toLocaleString() : "Unknown";
      tooltipHTML += `<div class="tooltip-earthquake"><strong>🌍 M${eq.magnitude.toFixed(1)}</strong><small>${eq.source} · ${eq.place}</small><span>Depth: ${eq.depth.toFixed(1)} km · ${time}</span>${eq.tsunami ? '<span class="tsunami-warning">⚠ Tsunami warning active</span>' : ""}</div>`;
    }
  }

  // Touch devices have no hover, so a tap opens the tooltip and this button is
  // the explicit way to move the selected location there. Hidden on hover
  // devices, where clicking the map still selects the location directly.
  tooltipHTML += `<button class="map-tooltip-action" type="button" data-lat="${location.latitude.toFixed(5)}" data-lon="${location.longitude.toFixed(5)}">Use this location</button>`;

  if (elements.mapTooltip) {
    elements.mapTooltip.innerHTML = tooltipHTML;
    elements.mapTooltip.classList.add("visible");

    const tooltipWidth = elements.mapTooltip.offsetWidth;
    const tooltipHeight = elements.mapTooltip.offsetHeight;
    const left = Math.min(rect.width - tooltipWidth - 10, pointerX + 14);
    const top = Math.max(10, Math.min(rect.height - tooltipHeight - 10, pointerY - tooltipHeight - 10));
    elements.mapTooltip.style.left = `${Math.max(10, left)}px`;
    elements.mapTooltip.style.top = `${top}px`;
    elements.mapTooltip.style.bottom = "auto";
  }

  if (elements.mapHoverIndicator) {
    elements.mapHoverIndicator.classList.add("visible");
    elements.mapHoverIndicator.style.left = `${pointerX}px`;
    elements.mapHoverIndicator.style.top = `${pointerY}px`;
  }
}

export function hideMapTooltip(elements: {
  mapTooltip: HTMLElement | null;
  mapHoverIndicator: HTMLElement | null;
}): void {
  if (elements.mapTooltip) elements.mapTooltip.classList.remove("visible");
  if (elements.mapHoverIndicator) elements.mapHoverIndicator.classList.remove("visible");
}

export function renderMapReadout(
  layer: string,
  min: number,
  max: number,
  meta: { columns?: number; rows?: number; zoom?: number } | null,
  el: HTMLElement | null,
): void {
  if (!el) return;
  const coverage = meta
    ? `${meta.columns}x${meta.rows} samples · zoom ${meta.zoom}`
    : "Viewport coverage pending";
  el.innerHTML = `
    <span>${escapeHTML(getHeatmapTitle(layer))}</span>
    <strong>${formatHeatmapValue(min, layer)} - ${formatHeatmapValue(max, layer)}</strong>
    <small>${coverage}</small>
  `;
}

/**
 * Draw a raster weather layer (radar, satellite cloud, forecast cloud/precip)
 * between the basemap tiles and the scalar field.
 */
export function drawRasterWeatherLayer(
  ctx: CanvasRenderingContext2D,
  layer: MapLayer,
  width: number,
  height: number,
  mapState: MapState,
  zoom: number,
  opacity: number,
  hourOffset = 0,
): void {
  if (layer.id === "satCloud" && layer.kind === "raster") {
    drawCloudLayer(ctx, width, height, mapState, zoom, opacity);
    return;
  }
  if ((layer.id === "fcastCloud" || layer.id === "fcastPrecip") && layer.kind === "raster") {
    drawForecastRasterLayer(ctx, layer.id, width, height, mapState, zoom, opacity, hourOffset);
    return;
  }
  drawRadarLayer(ctx, width, height, mapState, zoom, opacity);
}

/** dBZ legend for the radar layer (RainViewer "continental" colour ramp). */
export function renderRadarLegend(
  status: Pick<RadarStatus, "providerLabel" | "attribution" | "attributionUrl" | "frameTime" | "frames"> | null,
  el: HTMLElement | null,
): void {
  if (!el) return;
  if (!status) {
    el.innerHTML = `<div class="heatmap-legend-head"><strong>Weather radar</strong><span class="legend-badge legend-badge-observed">Observed</span></div><small>Loading radar…</small>`;
    return;
  }
  const ago = formatRadarRelativeTime(status.frameTime);
  el.innerHTML = `
    <div class="heatmap-legend-head"><strong>Weather radar</strong><span class="legend-badge legend-badge-observed">Observed</span></div>
    <div class="heatmap-gradient radar-gradient"></div>
    <div class="heatmap-legend-range"><span>Light</span><span>Heavy</span><span>Intense</span></div>
    <small>${escapeHTML(status.providerLabel)} · dBZ</small>
    <small>${ago} · past 2 h</small>
    <small><a class="legend-attribution" href="${escapeHTML(status.attributionUrl)}" target="_blank" rel="noreferrer">${escapeHTML(status.attribution)}</a></small>
  `;
}

export function renderRadarReadout(
  status: Pick<RadarStatus, "providerLabel" | "frameTime" | "frames"> | null,
  el: HTMLElement | null,
): void {
  if (!el) return;
  if (!status) {
    el.innerHTML = `<span>Weather radar</span><strong>Loading…</strong><small>Fetching latest frames</small>`;
    return;
  }
  el.innerHTML = `
    <span>Weather radar</span>
    <strong>Observed · ${escapeHTML(status.providerLabel)}</strong>
    <small>${formatRadarRelativeTime(status.frameTime)} · ${status.frames.length} frames</small>
  `;
}

/** Legend for the satellite cloud layer (IR veil is a luminance ramp). */
export function renderCloudLegend(
  status: Pick<CloudStatus, "providerLabel" | "attribution" | "attributionUrl"> | null,
  el: HTMLElement | null,
): void {
  if (!el) return;
  if (!status) {
    el.innerHTML = `<div class="heatmap-legend-head"><strong>Satellite cloud</strong><span class="legend-badge legend-badge-observed">Observed</span></div><small>Loading imagery…</small>`;
    return;
  }
  el.innerHTML = `
    <div class="heatmap-legend-head"><strong>Satellite cloud</strong><span class="legend-badge legend-badge-observed">Observed</span></div>
    <div class="heatmap-gradient cloud-gradient"></div>
    <div class="heatmap-legend-range"><span>Low</span><span>Mid</span><span>Deep</span></div>
    <small>${escapeHTML(status.providerLabel)} · infrared</small>
    <small>Latest imagery · 10 min cadence</small>
    <small><a class="legend-attribution" href="${escapeHTML(status.attributionUrl)}" target="_blank" rel="noreferrer">${escapeHTML(status.attribution)}</a></small>
  `;
}

export function renderCloudReadout(
  status: Pick<CloudStatus, "providerLabel"> | null,
  el: HTMLElement | null,
): void {
  if (!el) return;
  if (!status) {
    el.innerHTML = `<span>Satellite cloud</span><strong>Loading…</strong><small>Fetching latest imagery</small>`;
    return;
  }
  el.innerHTML = `
    <span>Satellite cloud</span>
    <strong>Observed · ${escapeHTML(status.providerLabel)}</strong>
    <small>Latest imagery · 10 min cadence</small>
  `;
}

/** Format a WMS valid time for display (e.g. "2026-11-07 18:00 UTC"). */
function formatValidTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/** Legend for the forecast raster layers (GeoMet cloud / precip rasters). */
export function renderForecastRasterLegend(
  layerId: string,
  status: Pick<ForecastRasterStatus, "providerLabel" | "attribution" | "attributionUrl" | "validTime" | "hourOffset"> | null,
  el: HTMLElement | null,
): void {
  if (!el) return;
  const isPrecip = layerId === "fcastPrecip";
  const title = isPrecip ? "Forecast precip rate" : "Forecast cloud cover";
  const gradientClass = isPrecip ? "forecast-precip-gradient" : "forecast-cloud-gradient";
  if (!status) {
    el.innerHTML = `<div class="heatmap-legend-head"><strong>${title}</strong><span class="legend-badge legend-badge-forecast">Forecast</span></div><small>Loading forecast imagery…</small>`;
    return;
  }
  const range = isPrecip
    ? `<span>0.01</span><span>1.0</span><span>5</span><span>20+</span>`
    : `<span>10%</span><span>50%</span><span>100%</span>`;
  el.innerHTML = `
    <div class="heatmap-legend-head"><strong>${title}</strong><span class="legend-badge legend-badge-forecast">Forecast</span></div>
    <div class="heatmap-gradient ${gradientClass}"></div>
    <div class="heatmap-legend-range">${range}</div>
    <small>${escapeHTML(status.providerLabel)} · ${isPrecip ? "mm/h" : "total cloud cover"}</small>
    <small>Valid ${formatValidTime(status.validTime)} (${status.hourOffset ? `+${status.hourOffset}h` : "now"})</small>
    <small><a class="legend-attribution" href="${escapeHTML(status.attributionUrl)}" target="_blank" rel="noreferrer">${escapeHTML(status.attribution)}</a></small>
  `;
}

export function renderForecastRasterReadout(
  layerId: string,
  status: Pick<ForecastRasterStatus, "providerLabel" | "validTime" | "hourOffset"> | null,
  el: HTMLElement | null,
): void {
  if (!el) return;
  const title = layerId === "fcastPrecip" ? "Forecast precip rate" : "Forecast cloud cover";
  if (!status) {
    el.innerHTML = `<span>${title}</span><strong>Loading…</strong><small>Fetching forecast imagery</small>`;
    return;
  }
  el.innerHTML = `
    <span>${title}</span>
    <strong>Forecast · ${escapeHTML(status.providerLabel)}</strong>
    <small>Valid ${formatValidTime(status.validTime)} (${status.hourOffset ? `+${status.hourOffset}h` : "now"})</small>
  `;
}

/**
 * Render the weather-layer legend card: layer name, Observed/Forecast badge,
 * gradient with min/max + unit, source, and attribution when a layer defines it.
 */
export function renderLayerLegend(
  layerId: string,
  min: number | null,
  max: number | null,
  el: HTMLElement | null,
  options?: { validTimeLabel?: string; hasData?: boolean },
): void {
  if (!el) return;
  const layer = getLayer(layerId);
  if (!layer) {
    renderHeatmapLegend(layerId, min ?? 0, max ?? 0, el);
    return;
  }

  const badge = layer.timeMode === "observed" ? "Observed" : "Forecast";
  const range = min != null && max != null && Number.isFinite(min) && Number.isFinite(max)
    ? `<span>${formatHeatmapValue(min, layer.id)}</span><span>${formatHeatmapValue(max, layer.id)}</span>`
    : `<span>--</span><span>--</span>`;
  const timeLabel = options?.validTimeLabel ? `<small>${escapeHTML(options.validTimeLabel)}</small>` : "";
  const source = `<small>${escapeHTML(layer.source)} · ${escapeHTML(layer.unit)}</small>`;
  const attribution = layer.attribution ? `<small class="legend-attribution">${escapeHTML(layer.attribution)}</small>` : "";

  el.innerHTML = `
    <div class="heatmap-legend-head"><strong>${escapeHTML(layer.label)}</strong><span class="legend-badge legend-badge-${layer.timeMode}">${badge}</span></div>
    <div class="heatmap-gradient ${layer.id}"></div>
    <div class="heatmap-legend-range">${range}</div>
    ${source}
    ${timeLabel}
    ${attribution}
  `;
}

export function renderHeatmapLegend(
  layer: string,
  min: number,
  max: number,
  el: HTMLElement | null,
): void {
  if (!el) return;
  el.innerHTML = `
    <span>${formatHeatmapValue(min, layer)}</span>
    <div class="heatmap-gradient ${layer}"></div>
    <span>${formatHeatmapValue(max, layer)}</span>
  `;
}

export function updateMapHourLabel(
  offset: number,
  heatmapData: HeatmapSample[] | null,
  el: HTMLElement | null,
): void {
  if (!el) return;
  if (!offset) {
    el.textContent = "Now";
    return;
  }
  const time = heatmapData?.[0]?.hourly?.time?.[offset];
  el.textContent = time
    ? new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : `+${offset}h`;
}

export function startMapDrag(
  event: PointerEvent,
  mapState: MapState,
  activePointers: Map<number, { x: number; y: number }>,
  canvas: HTMLCanvasElement,
  onDragStart: () => void,
  pinchState?: { startDist: number; startZoom: number },
): void {
  if (event.button !== 0) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (activePointers.size >= 2) {
    if (mapState.drag) {
      canvas.classList.remove("dragging");
      mapState.drag = null;
    }
    if (pinchState) {
      const pts = [...activePointers.values()];
      pinchState.startDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchState.startZoom = Math.round(mapState.zoom);
    }
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const zoom = Math.round(mapState.zoom);
  mapState.drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    canvasX: event.clientX - rect.left,
    canvasY: event.clientY - rect.top,
    width: rect.width,
    height: rect.height,
    centerWorld: latLonToWorld(mapState.center.latitude, mapState.center.longitude, zoom),
    zoom,
    moved: false,
  };
  canvas.classList.add("dragging");
  canvas.setPointerCapture(event.pointerId);
  onDragStart();
}

export function moveMapDrag(
  event: PointerEvent,
  mapState: MapState,
  activePointers: Map<number, { x: number; y: number }>,
  pinchState: { startDist: number; startZoom: number },
  onZoomChange: () => void,
  onRender: () => void,
  onScheduleRefresh: () => void,
  onTooltipUpdate: (event: PointerEvent) => void,
): void {
  if (activePointers.has(event.pointerId)) {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  if (activePointers.size >= 2 && pinchState.startDist > 0) {
    const pts = [...activePointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const targetZoom = clampMapZoom(Math.round(pinchState.startZoom + Math.log2(dist / pinchState.startDist)), MAP_MIN_ZOOM, MAP_MAX_ZOOM);
    if (targetZoom !== mapState.zoom) {
      mapState.zoom = targetZoom;
      queueMapRender(mapState, onZoomChange);
      onScheduleRefresh();
    }
    return;
  }

  if (!mapState.drag || mapState.drag.pointerId !== event.pointerId) {
    onTooltipUpdate(event);
    return;
  }

  const dx = event.clientX - mapState.drag.startX;
  const dy = event.clientY - mapState.drag.startY;
  if (Math.hypot(dx, dy) > 5) {
    mapState.drag.moved = true;
  }

  mapState.center = setMapCenterFromWorld(
    { x: mapState.drag.centerWorld.x - dx, y: mapState.drag.centerWorld.y - dy },
    mapState.drag.zoom,
  );
  queueMapRender(mapState, onRender);
}

export function endMapDrag(
  event: PointerEvent,
  mapState: MapState,
  activePointers: Map<number, { x: number; y: number }>,
  pinchState: { startDist: number; startZoom: number },
  onScheduleRefresh: () => void,
  onMapClick: (latitude: number, longitude: number, event: PointerEvent) => void,
): void {
  activePointers.delete(event.pointerId);
  if (activePointers.size < 2) {
    pinchState.startDist = 0;
  }

  if (!mapState.drag || mapState.drag.pointerId !== event.pointerId) return;

  const drag = mapState.drag;
  mapState.drag = null;
  const canvas = event.currentTarget as HTMLCanvasElement;
  canvas.classList.remove("dragging");
  canvas.releasePointerCapture(event.pointerId);

  if (!drag.moved) {
    const location = screenToMapLocation(drag.canvasX, drag.canvasY, drag.width, drag.height, mapState.center.latitude, mapState.center.longitude, drag.zoom);
    onMapClick(location.latitude, location.longitude, event);
    return;
  }

  onScheduleRefresh();
}

export function resetMapView(
  mapState: MapState,
  defaultZoom: number,
  location?: { latitude: number; longitude: number } | null,
): void {
  const loc = location || mapState.selected;
  if (!loc) return;
  mapState.center = { latitude: loc.latitude, longitude: loc.longitude };
  mapState.zoom = defaultZoom;
}

export function cleanupMapModule(): void {
  if (tileLoadTimer) clearTimeout(tileLoadTimer);
  tileCache.clear();
}
