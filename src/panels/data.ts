import type { Location, Forecast, WatchlistItem, AppSettings, HeatmapSample, WildfireFeature } from "../types";
import { elements, activeLocation, latestForecast, mapState, heatmapCanvas, heatmapButtons, showAlerts, showWildfires } from "../state";
import {
  getWatchlist, saveWatchlist,
  getPreferredLocation, getAppSettings, savePreferredLocation, saveAppSettings,
  removeCookieValue, formatSavedLocation,
} from "../storage";
import { fetchHeatmap } from "../heatmap";
import {
  calculateStormRisk, formatTemp, formatSpeed, formatPrecip,
  maxNext, sumNext,
} from "../weather";
import { addLog, spinner, escapeHTML, showToast, prepareCanvas } from "../ui";
import {
  drawMapTiles, drawMapOverlayText, drawHeatmapOverlay,
  drawMapPlaces, queueMapRender,
  renderMapReadout, renderHeatmapLegend, updateMapHourLabel,
  hideMapTooltip,
} from "../map";
import { projectToMapScreenFast, latLonToWorld } from "../geo";
import { drawStormTracks } from "../storm-tracks";
import { drawMapAlertPolygons, getMapCenterAlerts, setAlertPolygonsCache, getMapCenterWildfires, setWildfireHitCache, getWildfireScreenCache, setWildfireScreenCache, getLastWildfireState, setLastWildfireState, drawCachedWildfires, showStormTracks } from "../alerts";
import {
  latestHeatmap, latestHeatmapMeta, activeHeatmapLayer, activeMapHourOffset,
  setLatestHeatmap, setLatestHeatmapMeta,
  setActiveHeatmapLayerState, setActiveMapHourOffsetState,
  heatmapRefreshTimer, heatmapRefreshToken, heatmapRetryDelay,
  setHeatmapRefreshTimer, setHeatmapRefreshToken, setHeatmapRetryDelay,
  mapAnimationTimer, mapAnimationPlaying,
  setMapAnimationTimer, setMapAnimationPlaying,
} from "../state";
import { getHeatmapValue } from "../weather";

export function updateSettingsUI(): void {
  const savedLocation = getPreferredLocation();
  const settings = getAppSettings();
  if (elements.defaultLocationLabel) elements.defaultLocationLabel.textContent = formatSavedLocation(savedLocation);
  if (elements.settingsMapLayer) elements.settingsMapLayer.value = settings.mapLayer;
  if (elements.settingsStartHour) elements.settingsStartHour.value = `${settings.mapHourOffset}`;
  const metricRadio = document.querySelector("#units-metric") as HTMLInputElement | null;
  const imperialRadio = document.querySelector("#units-imperial") as HTMLInputElement | null;
  if (metricRadio) metricRadio.checked = !settings.useImperial;
  if (imperialRadio) imperialRadio.checked = settings.useImperial;
  if (elements.setDefaultLocationButton) elements.setDefaultLocationButton.disabled = !activeLocation;
  if (elements.resetDefaultLocationButton) elements.resetDefaultLocationButton.disabled = !savedLocation;
}

export function renderWatchlistUI(items = getWatchlist(), onLoadLocation?: (loc: Location) => void): void {
  if (!elements.watchlistGrid) return;
  if (!items.length) {
    elements.watchlistGrid.innerHTML = `<div class="empty-signal">No pinned locations yet.</div>`;
    return;
  }

  elements.watchlistGrid.innerHTML = (items as WatchlistItem[])
    .map(
      (item, index) => `
        <div class="watchlist-row">
          <div><strong>${escapeHTML([item.name, item.admin, item.country].filter(Boolean).join(", "))}</strong><small>${new Date(item.pinnedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div>
          <div><span>Temp</span><strong>${formatTemp(item.temperature)}</strong></div>
          <div><span>Gust</span><strong>${formatSpeed(item.gusts || 0)}</strong></div>
          <div><span>Rain</span><strong>${formatPrecip(item.rain)}</strong></div>
          <div><span>Risk</span><strong>${escapeHTML(item.risk || "--")}</strong></div>
          <button type="button" data-watch-index="${index}">Load</button>
        </div>
      `,
    )
    .join("");

  if (onLoadLocation) {
    elements.watchlistGrid.querySelectorAll("button[data-watch-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const location = getWatchlist()[Number((button as HTMLElement).dataset.watchIndex)];
        if (location) onLoadLocation(location);
      });
    });
  }
}

export function pinCurrentLocation(): void {
  if (!activeLocation || !latestForecast) return;
  const remaining = getWatchlist().filter(
    (item) =>
      Math.abs(item.latitude - activeLocation!.latitude) > 0.01 ||
      Math.abs(item.longitude - activeLocation!.longitude) > 0.01,
  );
  const risk = calculateStormRisk(latestForecast);
  const watchlistItem: WatchlistItem = {
    ...activeLocation,
    pinnedAt: new Date().toISOString(),
    temperature: latestForecast.current.temperature_2m,
    gusts: maxNext(latestForecast, "wind_gusts_10m", 24),
    rain: sumNext(latestForecast, "precipitation", 24),
    risk: risk.level,
  };
  saveWatchlist([watchlistItem, ...remaining]);
  renderWatchlistUI();
  addLog(`${activeLocation.name} pinned to stormwatch.`, elements.eventLog);
}

export function clearSavedWatchlist(): void {
  removeCookieValue("precip.watchlist.v1");
  try { window.localStorage.removeItem("precip.watchlist.v1"); } catch {}
  renderWatchlistUI([]);
  addLog("Pinned locations cleared.", elements.eventLog);
}

export function saveCurrentAsPreferredLocation(): void {
  if (!activeLocation) return;
  savePreferredLocation(activeLocation);
  updateSettingsUI();
  addLog(`${activeLocation.name} saved as the default location.`, elements.eventLog);
}

export function clearPreferredLocationSetting(): void {
  removeCookieValue("precip.preferredLocation.v1");
  updateSettingsUI();
  addLog("Saved default location cleared.", elements.eventLog);
  window.location.replace("welcome.html");
}

export function scheduleHeatmapRefresh(delay = 320): void {
  if (!activeLocation) return;
  if (heatmapRefreshTimer) clearTimeout(heatmapRefreshTimer);
  const requestToken = heatmapRefreshToken + 1;
  setHeatmapRefreshToken(requestToken);
  const timer = setTimeout(() => {
    refreshHeatmapForViewport(requestToken);
  }, delay);
  setHeatmapRefreshTimer(timer);
}

export function scheduleHeatmapRetry(backoff = heatmapRetryDelay): void {
  if (!activeLocation) return;
  setHeatmapRetryDelay(Math.min(backoff * 2, 30000));
  scheduleHeatmapRefresh(backoff);
}

export async function refreshHeatmapForViewport(requestToken: number): Promise<void> {
  if (!activeLocation) return;
  try {
    const result = await fetchHeatmap(mapState.center, Math.round(mapState.zoom), heatmapCanvas);
    if (requestToken !== heatmapRefreshToken || !activeLocation) return;
    setHeatmapRetryDelay(1000);
    setLatestHeatmap(result.points);
    setLatestHeatmapMeta(result.meta);
    renderHeatmap(result.points, activeHeatmapLayer);
  } catch (error) {
    if (requestToken !== heatmapRefreshToken) return;
    addLog((error as Error).message || "Regional heatmap request failed", elements.eventLog);
    if (latestHeatmap?.length) {
      renderHeatmap(latestHeatmap, activeHeatmapLayer);
      scheduleHeatmapRetry();
      return;
    }
    setLatestHeatmap(null);
    setLatestHeatmapMeta(null);
    renderHeatmap(null, activeHeatmapLayer);
    scheduleHeatmapRetry();
  }
}

export function setLoadingState(message: string): void {
  if (activeLocation) {
    if (elements.heroLocation) elements.heroLocation.textContent = activeLocation.name;
    if (elements.heroKicker) elements.heroKicker.textContent = "Refreshing weather brief";
    if (elements.heroTimezone) elements.heroTimezone.textContent = activeLocation.timezone || "Local timezone pending";
  }
  if (elements.heroCopy) elements.heroCopy.innerHTML = `${spinner()} Pulling the latest forecast, regional map samples, and analysis tools for the selected location.`;
  if (elements.tempTrend) elements.tempTrend.innerHTML = `${spinner()} ${message}`;
  if (elements.pressureTrend) elements.pressureTrend.innerHTML = `${spinner()} Waiting for API response`;
  if (elements.windDirection) elements.windDirection.innerHTML = `${spinner()} Waiting for API response`;
  if (elements.watchCopy) elements.watchCopy.innerHTML = `${spinner()} Waiting for API response`;
}

export function applyForecastCacheStatus(forecast: Forecast): void {
  const cacheMeta = forecast.__precipCacheMeta;
  if (!cacheMeta?.stale) return;
  const ageMinutes = Math.max(1, Math.round((cacheMeta.age || 0) / 60000));
  if (elements.tempTrend) {
    elements.tempTrend.textContent = `Showing cached forecast from about ${ageMinutes} minute${ageMinutes === 1 ? "" : "s"} ago`;
  }
  addLog(`Using cached forecast data (${ageMinutes} minute${ageMinutes === 1 ? "" : "s"} old).`, elements.eventLog);
}

export function renderHeatmap(points: HeatmapSample[] | null, layer?: string): void {
  if (!heatmapCanvas) return;
  const ctx = heatmapCanvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = prepareCanvas(heatmapCanvas, ctx);
  const zoomRound = Math.round(mapState.zoom);
  const centerWorld = latLonToWorld(mapState.center.latitude, mapState.center.longitude, zoomRound);

  drawMapTiles(ctx, width, height, mapState.center, zoomRound, () => {
    queueMapRender(mapState, () => renderHeatmap(latestHeatmap, activeHeatmapLayer));
  });

  if (!points?.length) {
    drawMapOverlayText(ctx, width, "Regional weather layer unavailable");
  } else {
    const values = points.map((point) => getHeatmapValue(point, layer || activeHeatmapLayer, activeMapHourOffset));
    const finiteValues = values.filter((v): v is number => Number.isFinite(v));
    if (!finiteValues.length) {
      drawMapOverlayText(ctx, width, "Weather samples unavailable");
    } else {
      const min = Math.min(...finiteValues);
      const max = Math.max(...finiteValues);
      if (!mapState.drag) {
        drawHeatmapOverlay(ctx, points, values, layer || activeHeatmapLayer, min, max, width, height, mapState, mapState.center, zoomRound);
        renderMapReadout(layer || activeHeatmapLayer, min, max, latestHeatmapMeta, elements.mapReadout);
        renderHeatmapLegend(layer || activeHeatmapLayer, min, max, elements.heatmapLegend);
        updateMapHourLabel(activeMapHourOffset, latestHeatmap, elements.mapHourLabel);
      }
    }
  }

  drawMapPlaces(ctx, width, height, activeLocation, mapState, centerWorld);

  if (showAlerts) {
    const alertPolygons = drawMapAlertPolygons(ctx, width, height, centerWorld, zoomRound, getMapCenterAlerts());
    setAlertPolygonsCache(alertPolygons);
  } else {
    setAlertPolygonsCache([]);
  }

  if (showWildfires) {
    drawWildfireLayer(ctx, width, height, centerWorld, zoomRound);
  } else {
    setWildfireHitCache([], []);
  }

  if (showStormTracks) {
    drawStormTracks(ctx, width, height, centerWorld, zoomRound);
  }

}

function drawWildfireLayer(
  ctx: CanvasRenderingContext2D,
  width: number, height: number,
  centerWorld: { x: number; y: number },
  zoomRound: number,
): void {
  const features = getMapCenterWildfires();
  if (!features?.length) { setWildfireHitCache([], []); setWildfireScreenCache([], []); return; }

  const margin = 60;

  // Build center key for memoization
  const centerKey = `${centerWorld.x.toFixed(2)},${centerWorld.y.toFixed(2)}`;

  // Get memoization state
  const lastState = getLastWildfireState();
  const cacheHit =
    features === lastState.featuresRef &&
    centerKey === lastState.centerKey &&
    zoomRound === lastState.zoom &&
    width === lastState.width &&
    height === lastState.height;

  if (cacheHit) {
    // Use cached screen points and draw them
    const { hotspots, perimeters } = getWildfireScreenCache();
    drawCachedWildfires(ctx, hotspots, perimeters);
    return;
  }

  // Cache miss: compute screen points
  const hotspotCache: { x: number; y: number; radius: number; colorBucket: 0 | 1 | 2; feature: WildfireFeature }[] = [];
  const perimeterCache: { points: { x: number; y: number }[]; feature: WildfireFeature }[] = [];

  const now = Date.now();
  const CLUSTER_ZOOM = 7;
  const enableClustering = zoomRound < CLUSTER_ZOOM;
  const clusterGrid = new Map<string, { x: number; y: number; count: number; colorBucket: 0 | 1 | 2; features: WildfireFeature[] }>();

  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    const props = f.properties;

    if (g.type === "Point" && props.featureType === "hotspot") {
      const [lon, lat] = g.coordinates as number[];
      const { x, y } = projectToMapScreenFast(lat, lon, width, height, centerWorld, zoomRound);

      // Frustum culling for hotspots
      const hotspotMargin = 10;
      if (x < -hotspotMargin || x > width + hotspotMargin || y < -hotspotMargin || y > height + hotspotMargin) {
        continue;
      }

      const ageHours = props.date
        ? (now - new Date(props.date).getTime()) / 3600000
        : 999;
      const colorBucket = (ageHours < 6 ? 0 : ageHours < 24 ? 1 : 2) as 0 | 1 | 2;
      const radius = Math.max(3, Math.min(8, 6 / Math.pow(2, zoomRound - 8)));

      if (enableClustering) {
        // Cluster hotspots in grid cells
        const cellSize = 50 * Math.pow(2, CLUSTER_ZOOM - zoomRound);
        const cellX = Math.floor(x / cellSize);
        const cellY = Math.floor(y / cellSize);
        const cellKey = `${cellX},${cellY}`;
        const existing = clusterGrid.get(cellKey);
        if (existing) {
          existing.count += 1;
          existing.features.push(f);
          // Use the most recent color bucket (lowest number = most recent)
          if (colorBucket < existing.colorBucket) existing.colorBucket = colorBucket;
        } else {
          clusterGrid.set(cellKey, { x, y, count: 1, colorBucket, features: [f] });
        }
      } else {
        hotspotCache.push({ x, y, radius, colorBucket, feature: f });
      }
    } else if ((g.type === "Polygon" || g.type === "MultiPolygon") && props.featureType === "perimeter") {
      const allRings: number[][][] = [];
      if (g.type === "MultiPolygon") {
        for (const poly of g.coordinates as number[][][][]) {
          for (const ring of poly) {
            allRings.push(ring);
          }
        }
      } else {
        for (const ring of g.coordinates as number[][][]) {
          allRings.push(ring);
        }
      }
      for (const ring of allRings) {
        // Frustum cull per ring
        let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
        for (const coord of ring) {
          const lon = coord[0], lat = coord[1];
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
        }
        const nw = projectToMapScreenFast(maxLat, minLon, width, height, centerWorld, zoomRound);
        const ne = projectToMapScreenFast(maxLat, maxLon, width, height, centerWorld, zoomRound);
        const sw = projectToMapScreenFast(minLat, minLon, width, height, centerWorld, zoomRound);
        const se = projectToMapScreenFast(minLat, maxLon, width, height, centerWorld, zoomRound);
        const sx1 = Math.min(nw.x, ne.x, sw.x, se.x);
        const sy1 = Math.min(nw.y, ne.y, sw.y, se.y);
        const sx2 = Math.max(nw.x, ne.x, sw.x, se.x);
        const sy2 = Math.max(nw.y, ne.y, sw.y, se.y);
        if (sx2 < -margin || sx1 > width + margin || sy2 < -margin || sy1 > height + margin) {
          continue;
        }

        const screenPts: { x: number; y: number }[] = [];
        for (const coord of ring) {
          screenPts.push(projectToMapScreenFast(coord[1], coord[0], width, height, centerWorld, zoomRound));
        }
        if (screenPts.length < 3) continue;
        perimeterCache.push({ points: screenPts, feature: f });
      }
    }
  }

  // If clustering, convert clusters to hotspot cache
  if (enableClustering) {
    for (const cluster of clusterGrid.values()) {
      const avgX = cluster.x;
      const avgY = cluster.y;
      const clusterRadius = Math.max(4, Math.min(12, 8 / Math.pow(2, zoomRound - 8)));
      hotspotCache.push({
        x: avgX,
        y: avgY,
        radius: clusterRadius,
        colorBucket: cluster.colorBucket,
        feature: cluster.features[0], // Use first feature for hit testing
      });
    }
  }

  // Update hit-test caches (use original unclustered for accurate hit testing)
  setWildfireHitCache(
    enableClustering
      ? Array.from(clusterGrid.values()).map(c => ({ x: c.x, y: c.y, radius: Math.max(4, Math.min(12, 8 / Math.pow(2, zoomRound - 8))), feature: c.features[0] }))
      : hotspotCache.map(h => ({ x: h.x, y: h.y, radius: h.radius, feature: h.feature })),
    perimeterCache
  );

  // Update memoization screen caches
  setWildfireScreenCache(hotspotCache, perimeterCache);

  // Draw the computed points
  drawCachedWildfires(ctx, hotspotCache, perimeterCache);

  // Update memoization state
  setLastWildfireState(features, centerKey, zoomRound, width, height);
}

export function renderHeatmapLoading(message = "Loading regional weather layer"): void {
  if (!heatmapCanvas) return;
  const ctx = heatmapCanvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = prepareCanvas(heatmapCanvas, ctx);
  drawMapTiles(ctx, width, height, mapState.center, Math.round(mapState.zoom), () => {});
  drawMapOverlayText(ctx, width, `${message}...`);
  showToast(message, "info", 2000);
}

export function setActiveHeatmapLayer(layer: string, options: { persist?: boolean } = {}): void {
  setActiveHeatmapLayerState(layer);
  heatmapButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.layer === layer);
  });
  if (elements.settingsMapLayer) elements.settingsMapLayer.value = layer;
  if (options.persist) saveAppSettings({ mapLayer: layer as AppSettings["mapLayer"] });
  if (latestHeatmap) renderHeatmap(latestHeatmap, activeHeatmapLayer);
}

export function setActiveMapHourOffset(offset: number, options: { persist?: boolean } = {}): void {
  setActiveMapHourOffsetState(Math.max(0, Math.min(23, Math.round(offset))));
  if (elements.mapHourSlider) elements.mapHourSlider.value = String(activeMapHourOffset);
  if (elements.settingsStartHour) elements.settingsStartHour.value = String(activeMapHourOffset);
  hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
  if (options.persist) saveAppSettings({ mapHourOffset: activeMapHourOffset });
  if (latestHeatmap) renderHeatmap(latestHeatmap, activeHeatmapLayer);
}

export function toggleMapAnimation(): void {
  if (mapAnimationPlaying) {
    setMapAnimationPlaying(false);
    if (mapAnimationTimer) clearInterval(mapAnimationTimer);
    setMapAnimationTimer(null);
    if (elements.mapPlayButton) {
      elements.mapPlayButton.classList.remove("playing");
      elements.mapPlayButton.innerHTML = "&#9654;";
    }
    return;
  }
  setMapAnimationPlaying(true);
  if (elements.mapPlayButton) {
    elements.mapPlayButton.classList.add("playing");
    elements.mapPlayButton.innerHTML = "&#10074;&#10074;";
  }
  setMapAnimationTimer(setInterval(() => {
    const next = parseInt(elements.mapHourSlider?.value || "0", 10) + 1;
    setActiveMapHourOffset(next > 23 ? 0 : next);
  }, 1200));
}
