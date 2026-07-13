import type { Forecast, AirQuality, NwsAlert, SpcCollection, NoaaCatalog, NoaaSector, Location, CacheMeta } from "./types";
import { FORECAST_CACHE_TTL_MS, AIR_QUALITY_CACHE_TTL_MS, API_RATE_LIMIT_BACKOFF_MS, SATELLITE_CACHE_TTL_MS, HEATMAP_CACHE_TTL_MS, HEATMAP_MAX_CACHE_ENTRIES } from "./config";
import { getCachedApiResponse, setCachedApiResponse } from "./storage";
import { worldToLatLon } from "./geo";

const API_BASE_URL = getApiBaseUrl();

export function getApiBaseUrl(): string {
  const host = window.location.hostname;
  if (host === "127.0.0.1" || host === "localhost") {
    return "http://127.0.0.1:7428";
  }
  return window.location.origin;
}

export function buildApiUrl(path: string): URL {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(`/api${normalizedPath}`, API_BASE_URL);
}

const apiBackoffUntil = new Map<string, number>();
const forecastRequestCache = new Map<string, Promise<Forecast>>();
const heatmapRequestCache = new Map<string, Promise<unknown>>();
const airQualityRequestCache = new Map<string, Promise<AirQuality>>();
export const satelliteCatalogCache = new Map<string, { savedAt: number; data: NoaaCatalog }>();
export const heatmapCache = new Map<string, { savedAt: number; data: unknown }>();

export function setApiBackoff(name: string): void {
  apiBackoffUntil.set(name, Date.now() + API_RATE_LIMIT_BACKOFF_MS);
}

export function isApiBackedOff(name: string): boolean {
  const until = apiBackoffUntil.get(name) || 0;
  return until > Date.now();
}

async function fetchJsonWithCache<T>(
  url: URL,
  {
    namespace,
    cacheKey,
    ttlMs,
    requestCache,
    rateLimitName,
    rateLimitMessage,
  }: {
    namespace: string;
    cacheKey: string;
    ttlMs: number;
    requestCache: Map<string, Promise<T>>;
    rateLimitName?: string;
    rateLimitMessage?: string;
  },
): Promise<T & { __precipCacheMeta?: CacheMeta }> {
  const freshCached = getCachedApiResponse<T>(namespace, cacheKey, ttlMs);
  if (freshCached) {
    return { ...freshCached.data, __precipCacheMeta: { stale: false, age: freshCached.age } };
  }

  if (rateLimitName && isApiBackedOff(rateLimitName)) {
    const staleCached = getCachedApiResponse<T>(namespace, cacheKey, ttlMs, { allowStale: true });
    if (staleCached) {
      return { ...staleCached.data, __precipCacheMeta: { stale: true, age: staleCached.age, backedOff: true } };
    }
    throw new Error(rateLimitMessage);
  }

  const requestKey = `${namespace}:${cacheKey}`;
  if (requestCache.has(requestKey)) {
    return requestCache.get(requestKey) as Promise<T & { __precipCacheMeta?: CacheMeta }>;
  }

  const request = (async () => {
    try {
      const response = await fetch(url);
      if (response.status === 429 && rateLimitName) {
        setApiBackoff(rateLimitName);
        const staleCached = getCachedApiResponse<T>(namespace, cacheKey, ttlMs, { allowStale: true });
        if (staleCached) {
          return { ...staleCached.data, __precipCacheMeta: { stale: true, age: staleCached.age, rateLimited: true } };
        }
        throw new Error(rateLimitMessage);
      }
      if (!response.ok) throw new Error(`${namespace} request failed`);
      const data = (await response.json()) as T;
      setCachedApiResponse(namespace, cacheKey, data);
      requestCache.delete(requestKey);
      return { ...data, __precipCacheMeta: { stale: false, age: 0 } };
    } catch (error) {
      const staleCached = getCachedApiResponse<T>(namespace, cacheKey, ttlMs, { allowStale: true });
      if (staleCached) {
        return { ...staleCached.data, __precipCacheMeta: { stale: true, age: staleCached.age, fallback: true } };
      }
      requestCache.delete(requestKey);
      if (rateLimitName && !isApiBackedOff(rateLimitName)) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          if (isApiBackedOff(rateLimitName)) break;
          try {
            const retryResponse = await fetch(url);
            if (retryResponse.ok) {
              const retryData = (await retryResponse.json()) as T;
              setCachedApiResponse(namespace, cacheKey, retryData);
              return { ...retryData, __precipCacheMeta: { stale: false, age: 0 } };
            }
            if (retryResponse.status !== 429) break;
            setApiBackoff(rateLimitName);
          } catch {
            continue;
          }
        }
      }
      throw error;
    }
  })();

  requestCache.set(requestKey, request);
  return request;
}

export async function fetchForecast(location: Location): Promise<Forecast> {
  const url = buildApiUrl("/forecast");
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("scope", "forecast");
  return fetchJsonWithCache<Forecast>(url, {
    namespace: "precip.forecastCache.v1",
    cacheKey: `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`,
    ttlMs: FORECAST_CACHE_TTL_MS,
    requestCache: forecastRequestCache as unknown as Map<string, Promise<Forecast>>,
    rateLimitName: "forecast",
    rateLimitMessage: "Weather provider is temporarily rate-limiting requests. Try again in about a minute.",
  });
}

export async function fetchAirQuality(location: Location): Promise<AirQuality> {
  const url = buildApiUrl("/air-quality");
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  return fetchJsonWithCache<AirQuality>(url, {
    namespace: "precip.airCache.v1",
    cacheKey: `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`,
    ttlMs: AIR_QUALITY_CACHE_TTL_MS,
    requestCache: airQualityRequestCache as unknown as Map<string, Promise<AirQuality>>,
    rateLimitName: "air-quality",
    rateLimitMessage: "Air quality provider is temporarily rate-limiting requests.",
  });
}

export async function fetchAlerts(location: Location): Promise<NwsAlert[]> {
  const isCanada = location.countryCode === "CA";
  const endpoint = isCanada ? "/ca-alerts" : "/alerts";
  try {
    const url = buildApiUrl(endpoint);
    url.searchParams.set("latitude", location.latitude.toFixed(4));
    url.searchParams.set("longitude", location.longitude.toFixed(4));
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return [];
    const body = await response.json();
    return body.features || [];
  } catch {
    return [];
  }
}

export async function fetchNoaaSectorCatalog(sector: NoaaSector): Promise<NoaaCatalog> {
  const cacheKey = `${sector.sat}:${sector.id}`;
  const cached = satelliteCatalogCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < SATELLITE_CACHE_TTL_MS) {
    return cached.data;
  }

  const url = buildApiUrl("/noaa-sector");
  url.searchParams.set("sat", sector.sat);
  url.searchParams.set("sector", sector.id);
  const response = await fetch(url);
  if (!response.ok) throw new Error("NOAA sector page request failed");

  const html = await response.text();
  const fragment = new DOMParser().parseFromString(html, "text/html");
  const products: NoaaCatalog["products"] = [];

  fragment.querySelectorAll("h2").forEach((heading) => {
    const title = heading.textContent?.trim() || "";
    const summaryCard = heading.closest(".summaryContainer");
    const linksPanel = summaryCard?.nextElementSibling;
    const animatedLink = [...(linksPanel?.querySelectorAll("a") || [])].find(
      (link) => /animated gif/i.test(link.textContent || ""),
    );
    if (!animatedLink) return;
    const url = animatedLink.getAttribute("href");
    if (!url) return;
    const productKey = title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    products.push({ key: productKey, title, url });
  });

  if (!products.length) {
    throw new Error("NOAA animated imagery unavailable for this sector");
  }

  const data: NoaaCatalog = { products };
  satelliteCatalogCache.set(cacheKey, { savedAt: Date.now(), data });
  return data;
}

export async function fetchSpcOutlook(layer = "1"): Promise<SpcCollection | null> {
  try {
    const r = await fetch(buildApiUrl(`/spc-outlook?layer=${layer}`));
    if (!r.ok) return null;
    return await r.json() as SpcCollection;
  } catch {
    return null;
  }
}

export function getHeatmapViewportCacheKey(viewport: {
  zoom: number;
  columns: number;
  rows: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}): string {
  const center = worldToLatLon(
    (viewport.left + viewport.right) / 2,
    (viewport.top + viewport.bottom) / 2,
    viewport.zoom,
  );
  return [viewport.zoom, viewport.columns, viewport.rows, center.latitude.toFixed(2), center.longitude.toFixed(2)].join(":");
}

export function getCachedHeatmap(cacheKey: string): unknown {
  const entry = heatmapCache.get(cacheKey);
  if (entry) return entry.data;
  const stored = getCachedApiResponse(`precip.heatmapCache.v1:${cacheKey}`, "", 0) as { savedAt?: number; data?: unknown } | null;
  if (stored?.data) {
    heatmapCache.set(cacheKey, stored as { savedAt: number; data: unknown });
    return stored.data;
  }
  return null;
}

export function setCachedHeatmap(cacheKey: string, data: unknown): void {
  const entry = { savedAt: Date.now(), data };
  heatmapCache.set(cacheKey, entry);
  setCachedApiResponse(`precip.heatmapCache.v1:${cacheKey}`, "", data);

  while (heatmapCache.size > HEATMAP_MAX_CACHE_ENTRIES) {
    const oldestKey = heatmapCache.keys().next().value;
    if (oldestKey) heatmapCache.delete(oldestKey);
  }
}
