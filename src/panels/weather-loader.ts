import type { Location } from "../types";
import { elements, mapState } from "../state";
import { getAppSettings } from "../storage";
import { fetchForecast, fetchAirQuality, fetchAlerts, fetchSpcOutlook } from "../api";
import { fetchHeatmap } from "../heatmap";
import { resolveLocation, reverseGeocodeLocation } from "../search";
import { updateNwsAlerts, setLatestSpcCat, setLatestSpcTorn, renderSpcOutlook, setMapCenterAlerts } from "../alerts";
import { updateSatelliteForLocation, setSatelliteTabLoaded } from "../satellite";
import { updateCurrentConditions, updateWeatherWarning, setWarningBarStandby, updateWarningBar } from "../panels/now";
import { renderPatterns, renderStormToolkit, renderConfidence, renderContext } from "../panels/trends";
import { renderDailyForecast, renderWeeklyForecast, renderHourlyForecast } from "../panels/forecast";
import { drawForecastChart } from "../panels/chart";
import {
  updateSettingsUI, renderWatchlistUI, saveForecastSnapshot,
  setLoadingState, applyForecastCacheStatus,
  setActiveHeatmapLayer, setActiveMapHourOffset,
  renderHeatmap, renderHeatmapLoading,
} from "../panels/data";
import { addLog, showToast } from "../ui";
import {
  latestHeatmap, latestAirQuality, latestForecast,
  weatherLoadId, heatmapCanvas,
  setActiveLocation, setLatestForecast, setLatestHeatmap, setLatestHeatmapMeta, setLatestAirQuality,
  setWeatherLoadId,
} from "../state";

export async function loadWeather(query: Location | string): Promise<void> {
  try {
    const requestId = weatherLoadId + 1;
    setWeatherLoadId(requestId);
    const queryLabel = typeof query === "string" ? query : (query as Location).name;
    const settings = getAppSettings();
    addLog(`Loading weather data for ${queryLabel}.`, elements.eventLog);
    const resolved = typeof query === "string" ? await resolveLocation(query, elements.eventLog) : query;
    setActiveLocation(resolved);
    setLoadingState(`Loading live weather data for ${resolved.name}`);
    setSatelliteTabLoaded(false);
    const overlayVisible = elements.satelliteOverlay && !elements.satelliteOverlay.hidden;
    if (overlayVisible) {
      setSatelliteTabLoaded(true);
      updateSatelliteForLocation(resolved, {
        satelliteStatus: elements.satelliteStatus,
        satelliteCopy: elements.satelliteCopy,
        satelliteEmpty: elements.satelliteEmpty,
        satelliteImage: elements.satelliteImage,
        satelliteProductSelect: elements.satelliteProductSelect,
        satelliteSectorSelect: elements.satelliteSectorSelect,
        satelliteLink: elements.satelliteLink,
      });
    }
    updateSettingsUI();
    setActiveMapHourOffset(settings.mapHourOffset);
    setActiveHeatmapLayer(settings.mapLayer);
    const forecast = await fetchForecast(resolved);
    setLatestForecast(forecast);
    if (requestId !== weatherLoadId) return;
    updateCurrentConditions(resolved, forecast);
    applyForecastCacheStatus(forecast);
    setWarningBarStandby();
    renderPatterns(forecast);
    renderStormToolkit(forecast);
    renderConfidence(forecast);
    renderContext(forecast);
    mapState.center = { latitude: resolved.latitude, longitude: resolved.longitude };
    mapState.selected = resolved;
    setLatestAirQuality(null);
    setLatestHeatmap(null);
    setLatestHeatmapMeta(null);
    setMapCenterAlerts(null);
    setLatestSpcCat(null);
    setLatestSpcTorn(null);
    if (elements.airGrid) elements.airGrid.innerHTML = `<div class="empty-signal">Loading air quality data.</div>`;
    if (elements.tornadoGrid) elements.tornadoGrid.innerHTML = `<div class="empty-signal">Loading SPC outlook data.</div>`;
    renderHeatmapLoading();
    renderHourlyForecast(forecast);
    renderDailyForecast(forecast);
    renderWeeklyForecast(forecast);
    drawForecastChart(forecast);
    saveForecastSnapshot(resolved, forecast);
    renderWatchlistUI();
    updateSettingsUI();
    showToast(`Weather data loaded for ${resolved.name}`, "success", 2500);
    addLog(`Live Open-Meteo feed updated for ${resolved.name}.`, elements.eventLog);
    void hydrateSupplementalWeather(resolved, requestId);
  } catch (error) {
    showToast((error as Error).message, "error", 4000);
    addLog((error as Error).message, elements.eventLog);
  }
}

export async function hydrateSupplementalWeather(location: Location, requestId: number): Promise<void> {
  const [airResult, heatmapResult, alertsResult] = await Promise.allSettled([
    fetchAirQuality(location),
    fetchHeatmap(mapState.center, Math.round(mapState.zoom), heatmapCanvas),
    fetchAlerts(location),
  ]);

  if (requestId !== weatherLoadId) return;

  if (airResult.status === "fulfilled") {
    setLatestAirQuality(airResult.value);
  } else {
    setLatestAirQuality(null);
    addLog((airResult.reason as Error)?.message || "Air quality request failed", elements.eventLog);
  }
  const { renderAirQuality } = await import("../panels/trends");
  renderAirQuality(latestAirQuality);

  if (heatmapResult.status === "fulfilled") {
    setLatestHeatmap(heatmapResult.value.points);
    setLatestHeatmapMeta(heatmapResult.value.meta);
  } else {
    setLatestHeatmap(null);
    setLatestHeatmapMeta(null);
    addLog((heatmapResult.reason as Error)?.message || "Regional heatmap request failed", elements.eventLog);
  }
  renderHeatmap(latestHeatmap);

  if (alertsResult.status === "fulfilled") {
    if (alertsResult.value.length) {
      updateNwsAlerts(alertsResult.value, elements as unknown as Record<string, HTMLElement | null>, showToast, updateWarningBar);
      if (latestHeatmap) renderHeatmap(latestHeatmap);
    } else {
      const alertBadge = document.querySelector('.tab-button[data-tab="now"] .alert-badge');
      if (alertBadge) alertBadge.remove();
      if (latestForecast) updateWeatherWarning(latestForecast);
    }
  } else {
    addLog((alertsResult.reason as Error)?.message || "Weather alerts request failed", elements.eventLog);
    if (latestForecast) updateWeatherWarning(latestForecast);
  }

  const [spcCatResult, spcTornResult] = await Promise.allSettled([
    fetchSpcOutlook("1"),
    fetchSpcOutlook("3"),
  ]);
  if (requestId !== weatherLoadId) return;
  setLatestSpcCat(spcCatResult.status === "fulfilled" ? spcCatResult.value : null);
  setLatestSpcTorn(spcTornResult.status === "fulfilled" ? spcTornResult.value : null);

  if (elements.tornadoGrid) {
    elements.tornadoGrid.innerHTML = renderSpcOutlook(mapState.center);
  }
}

export async function selectMapLocation(latitude: number, longitude: number): Promise<void> {
  try {
    addLog(`Looking up ${latitude.toFixed(3)}, ${longitude.toFixed(3)} from map click.`, elements.eventLog);
    const location = await reverseGeocodeLocation(latitude, longitude);
    if (elements.locationInput) {
      elements.locationInput.value = [location.name, location.admin, location.country].filter(Boolean).join(", ");
    }
    await loadWeather(location);
  } catch (error) {
    addLog((error as Error).message, elements.eventLog);
  }
}
