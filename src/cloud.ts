/**
 * Satellite cloud layer (Phase 3).
 *
 * Full-disk GOES/Himawari imagery from NASA GIBS, drawn through the
 * same-origin proxy. The GIBS "clean infrared" product is a fully-opaque
 * colour raster: bright pixels are cold/high cloud tops, dark pixels are
 * warm ground or ocean. We convert luminance to a semi-transparent cool
 * white cloud veil in a per-tile processing cache, then composite the
 * processed tiles like the radar layer does.
 */

import type { MapState } from "./types";
import { MAP_TILE_SIZE } from "./config";
import { latLonToWorld } from "./geo";
import { buildApiUrl } from "./api";

export type CloudProviderId = "goes-east" | "goes-west" | "himawari";

export interface CloudStatus {
  provider: CloudProviderId;
  providerLabel: string;
  attribution: string;
  attributionUrl: string;
}

const PROVIDER_LABELS: Record<CloudProviderId, { label: string; attribution: string; attributionUrl: string }> = {
  "goes-east": {
    label: "GOES-East",
    attribution: "NASA GIBS / NOAA GOES-East",
    attributionUrl: "https://worldview.earthdata.nasa.gov/",
  },
  "goes-west": {
    label: "GOES-West",
    attribution: "NASA GIBS / NOAA GOES-West",
    attributionUrl: "https://worldview.earthdata.nasa.gov/",
  },
  himawari: {
    label: "Himawari",
    attribution: "NASA GIBS / JMA Himawari",
    attributionUrl: "https://worldview.earthdata.nasa.gov/",
  },
};

/** GIBS publishes these products at GoogleMapsCompatible_Level6 (zoom cap 6). */
const CLOUD_MAX_ZOOM = 6;
/**
 * IR luminance thresholds: below LOW is ground/ocean, above HIGH is cloud.
 * The false-colour GIBS clean-IR product puts warm ground near luminance
 * 145–162 and cold cloud tops at 180+, so the low edge sits just above the
 * ground band. A sub-unity gamma boosts mid-level cloud over the ground.
 */
const IR_LOW = 148;
const IR_HIGH = 205;
const PROCESSED_CACHE_MAX = 256;
const RAW_CACHE_MAX = 128;

let providerOverride: CloudProviderId | null = null;
let overrideCenter: { latitude: number; longitude: number } | null = null;

const rawImages = new Map<string, HTMLImageElement>();
const processedTiles = new Map<string, HTMLCanvasElement>();

let offscreenCanvas: HTMLCanvasElement | null = null;
let offscreenCtx: CanvasRenderingContext2D | null = null;
let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

let redrawHandler: (() => void) | null = null;
let cloudRefreshTimer: ReturnType<typeof setInterval> | null = null;

export function registerCloudRedrawHandler(handler: () => void): void {
  redrawHandler = handler;
}

export function getCloudStatus(center: { latitude: number; longitude: number } | null): CloudStatus | null {
  const provider = getActiveProvider(center ?? { latitude: 0, longitude: 0 });
  const meta = PROVIDER_LABELS[provider];
  return {
    provider,
    providerLabel: meta.label,
    attribution: meta.attribution,
    attributionUrl: meta.attributionUrl,
  };
}

function normalizeLongitude(longitude: number): number {
  let lon = longitude;
  while (lon < -180) lon += 360;
  while (lon > 180) lon -= 360;
  return lon;
}

/** Pick the full-disk product whose footprint contains the viewport. */
function pickProvider(longitude: number): CloudProviderId {
  const lon = normalizeLongitude(longitude);
  if (lon >= 90 || lon < -170) return "himawari";
  // GOES-West's disk reaches ~85°W; past that the East disk looks straight on.
  if (lon < -135) return "goes-west";
  return "goes-east";
}

function getActiveProvider(center: { latitude: number; longitude: number }): CloudProviderId {
  if (providerOverride && overrideCenter) {
    const moved = Math.abs(center.latitude - overrideCenter.latitude) > 6 ||
      Math.abs(normalizeLongitude(center.longitude) - normalizeLongitude(overrideCenter.longitude)) > 12;
    if (moved) {
      providerOverride = null;
      overrideCenter = null;
    } else {
      return providerOverride;
    }
  }
  return pickProvider(center.longitude);
}

function requestCloudTile(provider: CloudProviderId, zoom: number, x: number, y: number): HTMLImageElement {
  const url = buildApiUrl("/satellite-tile");
  url.searchParams.set("layer", provider);
  url.searchParams.set("z", String(zoom));
  url.searchParams.set("x", String(x));
  url.searchParams.set("y", String(y));
  const cacheKey = `sat:${provider}:${zoom}/${x}/${y}`;
  const cached = rawImages.get(cacheKey);
  if (cached) return cached;
  const image = new Image();
  image.decoding = "async";
  image.src = url.toString();
  image.addEventListener("load", () => redrawHandler?.(), { once: true });
  image.addEventListener("error", () => rawImages.delete(cacheKey), { once: true });
  rawImages.set(cacheKey, image);
  if (rawImages.size >= RAW_CACHE_MAX) {
    const first = rawImages.keys().next();
    if (!first.done) rawImages.delete(first.value);
  }
  return image;
}

/**
 * Convert one GIBS "clean infrared" tile into a transparent cloud-veil
 * canvas. Luminance drives alpha; the veil is tinted from cool grey (low
 * cloud) towards white (deep convective tops).
 */
function processCloudTile(image: HTMLImageElement): HTMLCanvasElement | null {
  if (!scratchCanvas || !scratchCtx) {
    scratchCanvas = document.createElement("canvas");
    scratchCanvas.width = MAP_TILE_SIZE;
    scratchCanvas.height = MAP_TILE_SIZE;
    scratchCtx = scratchCanvas.getContext("2d", { willReadFrequently: true });
    if (!scratchCanvas || !scratchCtx) return null;
  }
  scratchCtx.clearRect(0, 0, MAP_TILE_SIZE, MAP_TILE_SIZE);
  scratchCtx.drawImage(image, 0, 0, MAP_TILE_SIZE, MAP_TILE_SIZE);
  const source = scratchCtx.getImageData(0, 0, MAP_TILE_SIZE, MAP_TILE_SIZE);
  const src = source.data;
  for (let i = 0; i < src.length; i += 4) {
    const red = src[i];
    const green = src[i + 1];
    const blue = src[i + 2];
    const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
    if (luminance <= IR_LOW) {
      src[i + 3] = 0;
      continue;
    }
    let alpha = (luminance - IR_LOW) / (IR_HIGH - IR_LOW);
    alpha = alpha > 1 ? 1 : alpha;
    src[i + 3] = Math.round(230 * Math.pow(alpha, 0.85));
    // Neutral grey → white ramp so high cloud tops read brighter; kept
    // neutral (not blue) so the veil can't be confused with radar colours.
    const tint = 215 + Math.round(40 * alpha);
    src[i] = tint;
    src[i + 1] = tint;
    src[i + 2] = tint;
  }
  const out = document.createElement("canvas");
  out.width = MAP_TILE_SIZE;
  out.height = MAP_TILE_SIZE;
  out.getContext("2d")!.putImageData(source, 0, 0);
  return out;
}

/** Return the processed canvas for a tile, processing + caching on demand. */
function getProcessedTile(image: HTMLImageElement, cacheKey: string): HTMLCanvasElement | null {
  const cached = processedTiles.get(cacheKey);
  if (cached) return cached;
  // Raw PNG not decodable (or failed request) → nothing to draw.
  if (!image.complete || !image.naturalWidth) return null;
  if (processedTiles.size >= PROCESSED_CACHE_MAX) {
    const first = processedTiles.keys().next();
    if (!first.done) processedTiles.delete(first.value);
  }
  let processed: HTMLCanvasElement | null = null;
  try {
    processed = processCloudTile(image);
  } catch {
    // Tainted canvas (or decode hiccup): skip this tile.
    processed = null;
  }
  if (processed) processedTiles.set(cacheKey, processed);
  return processed;
}

/** Draw the satellite cloud layer between the basemap and other content. */
export function drawCloudLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mapState: MapState,
  zoom: number,
  opacity: number,
): { requested: number; failed: number } {
  if (!offscreenCanvas || !offscreenCtx) {
    offscreenCanvas = document.createElement("canvas");
    offscreenCtx = offscreenCanvas.getContext("2d")!;
  }
  if (offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
    offscreenCanvas.width = Math.max(1, width);
    offscreenCanvas.height = Math.max(1, height);
  }
  const offscreen = offscreenCtx;
  offscreen.clearRect(0, 0, width, height);

  const provider = getActiveProvider(mapState.center);
  const tileZoom = Math.min(zoom, CLOUD_MAX_ZOOM);
  const scale = 2 ** (zoom - tileZoom);
  const centerWorld = latLonToWorld(mapState.center.latitude, mapState.center.longitude, tileZoom);
  const topLeft = {
    x: centerWorld.x - width / 2 / scale,
    y: centerWorld.y - height / 2 / scale,
  };
  const firstTileX = Math.floor(topLeft.x / MAP_TILE_SIZE);
  const firstTileY = Math.floor(topLeft.y / MAP_TILE_SIZE);
  const lastTileX = Math.floor((topLeft.x + width / scale) / MAP_TILE_SIZE);
  const lastTileY = Math.floor((topLeft.y + height / scale) / MAP_TILE_SIZE);
  const tileCount = 2 ** tileZoom;

  let requested = 0;
  let failed = 0;
  for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
    for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
      if (tileY < 0 || tileY >= tileCount) continue;
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      const drawX = tileX * MAP_TILE_SIZE * scale - topLeft.x * scale;
      const drawY = tileY * MAP_TILE_SIZE * scale - topLeft.y * scale;
      const image = requestCloudTile(provider, tileZoom, wrappedX, tileY);
      requested += 1;
      if (!image.complete || !image.naturalWidth) {
        continue; // still loading; its load event re-triggers a render
      }
      const processed = getProcessedTile(image, `sat:${provider}:${tileZoom}/${wrappedX}/${tileY}`);
      if (!processed) {
        failed += 1;
        continue;
      }
      offscreen.drawImage(processed, drawX, drawY, MAP_TILE_SIZE * scale, MAP_TILE_SIZE * scale);
    }
  }

  // Clear the provider override once this location works again.
  if (providerOverride && requested > 0 && failed / requested <= 0.4) {
    providerOverride = null;
    overrideCenter = null;
  }

  ctx.save();
  ctx.globalAlpha = Math.max(0.1, Math.min(1, opacity));
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(offscreenCanvas, 0, 0);
  ctx.restore();

  // If nearly every tile failed to process, one-shot switch to the other
  // disk (e.g. tiles blank because the viewport sat outside the disk).
  if (requested > 0 && failed / requested > 0.8) {
    const fallback: CloudProviderId = provider === "goes-west" ? "goes-east" : "goes-west";
    if (fallback !== provider) {
      providerOverride = fallback;
      overrideCenter = { latitude: mapState.center.latitude, longitude: mapState.center.longitude };
      redrawHandler?.();
      return { requested, failed };
    }
  }
  return { requested, failed };
}

/** Refresh the imagery at most every five minutes while the tab is visible. */
export function startCloudRefresh(redraw: () => void): void {
  if (cloudRefreshTimer) return;
  cloudRefreshTimer = setInterval(() => {
    if (document.hidden) return;
    // Age every processed tile so the next render re-fetches "latest".
    processedTiles.clear();
    rawImages.clear();
    redraw();
  }, 300_000);
}

export function stopCloudRefresh(): void {
  if (!cloudRefreshTimer) return;
  clearInterval(cloudRefreshTimer);
  cloudRefreshTimer = null;
}
