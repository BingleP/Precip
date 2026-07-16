import type { Location, Forecast, WatchlistItem, ForecastSnapshot, AppSettings, HeatmapSample } from "../types";
import { elements, activeLocation, latestForecast, mapState, heatmapCanvas, heatmapButtons } from "../state";
import { MAX_HISTORY_ITEMS } from "../config";
import {
  getWatchlist, saveWatchlist, getForecastHistory, saveForecastHistory,
  getPreferredLocation, getAppSettings, savePreferredLocation, saveAppSettings,
  removeCookieValue, formatSavedLocation,
} from "../storage";
import { fetchHeatmap } from "../heatmap";
import {
  calculateStormRisk, formatTemp, formatSpeed, formatPrecip,
  formatPressure, describeWeatherCode, maxNext, sumNext, isImperial,
} from "../weather";
import { addLog, spinner, escapeHTML, showToast, prepareCanvas } from "../ui";
import {
  drawMapTiles, drawMapOverlayText, drawHeatmapOverlay,
  drawMapPlaces, queueMapRender,
  renderMapReadout, renderHeatmapLegend, updateMapHourLabel,
  hideMapTooltip,
} from "../map";
import { drawMapAlertPolygons, getMapCenterAlerts, setAlertPolygonsCache } from "../alerts";
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

export function renderForecastHistoryUI(history = getForecastHistory()): void {
  if (!elements.historyList) return;
  if (!history.length) {
    elements.historyList.innerHTML = `<div class="empty-signal">No forecast snapshots saved yet.</div>`;
    return;
  }

  elements.historyList.innerHTML = history
    .map(
      (item) => `
        <div class="history-row">
          <div class="history-date">${new Date(item.savedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
          <div class="history-location" title="${escapeHTML(item.location)}">${escapeHTML(item.location)}</div>
          <div class="history-meta">
            <span>Now <strong>${formatTemp(item.temperature)}</strong></span>
            <span>Pressure <strong>${formatPressure(item.pressure)}</strong></span>
            <span>Today <strong>${isImperial() ? `${Math.round(item.todayHigh * 9 / 5 + 32)}°F / ${Math.round(item.todayLow * 9 / 5 + 32)}°F` : `${Math.round(item.todayHigh)}°C / ${Math.round(item.todayLow)}°C`}</strong></span>
            <span>Precip <strong>${formatPrecip(item.todayPrecip)}</strong></span>
            <span>Cond <strong>${escapeHTML(item.condition)}</strong></span>
          </div>
        </div>
      `,
    )
    .join("");
}

export function saveForecastSnapshot(location: Location, forecast: Forecast): void {
  const current = forecast.current;
  const daily = forecast.daily;
  const snapshot: ForecastSnapshot = {
    id: `${Date.now()}`,
    savedAt: new Date().toISOString(),
    location: [location.name, location.admin, location.country].filter(Boolean).join(", "),
    temperature: current.temperature_2m,
    pressure: current.pressure_msl,
    wind: current.wind_speed_10m,
    todayHigh: daily.temperature_2m_max[0],
    todayLow: daily.temperature_2m_min[0],
    todayPrecip: daily.precipitation_sum[0],
    todayChance: daily.precipitation_probability_max[0],
    condition: describeWeatherCode(daily.weather_code[0]),
  };

  try {
    const existing = getForecastHistory();
    const next = [snapshot, ...existing].slice(0, MAX_HISTORY_ITEMS);
    saveForecastHistory(next);
    renderForecastHistoryUI(next);
  } catch {
    addLog("Forecast history could not be saved in this browser.", elements.eventLog);
  }
}

export function clearSavedWatchlist(): void {
  removeCookieValue("precip.watchlist.v1");
  try { window.localStorage.removeItem("precip.watchlist.v1"); } catch {}
  renderWatchlistUI([]);
  addLog("Pinned locations cleared.", elements.eventLog);
}

export function clearSavedHistory(): void {
  removeCookieValue("precip.forecastHistory.v1");
  try { window.localStorage.removeItem("precip.forecastHistory.v1"); } catch {}
  renderForecastHistoryUI([]);
  addLog("Forecast history cleared.", elements.eventLog);
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

  drawMapTiles(ctx, width, height, mapState.center, Math.round(mapState.zoom), () => {
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
        drawHeatmapOverlay(ctx, points, values, layer || activeHeatmapLayer, min, max, width, height, mapState, mapState.center, Math.round(mapState.zoom));
        renderMapReadout(layer || activeHeatmapLayer, min, max, latestHeatmapMeta, elements.mapReadout);
        renderHeatmapLegend(layer || activeHeatmapLayer, min, max, elements.heatmapLegend);
        updateMapHourLabel(activeMapHourOffset, latestHeatmap, elements.mapHourLabel);
      }
    }
  }

  drawMapPlaces(ctx, width, height, activeLocation, mapState);

  const alertPolygons = drawMapAlertPolygons(ctx, width, height, mapState.center.latitude, mapState.center.longitude, Math.round(mapState.zoom), getMapCenterAlerts());
  setAlertPolygonsCache(alertPolygons);

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
