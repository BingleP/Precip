// Bootstrap redirect: if no saved location, send to welcome page
if (!document.cookie.split("; ").find((row) => row.startsWith("precip.preferredLocation.v1="))) {
  if (!window.location.pathname.includes("welcome")) {
    window.location.replace("welcome.html");
  }
}

import type {
  Location, Forecast, AirQuality, HeatmapSample, HeatmapResult,
  AppSettings, NwsAlert, MapState, AlertPolygon, WatchlistItem,
} from "./types";
import {
  HOURS_TO_SHOW, MAP_DEFAULT_ZOOM, MAP_MIN_ZOOM, MAP_MAX_ZOOM,
  INITIAL_MAP_CENTER, NOAA_SECTORS, MAX_HISTORY_ITEMS,
} from "./config";
import {
  getAppSettings, saveAppSettings, getPreferredLocation, savePreferredLocation,
  getWatchlist, saveWatchlist, getForecastHistory, saveForecastHistory,
  removeCookieValue, formatSavedLocation,
} from "./storage";
import {
  fetchForecast, fetchAirQuality, fetchAlerts, fetchSpcOutlook,
  fetchNoaaSectorCatalog,
} from "./api";
import {
  reverseGeocodeLocation, geocodeLocationCandidates, resolveLocation,
  searchLocationSuggestions, selectLocationSuggestion, clearLocationSuggestions,
  renderLocationSuggestions,
} from "./search";
import {
  updateNwsAlerts, renderSpcOutlook, getLatestAlerts, setLatestAlerts,
  getLatestSpcCat, setLatestSpcCat, getLatestSpcTorn, setLatestSpcTorn,
  setAlertPolygonsCache, drawMapAlertPolygons,
} from "./alerts";
import {
  updateSatelliteForLocation, loadSatelliteSector, getNoaaSectorById,
  isSatelliteTabLoaded, setSatelliteTabLoaded, setActiveSatelliteProductKey,
  getActiveSatelliteSectorId, renderSatelliteProductOptions, renderSatelliteImage,
} from "./satellite";
import {
  getHeatmapViewportDefinition, buildHeatmapPoints, fetchHeatmap,
} from "./heatmap";
import {
  getMapState, tileCache, drawMapTiles, drawMapOverlayText,
  drawMapPlaces, drawHeatmapOverlay, zoomMap, queueMapRender,
  startMapDrag, moveMapDrag, endMapDrag, resetMapView,
  updateMapTooltip, hideMapTooltip, renderMapReadout,
  renderHeatmapLegend, updateMapHourLabel,
} from "./map";
import {
  calculateStormRisk, findCurrentIndex, formatTemp, formatSpeed,
  formatPrecip, formatPressure, formatNumber, formatHeatmapValue,
  describeWeatherCode, formatDay, getHeatmapValue, isImperial,
  getCurrentHourlyIndex, hourlyValue, maxNext, sumNext,
  getPrecipBarClass, degreesToCompass,
} from "./weather";
import {
  addLog, showToast, escapeHTML, normalizeSearchText,
  formatLocationLabel, spinner, selectTab, togglePanel,
  prepareCanvas, roundedRect,
} from "./ui";
import { projectToMapScreen, screenToMapLocation, latLonToWorld } from "./geo";
import { chartState, createChartState } from "./chart";
import {
  exportSettingsPreset, importSettingsPreset,
} from "./settings";

let activeLocation: Location | null = null;
let latestForecast: Forecast | null = null;
let latestHeatmap: HeatmapSample[] | null = null;
let latestHeatmapMeta: HeatmapResult["meta"] | null = null;
let latestAirQuality: AirQuality | null = null;
let activeHeatmapLayer = "temperature";
let activeMapHourOffset = 0;

const mapState: MapState = getMapState();
const activePointers = new Map<number, { x: number; y: number }>();
let pinchStartDist = 0;
let pinchStartZoom = MAP_DEFAULT_ZOOM;
let weatherLoadId = 0;
let heatmapRefreshToken = 0;
let heatmapRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let heatmapRetryDelay = 1000;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let searchRequestToken = 0;
let activeLocationSuggestions: Location[] = [];
let selectedLocationSuggestion: Location | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
let mapAnimationTimer: ReturnType<typeof setInterval> | null = null;
let mapAnimationPlaying = false;
let tooltipRaf: number | null = null;
const cachedMetricUnits = [...document.querySelectorAll(".metric-card .metric-unit")] as HTMLElement[];
let satelliteOverlayDrag: { startX: number; startY: number; left: number; top: number } | null = null;
let satelliteOverlayResizeDrag: { startX: number; startY: number; width: number; height: number } | null = null;

const elements = {
  stationTitle: document.querySelector("#station-title") as HTMLElement | null,
  stationCopy: document.querySelector("#station-copy") as HTMLElement | null,
  stationCoordinates: document.querySelector("#station-coordinates") as HTMLElement | null,
  updatedAt: document.querySelector("#updated-at") as HTMLElement | null,
  heroKicker: document.querySelector("#hero-kicker") as HTMLElement | null,
  heroLocation: document.querySelector("#hero-location") as HTMLElement | null,
  heroCopy: document.querySelector("#hero-copy") as HTMLElement | null,
  heroTimezone: document.querySelector("#hero-timezone") as HTMLElement | null,
  temperature: document.querySelector("#temperature") as HTMLElement | null,
  currentCondition: document.querySelector("#current-condition") as HTMLElement | null,
  conditionCopy: document.querySelector("#condition-copy") as HTMLElement | null,
  pressure: document.querySelector("#pressure") as HTMLElement | null,
  wind: document.querySelector("#wind") as HTMLElement | null,
  windCompass: document.querySelector("#wind-compass") as HTMLElement | null,
  tempTrend: document.querySelector("#temp-trend") as HTMLElement | null,
  pressureTrend: document.querySelector("#pressure-trend") as HTMLElement | null,
  windDirection: document.querySelector("#wind-direction") as HTMLElement | null,
  humidity: document.querySelector("#humidity") as HTMLElement | null,
  humidityTrend: document.querySelector("#humidity-trend") as HTMLElement | null,
  watchLevel: document.querySelector("#watch-level") as HTMLElement | null,
  watchCopy: document.querySelector("#watch-copy") as HTMLElement | null,
  warningBar: document.querySelector("#weather-warning") as HTMLElement | null,
  warningLabel: document.querySelector("#warning-label") as HTMLElement | null,
  warningTitle: document.querySelector("#warning-title") as HTMLElement | null,
  warningCopy: document.querySelector("#warning-copy") as HTMLElement | null,
  eventLog: document.querySelector("#event-log") as HTMLElement | null,
  patternList: document.querySelector("#pattern-list") as HTMLElement | null,
  dailyGrid: document.querySelector("#daily-grid") as HTMLElement | null,
  weeklyList: document.querySelector("#weekly-list") as HTMLElement | null,
  historyList: document.querySelector("#history-list") as HTMLElement | null,
  hourlyStrip: document.querySelector("#hourly-strip") as HTMLElement | null,
  refreshButton: document.querySelector("#refresh-button") as HTMLElement | null,
  clearHistoryButton: document.querySelector("#clear-history-button") as HTMLElement | null,
  chartTooltip: document.querySelector("#chart-tooltip") as HTMLElement | null,
  heatmapLegend: document.querySelector("#heatmap-legend") as HTMLElement | null,
  mapHourSlider: document.querySelector("#map-hour-slider") as HTMLInputElement | null,
  mapHourLabel: document.querySelector("#map-hour-label") as HTMLElement | null,
  mapPlayButton: document.querySelector("#map-play-button") as HTMLElement | null,
  mapReadout: document.querySelector("#map-readout") as HTMLElement | null,
  mapTooltip: document.querySelector("#map-tooltip") as HTMLElement | null,
  mapHoverIndicator: document.querySelector("#map-hover-indicator") as HTMLElement | null,
  mapTitle: document.querySelector("#map-title") as HTMLElement | null,
  mapCopy: document.querySelector("#map-copy") as HTMLElement | null,
  mapZoomIn: document.querySelector("#map-zoom-in") as HTMLElement | null,
  mapZoomOut: document.querySelector("#map-zoom-out") as HTMLElement | null,
  mapReset: document.querySelector("#map-reset") as HTMLElement | null,
  satelliteStatus: document.querySelector("#satellite-status") as HTMLElement | null,
  satelliteCopy: document.querySelector("#satellite-copy") as HTMLElement | null,
  satelliteSectorSelect: document.querySelector("#satellite-sector-select") as HTMLSelectElement | null,
  satelliteProductSelect: document.querySelector("#satellite-product-select") as HTMLSelectElement | null,
  satelliteLink: document.querySelector("#satellite-link") as HTMLAnchorElement | null,
  satelliteImage: document.querySelector("#satellite-image") as HTMLImageElement | null,
  satelliteEmpty: document.querySelector("#satellite-empty") as HTMLElement | null,
  locationForm: document.querySelector("#location-form") as HTMLFormElement | null,
  locationInput: document.querySelector("#location-input") as HTMLInputElement | null,
  locationSearchNote: document.querySelector("#location-search-note") as HTMLElement | null,
  locationSuggestions: document.querySelector("#location-suggestions") as HTMLElement | null,
  defaultLocationLabel: document.querySelector("#default-location-label") as HTMLElement | null,
  setDefaultLocationButton: document.querySelector("#set-default-location-button") as HTMLButtonElement | null,
  resetDefaultLocationButton: document.querySelector("#reset-default-location-button") as HTMLButtonElement | null,
  settingsMapLayer: document.querySelector("#settings-map-layer") as HTMLSelectElement | null,
  settingsStartHour: document.querySelector("#settings-start-hour") as HTMLSelectElement | null,
  clearWatchlistButton: document.querySelector("#clear-watchlist-button") as HTMLButtonElement | null,
  clearHistorySettingsButton: document.querySelector("#clear-history-settings-button") as HTMLButtonElement | null,
  exportSettingsButton: document.querySelector("#export-settings-button") as HTMLButtonElement | null,
  importSettingsButton: document.querySelector("#import-settings-button") as HTMLButtonElement | null,
  importSettingsFile: document.querySelector("#import-settings-file") as HTMLInputElement | null,
  stormHeading: document.querySelector("#storm-heading") as HTMLElement | null,
  stormGrid: document.querySelector("#storm-grid") as HTMLElement | null,
  stormSignals: document.querySelector("#storm-signals") as HTMLElement | null,
  stormRiskBadge: document.querySelector("#storm-risk-badge") as HTMLElement | null,
  stormRiskFill: document.querySelector("#storm-risk-fill") as HTMLElement | null,
  airGrid: document.querySelector("#air-grid") as HTMLElement | null,
  confidenceGrid: document.querySelector("#confidence-grid") as HTMLElement | null,
  contextGrid: document.querySelector("#context-grid") as HTMLElement | null,
  watchlistGrid: document.querySelector("#watchlist-grid") as HTMLElement | null,
  pinLocationButton: document.querySelector("#pin-location-button") as HTMLButtonElement | null,
  tornadoGrid: document.querySelector("#tornado-grid") as HTMLElement | null,
  satelliteOverlay: document.querySelector("#satellite-overlay") as HTMLElement | null,
  satelliteOverlayHeader: document.querySelector("#satellite-overlay-header") as HTMLElement | null,
  satelliteOverlayClose: document.querySelector("#satellite-overlay-close") as HTMLButtonElement | null,
  satelliteOverlayResize: document.querySelector("#satellite-overlay-resize") as HTMLElement | null,
};

const chartCanvas = document.querySelector("#weather-chart") as HTMLCanvasElement;
const heatmapCanvas = document.querySelector("#heatmap-canvas") as HTMLCanvasElement;

const heatmapButtons = [...document.querySelectorAll(".heatmap-button")] as HTMLElement[];

// Initialize satellite sector select
if (elements.satelliteSectorSelect) {
  elements.satelliteSectorSelect.innerHTML = NOAA_SECTORS
    .map((sector) => `<option value="${sector.id}">${sector.name} (${sector.sat})</option>`)
    .join("");
}

function updateWarningBar(level: string, label: string, title: string, copy: string): void {
  if (elements.warningBar) elements.warningBar.className = `weather-warning ${level}`;
  if (elements.warningLabel) elements.warningLabel.textContent = label;
  if (elements.warningTitle) elements.warningTitle.textContent = title;
  if (elements.warningCopy) elements.warningCopy.textContent = copy;
}

function renderHeatmap(points: HeatmapSample[] | null = latestHeatmap, layer = activeHeatmapLayer): void {
  if (!heatmapCanvas) return;
  const ctx = heatmapCanvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = prepareCanvas(heatmapCanvas, ctx);

  drawMapTiles(ctx, width, height, mapState.center, Math.round(mapState.zoom), () => {
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  });

  if (!points?.length) {
    drawMapOverlayText(ctx, width, "Regional weather layer unavailable");
    return;
  }

  const values = points.map((point) => getHeatmapValue(point, layer, activeMapHourOffset));
  const finiteValues = values.filter((v): v is number => Number.isFinite(v));
  if (!finiteValues.length) {
    drawMapOverlayText(ctx, width, "Weather samples unavailable");
    return;
  }

  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);

  if (!mapState.drag) {
    drawHeatmapOverlay(ctx, points, values, layer, min, max, width, height, mapState, mapState.center, Math.round(mapState.zoom));
  }
  drawMapPlaces(ctx, width, height, activeLocation, mapState);

  const alertPolygons = drawMapAlertPolygons(ctx, width, height, mapState.center.latitude, mapState.center.longitude, Math.round(mapState.zoom));
  setAlertPolygonsCache(alertPolygons);

  if (!mapState.drag) {
    renderMapReadout(layer, min, max, latestHeatmapMeta, elements.mapReadout);
    renderHeatmapLegend(layer, min, max, elements.heatmapLegend);
    updateMapHourLabel(activeMapHourOffset, latestHeatmap, elements.mapHourLabel);
  }
}

function renderHeatmapLoading(message = "Loading regional weather layer"): void {
  if (!heatmapCanvas) return;
  const ctx = heatmapCanvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = prepareCanvas(heatmapCanvas, ctx);
  drawMapTiles(ctx, width, height, mapState.center, Math.round(mapState.zoom), () => {});
  drawMapOverlayText(ctx, width, `${message}...`);
  showToast(message, "info", 2000);
}

function setActiveHeatmapLayer(layer: string, options: { persist?: boolean } = {}): void {
  activeHeatmapLayer = layer;
  heatmapButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.layer === layer);
  });
  if (elements.settingsMapLayer) elements.settingsMapLayer.value = layer;
  if (options.persist) saveAppSettings({ mapLayer: layer as AppSettings["mapLayer"] });
  if (latestHeatmap) renderHeatmap(latestHeatmap, activeHeatmapLayer);
}

function setActiveMapHourOffset(offset: number, options: { persist?: boolean } = {}): void {
  activeMapHourOffset = Math.max(0, Math.min(23, Math.round(offset)));
  if (elements.mapHourSlider) elements.mapHourSlider.value = String(activeMapHourOffset);
  if (elements.settingsStartHour) elements.settingsStartHour.value = String(activeMapHourOffset);
  hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
  if (options.persist) saveAppSettings({ mapHourOffset: activeMapHourOffset });
  if (latestHeatmap) renderHeatmap(latestHeatmap, activeHeatmapLayer);
}

function toggleMapAnimation(): void {
  if (mapAnimationPlaying) {
    mapAnimationPlaying = false;
    if (mapAnimationTimer) clearInterval(mapAnimationTimer);
    mapAnimationTimer = null;
    if (elements.mapPlayButton) {
      elements.mapPlayButton.classList.remove("playing");
      elements.mapPlayButton.innerHTML = "&#9654;";
    }
    return;
  }
  mapAnimationPlaying = true;
  if (elements.mapPlayButton) {
    elements.mapPlayButton.classList.add("playing");
    elements.mapPlayButton.innerHTML = "&#10074;&#10074;";
  }
  mapAnimationTimer = setInterval(() => {
    const next = parseInt(elements.mapHourSlider?.value || "0", 10) + 1;
    setActiveMapHourOffset(next > 23 ? 0 : next);
  }, 1200);
}

function updateSettingsUI(): void {
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

function updateCurrentConditions(location: Location, forecast: Forecast): void {
  const current = forecast.current;
  const hourly = forecast.hourly;
  const daily = forecast.daily;
  const currentIndex = findCurrentIndex(hourly.time);
  const previousIndex = Math.max(0, currentIndex - 3);
  const nextIndex = Math.min(hourly.time.length - 1, currentIndex + 1);

  const temperatureDelta = current.temperature_2m - hourly.temperature_2m[previousIndex];
  const pressureDelta = current.pressure_msl - hourly.pressure_msl[previousIndex];
  const nextPrecip = hourly.precipitation[nextIndex] ?? current.precipitation;
  const nextPrecipChance = hourly.precipitation_probability[nextIndex];

  const imp = isImperial();
  const placeName = [location.name, location.admin, location.country].filter(Boolean).join(", ");
  const regionalName = [location.admin, location.country].filter(Boolean).join(", ");

  if (elements.stationTitle) elements.stationTitle.textContent = placeName;
  if (elements.stationCopy) elements.stationCopy.textContent = `Live forecast feed for ${location.name}. Hardware receiver feed is separate.`;
  if (elements.stationCoordinates) elements.stationCoordinates.textContent = `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`;
  if (elements.updatedAt) elements.updatedAt.textContent = new Date(current.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (elements.heroKicker) elements.heroKicker.textContent = regionalName ? `Live weather brief for ${regionalName}` : "Live weather brief";
  if (elements.heroLocation) elements.heroLocation.textContent = location.name;
  if (elements.heroTimezone) elements.heroTimezone.textContent = location.timezone || forecast.timezone || "Local timezone unavailable";

  const hi = imp ? `${Math.round(daily.temperature_2m_max[0] * 9 / 5 + 32)}°F` : `${Math.round(daily.temperature_2m_max[0])}°C`;
  const lo = imp ? `${Math.round(daily.temperature_2m_min[0] * 9 / 5 + 32)}°F` : `${Math.round(daily.temperature_2m_min[0])}°C`;
  const currentConditionText = describeWeatherCode(current.weather_code);
  const dailyConditionText = describeWeatherCode(daily.weather_code[0]);
  if (elements.heroCopy) elements.heroCopy.textContent = currentConditionText === dailyConditionText
    ? `${currentConditionText} with ${hi} / ${lo} today. Next-hour precipitation signal is ${Number.isFinite(nextPrecipChance) ? `${nextPrecipChance}%` : "unavailable"}.`
    : `${currentConditionText} now. Today: ${dailyConditionText}, ${hi} / ${lo}. Next-hour precipitation signal is ${Number.isFinite(nextPrecipChance) ? `${nextPrecipChance}%` : "unavailable"}.`;

  if (elements.mapTitle) elements.mapTitle.textContent = `${location.name} Regional Weather Field`;
  if (elements.mapCopy) elements.mapCopy.textContent = `Interactive forecast map centered on ${placeName}. Click any point on the map to switch the briefing to that area.`;
  if (elements.locationInput) elements.locationInput.value = placeName;

  if (elements.temperature) elements.temperature.textContent = formatNumber(current.temperature_2m);

  const peekTemp = document.querySelector("#peek-temp") as HTMLElement | null;
  const peekCondition = document.querySelector("#peek-condition") as HTMLElement | null;
  if (peekTemp) peekTemp.textContent = formatTemp(current.temperature_2m);
  if (peekCondition) peekCondition.textContent = describeWeatherCode(current.weather_code);

  if (elements.currentCondition) elements.currentCondition.textContent = describeWeatherCode(current.weather_code);
  if (elements.conditionCopy) elements.conditionCopy.textContent = `${imp ? `${Math.round(daily.temperature_2m_max[0] * 9 / 5 + 32)}°F` : `${Math.round(daily.temperature_2m_max[0])}°C`} high, ${imp ? `${Math.round(daily.temperature_2m_min[0] * 9 / 5 + 32)}°F` : `${Math.round(daily.temperature_2m_min[0])}°C`} low today`;

  if (elements.pressure) elements.pressure.textContent = imp ? (current.pressure_msl / 33.864).toFixed(2) : String(Math.round(current.pressure_msl));
  if (elements.wind) elements.wind.textContent = imp ? String(Math.round(current.wind_speed_10m / 1.609)) : String(Math.round(current.wind_speed_10m));
  if (elements.windCompass) elements.windCompass.textContent = degreesToCompass(current.wind_direction_10m);

  if (elements.tempTrend) elements.tempTrend.textContent = `${temperatureDelta >= 0 ? "Warming" : "Cooling"} ${Math.abs(temperatureDelta).toFixed(1)}${imp ? "°F" : "°C"} in 3h`;
  if (elements.pressureTrend) elements.pressureTrend.textContent = `${pressureDelta >= 0 ? "Rising" : "Falling"} ${Math.abs(pressureDelta).toFixed(1)}${imp ? " inHg" : " hPa"} in 3h`;
  if (elements.windDirection) elements.windDirection.textContent = `From ${Math.round(current.wind_direction_10m)}° with gusts to ${formatSpeed(current.wind_gusts_10m)}`;

  cachedMetricUnits.forEach((el) => {
    const card = el.closest(".metric-card");
    if (!card) return;
    const label = card.querySelector("span:first-child")?.textContent;
    if (label === "Temperature") el.textContent = imp ? "°F" : "°C";
    else if (label === "Pressure") el.textContent = imp ? " inHg" : " hPa";
    else if (label === "Wind") el.textContent = imp ? " mph" : " km/h";
    else if (label?.includes("Precip")) el.textContent = imp ? " in" : " mm";
  });

  if (elements.humidity) elements.humidity.textContent = Number.isFinite(current.relative_humidity_2m) ? String(Math.round(current.relative_humidity_2m)) : "--";
  if (elements.humidityTrend) elements.humidityTrend.textContent = Number.isFinite(current.relative_humidity_2m) && Number.isFinite(hourly.relative_humidity_2m?.[previousIndex])
    ? `${
        current.relative_humidity_2m - hourly.relative_humidity_2m![previousIndex] >= 0 ? "Rising" : "Falling"
      } ${Math.abs(current.relative_humidity_2m - hourly.relative_humidity_2m![previousIndex]).toFixed(0)}% in 3h`
    : "Awaiting data";
  if (elements.watchLevel) elements.watchLevel.textContent = formatNumber(nextPrecip);
  if (elements.watchCopy) elements.watchCopy.textContent = Number.isFinite(nextPrecipChance)
    ? `${nextPrecipChance}% chance in the next hour`
    : "Next-hour probability unavailable";
}

function updateWeatherWarning(forecast: Forecast): void {
  const hourly = forecast.hourly;
  const daily = forecast.daily;
  const currentIndex = findCurrentIndex(hourly.time);
  const nextTwelveIndexes = hourly.time.slice(currentIndex, currentIndex + 12).map((_, offset) => currentIndex + offset);
  const nextSixIndexes = hourly.time.slice(currentIndex, currentIndex + 6).map((_, offset) => currentIndex + offset);
  const maxGust = Math.max(...nextTwelveIndexes.map((index) => hourly.wind_gusts_10m[index] || 0));
  const maxPrecipChance = Math.max(...nextTwelveIndexes.map((index) => hourly.precipitation_probability[index] || 0));
  const precipTotal = nextTwelveIndexes.reduce((total, index) => total + (hourly.precipitation[index] || 0), 0);
  const pressureNow = hourly.pressure_msl[currentIndex];
  const pressureLater = hourly.pressure_msl[Math.min(hourly.pressure_msl.length - 1, currentIndex + 6)];
  const pressureDrop = pressureNow - pressureLater;
  const stormToday = [95, 96, 99].includes(daily.weather_code[0]);
  const heavyRainToday = [65, 82].includes(daily.weather_code[0]);

  let level = "clear";
  let label = "Weather Status";
  let title = "No major weather warnings indicated";
  let copy = "Forecast-based scan is quiet for the next 12 hours. Check official alerts before travel or severe weather decisions.";

  if (stormToday || maxGust >= 70) {
    level = "warning";
    label = "Weather Warning";
    title = stormToday ? "Thunderstorm risk in the forecast" : "Damaging gust potential";
    copy = stormToday
      ? `Storm conditions appear in today's forecast. Peak gusts may reach ${formatSpeed(maxGust)}.`
      : `Forecast gusts may reach ${formatSpeed(maxGust)} in the next 12 hours.`;
  } else if (heavyRainToday || precipTotal >= 10 || maxPrecipChance >= 75) {
    level = "watch";
    label = "Weather Watch";
    title = "Rain risk is elevated";
    copy = `${formatPrecip(precipTotal)} is forecast over the next 12 hours, with peak probability near ${maxPrecipChance}%.`;
  } else if (maxGust >= 45 || pressureDrop >= 3 || precipTotal >= 3) {
    level = "advisory";
    label = "Weather Advisory";
    title = maxGust >= 45 ? "Gusty winds possible" : "Changing weather pattern";
    copy = maxGust >= 45
      ? `Gusts may reach ${formatSpeed(maxGust)} in the next 12 hours.`
      : `Pressure may fall ${formatPressure(pressureDrop)} over 6 hours with ${formatPrecip(precipTotal)} possible.`;
  }

  updateWarningBar(level, label, title, copy);
}

function renderPatterns(forecast: Forecast): void {
  if (!elements.patternList) return;
  const hourly = forecast.hourly;
  const currentIndex = findCurrentIndex(hourly.time);
  const nextSixIndexes = hourly.time.slice(currentIndex, currentIndex + 6).map((_, offset) => currentIndex + offset);
  const nextPrecipTotal = nextSixIndexes.reduce((total, index) => total + (hourly.precipitation[index] || 0), 0);
  const maxPrecipChance = Math.max(...nextSixIndexes.map((index) => hourly.precipitation_probability[index] || 0));
  const pressureNow = hourly.pressure_msl[currentIndex];
  const pressureLater = hourly.pressure_msl[Math.min(hourly.pressure_msl.length - 1, currentIndex + 6)];
  const windNow = hourly.wind_speed_10m[currentIndex];
  const windLater = hourly.wind_speed_10m[Math.min(hourly.wind_speed_10m.length - 1, currentIndex + 6)];

  const patterns = [
    {
      level: pressureLater < pressureNow - 1.5 ? "high" : "low",
      title: "Pressure Trend",
      copy: pressureLater < pressureNow - 1.5
        ? `Pressure may fall ${formatPressure(pressureNow - pressureLater)} in the next 6 hours.`
        : `Pressure is fairly steady over the next 6 hours: ${formatPressure(pressureLater - pressureNow)}.`,
    },
    {
      level: maxPrecipChance >= 60 || nextPrecipTotal >= 2 ? "medium" : "low",
      title: "Rain Window",
      copy: `${formatPrecip(nextPrecipTotal)} forecast over 6 hours, with peak probability at ${maxPrecipChance}%.`,
    },
    {
      level: windLater > windNow + 8 ? "medium" : "low",
      title: "Wind Change",
      copy: `Wind changes from ${formatSpeed(windNow)} to ${formatSpeed(windLater)} over the next 6 hours.`,
    },
  ];

  elements.patternList.innerHTML = patterns
    .map(
      (pattern) => `
        <div class="pattern-item ${pattern.level}">
          <span></span>
          <div>
            <strong>${pattern.title}</strong>
            <p>${pattern.copy}</p>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderStormToolkit(forecast: Forecast): void {
  const risk = calculateStormRisk(forecast);
  if (elements.stormRiskBadge) elements.stormRiskBadge.textContent = `${risk.level} ${Math.round(risk.score)}`;
  if (elements.stormRiskFill) elements.stormRiskFill.style.width = `${Math.round(risk.score)}%`;

  if (elements.stormHeading) {
    const headings: Record<string, string> = {
      Quiet: "Clear Conditions — No Significant Storm Threat",
      Monitor: "Monitoring — Marginal Convective Signals Detected",
      Elevated: "Elevated Risk — Supportive Environment for Storms",
      High: "High Risk — Favorable Setup for Severe Storms",
    };
    elements.stormHeading.textContent = headings[risk.level] || "Convective Setup and Severe Potential";
  }

  if (elements.stormGrid) {
    elements.stormGrid.innerHTML = [
      ["CAPE", formatHeatmapValue(risk.cape, "cape"), "Convective available potential energy"],
      ["Dew point", formatHeatmapValue(risk.dewPoint, "dewpoint"), "Moisture available near the surface"],
      ["Peak gust", formatHeatmapValue(risk.gusts, "gusts"), "Highest gust in the next 12 hours"],
      ["Rain chance", formatHeatmapValue(risk.rainChance, "precipProbability"), "Peak probability in the next 12 hours"],
      ["12h rain", formatHeatmapValue(risk.rainTotal, "precipitation"), "Total precipitation window"],
      ["Pressure drop", `${formatPressure(risk.pressureDrop)}`, "Six-hour pressure tendency"],
      ["Wind shear proxy", `${formatSpeed(risk.shear)}`, "100 m minus 10 m wind speed"],
      ["Visibility", formatHeatmapValue(hourlyValue(forecast, "visibility"), "visibility"), "Near-term surface visibility"],
    ]
      .map(([label, value, copy]) => `<article class="toolkit-card"><span>${label}</span><strong>${value}</strong><small>${copy}</small></article>`)
      .join("");
  }

  if (elements.stormSignals) {
    const signals = [
      risk.cape >= 800 ? "Instability is supportive of convection." : "Instability signal is limited.",
      risk.pressureDrop >= 3 ? "Pressure is falling quickly enough to monitor." : "Pressure tendency is not strongly concerning.",
      risk.gusts >= 55 ? "Wind gusts may become hazardous." : "Gust signal remains below severe thresholds.",
    ];
    elements.stormSignals.innerHTML = signals
      .map((copy) => `<div class="pattern-item low"><span></span><div><strong>Signal</strong><p>${copy}</p></div></div>`)
      .join("");
  }
}

function renderAirQuality(airQuality: AirQuality | null): void {
  if (!airQuality?.hourly?.time) {
    if (elements.airGrid) elements.airGrid.innerHTML = `<div class="empty-signal">Air quality data unavailable.</div>`;
    return;
  }
  const index = findCurrentIndex(airQuality.hourly.time);
  const hourly = airQuality.hourly;

  if (elements.airGrid) {
    elements.airGrid.innerHTML = [
      ["US AQI", hourly.us_aqi?.[index], "", "Overall air quality index"],
      ["PM2.5", hourly.pm2_5?.[index], " ug/m3", "Fine particulate/smoke indicator"],
      ["PM10", hourly.pm10?.[index], " ug/m3", "Coarse particulate load"],
      ["Ozone", hourly.ozone?.[index], " ug/m3", "Surface ozone concentration"],
      ["NO2", hourly.nitrogen_dioxide?.[index], " ug/m3", "Traffic/combustion signal"],
      ["CO", hourly.carbon_monoxide?.[index], " ug/m3", "Carbon monoxide"],
      ["UV", hourly.uv_index?.[index], "", "Sun exposure index"],
      ["Next AQI peak", Math.max(...(hourly.us_aqi || []).filter(Number.isFinite)), "", "Highest available forecast value"],
    ]
      .map(([label, value, unit, copy]) =>
        `<article class="toolkit-card"><span>${label}</span><strong>${Number.isFinite(value) ? Math.round(value as number) + String(unit || "") : "--"}</strong><small>${copy}</small></article>`,
      )
      .join("");
  }
}

function renderConfidence(forecast: Forecast): void {
  if (!elements.confidenceGrid) return;
  const pressureChange = Math.abs(
    (hourlyValue(forecast, "pressure_msl", 0) || 0) - (hourlyValue(forecast, "pressure_msl", 12) || 0),
  );
  const gustSpread = maxNext(forecast, "wind_gusts_10m", 24) - (hourlyValue(forecast, "wind_gusts_10m") || 0);
  const rainWindow = maxNext(forecast, "precipitation_probability", 24);
  const startIdx = getCurrentHourlyIndex(forecast);
  const cloudMin = Math.min(
    ...forecast.hourly.cloud_cover.slice(startIdx, startIdx + 24).filter(Number.isFinite),
  );
  const cloudRange = maxNext(forecast, "cloud_cover", 24) - cloudMin;
  const confidence = Math.max(
    0,
    Math.min(100, 100 - pressureChange * 5 - gustSpread * 0.5 - cloudRange * 0.15 - (rainWindow > 50 ? 8 : 0)),
  );

  elements.confidenceGrid.innerHTML = [
    ["Confidence", `${Math.round(confidence)}%`, "Lower when pressure, cloud, rain, and gust signals vary sharply"],
    ["Gust spread", `${formatSpeed(gustSpread)}`, "Change from now to the peak gust window"],
    ["Cloud range", `${Math.round(cloudRange)}%`, "Cloud cover variability over 24 hours"],
    ["Rain peak", `${Math.round(rainWindow)}%`, "Peak precipitation probability over 24 hours"],
  ]
    .map(([label, value, copy]) => `<article class="toolkit-card"><span>${label}</span><strong>${value}</strong><small>${copy}</small></article>`)
    .join("");
}

function renderContext(forecast: Forecast): void {
  if (!elements.contextGrid) return;
  const rain24 = sumNext(forecast, "precipitation", 24);
  const snow24 = sumNext(forecast, "snowfall", 24);
  const peakCape = maxNext(forecast, "cape", 24);
  const peakGust = maxNext(forecast, "wind_gusts_10m", 24);
  const uv = forecast.daily.uv_index_max?.[0];

  elements.contextGrid.innerHTML = [
    ["24h rain", formatHeatmapValue(rain24, "precipitation"), "Upcoming local accumulation"],
    ["24h snow", `${formatNumber(snow24)} cm`, "Snowfall forecast where applicable"],
    ["Peak CAPE", formatHeatmapValue(peakCape, "cape"), "Instability peak over 24 hours"],
    ["Peak gust", formatHeatmapValue(peakGust, "gusts"), "Maximum gust forecast"],
    ["UV max", Number.isFinite(uv) ? formatNumber(uv) : "--", "Daily maximum UV index"],
    ["Cloud now", formatHeatmapValue(hourlyValue(forecast, "cloud_cover"), "cloud"), "Current cloud cover"],
    ["VPD", `${formatNumber(hourlyValue(forecast, "vapour_pressure_deficit"))} kPa`, "Drying/evaporation stress"],
    ["Soil temp", formatTemp(hourlyValue(forecast, "soil_temperature_0cm")), "Surface soil temperature"],
  ]
    .map(([label, value, copy]) => `<article class="toolkit-card"><span>${label}</span><strong>${value}</strong><small>${copy}</small></article>`)
    .join("");
}

function renderDailyForecast(forecast: Forecast): void {
  if (!elements.dailyGrid) return;
  const daily = forecast.daily;
  const dayIndexes = [0, 1].filter((index) => daily.time[index]);

  elements.dailyGrid.innerHTML = dayIndexes
    .map((index) => {
      const label = index === 0 ? "Today" : "Tomorrow";
      return `
        <article class="forecast-card">
          <div>
            <span>${label}</span>
            <strong>${describeWeatherCode(daily.weather_code[index])}</strong>
          </div>
          <div class="forecast-temp">
            <strong>${isImperial() ? `${Math.round(daily.temperature_2m_max[index] * 9 / 5 + 32)}°` : `${Math.round(daily.temperature_2m_max[index])}°`}</strong>
            <small>${isImperial() ? `${Math.round(daily.temperature_2m_min[index] * 9 / 5 + 32)}°` : `${Math.round(daily.temperature_2m_min[index])}°`} low</small>
          </div>
          <dl class="forecast-details">
            <div><dt>Precip</dt><dd>${formatPrecip(daily.precipitation_sum[index])}</dd></div>
            <div><dt>Chance</dt><dd>${daily.precipitation_probability_max[index] ?? "--"}%</dd></div>
            <div><dt>Wind</dt><dd>${formatSpeed(daily.wind_speed_10m_max[index])}</dd></div>
            <div><dt>Gusts</dt><dd>${formatSpeed(daily.wind_gusts_10m_max[index])}</dd></div>
            <div><dt>Sunrise</dt><dd>${new Date(daily.sunrise[index]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd></div>
            <div><dt>Sunset</dt><dd>${new Date(daily.sunset[index]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd></div>
          </dl>
        </article>
      `;
    })
    .join("");
}

function renderWeeklyForecast(forecast: Forecast): void {
  if (!elements.weeklyList) return;
  const daily = forecast.daily;

  elements.weeklyList.innerHTML = daily.time
    .map(
      (day, index) => `
        <div class="weekly-row">
          <div>
            <strong>${formatDay(day)}</strong>
            <small>${describeWeatherCode(daily.weather_code[index])}</small>
          </div>
          <div class="weekly-temp">
            <span>${isImperial() ? `${Math.round(daily.temperature_2m_max[index] * 9 / 5 + 32)}°` : `${Math.round(daily.temperature_2m_max[index])}°`}</span>
            <small>${isImperial() ? `${Math.round(daily.temperature_2m_min[index] * 9 / 5 + 32)}°` : `${Math.round(daily.temperature_2m_min[index])}°`}</small>
          </div>
          <div class="weekly-bar" aria-hidden="true">
            <span class="${getPrecipBarClass(daily.precipitation_probability_max[index])}"></span>
          </div>
          <div class="weekly-meta">
            <span>${daily.precipitation_probability_max[index] ?? "--"}%</span>
            <small>${formatPrecip(daily.precipitation_sum[index])}</small>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderHourlyForecast(forecast: Forecast): void {
  if (!elements.hourlyStrip) return;
  const hourly = forecast.hourly;
  const currentIndex = findCurrentIndex(hourly.time);
  const indexes = hourly.time.slice(currentIndex, currentIndex + HOURS_TO_SHOW).map((_, offset) => currentIndex + offset);

  elements.hourlyStrip.innerHTML = indexes
    .map((index, offset) => {
      const time = offset === 0 ? "Now" : new Date(hourly.time[index]).toLocaleTimeString([], { hour: "2-digit" });
      const chance = hourly.precipitation_probability[index] ?? 0;
      return `
        <article class="hourly-card">
          <span>${time}</span>
          <strong>${isImperial() ? `${Math.round(hourly.temperature_2m[index] * 9 / 5 + 32)}°` : `${Math.round(hourly.temperature_2m[index])}°`}</strong>
          <small class="rain-badge">${chance > 0 ? `${chance}%` : "—"}</small>
          <small class="wind-value">${formatSpeed(hourly.wind_speed_10m[index])}</small>
        </article>
      `;
    })
    .join("");
}

function drawForecastChart(forecast: Forecast): void {
  if (!chartCanvas) return;
  const ctx = chartCanvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = prepareCanvas(chartCanvas, ctx);
  const leftPadding = Math.max(46, Math.min(68, width * 0.065));
  const rightPadding = 28;
  const bottomPadding = 52;
  const topPadding = 64;
  const hourly = forecast.hourly;
  const currentIndex = findCurrentIndex(hourly.time);
  const indexes = hourly.time.slice(currentIndex, currentIndex + HOURS_TO_SHOW).map((_, offset) => currentIndex + offset);
  const temperatures = indexes.map((index) => hourly.temperature_2m[index]);
  const precipitation = indexes.map((index) => hourly.precipitation_probability[index]);
  const chartTop = topPadding;
  const chartBottom = height - bottomPadding;
  const chartHeight = chartBottom - chartTop;

  const finiteTemps = temperatures.filter(Number.isFinite);
  const tempMin = Math.min(...finiteTemps);
  const tempMax = Math.max(...finiteTemps);
  const tempRange = tempMax - tempMin || 1;

  const temperatureY = temperatures.map((value) =>
    chartBottom - ((value - tempMin) / tempRange) * chartHeight,
  );
  const precipY = precipitation.map((value) =>
    chartBottom - ((value || 0) / 100) * chartHeight,
  );
  const chartLeft = leftPadding;
  const chartRight = width - rightPadding;
  const xStep = (chartRight - chartLeft) / Math.max(1, indexes.length - 1);

  chartState.points = indexes.map((index, offset) => ({
    index,
    offset,
    x: chartLeft + offset * xStep,
    temperatureY: temperatureY[offset],
    precipY: precipY[offset],
    time: hourly.time[index],
    temperature: temperatures[offset],
    precipitationProbability: precipitation[offset],
    precipitationAmount: hourly.precipitation[index],
    wind: hourly.wind_speed_10m[index],
  }));

  // Draw background
  ctx.clearRect(0, 0, width, height);
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#171c23");
  background.addColorStop(1, "#11161b");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  // Grid lines
  ctx.strokeStyle = "rgba(120, 134, 152, 0.36)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i += 1) {
    const y = chartTop + (chartHeight / 5) * i;
    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.stroke();

    const labelValue = tempMax - ((tempMax - tempMin) / 5) * i;
    ctx.textAlign = "right";
    ctx.fillStyle = "#98a4b3";
    ctx.font = "700 12px system-ui";
    ctx.fillText(
      `${isImperial() ? `${(labelValue * 9 / 5 + 32).toFixed(0)}°` : `${labelValue.toFixed(0)}°`}`,
      chartLeft - 8,
      y + 4,
    );
  }
  ctx.textAlign = "start";

  // Precipitation bars
  precipitation.forEach((chance, offset) => {
    const barHeight = (chartHeight * (chance || 0)) / 100;
    const barWidth = Math.max(8, Math.min(18, xStep * 0.5));
    const x = chartLeft + offset * xStep - barWidth / 2;
    const barGradient = ctx.createLinearGradient(0, chartBottom - barHeight, 0, chartBottom);
    barGradient.addColorStop(0, "rgba(114, 174, 230, 0.64)");
    barGradient.addColorStop(1, "rgba(114, 174, 230, 0.1)");
    ctx.fillStyle = barGradient;
    roundedRect(ctx, x, chartBottom - barHeight, barWidth, barHeight, 5);
    ctx.fill();
  });

  // Temperature area fill
  const areaGradient = ctx.createLinearGradient(0, chartTop, 0, chartBottom);
  areaGradient.addColorStop(0, "rgba(129, 197, 171, 0.22)");
  areaGradient.addColorStop(0.72, "rgba(129, 197, 171, 0.04)");
  areaGradient.addColorStop(1, "rgba(129, 197, 171, 0)");
  ctx.beginPath();
  temperatureY.forEach((y, offset) => {
    const x = chartLeft + offset * xStep;
    if (offset === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(chartRight, chartBottom);
  ctx.lineTo(chartLeft, chartBottom);
  ctx.closePath();
  ctx.fillStyle = areaGradient;
  ctx.fill();

  // Temperature line
  ctx.beginPath();
  ctx.strokeStyle = "#81c5ab";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  temperatureY.forEach((y, offset) => {
    const x = chartLeft + offset * xStep;
    if (offset === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Temperature points
  chartState.points.forEach((point, offset) => {
    if (offset % 3 !== 0 && offset !== 0) return;
    ctx.fillStyle = "#141a20";
    ctx.strokeStyle = "#81c5ab";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.temperatureY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  // Chart hover
  if (chartState.hoverIndex !== null && chartState.points[chartState.hoverIndex]) {
    const point = chartState.points[chartState.hoverIndex];
    ctx.strokeStyle = "rgba(213, 221, 231, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(point.x, chartTop);
    ctx.lineTo(point.x, chartBottom);
    ctx.stroke();

    const drawMarker = (x: number, y: number, color: string) => {
      ctx.fillStyle = "#141a20";
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    drawMarker(point.x, point.temperatureY, "#81c5ab");
    drawMarker(point.x, point.precipY, "#72aee6");
  }

  // Legend
  ctx.font = "700 13px system-ui";
  const tempW = ctx.measureText("Temp").width;
  const rainW = ctx.measureText("Rain").width;
  const gap1 = 22, gap2 = 18, dotR = 5;
  const totalW = tempW + gap1 + rainW + gap2 + dotR * 2;
  let legX = chartRight - totalW;
  if (legX < chartLeft) legX = chartLeft;
  ctx.textAlign = "left";
  ctx.fillStyle = "#d5dde7";
  ctx.fillText("Temp", legX, 29);
  ctx.fillStyle = "#81c5ab";
  ctx.beginPath();
  ctx.arc(legX + tempW + 6, 25, dotR, 0, Math.PI * 2);
  ctx.fill();
  legX += tempW + gap1;
  ctx.fillStyle = "#d5dde7";
  ctx.fillText("Rain", legX, 29);
  ctx.fillStyle = "#72aee6";
  ctx.beginPath();
  ctx.arc(legX + rainW + 6, 25, dotR, 0, Math.PI * 2);
  ctx.fill();

  // X-axis labels
  ctx.textAlign = "center";
  ctx.fillStyle = "#98a4b3";
  ctx.font = "700 12px system-ui";
  const labelStep = width < 400 ? 6 : 3;
  indexes.forEach((index, offset) => {
    if (offset % labelStep !== 0) return;
    const x = chartLeft + offset * xStep;
    const label = new Date(hourly.time[index]).toLocaleTimeString([], { hour: "2-digit" });
    ctx.fillText(label, x, height - 22);
  });
  ctx.textAlign = "start";
}

function showChartTooltip(point: typeof chartState.points[0], pointerX: number, pointerY: number, rect: DOMRect): void {
  if (!elements.chartTooltip) return;
  const time = new Date(point.time).toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  elements.chartTooltip.innerHTML = `
    <strong>${escapeHTML(time)}</strong>
    <span>Temperature: ${formatTemp(point.temperature)}</span>
    <span>Precip chance: ${point.precipitationProbability ?? "--"}%</span>
    <span>Precip amount: ${formatPrecip(point.precipitationAmount)}</span>
    <span>Wind: ${formatSpeed(point.wind)}</span>
  `;
  elements.chartTooltip.classList.add("visible");

  const tooltipWidth = elements.chartTooltip.offsetWidth;
  const tooltipHeight = elements.chartTooltip.offsetHeight;
  const left = Math.min(rect.width - tooltipWidth - 10, pointerX + 14);
  const top = Math.max(10, Math.min(rect.height - tooltipHeight - 10, pointerY - tooltipHeight - 10));
  elements.chartTooltip.style.left = `${Math.max(10, left)}px`;
  elements.chartTooltip.style.top = `${top}px`;
}

function hideChartTooltip(): void {
  if (!elements.chartTooltip) return;
  if (chartState.hoverIndex === null && !elements.chartTooltip.classList.contains("visible")) return;
  chartState.hoverIndex = null;
  elements.chartTooltip.classList.remove("visible");
  if (latestForecast) drawForecastChart(latestForecast);
}

function updateChartTooltip(event: PointerEvent): void {
  if (!latestForecast || !chartState.points.length) return;

  const rect = chartCanvas.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  let nearestIndex: number | null = null;
  let nearestDistance = Infinity;

  chartState.points.forEach((point, index) => {
    const distance = Math.min(
      Math.hypot(pointerX - point.x, pointerY - point.temperatureY),
      Math.hypot(pointerX - point.x, pointerY - point.precipY),
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  if (nearestIndex === null || nearestDistance > 32) {
    hideChartTooltip();
    return;
  }

  chartState.hoverIndex = nearestIndex;
  drawForecastChart(latestForecast);
  showChartTooltip(chartState.points[nearestIndex], pointerX, pointerY, rect);
}

function scheduleHeatmapRefresh(delay = 320): void {
  if (!activeLocation) return;
  if (heatmapRefreshTimer) clearTimeout(heatmapRefreshTimer);
  const requestToken = ++heatmapRefreshToken;
  heatmapRefreshTimer = setTimeout(() => {
    refreshHeatmapForViewport(requestToken);
  }, delay);
}

function scheduleHeatmapRetry(backoff = heatmapRetryDelay): void {
  if (!activeLocation) return;
  heatmapRetryDelay = Math.min(backoff * 2, 30000);
  scheduleHeatmapRefresh(backoff);
}

async function refreshHeatmapForViewport(requestToken: number): Promise<void> {
  if (!activeLocation) return;
  try {
    const result = await fetchHeatmap(mapState.center, Math.round(mapState.zoom), heatmapCanvas);
    if (requestToken !== heatmapRefreshToken || !activeLocation) return;
    heatmapRetryDelay = 1000;
    latestHeatmap = result.points;
    latestHeatmapMeta = result.meta;
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  } catch (error) {
    if (requestToken !== heatmapRefreshToken) return;
    addLog((error as Error).message || "Regional heatmap request failed", elements.eventLog);
    if (latestHeatmap?.length) {
      renderHeatmap(latestHeatmap, activeHeatmapLayer);
      scheduleHeatmapRetry();
      return;
    }
    latestHeatmap = null;
    latestHeatmapMeta = null;
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
    scheduleHeatmapRetry();
  }
}

function setLoadingState(message: string): void {
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

function applyForecastCacheStatus(forecast: Forecast): void {
  const cacheMeta = forecast.__precipCacheMeta;
  if (!cacheMeta?.stale) return;
  const ageMinutes = Math.max(1, Math.round((cacheMeta.age || 0) / 60000));
  if (elements.tempTrend) {
    elements.tempTrend.textContent = `Showing cached forecast from about ${ageMinutes} minute${ageMinutes === 1 ? "" : "s"} ago`;
  }
  addLog(`Using cached forecast data (${ageMinutes} minute${ageMinutes === 1 ? "" : "s"} old).`, elements.eventLog);
}

function renderWatchlistUI(items = getWatchlist()): void {
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

  elements.watchlistGrid.querySelectorAll("button[data-watch-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const location = getWatchlist()[Number((button as HTMLElement).dataset.watchIndex)];
      if (location) loadWeather(location);
    });
  });
}

function pinCurrentLocation(): void {
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

function renderForecastHistoryUI(history = getForecastHistory()): void {
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

function saveForecastSnapshot(location: Location, forecast: Forecast): void {
  const current = forecast.current;
  const daily = forecast.daily;
  const snapshot = {
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

function clearSavedWatchlist(): void {
  removeCookieValue("precip.watchlist.v1");
  try { window.localStorage.removeItem("precip.watchlist.v1"); } catch {}
  renderWatchlistUI([]);
  addLog("Pinned locations cleared.", elements.eventLog);
}

function clearSavedHistory(): void {
  removeCookieValue("precip.forecastHistory.v1");
  try { window.localStorage.removeItem("precip.forecastHistory.v1"); } catch {}
  renderForecastHistoryUI([]);
  addLog("Forecast history cleared.", elements.eventLog);
}

function saveCurrentAsPreferredLocation(): void {
  if (!activeLocation) return;
  savePreferredLocation(activeLocation);
  updateSettingsUI();
  addLog(`${activeLocation.name} saved as the default location.`, elements.eventLog);
}

function clearPreferredLocationSetting(): void {
  removeCookieValue("precip.preferredLocation.v1");
  updateSettingsUI();
  addLog("Saved default location cleared.", elements.eventLog);
  window.location.replace("welcome.html");
}

async function loadWeather(query: Location | string): Promise<void> {
  try {
    const requestId = ++weatherLoadId;
    const queryLabel = typeof query === "string" ? query : query.name;
    const settings = getAppSettings();
    addLog(`Loading weather data for ${queryLabel}.`, elements.eventLog);
    activeLocation = typeof query === "string" ? await resolveLocation(query, elements.eventLog) : query;
    setLoadingState(`Loading live weather data for ${activeLocation.name}`);
    setSatelliteTabLoaded(false);
    const overlayVisible = elements.satelliteOverlay && !elements.satelliteOverlay.hidden;
    if (overlayVisible) {
      setSatelliteTabLoaded(true);
      updateSatelliteForLocation(activeLocation, {
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
    latestForecast = await fetchForecast(activeLocation);
    if (requestId !== weatherLoadId) return;
    updateCurrentConditions(activeLocation, latestForecast);
    applyForecastCacheStatus(latestForecast);
    updateWeatherWarning(latestForecast);
    renderPatterns(latestForecast);
    renderStormToolkit(latestForecast);
    renderConfidence(latestForecast);
    renderContext(latestForecast);
    mapState.center = { latitude: activeLocation.latitude, longitude: activeLocation.longitude };
    mapState.selected = activeLocation;
    latestAirQuality = null;
    latestHeatmap = null;
    latestHeatmapMeta = null;
    setLatestAlerts(null);
    document.querySelector('.tab-button[data-tab="now"] .alert-badge')?.remove();
    setLatestSpcCat(null);
    setLatestSpcTorn(null);
    if (elements.airGrid) elements.airGrid.innerHTML = `<div class="empty-signal">Loading air quality data.</div>`;
    if (elements.tornadoGrid) elements.tornadoGrid.innerHTML = `<div class="empty-signal">Loading SPC outlook data.</div>`;
    renderHeatmapLoading();
    renderHourlyForecast(latestForecast);
    renderDailyForecast(latestForecast);
    renderWeeklyForecast(latestForecast);
    drawForecastChart(latestForecast);
    saveForecastSnapshot(activeLocation, latestForecast);
    renderWatchlistUI();
    updateSettingsUI();
    showToast(`Weather data loaded for ${activeLocation.name}`, "success", 2500);
    addLog(`Live Open-Meteo feed updated for ${activeLocation.name}.`, elements.eventLog);
    hydrateSupplementalWeather(activeLocation, requestId);
  } catch (error) {
    showToast((error as Error).message, "error", 4000);
    addLog((error as Error).message, elements.eventLog);
    updateWarningBar("advisory", "Weather Advisory", "Weather feed unavailable", "Live forecast warnings cannot be calculated until the Open-Meteo feed is reachable.");
    if (elements.tempTrend) elements.tempTrend.textContent = "Weather feed unavailable";
    if (elements.pressureTrend) elements.pressureTrend.textContent = "Check network access or location";
    if (elements.windDirection) elements.windDirection.textContent = "No live wind data";
    if (elements.windCompass) elements.windCompass.textContent = "--";
    if (elements.watchCopy) elements.watchCopy.textContent = "No live precipitation data";
  }
}

async function hydrateSupplementalWeather(location: Location, requestId: number): Promise<void> {
  const [airResult, heatmapResult, alertsResult] = await Promise.allSettled([
    fetchAirQuality(location),
    fetchHeatmap(mapState.center, Math.round(mapState.zoom), heatmapCanvas),
    fetchAlerts(location),
  ]);

  if (requestId !== weatherLoadId) return;

  if (airResult.status === "fulfilled") {
    latestAirQuality = airResult.value;
  } else {
    latestAirQuality = null;
    addLog((airResult.reason as Error)?.message || "Air quality request failed", elements.eventLog);
  }
  renderAirQuality(latestAirQuality);

  if (heatmapResult.status === "fulfilled") {
    latestHeatmap = heatmapResult.value.points;
    latestHeatmapMeta = heatmapResult.value.meta;
  } else {
    latestHeatmap = null;
    latestHeatmapMeta = null;
    addLog((heatmapResult.reason as Error)?.message || "Regional heatmap request failed", elements.eventLog);
  }
  renderHeatmap(latestHeatmap);

  if (alertsResult.status === "fulfilled") {
    if (alertsResult.value.length) {
      updateNwsAlerts(alertsResult.value, elements, showToast, updateWarningBar);
    } else {
      const alertBadge = document.querySelector('.tab-button[data-tab="now"] .alert-badge');
      if (alertBadge) alertBadge.remove();
    }
  } else {
    addLog((alertsResult.reason as Error)?.message || "Weather alerts request failed", elements.eventLog);
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

async function selectMapLocation(latitude: number, longitude: number): Promise<void> {
  try {
    hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
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

function toggleSatelliteOverlay(show?: boolean): void {
  const overlay = elements.satelliteOverlay;
  if (!overlay) return;
  const isVisible = !overlay.hidden;
  const targetState = show ?? !isVisible;

  if (targetState) {
    overlay.hidden = false;
    if (activeLocation && !isSatelliteTabLoaded()) {
      setSatelliteTabLoaded(true);
      updateSatelliteForLocation(activeLocation, {
        satelliteStatus: elements.satelliteStatus,
        satelliteCopy: elements.satelliteCopy,
        satelliteEmpty: elements.satelliteEmpty,
        satelliteImage: elements.satelliteImage,
        satelliteProductSelect: elements.satelliteProductSelect,
        satelliteSectorSelect: elements.satelliteSectorSelect,
        satelliteLink: elements.satelliteLink,
      });
    }
    const isNarrow = window.matchMedia("(max-width: 768px)").matches;
    if (isNarrow) {
      document.querySelector("#data-panel")?.classList.add("collapsed");
    }
  } else {
    overlay.hidden = true;
  }
}

// --- Event Listeners ---

if (elements.locationForm) {
  elements.locationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = elements.locationInput?.value.trim() || "";
    if (!query) return;
    if (
      selectedLocationSuggestion &&
      normalizeSearchText(formatLocationLabel(selectedLocationSuggestion)) === normalizeSearchText(query)
    ) {
      loadWeather(selectedLocationSuggestion);
      return;
    }
    resolveLocation(query, elements.eventLog)
      .then((location) => {
        selectedLocationSuggestion = location;
        loadWeather(location);
      })
      .catch(() => {
        searchLocationSuggestions(query, elements.eventLog, elements.locationSearchNote, elements.locationSuggestions, elements.locationInput);
        if (elements.locationSearchNote) {
          elements.locationSearchNote.textContent = "Choose the exact location from the suggestions before loading weather.";
        }
      });
  });
}

if (elements.locationInput) {
  elements.locationInput.addEventListener("input", () => {
    selectedLocationSuggestion = null;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      searchLocationSuggestions(
        elements.locationInput?.value.trim() || "",
        elements.eventLog,
        elements.locationSearchNote,
        elements.locationSuggestions,
        elements.locationInput,
      );
    }, 180);
  });
}

document.addEventListener("click", (event) => {
  if (elements.locationForm && !elements.locationForm.contains(event.target as Node)) {
    if (elements.locationSuggestions) elements.locationSuggestions.classList.remove("visible");
  }
});

elements.refreshButton?.addEventListener("click", () => {
  const query = activeLocation || elements.locationInput?.value.trim() || getPreferredLocation();
  if (query) loadWeather(query);
});

elements.clearHistoryButton?.addEventListener("click", clearSavedHistory);
elements.pinLocationButton?.addEventListener("click", pinCurrentLocation);

elements.mapHourSlider?.addEventListener("input", () => {
  setActiveMapHourOffset(Number(elements.mapHourSlider?.value), { persist: true });
});

window.addEventListener("resize", () => {
  hideChartTooltip();
  hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    if (latestForecast) drawForecastChart(latestForecast);
    if (latestHeatmap) {
      renderHeatmap(latestHeatmap);
      scheduleHeatmapRefresh(300);
    }
  }, 200);
});

chartCanvas?.addEventListener("pointermove", updateChartTooltip);
chartCanvas?.addEventListener("pointerleave", hideChartTooltip);

if (heatmapCanvas) {
  const onMapZoomChange = () => {
    hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  };

  const onScheduleRefresh = () => scheduleHeatmapRefresh();

  const onDragStart = () => {
    if (tooltipRaf !== null) { cancelAnimationFrame(tooltipRaf); tooltipRaf = null; }
    hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
  };

  heatmapCanvas.addEventListener("pointerdown", (event) => {
    startMapDrag(event, mapState, activePointers, heatmapCanvas, onDragStart);
  });

  heatmapCanvas.addEventListener("pointermove", (event) => {
    const result = moveMapDrag(
      event, mapState, activePointers, pinchStartDist, pinchStartZoom,
      () => {
        hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
        renderHeatmap(latestHeatmap, activeHeatmapLayer);
      },
      () => renderHeatmap(latestHeatmap, activeHeatmapLayer),
      () => scheduleHeatmapRefresh(),
      (e) => {
        if (!mapState.drag) {
          if (tooltipRaf !== null) cancelAnimationFrame(tooltipRaf);
          tooltipRaf = requestAnimationFrame(() => {
            tooltipRaf = null;
            updateMapTooltip(e, heatmapCanvas, mapState, activeHeatmapLayer, activeMapHourOffset, {
              mapTooltip: elements.mapTooltip,
              mapHoverIndicator: elements.mapHoverIndicator,
            });
          });
        }
      },
    );
    pinchStartDist = result.pinchStartDist;
    pinchStartZoom = result.pinchStartZoom;
  });

  heatmapCanvas.addEventListener("pointerup", (event) => {
    endMapDrag(
      event, mapState, activePointers, pinchStartDist,
      () => scheduleHeatmapRefresh(),
      (lat, lon) => selectMapLocation(lat, lon),
    );
    if (activePointers.size < 2) pinchStartDist = 0;
  });

  heatmapCanvas.addEventListener("pointercancel", (event) => {
    endMapDrag(
      event, mapState, activePointers, pinchStartDist,
      () => {},
      () => {},
    );
  });

  heatmapCanvas.addEventListener("pointerleave", () => {
    if (tooltipRaf !== null) { cancelAnimationFrame(tooltipRaf); tooltipRaf = null; }
    hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
  });

  heatmapCanvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomMap(
        event.deltaY > 0 ? -1 : 1,
        mapState,
        () => {
          hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
          renderHeatmap(latestHeatmap, activeHeatmapLayer);
        },
        () => scheduleHeatmapRefresh(),
      );
    },
    { passive: false },
  );
}

elements.mapZoomIn?.addEventListener("click", () => {
  zoomMap(1, mapState, () => {
    hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  }, () => scheduleHeatmapRefresh());
});

elements.mapZoomOut?.addEventListener("click", () => {
  zoomMap(-1, mapState, () => {
    hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  }, () => scheduleHeatmapRefresh());
});

elements.mapReset?.addEventListener("click", () => {
  resetMapView(mapState, MAP_DEFAULT_ZOOM, activeLocation);
  renderHeatmap(latestHeatmap, activeHeatmapLayer);
  scheduleHeatmapRefresh(0);
});

heatmapButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveHeatmapLayer(button.dataset.layer || "temperature", { persist: true });
  });
});

elements.setDefaultLocationButton?.addEventListener("click", saveCurrentAsPreferredLocation);
elements.resetDefaultLocationButton?.addEventListener("click", clearPreferredLocationSetting);

elements.settingsMapLayer?.addEventListener("change", () => {
  setActiveHeatmapLayer(elements.settingsMapLayer?.value || "temperature", { persist: true });
});

elements.settingsStartHour?.addEventListener("change", () => {
  setActiveMapHourOffset(Number(elements.settingsStartHour?.value), { persist: true });
});

document.querySelectorAll('input[name="units"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!(radio as HTMLInputElement).checked) return;
    saveAppSettings({ useImperial: (radio as HTMLInputElement).value === "imperial" });
    if (activeLocation && latestForecast) updateCurrentConditions(activeLocation, latestForecast);
    if (latestHeatmap) renderHeatmap(latestHeatmap, activeHeatmapLayer);
  });
});

elements.clearWatchlistButton?.addEventListener("click", clearSavedWatchlist);
elements.clearHistorySettingsButton?.addEventListener("click", clearSavedHistory);

elements.satelliteImage?.addEventListener("load", () => {
  if (elements.satelliteEmpty) elements.satelliteEmpty.hidden = true;
});

elements.satelliteImage?.addEventListener("error", () => {
  if (elements.satelliteStatus) {
    elements.satelliteStatus.textContent = "NOAA unavailable";
    elements.satelliteStatus.className = "status-pill standby";
  }
  if (elements.satelliteEmpty) {
    elements.satelliteEmpty.textContent = "NOAA animation could not be loaded for this sector.";
    elements.satelliteEmpty.hidden = false;
  }
  if (elements.satelliteImage) elements.satelliteImage.hidden = true;
});

elements.satelliteSectorSelect?.addEventListener("change", () => {
  loadSatelliteSector(elements.satelliteSectorSelect?.value || "", {
    preferredProductKey: "geocolor",
    elements: {
      satelliteStatus: elements.satelliteStatus,
      satelliteCopy: elements.satelliteCopy,
      satelliteEmpty: elements.satelliteEmpty,
      satelliteImage: elements.satelliteImage,
      satelliteProductSelect: elements.satelliteProductSelect,
      satelliteSectorSelect: elements.satelliteSectorSelect,
      satelliteLink: elements.satelliteLink,
    },
  });
});

let satelliteCatalogRequestToken = 0;

elements.satelliteProductSelect?.addEventListener("change", async () => {
  const sectorId = elements.satelliteSectorSelect?.value || "";
  const sector = getNoaaSectorById(sectorId || getActiveSatelliteSectorId() || NOAA_SECTORS[0].id);
  const requestToken = ++satelliteCatalogRequestToken;
  try {
    const catalog = await fetchNoaaSectorCatalog(sector);
    if (requestToken !== satelliteCatalogRequestToken) return;
    const selectedProduct =
      catalog.products.find((product) => product.key === elements.satelliteProductSelect?.value) || catalog.products[0];
    renderSatelliteProductOptions(
      catalog.products,
      selectedProduct.key,
      elements.satelliteProductSelect,
    );
    renderSatelliteImage(sector, selectedProduct, {
      satelliteStatus: elements.satelliteStatus,
      satelliteCopy: elements.satelliteCopy,
      satelliteLink: elements.satelliteLink,
      satelliteImage: elements.satelliteImage,
      satelliteEmpty: elements.satelliteEmpty,
    });
  } catch (error) {
    if (requestToken !== satelliteCatalogRequestToken) return;
    if (elements.satelliteEmpty) {
      elements.satelliteEmpty.textContent = (error as Error).message;
      elements.satelliteEmpty.hidden = false;
    }
    if (elements.satelliteImage) elements.satelliteImage.hidden = true;
  }
});

// Satellite map toggle button
document.querySelector("#satellite-toggle")?.addEventListener("click", () => {
  toggleSatelliteOverlay();
});

// Satellite overlay close button
elements.satelliteOverlayClose?.addEventListener("click", () => {
  toggleSatelliteOverlay(false);
});

// Satellite overlay drag to reposition
let satDragRaf: number | null = null;

elements.satelliteOverlayHeader?.addEventListener("pointerdown", (event) => {
  const overlay = elements.satelliteOverlay;
  if (!overlay || overlay.hidden) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  satelliteOverlayDrag = {
    startX: event.clientX,
    startY: event.clientY,
    left: overlay.offsetLeft,
    top: overlay.offsetTop,
  };
});

elements.satelliteOverlayHeader?.addEventListener("pointermove", (event) => {
  if (!satelliteOverlayDrag) return;
  if (satDragRaf !== null) cancelAnimationFrame(satDragRaf);
  satDragRaf = requestAnimationFrame(() => {
    satDragRaf = null;
    const overlay = elements.satelliteOverlay;
    if (!overlay || overlay.hidden) return;
    const dx = event.clientX - satelliteOverlayDrag!.startX;
    const dy = event.clientY - satelliteOverlayDrag!.startY;
    const parent = overlay.parentElement!;
    const maxRight = parent.clientWidth - overlay.offsetWidth;
    const maxBottom = parent.clientHeight - overlay.offsetHeight;
    const newLeft = Math.max(0, Math.min(maxRight, satelliteOverlayDrag!.left + dx));
    const newTop = Math.max(0, Math.min(maxBottom, satelliteOverlayDrag!.top + dy));
    overlay.style.left = `${newLeft}px`;
    overlay.style.top = `${newTop}px`;
    overlay.style.right = "auto";
    overlay.style.bottom = "auto";
  });
});

elements.satelliteOverlayHeader?.addEventListener("pointerup", (event) => {
  if (!satelliteOverlayDrag) return;
  satelliteOverlayDrag = null;
  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
});

elements.satelliteOverlayHeader?.addEventListener("pointercancel", () => {
  satelliteOverlayDrag = null;
  if (satDragRaf !== null) { cancelAnimationFrame(satDragRaf); satDragRaf = null; }
});

// Satellite overlay resize
elements.satelliteOverlayResize?.addEventListener("pointerdown", (event) => {
  const overlay = elements.satelliteOverlay;
  if (!overlay || overlay.hidden) return;
  event.preventDefault();
  event.stopPropagation();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  satelliteOverlayResizeDrag = {
    startX: event.clientX,
    startY: event.clientY,
    width: overlay.offsetWidth,
    height: overlay.offsetHeight,
  };
});

elements.satelliteOverlayResize?.addEventListener("pointermove", (event) => {
  if (!satelliteOverlayResizeDrag) return;
  if (satDragRaf !== null) cancelAnimationFrame(satDragRaf);
  satDragRaf = requestAnimationFrame(() => {
    satDragRaf = null;
    const overlay = elements.satelliteOverlay;
    if (!overlay || overlay.hidden) return;
    const dx = event.clientX - satelliteOverlayResizeDrag!.startX;
    const dy = event.clientY - satelliteOverlayResizeDrag!.startY;
    const parent = overlay.parentElement!;
    const newW = Math.max(320, Math.min(parent.clientWidth, satelliteOverlayResizeDrag!.width + dx));
    const newH = Math.max(240, Math.min(parent.clientHeight, satelliteOverlayResizeDrag!.height + dy));
    overlay.style.width = `${newW}px`;
    overlay.style.height = `${newH}px`;
  });
});

elements.satelliteOverlayResize?.addEventListener("pointerup", (event) => {
  if (!satelliteOverlayResizeDrag) return;
  satelliteOverlayResizeDrag = null;
  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
});

elements.satelliteOverlayResize?.addEventListener("pointercancel", () => {
  satelliteOverlayResizeDrag = null;
  if (satDragRaf !== null) { cancelAnimationFrame(satDragRaf); satDragRaf = null; }
});

elements.exportSettingsButton?.addEventListener("click", () => {
  exportSettingsPreset(getForecastHistory, getWatchlist, getPreferredLocation, getAppSettings, elements.eventLog);
});

elements.importSettingsButton?.addEventListener("click", () => {
  elements.importSettingsFile?.click();
});

elements.importSettingsFile?.addEventListener("change", (event) => {
  const [file] = (event.target as HTMLInputElement).files || [];
  importSettingsPreset(file, elements.eventLog, getForecastHistory, getWatchlist, getPreferredLocation, getAppSettings, saveAppSettings, savePreferredLocation, removeCookieValue, saveForecastHistory, saveWatchlist, setActiveHeatmapLayer, setActiveMapHourOffset, updateSettingsUI, formatSavedLocation, elements);
});

elements.mapPlayButton?.addEventListener("click", toggleMapAnimation);

document.addEventListener("keydown", (event) => {
  const tag = (event.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  if ((event.metaKey || event.ctrlKey) && event.key === "k") {
    event.preventDefault();
    elements.locationInput?.focus();
    elements.locationInput?.select();
    return;
  }

  if (event.key === "Escape") {
    hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
    hideChartTooltip();
    if (elements.locationSuggestions) elements.locationSuggestions.classList.remove("visible");
    return;
  }

  const tabIndex = parseInt(event.key, 10);
  if (tabIndex >= 1 && tabIndex <= 9) {
    const tabs = ["now", "hourly", "outlook", "storm", "air", "trends", "pins", "history", "settings"];
    selectTab(tabs[tabIndex - 1]);
    return;
  }

  if (event.key === "0") {
    selectTab("system");
    return;
  }
});

// Tab clicks (satellite handled separately)
document.querySelectorAll(".tab-button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tabId = (btn as HTMLElement).dataset.tab || "";
    selectTab(tabId);
  });
});

document.querySelector("#panel-collapse")?.addEventListener("click", togglePanel);
document.querySelector("#panel-expand")?.addEventListener("click", togglePanel);
document.querySelector("#drawer-peek")?.addEventListener("click", () => {
  document.querySelector("#data-panel")?.classList.remove("collapsed");
});
document.querySelector("#map-tools-toggle")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const popover = document.querySelector("#map-tools-popover") as HTMLElement | null;
  const toggle = e.currentTarget as HTMLElement;
  if (popover) {
    const isOpen = popover.classList.toggle("open");
    toggle.classList.toggle("active", isOpen);
  }
});
document.addEventListener("click", (e) => {
  const popover = document.querySelector("#map-tools-popover") as HTMLElement | null;
  const toggle = document.querySelector("#map-tools-toggle") as HTMLElement | null;
  if (popover && toggle && !popover.contains(e.target as Node) && !toggle.contains(e.target as Node)) {
    popover.classList.remove("open");
    toggle.classList.remove("active");
  }
});

// --- Init ---
selectTab("now");
document.querySelector(".app-shell")?.classList.add("panel-expanded");

const initialSettings = getAppSettings();
setActiveHeatmapLayer(initialSettings.mapLayer);
setActiveMapHourOffset(initialSettings.mapHourOffset);
if (elements.satelliteSectorSelect) elements.satelliteSectorSelect.value = NOAA_SECTORS[0].id;
if (elements.satelliteProductSelect) {
  elements.satelliteProductSelect.innerHTML = `<option value="">Select a location first</option>`;
}
renderForecastHistoryUI();
renderWatchlistUI();
updateSettingsUI();

const preferredLocation = getPreferredLocation();
if (preferredLocation) {
  if (elements.locationInput) {
    elements.locationInput.value = typeof preferredLocation === "string"
      ? preferredLocation
      : formatLocationLabel(preferredLocation);
  }
  loadWeather(preferredLocation);
}
