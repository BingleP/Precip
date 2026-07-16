import type { HeatmapSample, MapState } from "./types";
import { MAP_TILE_SIZE, MAP_MIN_ZOOM, MAP_MAX_ZOOM, MAP_DEFAULT_ZOOM, HEATMAP_SCALE, INITIAL_MAP_CENTER } from "./config";
import { latLonToWorld, projectToMapScreen, projectToMapScreenFast, screenToMapLocation, setMapCenterFromWorld, clampMapZoom } from "./geo";
import { normalizeValue, formatHeatmapValue, getHeatmapTitle } from "./weather";
import { isInsideAlertPolygonSpatial, getWildfireAtPoint } from "./alerts";
import { escapeHTML } from "./ui";

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
const TILE_FILTER = "brightness(0.48) saturate(0.6) contrast(1.25)";

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

  // Memoize label position by viewport
  const cacheKey = `${selected.latitude.toFixed(4)}:${selected.longitude.toFixed(4)}:${zoomRound}:${width}:${height}`;
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

// Label position cache
const labelPositionCache = new Map<string, { x: number; y: number }>();

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
): void {
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
        data[offset + 3] = 132;
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
        data[offset + 3] = 132;
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

  let tooltipHTML =
    `<strong>${formatHeatmapValue(layerValue ?? undefined, activeHeatmapLayer)}</strong>` +
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
  onMapClick: (latitude: number, longitude: number) => void,
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
    onMapClick(location.latitude, location.longitude);
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
