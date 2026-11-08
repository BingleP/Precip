import type { MapState } from "./types";
import { MAP_TILE_SIZE } from "./config";
import { latLonToWorld } from "./geo";
import { buildApiUrl } from "./api";

export type RadarProviderId = "rainviewer" | "iem" | "geomet";

export interface RadarFrame {
  /** Unix seconds (UTC) when the frame was generated. */
  time: number;
  /** RainViewer tile base path, e.g. /v2/radar/2c785a5680ae. Empty for IEM/GeoMet. */
  path: string;
}

export interface RadarStatus {
  provider: RadarProviderId;
  providerLabel: string;
  attribution: string;
  attributionUrl: string;
  frames: RadarFrame[];
  frameIndex: number;
  frameTime: number;
  available: boolean;
  loading: boolean;
}

const TILE_CACHE_MAX = 512;
const WMS_CACHE_MAX = 32;
const INDEX_REFRESH_MS = 120_000;
const LOOP_STEP_MS = 700;
const FADE_MS = 180;
const EARTH_HALF_CIRCUMFERENCE_M = 20037508.343; // EPSG:3857 half extent in metres
const WMS_SNAP_M = 5000;

const PROVIDER_LABELS: Record<RadarProviderId, { label: string; attribution: string; attributionUrl: string }> = {
  rainviewer: {
    label: "RainViewer",
    attribution: "Weather data by RainViewer",
    attributionUrl: "https://www.rainviewer.com/",
  },
  iem: {
    label: "IEM NEXRAD",
    attribution: "Radar data by Iowa Environmental Mesonet",
    attributionUrl: "https://mesonet.agron.iastate.edu/",
  },
  geomet: {
    label: "ECCC GeoMet",
    attribution: "Radar data by Environment and Climate Change Canada",
    attributionUrl: "https://geo.weather.gc.ca/",
  },
};

let frames: RadarFrame[] = [];
let frameIndex = 0;
let indexFetchedAt = 0;
let indexPromise: Promise<void> | null = null;
let redrawHandler: (() => void) | null = null;

let loopTimer: ReturnType<typeof setInterval> | null = null;
let loopPlaying = false;

const tileCache = new Map<string, HTMLImageElement>();
const wmsCache = new Map<string, HTMLImageElement>();

let offscreenCanvas: HTMLCanvasElement | null = null;
let offscreenCtx: CanvasRenderingContext2D | null = null;
let prevCanvas: HTMLCanvasElement | null = null;
let fadeStartedAt = 0;
let fadingKey = ""; // compositeKey the active fade is transitioning towards
let lastCompositeKey = "";

let providerOverride: RadarProviderId | null = null;
let providerOverrideCenter: { latitude: number; longitude: number } | null = null;

export function registerRadarRedrawHandler(handler: () => void): void {
  redrawHandler = handler;
}

export function isRadarFrameProvider(provider: RadarProviderId): boolean {
  return provider === "rainviewer" || provider === "iem";
}

/** Choose the radar source by viewport coverage. */
export function selectProvider(latitude: number, longitude: number): RadarProviderId {
  if (latitude >= 41 && latitude <= 84 && longitude >= -141 && longitude <= -52) return "geomet";
  if (latitude >= 24 && latitude <= 50 && longitude >= -125 && longitude <= -66) return "iem";
  return "rainviewer";
}

export function getRadarFrames(): RadarFrame[] {
  return frames;
}

export function getRadarFrameIndex(): number {
  return frameIndex;
}

export function setRadarFrame(index: number): void {
  const next = Math.max(0, Math.min(frames.length - 1, index));
  if (next === frameIndex) return;
  frameIndex = next;
  redrawHandler?.();
}

export function isRadarLoopPlaying(): boolean {
  return loopPlaying;
}

export function setRadarLoop(playing: boolean): void {
  loopPlaying = playing;
  if (playing) {
    if (loopTimer) return;
    loopTimer = setInterval(() => {
      if (document.hidden) return;
      const next = frameIndex + 1 >= frames.length ? 0 : frameIndex + 1;
      setRadarFrame(next);
    }, LOOP_STEP_MS);
  } else if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden && loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  } else if (!document.hidden && loopPlaying && !loopTimer) {
    setRadarLoop(true);
  }
});

export function formatRadarRelativeTime(unixSeconds: number): string {
  const ageMs = Date.now() - unixSeconds * 1000;
  if (ageMs < 0) return "just now";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

export function getRadarStatus(mapCenter: { latitude: number; longitude: number }): RadarStatus | null {
  if (!frames.length) return null;
  const provider = getActiveProvider(mapCenter);
  const meta = PROVIDER_LABELS[provider];
  const frame = frames[frameIndex];
  return {
    provider,
    providerLabel: meta.label,
    attribution: meta.attribution,
    attributionUrl: meta.attributionUrl,
    frames,
    frameIndex,
    frameTime: frame.time,
    available: true,
    loading: false,
  };
}

function getActiveProvider(mapCenter: { latitude: number; longitude: number }): RadarProviderId {
  if (providerOverride && providerOverrideCenter) {
    const moved =
      Math.abs(mapCenter.latitude - providerOverrideCenter.latitude) > 3 ||
      Math.abs(mapCenter.longitude - providerOverrideCenter.longitude) > 3;
    if (!moved) return providerOverride;
    providerOverride = null;
    providerOverrideCenter = null;
  }
  return selectProvider(mapCenter.latitude, mapCenter.longitude);
}

async function fetchRadarIndex(): Promise<void> {
  const response = await fetch(buildApiUrl("/radar-index"), { cache: "no-store" });
  if (!response.ok) throw new Error(`radar index ${response.status}`);
  const data = await response.json();
  const past: Array<{ time: number; path: string }> = Array.isArray(data?.radar?.past) ? data.radar.past : [];
  if (!past.length) throw new Error("radar index has no frames");
  // Drop frames older than 2h so the loop always covers the advertised window.
  const cutoff = Math.floor(Date.now() / 1000) - 2 * 3600;
  frames = past.filter((frame) => frame.time >= cutoff);
  if (!frames.length) frames = past;
  frameIndex = frames.length - 1;
  indexFetchedAt = Date.now();
}

export function ensureRadarFrames(): Promise<void> {
  if (frames.length && Date.now() - indexFetchedAt < INDEX_REFRESH_MS) return Promise.resolve();
  if (!indexPromise) {
    indexPromise = fetchRadarIndex()
      .then(() => redrawHandler?.())
      .catch(() => {
        frames = [];
      })
      .finally(() => {
        indexPromise = null;
      });
  }
  return indexPromise;
}

function tileCacheSet(key: string, image: HTMLImageElement): void {
  if (tileCache.size >= TILE_CACHE_MAX) {
    const deleteCount = Math.round(TILE_CACHE_MAX * 0.25);
    for (const [index, cachedKey] of [...tileCache.keys()].entries()) {
      if (index >= deleteCount) break;
      tileCache.delete(cachedKey);
    }
  }
  tileCache.set(key, image);
}

function wmsCacheSet(key: string, image: HTMLImageElement): void {
  if (wmsCache.size >= WMS_CACHE_MAX) {
    const deleteCount = Math.round(WMS_CACHE_MAX * 0.25);
    for (const [index, cachedKey] of [...wmsCache.keys()].entries()) {
      if (index >= deleteCount) break;
      wmsCache.delete(cachedKey);
    }
  }
  wmsCache.set(key, image);
}

function getTileImage(url: string, cacheKey: string): HTMLImageElement {
  const cached = tileCache.get(cacheKey);
  if (cached) return cached;
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  image.addEventListener(
    "load",
    () => redrawHandler?.(),
    { once: true },
  );
  image.addEventListener("error", () => tileCache.delete(cacheKey), { once: true });
  tileCacheSet(cacheKey, image);
  return image;
}

function getWmsImage(url: string, cacheKey: string): HTMLImageElement {
  const cached = wmsCache.get(cacheKey);
  if (cached) return cached;
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  image.addEventListener(
    "load",
    () => redrawHandler?.(),
    { once: true },
  );
  image.addEventListener("error", () => wmsCache.delete(cacheKey), { once: true });
  wmsCacheSet(cacheKey, image);
  return image;
}

function tileMaxZoom(provider: RadarProviderId): number {
  // RainViewer's tile pyramid stops at z7; IEM supports higher zooms.
  return provider === "rainviewer" ? 7 : 12;
}

/** Draw radar tiles for one frame through the same-origin proxy. */
function drawTileProvider(
  ctx: CanvasRenderingContext2D,
  provider: RadarProviderId,
  frame: RadarFrame,
  width: number,
  height: number,
  mapState: MapState,
  zoom: number,
): { requested: number; failed: number } {
  const tileZoom = Math.min(zoom, tileMaxZoom(provider));
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
      const drawX = (tileX * MAP_TILE_SIZE - topLeft.x) * scale;
      const drawY = (tileY * MAP_TILE_SIZE - topLeft.y) * scale;
      const params = new URLSearchParams({
        source: provider,
        z: String(tileZoom),
        x: String(wrappedX),
        y: String(tileY),
        size: "256",
      });
      const cacheKey = `${provider}:${frame.time}:${tileZoom}/${wrappedX}/${tileY}`;
      if (provider === "rainviewer") params.set("path", frame.path);
      const url = buildApiUrl("/radar-tile");
      url.search = params.toString();
      const image = getTileImage(url.toString(), cacheKey);
      requested += 1;
      if (image.complete && image.naturalWidth) {
        ctx.drawImage(image, drawX, drawY, MAP_TILE_SIZE * scale, MAP_TILE_SIZE * scale);
      } else if (image.complete && !image.naturalWidth) {
        failed += 1;
      }
    }
  }
  return { requested, failed };
}

/** Draw one GeoMet WMS GetMap image covering the viewport (EPSG:3857). */
function drawWmsProvider(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mapState: MapState,
  zoom: number,
): { requested: number; failed: number } {
  const worldScale = MAP_TILE_SIZE * 2 ** zoom;
  const metresPerPixel = (EARTH_HALF_CIRCUMFERENCE_M * 2) / worldScale;
  const centerWorld = latLonToWorld(mapState.center.latitude, mapState.center.longitude, zoom);
  const topLeftX = centerWorld.x - width / 2;
  const topLeftY = centerWorld.y - height / 2;

  const west = Math.floor((topLeftX * metresPerPixel - EARTH_HALF_CIRCUMFERENCE_M) / WMS_SNAP_M) * WMS_SNAP_M;
  const north = Math.floor((EARTH_HALF_CIRCUMFERENCE_M - topLeftY * metresPerPixel) / WMS_SNAP_M) * WMS_SNAP_M;
  const east = Math.ceil((west + width * metresPerPixel + WMS_SNAP_M) / WMS_SNAP_M) * WMS_SNAP_M;
  const south = north - Math.ceil((height * metresPerPixel + WMS_SNAP_M) / WMS_SNAP_M) * WMS_SNAP_M;

  // Request resolution is capped so one image stays cheap, but the image must
  // always be drawn at the geographic extent of the bbox. Using the requested
  // pixel size here made the layer shrink into the corner on large (4K) or
  // high-DPR viewports.
  const extentWidth = (east - west) / metresPerPixel;
  const extentHeight = (north - south) / metresPerPixel;
  const imageWidth = Math.min(2048, Math.max(128, Math.round(extentWidth)));
  const imageHeight = Math.min(2048, Math.max(128, Math.round(extentHeight)));
  const cacheKey = `geomet:${west},${south},${east},${north},${imageWidth}x${imageHeight}`;
  const url = buildApiUrl("/radar-wms");
  url.searchParams.set("bbox", `${west},${south},${east},${north}`);
  url.searchParams.set("width", String(imageWidth));
  url.searchParams.set("height", String(imageHeight));
  const image = getWmsImage(url.toString(), cacheKey);

  if (image.complete && image.naturalWidth) {
    const drawX = (west + EARTH_HALF_CIRCUMFERENCE_M) / metresPerPixel - topLeftX;
    const drawY = topLeftY - (EARTH_HALF_CIRCUMFERENCE_M - north) / metresPerPixel;
    ctx.drawImage(image, drawX, drawY, extentWidth, extentHeight);
    return { requested: 1, failed: 0 };
  }
  if (image.complete && !image.naturalWidth) return { requested: 1, failed: 1 };
  return { requested: 1, failed: 0 };
}

/**
 * Draw the radar frame onto an offscreen canvas, then composite it with a
 * short cross-fade from the previous frame so loop playback is smooth.
 */
export function drawRadarLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mapState: MapState,
  zoom: number,
  opacity: number,
): void {
  void ensureRadarFrames();
  if (!frames.length) return;

  if (!offscreenCanvas || !offscreenCtx) {
    offscreenCanvas = document.createElement("canvas");
    offscreenCtx = offscreenCanvas.getContext("2d")!;
    prevCanvas = document.createElement("canvas");
  }
  if (offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
    offscreenCanvas.width = Math.max(1, width);
    offscreenCanvas.height = Math.max(1, height);
    prevCanvas!.width = offscreenCanvas.width;
    prevCanvas!.height = offscreenCanvas.height;
    lastCompositeKey = "";
  }

  const provider = getActiveProvider(mapState.center);
  const frame = frames[frameIndex];
  const compositeKey = `${provider}:${frame.time}:${zoom}:${width}:${height}`;

  offscreenCtx!.clearRect(0, 0, width, height);

  const stats =
    provider === "geomet"
      ? drawWmsProvider(offscreenCtx!, width, height, mapState, zoom)
      : drawTileProvider(offscreenCtx!, provider, frame, width, height, mapState, zoom);

  // If a regional provider is failing (no coverage for this viewport), fall
  // back to the global RainViewer source until the user moves away.
  if (provider !== "rainviewer" && stats.requested > 0 && stats.failed / stats.requested > 0.6) {
    providerOverride = "rainviewer";
    providerOverrideCenter = { ...mapState.center };
    redrawHandler?.();
    return;
  }

  ctx.save();
  ctx.globalAlpha = Math.max(0.1, Math.min(1, opacity));
  ctx.imageSmoothingEnabled = true;

  // Cross-fade between radar frames so loop playback transitions smoothly.
  // prevCanvas holds the previous radar pass; redraws scheduled by rAF
  // advance the fade until it completes. The fade timer is only armed for a
  // new transition key — NOT reset by every redraw during the transition,
  // which would keep the new frame at alpha ~0 forever.
  const navigating = lastCompositeKey && prevCanvas!.width === width && prevCanvas!.height === height;
  if (lastCompositeKey && compositeKey === fadingKey) {
    // Mid-fade redraw: advance the existing fade.
  } else if (compositeKey !== lastCompositeKey && navigating) {
    // A new frame/provider/zoom transition: start fading from the previous
    // radar pass (already in prevCanvas) towards the new one.
    fadeStartedAt = performance.now();
    fadingKey = compositeKey;
  } else if (compositeKey !== lastCompositeKey) {
    // No previous pass to fade from (first draw, or canvas resized).
    fadeStartedAt = 0;
    fadingKey = "";
  }

  if (fadeStartedAt > 0 && navigating) {
    const t = Math.min(1, (performance.now() - fadeStartedAt) / FADE_MS);
    if (t < 1) {
      ctx.globalAlpha = Math.max(0.1, Math.min(1, opacity)) * (1 - t);
      ctx.drawImage(prevCanvas!, 0, 0);
      ctx.globalAlpha = Math.max(0.1, Math.min(1, opacity)) * t;
      ctx.drawImage(offscreenCanvas, 0, 0);
      requestAnimationFrame(() => redrawHandler?.());
      ctx.restore();
      return;
    }
    fadeStartedAt = 0;
    fadingKey = "";
  }

  ctx.drawImage(offscreenCanvas, 0, 0);

  // Keep a copy of this radar pass as the fade source for the next transition.
  if (compositeKey !== lastCompositeKey) {
    prevCanvas!.getContext("2d")!.drawImage(offscreenCanvas, 0, 0);
    lastCompositeKey = compositeKey;
  }
  ctx.restore();
}
