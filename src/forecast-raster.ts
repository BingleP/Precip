/**
 * Forecast raster layers (Phase 4).
 *
 * ECCC GeoMet WMS forecast rasters drawn through the same-origin proxy:
 * total cloud cover (CLOUD greyscale ramp) and precipitation rate
 * (PRECIPPRTMMH discrete palette). GDPS 15km is global and is the source
 * for both. (CAPS 3km was evaluated and dropped: it returned fully
 * transparent images for every style/time over Canada — see the plan's
 * Phase 4 record.) The images are keyed by valid time (now truncated to
 * the hour + the forecast-hour slider offset), so scrubbing the timeline
 * swaps imagery.
 */

import type { MapState } from "./types";
import { MAP_TILE_SIZE } from "./config";
import { latLonToWorld } from "./geo";
import { buildApiUrl } from "./api";

export type ForecastRasterProduct = "gdps-cloud" | "gdps-precip";

export interface ForecastRasterStatus {
  product: ForecastRasterProduct;
  /** e.g. "GDPS 15km" or "CAPS 3km". */
  providerLabel: string;
  attribution: string;
  attributionUrl: string;
  /** ISO8601 valid time served for the current hour offset. */
  validTime: string;
  hourOffset: number;
}

const PROVIDER_LABELS: Record<ForecastRasterProduct, { label: string; attribution: string; attributionUrl: string }> = {
  "gdps-cloud": { label: "GDPS 15km", attribution: "ECCC GeoMet (GDPS)", attributionUrl: "https://geo.weather.gc.ca/" },
  "gdps-precip": { label: "GDPS 15km", attribution: "ECCC GeoMet (GDPS)", attributionUrl: "https://geo.weather.gc.ca/" },
};

const EARTH_HALF_CIRCUMFERENCE_M = 20037508.343; // EPSG:3857 half extent in metres
const WMS_SNAP_M = 5000;
const WMS_CACHE_MAX = 64;
const PROCESSED_CACHE_MAX = 64;

/** Cloud veil thresholds on the CLOUD greyscale ramp (0%→black, 100%→white). */
const CLOUD_LOW = 30;
const CLOUD_HIGH = 230;

const wmsCache = new Map<string, HTMLImageElement>();
const processedCache = new Map<string, HTMLCanvasElement>();

let offscreenCanvas: HTMLCanvasElement | null = null;
let offscreenCtx: CanvasRenderingContext2D | null = null;

let redrawHandler: (() => void) | null = null;

export function registerForecastRasterRedrawHandler(handler: () => void): void {
  redrawHandler = handler;
}

/** Valid time for an hour offset: now truncated to the UTC hour + offset. */
export function validTimeForOffset(hourOffset: number): string {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const valid = new Date(now.getTime() + hourOffset * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${valid.getUTCFullYear()}-${pad(valid.getUTCMonth() + 1)}-${pad(valid.getUTCDate())}T${pad(valid.getUTCHours())}:00:00Z`;
}

/** GDPS 15km is global, so the product only depends on the layer kind. */
function pickProduct(layerId: string): ForecastRasterProduct {
  return layerId === "fcastPrecip" ? "gdps-precip" : "gdps-cloud";
}

export function getForecastRasterStatus(
  layerId: string,
  center: { latitude: number; longitude: number } | null,
  hourOffset: number,
): ForecastRasterStatus | null {
  if (!center) return null;
  const product = pickProduct(layerId);
  const meta = PROVIDER_LABELS[product];
  return {
    product,
    providerLabel: meta.label,
    attribution: meta.attribution,
    attributionUrl: meta.attributionUrl,
    validTime: validTimeForOffset(hourOffset),
    hourOffset,
  };
}

interface WmsGeometry {
  west: number;
  south: number;
  east: number;
  north: number;
  imageWidth: number;
  imageHeight: number;
  metresPerPixel: number;
  topLeftX: number;
  topLeftY: number;
}

function wmsGeometry(width: number, height: number, mapState: MapState, zoom: number): WmsGeometry {
  const worldScale = MAP_TILE_SIZE * 2 ** zoom;
  const metresPerPixel = (EARTH_HALF_CIRCUMFERENCE_M * 2) / worldScale;
  const centerWorld = latLonToWorld(mapState.center.latitude, mapState.center.longitude, zoom);
  const topLeftX = centerWorld.x - width / 2;
  const topLeftY = centerWorld.y - height / 2;
  const west = Math.floor((topLeftX * metresPerPixel - EARTH_HALF_CIRCUMFERENCE_M) / WMS_SNAP_M) * WMS_SNAP_M;
  const north = Math.floor((EARTH_HALF_CIRCUMFERENCE_M - topLeftY * metresPerPixel) / WMS_SNAP_M) * WMS_SNAP_M;
  const east = Math.ceil((west + width * metresPerPixel + WMS_SNAP_M) / WMS_SNAP_M) * WMS_SNAP_M;
  const south = north - Math.ceil((height * metresPerPixel + WMS_SNAP_M) / WMS_SNAP_M) * WMS_SNAP_M;
  const imageWidth = Math.min(1600, Math.max(128, Math.round((east - west) / metresPerPixel)));
  const imageHeight = Math.min(1600, Math.max(128, Math.round((north - south) / metresPerPixel)));
  return { west, south, east, north, imageWidth, imageHeight, metresPerPixel, topLeftX, topLeftY };
}

function getWmsImage(product: ForecastRasterProduct, validTime: string, geo: WmsGeometry): HTMLImageElement {
  const cacheKey = `${product}:${validTime}:${geo.west},${geo.south},${geo.east},${geo.north},${geo.imageWidth}x${geo.imageHeight}`;
  const cached = wmsCache.get(cacheKey);
  if (cached) return cached;
  const url = buildApiUrl("/forecast-wms");
  url.searchParams.set("product", product);
  url.searchParams.set("bbox", `${geo.west},${geo.south},${geo.east},${geo.north}`);
  url.searchParams.set("width", String(geo.imageWidth));
  url.searchParams.set("height", String(geo.imageHeight));
  url.searchParams.set("time", validTime);
  const image = new Image();
  image.decoding = "async";
  image.src = url.toString();
  image.addEventListener("load", () => redrawHandler?.(), { once: true });
  image.addEventListener("error", () => wmsCache.delete(cacheKey), { once: true });
  wmsCache.set(cacheKey, image);
  if (wmsCache.size >= WMS_CACHE_MAX) {
    const first = wmsCache.keys().next();
    if (!first.done) wmsCache.delete(first.value);
  }
  return image;
}

/**
 * Convert the CLOUD greyscale WMS rendering into a transparent veil:
 * dark (low cover) pixels drop out, bright (deep cover) pixels paint
 * neutral white. Tuned against live tiles (see plan Phase 4 record).
 */
function processCloudWms(image: HTMLImageElement): HTMLCanvasElement | null {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) return null;
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
  if (!scratchCtx) return null;
  scratchCtx.drawImage(image, 0, 0);
  let data: ImageData;
  try {
    data = scratchCtx.getImageData(0, 0, width, height);
  } catch {
    return null; // tainted canvas
  }
  const src = data.data;
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] === 0) continue;
    const luminance = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    if (luminance <= CLOUD_LOW) {
      src[i + 3] = 0;
      continue;
    }
    let t = (luminance - CLOUD_LOW) / (CLOUD_HIGH - CLOUD_LOW);
    t = t > 1 ? 1 : t;
    src[i + 3] = Math.round(235 * Math.pow(t, 0.8));
    const tint = 215 + Math.round(40 * t);
    src[i] = tint;
    src[i + 1] = tint;
    src[i + 2] = tint;
  }
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  out.getContext("2d")!.putImageData(data, 0, 0);
  return out;
}

/** Fetch (and cache-warm) the WMS images for the adjacent valid times. */
export function prefetchAdjacentHours(
  layerId: string,
  mapState: MapState,
  zoom: number,
  width: number,
  height: number,
  hourOffset: number,
): void {
  if (!width || !height) return;
  const product = pickProduct(layerId);
  const geo = wmsGeometry(width, height, mapState, zoom);
  for (const delta of [-1, 1]) {
    const next = hourOffset + delta;
    if (next < 0 || next > 23) continue;
    getWmsImage(product, validTimeForOffset(next), geo);
  }
}

/** Draw a forecast raster layer between the basemap and other content. */
export function drawForecastRasterLayer(
  ctx: CanvasRenderingContext2D,
  layerId: string,
  width: number,
  height: number,
  mapState: MapState,
  zoom: number,
  opacity: number,
  hourOffset: number,
): void {
  if (!offscreenCanvas || !offscreenCtx) {
    offscreenCanvas = document.createElement("canvas");
    offscreenCtx = offscreenCanvas.getContext("2d")!;
  }
  if (offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
    offscreenCanvas.width = Math.max(1, width);
    offscreenCanvas.height = Math.max(1, height);
  }
  offscreenCtx.clearRect(0, 0, width, height);

  const product = pickProduct(layerId);
  const validTime = validTimeForOffset(hourOffset);
  const geo = wmsGeometry(width, height, mapState, zoom);
  const image = getWmsImage(product, validTime, geo);
  const drawX = (geo.west + EARTH_HALF_CIRCUMFERENCE_M) / geo.metresPerPixel - geo.topLeftX;
  const drawY = geo.topLeftY - (EARTH_HALF_CIRCUMFERENCE_M - geo.north) / geo.metresPerPixel;
  // Draw at the bbox's geographic extent, never at the (capped) request pixel
  // size — otherwise the raster shrinks and misaligns on 4K viewports.
  const drawWidth = (geo.east - geo.west) / geo.metresPerPixel;
  const drawHeight = (geo.north - geo.south) / geo.metresPerPixel;

  if (image.complete && image.naturalWidth) {
    if (product.endsWith("cloud")) {
      const cacheKey = `${product}:${validTime}:${geo.west},${geo.south},${geo.east},${geo.north},${geo.imageWidth}x${geo.imageHeight}`;
      let processed = processedCache.get(cacheKey);
      if (!processed) {
        processed = processCloudWms(image) ?? undefined;
        if (processed) {
          processedCache.set(cacheKey, processed);
          if (processedCache.size >= PROCESSED_CACHE_MAX) {
            const first = processedCache.keys().next();
            if (!first.done) processedCache.delete(first.value);
          }
        }
      }
      if (processed) {
        offscreenCtx.drawImage(processed, drawX, drawY, drawWidth, drawHeight);
      }
    } else {
      offscreenCtx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    }
  }

  ctx.save();
  ctx.globalAlpha = Math.max(0.1, Math.min(1, opacity));
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(offscreenCanvas, 0, 0);
  ctx.restore();
}
