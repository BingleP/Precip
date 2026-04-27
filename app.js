const HOURS_TO_SHOW = 24;
const HEATMAP_MIN_COLUMNS = 6;
const HEATMAP_MAX_COLUMNS = 11;
const HEATMAP_MIN_ROWS = 5;
const HEATMAP_MAX_ROWS = 9;
const HEATMAP_VIEW_PADDING = 120;
const HEATMAP_CACHE_TTL_MS = 8 * 60 * 1000;
const HEATMAP_MAX_CACHE_ENTRIES = 24;
const MAP_TILE_SIZE = 256;
const MAP_MIN_ZOOM = 8;
const MAP_MAX_ZOOM = 15;
const MAP_DEFAULT_ZOOM = 10;
const HEATMAP_SCALE = 0.22;
const INITIAL_MAP_CENTER = {
  latitude: 39.8283,
  longitude: -98.5795,
};
const HISTORY_KEY = "precip.forecastHistory.v1";
const WATCHLIST_KEY = "precip.watchlist.v1";
const PREFERRED_LOCATION_KEY = "precip.preferredLocation.v1";
const SETTINGS_KEY = "precip.settings.v1";
const MAX_HISTORY_ITEMS = 12;
const MAP_HOURS_TO_SHOW = 24;
const LOCATION_SUGGESTION_LIMIT = 8;
const DEFAULT_APP_SETTINGS = {
  mapLayer: "temperature",
  mapHourOffset: 0,
};

const elements = {
  stationTitle: document.querySelector("#station-title"),
  stationCopy: document.querySelector("#station-copy"),
  stationCoordinates: document.querySelector("#station-coordinates"),
  updatedAt: document.querySelector("#updated-at"),
  heroKicker: document.querySelector("#hero-kicker"),
  heroLocation: document.querySelector("#hero-location"),
  heroCopy: document.querySelector("#hero-copy"),
  heroTimezone: document.querySelector("#hero-timezone"),
  temperature: document.querySelector("#temperature"),
  currentCondition: document.querySelector("#current-condition"),
  conditionCopy: document.querySelector("#condition-copy"),
  pressure: document.querySelector("#pressure"),
  wind: document.querySelector("#wind"),
  windCompass: document.querySelector("#wind-compass"),
  tempTrend: document.querySelector("#temp-trend"),
  pressureTrend: document.querySelector("#pressure-trend"),
  windDirection: document.querySelector("#wind-direction"),
  watchLevel: document.querySelector("#watch-level"),
  watchCopy: document.querySelector("#watch-copy"),
  warningBar: document.querySelector("#weather-warning"),
  warningLabel: document.querySelector("#warning-label"),
  warningTitle: document.querySelector("#warning-title"),
  warningCopy: document.querySelector("#warning-copy"),
  eventLog: document.querySelector("#event-log"),
  patternList: document.querySelector("#pattern-list"),
  dailyGrid: document.querySelector("#daily-grid"),
  weeklyList: document.querySelector("#weekly-list"),
  historyList: document.querySelector("#history-list"),
  hourlyStrip: document.querySelector("#hourly-strip"),
  refreshButton: document.querySelector("#refresh-button"),
  clearHistoryButton: document.querySelector("#clear-history-button"),
  chartTooltip: document.querySelector("#chart-tooltip"),
  heatmapLegend: document.querySelector("#heatmap-legend"),
  mapHourSlider: document.querySelector("#map-hour-slider"),
  mapHourLabel: document.querySelector("#map-hour-label"),
  mapReadout: document.querySelector("#map-readout"),
  mapTooltip: document.querySelector("#map-tooltip"),
  mapHoverIndicator: document.querySelector("#map-hover-indicator"),
  mapTitle: document.querySelector("#map-title"),
  mapCopy: document.querySelector("#map-copy"),
  mapZoomIn: document.querySelector("#map-zoom-in"),
  mapZoomOut: document.querySelector("#map-zoom-out"),
  mapReset: document.querySelector("#map-reset"),
  locationForm: document.querySelector("#location-form"),
  locationInput: document.querySelector("#location-input"),
  locationSearchNote: document.querySelector("#location-search-note"),
  locationSuggestions: document.querySelector("#location-suggestions"),
  defaultLocationLabel: document.querySelector("#default-location-label"),
  setDefaultLocationButton: document.querySelector("#set-default-location-button"),
  resetDefaultLocationButton: document.querySelector("#reset-default-location-button"),
  settingsMapLayer: document.querySelector("#settings-map-layer"),
  settingsStartHour: document.querySelector("#settings-start-hour"),
  clearWatchlistButton: document.querySelector("#clear-watchlist-button"),
  clearHistorySettingsButton: document.querySelector("#clear-history-settings-button"),
  exportSettingsButton: document.querySelector("#export-settings-button"),
  importSettingsButton: document.querySelector("#import-settings-button"),
  importSettingsFile: document.querySelector("#import-settings-file"),
  stormGrid: document.querySelector("#storm-grid"),
  stormSignals: document.querySelector("#storm-signals"),
  stormRiskBadge: document.querySelector("#storm-risk-badge"),
  stormRiskFill: document.querySelector("#storm-risk-fill"),
  airGrid: document.querySelector("#air-grid"),
  confidenceGrid: document.querySelector("#confidence-grid"),
  contextGrid: document.querySelector("#context-grid"),
  watchlistGrid: document.querySelector("#watchlist-grid"),
  pinLocationButton: document.querySelector("#pin-location-button"),
};

const chartCanvas = document.querySelector("#weather-chart");
const chartCtx = chartCanvas.getContext("2d");
const heatmapCanvas = document.querySelector("#heatmap-canvas");
const heatmapCtx = heatmapCanvas.getContext("2d");

let activeLocation = null;
let latestForecast = null;
let latestHeatmap = null;
let latestHeatmapMeta = null;
let latestAirQuality = null;
let weatherLoadId = 0;
let heatmapRefreshToken = 0;
let heatmapRefreshTimer = null;
let activeHeatmapLayer = "temperature";
let activeMapHourOffset = 0;
let searchDebounceTimer = null;
let searchRequestToken = 0;
let activeLocationSuggestions = [];
let selectedLocationSuggestion = null;
const mapState = {
  center: { latitude: INITIAL_MAP_CENTER.latitude, longitude: INITIAL_MAP_CENTER.longitude },
  zoom: MAP_DEFAULT_ZOOM,
  drag: null,
  selected: null,
  renderQueued: false,
};
const tileCache = new Map();
const heatmapCache = new Map();
const heatmapRequestCache = new Map();
const chartState = {
  hoverIndex: null,
  points: [],
};
const heatmapButtons = [...document.querySelectorAll(".heatmap-button")];

function addLog(message) {
  const item = document.createElement("li");
  const text = document.createElement("span");
  const timestamp = document.createElement("time");
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  text.textContent = message;
  timestamp.textContent = time;
  item.append(text, timestamp);
  elements.eventLog.prepend(item);

  while (elements.eventLog.children.length > 7) {
    elements.eventLog.lastElementChild.remove();
  }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[^\w\s,]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function formatLocationLabel(location) {
  return [location.name, location.admin, location.country].filter(Boolean).join(", ");
}

function getCookieValue(name) {
  const row = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`));
  return row ? row.slice(name.length + 1) : null;
}

function setCookieValue(name, value, maxAge = 31536000) {
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax`;
}

function removeCookieValue(name) {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

function readCookieJSON(name) {
  const value = getCookieValue(name);
  if (!value) return null;
  try {
    return JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
}

function writeCookieJSON(name, value) {
  try {
    setCookieValue(name, encodeURIComponent(JSON.stringify(value)));
    return true;
  } catch {
    return false;
  }
}

function normalizeMapLayer(value) {
  return heatmapButtons.some((button) => button.dataset.layer === value) ? value : DEFAULT_APP_SETTINGS.mapLayer;
}

function normalizeMapHourOffset(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return DEFAULT_APP_SETTINGS.mapHourOffset;
  return Math.max(0, Math.min(MAP_HOURS_TO_SHOW - 1, Math.round(next)));
}

function getAppSettings() {
  const parsed = readCookieJSON(SETTINGS_KEY);
  return {
    mapLayer: normalizeMapLayer(parsed?.mapLayer),
    mapHourOffset: normalizeMapHourOffset(parsed?.mapHourOffset),
  };
}

function saveAppSettings(partial) {
  const next = {
    ...getAppSettings(),
    ...partial,
  };
  next.mapLayer = normalizeMapLayer(next.mapLayer);
  next.mapHourOffset = normalizeMapHourOffset(next.mapHourOffset);
  writeCookieJSON(SETTINGS_KEY, next);
  return next;
}

function formatSavedLocation(location) {
  if (!location) return "Not set";
  if (typeof location === "string") return location;
  return formatLocationLabel(location);
}

function updateSettingsUI() {
  const savedLocation = getPreferredLocation();
  const settings = getAppSettings();
  elements.defaultLocationLabel.textContent = formatSavedLocation(savedLocation);
  elements.settingsMapLayer.value = settings.mapLayer;
  elements.settingsStartHour.value = `${settings.mapHourOffset}`;
  elements.setDefaultLocationButton.disabled = !activeLocation;
  elements.resetDefaultLocationButton.disabled = !savedLocation;
}

function setActiveHeatmapLayer(layer, { persist = false } = {}) {
  activeHeatmapLayer = normalizeMapLayer(layer);
  heatmapButtons.forEach((button) => button.classList.toggle("active", button.dataset.layer === activeHeatmapLayer));
  elements.settingsMapLayer.value = activeHeatmapLayer;
  if (persist) saveAppSettings({ mapLayer: activeHeatmapLayer });
  if (latestHeatmap) renderHeatmap(latestHeatmap, activeHeatmapLayer);
}

function setActiveMapHourOffset(offset, { persist = false } = {}) {
  activeMapHourOffset = normalizeMapHourOffset(offset);
  elements.mapHourSlider.value = `${activeMapHourOffset}`;
  elements.settingsStartHour.value = `${activeMapHourOffset}`;
  hideMapTooltip();
  if (persist) saveAppSettings({ mapHourOffset: activeMapHourOffset });
  if (latestHeatmap) renderHeatmap(latestHeatmap, activeHeatmapLayer);
}

function saveCurrentAsPreferredLocation() {
  if (!activeLocation) return;
  savePreferredLocation(activeLocation);
  updateSettingsUI();
  addLog(`${activeLocation.name} saved as the default location.`);
}

function clearPreferredLocationSetting() {
  removeCookieValue(PREFERRED_LOCATION_KEY);
  updateSettingsUI();
  addLog("Saved default location cleared.");
  window.location.replace("welcome.html");
}

function clearSavedWatchlist() {
  removeCookieValue(WATCHLIST_KEY);
  renderWatchlist([]);
  addLog("Pinned locations cleared.");
}

function clearSavedHistory() {
  removeCookieValue(HISTORY_KEY);
  renderForecastHistory([]);
  addLog("Forecast history cleared.");
}

function buildSettingsPreset() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    preferredLocation: getPreferredLocation(),
    settings: getAppSettings(),
    watchlist: getWatchlist(),
    history: getForecastHistory(),
  };
}

function exportSettingsPreset() {
  try {
    const preset = buildSettingsPreset();
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `precip-preset-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    addLog("Settings preset exported.");
  } catch {
    addLog("Settings preset export failed.");
  }
}

function isLocationLike(value) {
  return value && typeof value === "object" && typeof value.name === "string" && Number.isFinite(Number(value.latitude)) && Number.isFinite(Number(value.longitude));
}

function applyImportedPreset(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Preset file is invalid.");
  }

  const settings = payload.settings && typeof payload.settings === "object" ? payload.settings : {};
  const nextSettings = saveAppSettings({
    mapLayer: settings.mapLayer,
    mapHourOffset: settings.mapHourOffset,
  });

  if (payload.preferredLocation && isLocationLike(payload.preferredLocation)) {
    savePreferredLocation(payload.preferredLocation);
  } else if (payload.preferredLocation === null) {
    removeCookieValue(PREFERRED_LOCATION_KEY);
  }

  if (Array.isArray(payload.watchlist)) {
    saveWatchlist(payload.watchlist.filter(isLocationLike));
  }

  if (Array.isArray(payload.history)) {
    writeCookieJSON(HISTORY_KEY, payload.history.slice(0, MAX_HISTORY_ITEMS));
    renderForecastHistory(payload.history.slice(0, MAX_HISTORY_ITEMS));
  }

  setActiveHeatmapLayer(nextSettings.mapLayer);
  setActiveMapHourOffset(nextSettings.mapHourOffset);
  updateSettingsUI();

  const preferredLocation = getPreferredLocation();
  if (preferredLocation) {
    elements.locationInput.value = formatSavedLocation(preferredLocation);
  }

  addLog("Settings preset imported.");
}

async function importSettingsPreset(file) {
  if (!file) return;
  try {
    const raw = await file.text();
    const payload = JSON.parse(raw);
    applyImportedPreset(payload);
  } catch (error) {
    addLog(error.message || "Settings preset import failed.");
  } finally {
    elements.importSettingsFile.value = "";
  }
}

function getPrecipBarClass(value) {
  const normalized = Math.max(0, Math.min(100, Number(value) || 0));
  return `bar-${Math.round(normalized / 10) * 10}`;
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function degreesToCompass(degrees) {
  if (!Number.isFinite(degrees)) return "--";
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(degrees / 45) % 8];
}

function describeWeatherCode(code) {
  const codes = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    80: "Rain showers",
    81: "Showers",
    82: "Heavy showers",
    95: "Thunderstorm",
    96: "Thunderstorm hail",
    99: "Severe storm",
  };

  return codes[code] || "Mixed conditions";
}

function formatDay(dateText, style = "short") {
  return new Date(`${dateText}T12:00:00`).toLocaleDateString([], {
    weekday: style,
    month: "short",
    day: "numeric",
  });
}

function describeDelta(value, unit, risingText, fallingText) {
  if (!Number.isFinite(value)) return "Trend unavailable";
  if (Math.abs(value) < 0.1) return "Stable last 3 hours";
  const direction = value > 0 ? risingText : fallingText;
  return `${direction} ${Math.abs(value).toFixed(1)} ${unit} last 3 hours`;
}

function findCurrentIndex(times) {
  const now = Date.now();
  let bestIndex = 0;
  let smallestDiff = Infinity;

  times.forEach((time, index) => {
    const diff = Math.abs(new Date(time).getTime() - now);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      bestIndex = index;
    }
  });

  return bestIndex;
}

async function geocodeLocationCandidates(query, count = LOCATION_SUGGESTION_LIMIT) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url);
  if (!response.ok) throw new Error("Location lookup failed");

  const data = await response.json();
  if (!data.results?.length) throw new Error(`No weather location found for "${query}"`);

  return data.results
    .map((result) => ({
      name: result.name,
      admin: result.admin1,
      country: result.country,
      countryCode: result.country_code,
      latitude: result.latitude,
      longitude: result.longitude,
      timezone: result.timezone,
      population: result.population || 0,
    }))
    .sort((a, b) => b.population - a.population);
}

function locationSearchVariants(location) {
  return [
    location.name,
    [location.name, location.admin].filter(Boolean).join(", "),
    formatLocationLabel(location),
  ]
    .map(normalizeSearchText)
    .filter(Boolean);
}

function matchesLocationQuery(location, query) {
  const normalizedQuery = normalizeSearchText(query);
  return locationSearchVariants(location).some((variant) => variant === normalizedQuery);
}

function rankLocationCandidates(candidates, query) {
  const normalizedQuery = normalizeSearchText(query);
  return [...candidates].sort((left, right) => {
    const leftVariants = locationSearchVariants(left);
    const rightVariants = locationSearchVariants(right);
    const leftExact = leftVariants.includes(normalizedQuery) ? 1 : 0;
    const rightExact = rightVariants.includes(normalizedQuery) ? 1 : 0;
    if (leftExact !== rightExact) return rightExact - leftExact;

    const leftStarts = leftVariants.some((variant) => variant.startsWith(normalizedQuery)) ? 1 : 0;
    const rightStarts = rightVariants.some((variant) => variant.startsWith(normalizedQuery)) ? 1 : 0;
    if (leftStarts !== rightStarts) return rightStarts - leftStarts;

    return (right.population || 0) - (left.population || 0);
  });
}

async function reverseGeocodeLocation(latitude, longitude) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", latitude.toFixed(6));
  url.searchParams.set("lon", longitude.toFixed(6));
  url.searchParams.set("zoom", "10");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "en");

  const response = await fetch(url);
  if (!response.ok) throw new Error("Map location lookup failed");

  const data = await response.json();
  const address = data.address || {};
  const name =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.hamlet ||
    address.county ||
    data.name ||
    "Selected location";

  return {
    name,
    admin: address.state || address.region || address.province || address.county,
    country: address.country_code ? address.country_code.toUpperCase() : address.country,
    latitude,
    longitude,
    timezone: "auto",
  };
}

async function fetchForecast(location) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", location.latitude);
  url.searchParams.set("longitude", location.longitude);
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,precipitation,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,cloud_cover");
  url.searchParams.set("hourly", "temperature_2m,dew_point_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,rain,showers,snowfall,snow_depth,weather_code,pressure_msl,surface_pressure,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,wind_speed_10m,wind_speed_100m,wind_direction_10m,wind_direction_100m,wind_gusts_10m,cape,vapour_pressure_deficit,soil_temperature_0cm,soil_moisture_0_to_1cm");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset,uv_index_max");
  url.searchParams.set("forecast_days", "7");

  const response = await fetch(url);
  if (!response.ok) throw new Error("Weather data request failed");
  return response.json();
}

async function fetchAirQuality(location) {
  const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  url.searchParams.set("latitude", location.latitude);
  url.searchParams.set("longitude", location.longitude);
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("hourly", "pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone,uv_index,us_aqi");
  url.searchParams.set("forecast_days", "2");

  const response = await fetch(url);
  if (!response.ok) throw new Error("Air quality request failed");
  return response.json();
}

async function fetchHeatmap() {
  const viewport = getHeatmapViewportDefinition();
  const cacheKey = getHeatmapViewportCacheKey(viewport);
  const cached = getCachedHeatmap(cacheKey);
  if (cached) {
    return cached;
  }

  if (heatmapRequestCache.has(cacheKey)) {
    return heatmapRequestCache.get(cacheKey);
  }

  const points = buildHeatmapPoints(viewport);
  const request = (async () => {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", points.map((point) => point.latitude.toFixed(4)).join(","));
    url.searchParams.set("longitude", points.map((point) => point.longitude.toFixed(4)).join(","));
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("hourly", "temperature_2m,dew_point_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,pressure_msl,cloud_cover,visibility,cape");
    url.searchParams.set("forecast_hours", String(MAP_HOURS_TO_SHOW));

    const response = await fetch(url);
    if (!response.ok) throw new Error("Regional heatmap request failed");

    const data = await response.json();
    const rows = Array.isArray(data) ? data : [data];
    const result = {
      points: points.map((point, index) => ({
        ...point,
        hourly: rows[index]?.hourly || {},
      })),
      meta: {
        ...viewport,
        cacheKey,
        fetchedAt: Date.now(),
      },
    };
    setCachedHeatmap(cacheKey, result);
    return result;
  })();

  heatmapRequestCache.set(cacheKey, request);
  try {
    return await request;
  } finally {
    heatmapRequestCache.delete(cacheKey);
  }
}

function getMapViewportSize() {
  const rect = heatmapCanvas.getBoundingClientRect();
  return {
    width: Math.max(320, Math.round(rect.width || heatmapCanvas.clientWidth || 920)),
    height: Math.max(260, Math.round(rect.height || heatmapCanvas.clientHeight || 560)),
  };
}

function getHeatmapViewportDefinition() {
  const { width, height } = getMapViewportSize();
  const zoom = Math.round(mapState.zoom);
  const centerWorld = latLonToWorld(mapState.center.latitude, mapState.center.longitude, zoom);
  const padding = Math.max(60, Math.min(HEATMAP_VIEW_PADDING, Math.round(Math.min(width, height) * 0.2)));
  const left = centerWorld.x - width / 2 - padding;
  const right = centerWorld.x + width / 2 + padding;
  const top = centerWorld.y - height / 2 - padding;
  const bottom = centerWorld.y + height / 2 + padding;

  return {
    zoom,
    width,
    height,
    padding,
    left,
    right,
    top,
    bottom,
    columns: getHeatmapColumnCount(width, zoom),
    rows: getHeatmapRowCount(height, zoom),
  };
}

function getHeatmapColumnCount(width, zoom) {
  const zoomBias = Math.max(0, zoom - MAP_DEFAULT_ZOOM);
  return Math.max(HEATMAP_MIN_COLUMNS, Math.min(HEATMAP_MAX_COLUMNS, Math.round(width / 165) + Math.min(3, zoomBias)));
}

function getHeatmapRowCount(height, zoom) {
  const zoomBias = Math.max(0, zoom - MAP_DEFAULT_ZOOM);
  return Math.max(HEATMAP_MIN_ROWS, Math.min(HEATMAP_MAX_ROWS, Math.round(height / 135) + Math.min(2, zoomBias)));
}

function getHeatmapViewportCacheKey(viewport) {
  const center = worldToLatLon((viewport.left + viewport.right) / 2, (viewport.top + viewport.bottom) / 2, viewport.zoom);
  const latStep = viewport.rows > 1 ? Math.abs(worldToLatLon((viewport.left + viewport.right) / 2, viewport.top, viewport.zoom).latitude - worldToLatLon((viewport.left + viewport.right) / 2, viewport.top + (viewport.bottom - viewport.top) / (viewport.rows - 1), viewport.zoom).latitude) : 0.5;
  const lonStep = viewport.columns > 1 ? Math.abs(worldToLatLon(viewport.left, (viewport.top + viewport.bottom) / 2, viewport.zoom).longitude - worldToLatLon(viewport.left + (viewport.right - viewport.left) / (viewport.columns - 1), (viewport.top + viewport.bottom) / 2, viewport.zoom).longitude) : 0.5;
  const precisionLat = Math.max(0.08, latStep * 0.9);
  const precisionLon = Math.max(0.08, lonStep * 0.9);
  const latBucket = Math.round(center.latitude / precisionLat);
  const lonBucket = Math.round(center.longitude / precisionLon);
  return [viewport.zoom, viewport.columns, viewport.rows, latBucket, lonBucket].join(":");
}

function getCachedHeatmap(cacheKey) {
  const entry = heatmapCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > HEATMAP_CACHE_TTL_MS) {
    heatmapCache.delete(cacheKey);
    return null;
  }
  return entry.data;
}

function setCachedHeatmap(cacheKey, data) {
  heatmapCache.set(cacheKey, {
    savedAt: Date.now(),
    data,
  });

  while (heatmapCache.size > HEATMAP_MAX_CACHE_ENTRIES) {
    const oldestKey = heatmapCache.keys().next().value;
    heatmapCache.delete(oldestKey);
  }
}

function buildHeatmapPoints(viewport = getHeatmapViewportDefinition()) {
  const points = [];
  const rowStep = viewport.rows > 1 ? (viewport.bottom - viewport.top) / (viewport.rows - 1) : 0;
  const columnStep = viewport.columns > 1 ? (viewport.right - viewport.left) / (viewport.columns - 1) : 0;

  for (let row = 0; row < viewport.rows; row += 1) {
    for (let column = 0; column < viewport.columns; column += 1) {
      const world = {
        x: viewport.left + column * columnStep,
        y: viewport.top + row * rowStep,
      };
      const projected = worldToLatLon(world.x, world.y, viewport.zoom);
      points.push({
        row,
        column,
        latitude: projected.latitude,
        longitude: projected.longitude,
      });
    }
  }

  return points;
}

function scheduleHeatmapRefresh(delay = 320) {
  if (!activeLocation) return;
  clearTimeout(heatmapRefreshTimer);
  const requestToken = ++heatmapRefreshToken;
  heatmapRefreshTimer = setTimeout(() => {
    refreshHeatmapForViewport(requestToken);
  }, delay);
}

async function refreshHeatmapForViewport(requestToken = ++heatmapRefreshToken) {
  if (!activeLocation) return;
  try {
    const result = await fetchHeatmap();
    if (requestToken !== heatmapRefreshToken || !activeLocation) return;
    latestHeatmap = result.points;
    latestHeatmapMeta = result.meta;
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  } catch (error) {
    if (requestToken !== heatmapRefreshToken) return;
    addLog(error.message || "Regional heatmap request failed");
    if (latestHeatmap?.length) {
      renderHeatmap(latestHeatmap, activeHeatmapLayer);
      return;
    }
    latestHeatmap = null;
    latestHeatmapMeta = null;
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  }
}

function setLoadingState(message) {
  if (activeLocation) {
    elements.heroLocation.textContent = activeLocation.name;
    elements.heroKicker.textContent = "Refreshing weather brief";
    elements.heroTimezone.textContent = activeLocation.timezone || "Local timezone pending";
  }
  elements.heroCopy.textContent = "Pulling the latest forecast, regional map samples, and analysis tools for the selected location.";
  elements.tempTrend.textContent = message;
  elements.pressureTrend.textContent = "Waiting for API response";
  elements.windDirection.textContent = "Waiting for API response";
  elements.watchCopy.textContent = "Waiting for API response";
}

function updateCurrentConditions(location, forecast) {
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

  const placeName = [location.name, location.admin, location.country].filter(Boolean).join(", ");
  const regionalName = [location.admin, location.country].filter(Boolean).join(", ");
  elements.stationTitle.textContent = placeName;
  elements.stationCopy.textContent = `Live forecast feed for ${location.name}. Hardware receiver feed is separate.`;
  elements.stationCoordinates.textContent = `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`;
  elements.updatedAt.textContent = new Date(current.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  elements.heroKicker.textContent = regionalName ? `Live weather brief for ${regionalName}` : "Live weather brief";
  elements.heroLocation.textContent = location.name;
  elements.heroTimezone.textContent = location.timezone || forecast.timezone || "Local timezone unavailable";
  elements.heroCopy.textContent = `${describeWeatherCode(daily.weather_code[0])} with ${Math.round(daily.temperature_2m_max[0])}° / ${Math.round(daily.temperature_2m_min[0])}° today. Next-hour precipitation signal is ${Number.isFinite(nextPrecipChance) ? `${nextPrecipChance}%` : "unavailable"}.`;
  elements.mapTitle.textContent = `${location.name} Regional Weather Field`;
  elements.mapCopy.textContent = `Interactive forecast map centered on ${placeName}. Click any point on the map to switch the briefing to that area.`;
  elements.locationInput.value = placeName;
  elements.temperature.textContent = formatNumber(current.temperature_2m);
  elements.currentCondition.textContent = describeWeatherCode(daily.weather_code[0]);
  elements.conditionCopy.textContent = `${Math.round(daily.temperature_2m_max[0])}° high, ${Math.round(daily.temperature_2m_min[0])}° low today`;
  elements.pressure.textContent = formatNumber(current.pressure_msl);
  elements.wind.textContent = Math.round(current.wind_speed_10m);
  elements.windCompass.textContent = degreesToCompass(current.wind_direction_10m);
  elements.tempTrend.textContent = describeDelta(temperatureDelta, "°C", "Warming", "Cooling");
  elements.pressureTrend.textContent = describeDelta(pressureDelta, "hPa", "Rising", "Falling");
  elements.windDirection.textContent = `From ${Math.round(current.wind_direction_10m)}° with gusts to ${Math.round(current.wind_gusts_10m)} km/h`;
  elements.watchLevel.textContent = formatNumber(nextPrecip);
  elements.watchCopy.textContent = Number.isFinite(nextPrecipChance)
    ? `${nextPrecipChance}% chance in the next hour`
    : "Next-hour probability unavailable";
}

function updateWeatherWarning(forecast) {
  const hourly = forecast.hourly;
  const daily = forecast.daily;
  const currentIndex = findCurrentIndex(hourly.time);
  const nextTwelveHours = hourly.time.slice(currentIndex, currentIndex + 12).map((_, offset) => currentIndex + offset);
  const nextSixHours = hourly.time.slice(currentIndex, currentIndex + 6).map((_, offset) => currentIndex + offset);
  const maxGust = Math.max(...nextTwelveHours.map((index) => hourly.wind_gusts_10m[index] || 0));
  const maxPrecipChance = Math.max(...nextTwelveHours.map((index) => hourly.precipitation_probability[index] || 0));
  const precipTotal = nextTwelveHours.reduce((total, index) => total + (hourly.precipitation[index] || 0), 0);
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
      ? `Storm conditions appear in today's forecast. Peak gusts may reach ${Math.round(maxGust)} km/h.`
      : `Forecast gusts may reach ${Math.round(maxGust)} km/h in the next 12 hours.`;
  } else if (heavyRainToday || precipTotal >= 10 || maxPrecipChance >= 75) {
    level = "watch";
    label = "Weather Watch";
    title = "Rain risk is elevated";
    copy = `${precipTotal.toFixed(1)} mm is forecast over the next 12 hours, with peak probability near ${maxPrecipChance}%.`;
  } else if (maxGust >= 45 || pressureDrop >= 3 || precipTotal >= 3) {
    level = "advisory";
    label = "Weather Advisory";
    title = maxGust >= 45 ? "Gusty winds possible" : "Changing weather pattern";
    copy =
      maxGust >= 45
        ? `Gusts may reach ${Math.round(maxGust)} km/h in the next 12 hours.`
        : `Pressure may fall ${pressureDrop.toFixed(1)} hPa over 6 hours with ${precipTotal.toFixed(1)} mm possible.`;
  }

  elements.warningBar.className = `weather-warning ${level}`;
  elements.warningLabel.textContent = label;
  elements.warningTitle.textContent = title;
  elements.warningCopy.textContent = copy;
}

function renderPatterns(forecast) {
  const hourly = forecast.hourly;
  const currentIndex = findCurrentIndex(hourly.time);
  const nextSixHours = hourly.time.slice(currentIndex, currentIndex + 6).map((_, offset) => currentIndex + offset);
  const nextPrecipTotal = nextSixHours.reduce((total, index) => total + (hourly.precipitation[index] || 0), 0);
  const maxPrecipChance = Math.max(...nextSixHours.map((index) => hourly.precipitation_probability[index] || 0));
  const pressureNow = hourly.pressure_msl[currentIndex];
  const pressureLater = hourly.pressure_msl[Math.min(hourly.pressure_msl.length - 1, currentIndex + 6)];
  const windNow = hourly.wind_speed_10m[currentIndex];
  const windLater = hourly.wind_speed_10m[Math.min(hourly.wind_speed_10m.length - 1, currentIndex + 6)];

  const patterns = [
    {
      level: pressureLater < pressureNow - 1.5 ? "high" : "low",
      title: "Pressure Trend",
      copy:
        pressureLater < pressureNow - 1.5
          ? `Pressure may fall ${(pressureNow - pressureLater).toFixed(1)} hPa in the next 6 hours.`
          : `Pressure is fairly steady over the next 6 hours: ${(pressureLater - pressureNow).toFixed(1)} hPa.`,
    },
    {
      level: maxPrecipChance >= 60 || nextPrecipTotal >= 2 ? "medium" : "low",
      title: "Rain Window",
      copy: `${nextPrecipTotal.toFixed(1)} mm forecast over 6 hours, with peak probability at ${maxPrecipChance}%.`,
    },
    {
      level: windLater > windNow + 8 ? "medium" : "low",
      title: "Wind Change",
      copy: `Wind changes from ${Math.round(windNow)} to ${Math.round(windLater)} km/h over the next 6 hours.`,
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

function getCurrentHourlyIndex(forecast) {
  return findCurrentIndex(forecast.hourly.time);
}

function hourlyValue(forecast, key, offset = 0) {
  const hourly = forecast.hourly;
  const index = Math.min(hourly.time.length - 1, getCurrentHourlyIndex(forecast) + offset);
  return hourly[key]?.[index];
}

function maxNext(forecast, key, hours = 12) {
  const hourly = forecast.hourly;
  const start = getCurrentHourlyIndex(forecast);
  const values = hourly.time.slice(start, start + hours).map((_, offset) => hourly[key]?.[start + offset]).filter(Number.isFinite);
  return values.length ? Math.max(...values) : NaN;
}

function sumNext(forecast, key, hours = 12) {
  const hourly = forecast.hourly;
  const start = getCurrentHourlyIndex(forecast);
  return hourly.time.slice(start, start + hours).reduce((total, _, offset) => total + (hourly[key]?.[start + offset] || 0), 0);
}

function calculateStormRisk(forecast) {
  const cape = maxNext(forecast, "cape", 12);
  const dewPoint = maxNext(forecast, "dew_point_2m", 12);
  const gusts = maxNext(forecast, "wind_gusts_10m", 12);
  const rainChance = maxNext(forecast, "precipitation_probability", 12);
  const rainTotal = sumNext(forecast, "precipitation", 12);
  const pressureDrop = hourlyValue(forecast, "pressure_msl", 0) - hourlyValue(forecast, "pressure_msl", 6);
  const shear = Math.abs((hourlyValue(forecast, "wind_speed_100m", 0) || 0) - (hourlyValue(forecast, "wind_speed_10m", 0) || 0));
  const stormCode = [95, 96, 99].includes(forecast.daily.weather_code?.[0]);
  let score = 0;
  score += Math.min(25, (cape || 0) / 60);
  score += Math.max(0, Math.min(15, ((dewPoint || 0) - 12) * 2));
  score += Math.min(18, (gusts || 0) / 4);
  score += Math.min(14, (rainChance || 0) / 7);
  score += Math.min(12, rainTotal * 1.4);
  score += Math.max(0, Math.min(10, pressureDrop * 2));
  score += Math.min(8, shear / 3);
  if (stormCode) score += 18;
  score = Math.max(0, Math.min(100, score));
  const level = score >= 72 ? "High" : score >= 48 ? "Elevated" : score >= 25 ? "Monitor" : "Quiet";
  return { score, level, cape, dewPoint, gusts, rainChance, rainTotal, pressureDrop, shear };
}

function renderStormToolkit(forecast) {
  const risk = calculateStormRisk(forecast);
  elements.stormRiskBadge.textContent = `${risk.level} ${Math.round(risk.score)}`;
  elements.stormRiskFill.style.width = `${Math.round(risk.score)}%`;
  elements.stormGrid.innerHTML = [
    ["CAPE", formatHeatmapValue(risk.cape, "cape"), "Convective available potential energy"],
    ["Dew point", formatHeatmapValue(risk.dewPoint, "dewpoint"), "Moisture available near the surface"],
    ["Peak gust", formatHeatmapValue(risk.gusts, "gusts"), "Highest gust in the next 12 hours"],
    ["Rain chance", formatHeatmapValue(risk.rainChance, "precipProbability"), "Peak probability in the next 12 hours"],
    ["12h rain", formatHeatmapValue(risk.rainTotal, "precipitation"), "Total precipitation window"],
    ["Pressure drop", `${formatNumber(risk.pressureDrop)} hPa`, "Six-hour pressure tendency"],
    ["Wind shear proxy", `${formatNumber(risk.shear)} km/h`, "100 m minus 10 m wind speed"],
    ["Visibility", formatHeatmapValue(hourlyValue(forecast, "visibility"), "visibility"), "Near-term surface visibility"],
  ]
    .map(([label, value, copy]) => `<article class="toolkit-card"><span>${label}</span><strong>${value}</strong><small>${copy}</small></article>`)
    .join("");

  const signals = [
    risk.cape >= 800 ? "Instability is supportive of convection." : "Instability signal is limited.",
    risk.pressureDrop >= 3 ? "Pressure is falling quickly enough to monitor." : "Pressure tendency is not strongly concerning.",
    risk.gusts >= 55 ? "Wind gusts may become hazardous." : "Gust signal remains below severe thresholds.",
  ];
  elements.stormSignals.innerHTML = signals.map((copy) => `<div class="pattern-item low"><span></span><div><strong>Signal</strong><p>${copy}</p></div></div>`).join("");
}

function renderAirQuality(airQuality) {
  if (!airQuality?.hourly?.time) {
    elements.airGrid.innerHTML = `<div class="empty-signal">Air quality data unavailable.</div>`;
    return;
  }
  const index = findCurrentIndex(airQuality.hourly.time);
  const hourly = airQuality.hourly;
  elements.airGrid.innerHTML = [
    ["US AQI", hourly.us_aqi?.[index], "", "Overall air quality index"],
    ["PM2.5", hourly.pm2_5?.[index], " ug/m3", "Fine particulate/smoke indicator"],
    ["PM10", hourly.pm10?.[index], " ug/m3", "Coarse particulate load"],
    ["Ozone", hourly.ozone?.[index], " ug/m3", "Surface ozone concentration"],
    ["NO2", hourly.nitrogen_dioxide?.[index], " ug/m3", "Traffic/combustion signal"],
    ["CO", hourly.carbon_monoxide?.[index], " ug/m3", "Carbon monoxide"],
    ["UV", hourly.uv_index?.[index], "", "Sun exposure index"],
    ["Next AQI peak", Math.max(...hourly.us_aqi.filter(Number.isFinite)), "", "Highest available forecast value"],
  ]
    .map(([label, value, unit, copy]) => `<article class="toolkit-card"><span>${label}</span><strong>${Number.isFinite(value) ? Math.round(value) + unit : "--"}</strong><small>${copy}</small></article>`)
    .join("");
}

function renderConfidence(forecast) {
  const pressureChange = Math.abs(hourlyValue(forecast, "pressure_msl", 0) - hourlyValue(forecast, "pressure_msl", 12));
  const gustSpread = maxNext(forecast, "wind_gusts_10m", 24) - (hourlyValue(forecast, "wind_gusts_10m") || 0);
  const rainWindow = maxNext(forecast, "precipitation_probability", 24);
  const cloudRange = maxNext(forecast, "cloud_cover", 24) - Math.min(...forecast.hourly.cloud_cover.slice(getCurrentHourlyIndex(forecast), getCurrentHourlyIndex(forecast) + 24).filter(Number.isFinite));
  const confidence = Math.max(0, Math.min(100, 100 - pressureChange * 5 - gustSpread * 0.5 - cloudRange * 0.15 - (rainWindow > 50 ? 8 : 0)));
  elements.confidenceGrid.innerHTML = [
    ["Confidence", `${Math.round(confidence)}%`, "Lower when pressure, cloud, rain, and gust signals vary sharply"],
    ["Gust spread", `${formatNumber(gustSpread)} km/h`, "Change from now to the peak gust window"],
    ["Cloud range", `${Math.round(cloudRange)}%`, "Cloud cover variability over 24 hours"],
    ["Rain peak", `${Math.round(rainWindow)}%`, "Peak precipitation probability over 24 hours"],
  ]
    .map(([label, value, copy]) => `<article class="toolkit-card"><span>${label}</span><strong>${value}</strong><small>${copy}</small></article>`)
    .join("");
}

function renderContext(forecast) {
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
    ["Soil temp", `${formatNumber(hourlyValue(forecast, "soil_temperature_0cm"))}°C`, "Surface soil temperature"],
  ]
    .map(([label, value, copy]) => `<article class="toolkit-card"><span>${label}</span><strong>${value}</strong><small>${copy}</small></article>`)
    .join("");
}

function renderDailyForecast(forecast) {
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
            <strong>${Math.round(daily.temperature_2m_max[index])}°</strong>
            <small>${Math.round(daily.temperature_2m_min[index])}° low</small>
          </div>
          <dl class="forecast-details">
            <div><dt>Precip</dt><dd>${formatNumber(daily.precipitation_sum[index])} mm</dd></div>
            <div><dt>Chance</dt><dd>${daily.precipitation_probability_max[index] ?? "--"}%</dd></div>
            <div><dt>Wind</dt><dd>${Math.round(daily.wind_speed_10m_max[index])} km/h</dd></div>
            <div><dt>Gusts</dt><dd>${Math.round(daily.wind_gusts_10m_max[index])} km/h</dd></div>
            <div><dt>Sunrise</dt><dd>${new Date(daily.sunrise[index]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd></div>
            <div><dt>Sunset</dt><dd>${new Date(daily.sunset[index]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd></div>
          </dl>
        </article>
      `;
    })
    .join("");
}

function renderWeeklyForecast(forecast) {
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
            <span>${Math.round(daily.temperature_2m_max[index])}°</span>
            <small>${Math.round(daily.temperature_2m_min[index])}°</small>
          </div>
          <div class="weekly-bar" aria-hidden="true">
            <span class="${getPrecipBarClass(daily.precipitation_probability_max[index])}"></span>
          </div>
          <div class="weekly-meta">
            <span>${daily.precipitation_probability_max[index] ?? "--"}%</span>
            <small>${formatNumber(daily.precipitation_sum[index])} mm</small>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderHourlyForecast(forecast) {
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
          <strong>${Math.round(hourly.temperature_2m[index])}°</strong>
          <small>${chance}% rain</small>
          <small>${Math.round(hourly.wind_speed_10m[index])} km/h</small>
        </article>
      `;
    })
    .join("");
}

function renderHeatmap(points = latestHeatmap, layer = activeHeatmapLayer) {
  const { width, height } = prepareCanvas(heatmapCanvas, heatmapCtx);
  drawMapTiles(width, height);

  if (!points?.length) {
    drawMapOverlayText(width, "Regional weather layer unavailable");
    return;
  }

  const values = points.map((point) => getHeatmapValue(point, layer));
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) {
    drawMapOverlayText(width, "Weather samples unavailable");
    return;
  }

  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);

  drawHeatmapOverlay(points, values, layer, min, max, width, height);
  drawMapPlaces(width, height);
  renderMapReadout(layer, min, max);
  renderHeatmapLegend(layer, min, max);
  updateMapHourLabel();
}

function renderHeatmapLoading(message = "Loading regional weather layer") {
  const { width, height } = prepareCanvas(heatmapCanvas, heatmapCtx);
  drawMapTiles(width, height);
  drawMapOverlayText(width, message);
}

function updateMapHourLabel() {
  if (!elements.mapHourLabel) return;
  if (!activeMapHourOffset) {
    elements.mapHourLabel.textContent = "Now";
    return;
  }
  const time = latestHeatmap?.[0]?.hourly?.time?.[activeMapHourOffset];
  elements.mapHourLabel.textContent = time ? new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : `+${activeMapHourOffset}h`;
}

function drawMapTiles(width, height) {
  heatmapCtx.clearRect(0, 0, width, height);
  heatmapCtx.fillStyle = "#0b1018";
  heatmapCtx.fillRect(0, 0, width, height);

  const zoom = Math.round(mapState.zoom);
  const centerWorld = latLonToWorld(mapState.center.latitude, mapState.center.longitude, zoom);
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
      const image = getMapTile(zoom, wrappedTileX, tileY);
      const x = Math.round(tileX * MAP_TILE_SIZE - topLeft.x);
      const y = Math.round(tileY * MAP_TILE_SIZE - topLeft.y);

      if (image.complete && image.naturalWidth) {
        heatmapCtx.save();
        heatmapCtx.filter = "brightness(0.48) saturate(0.6) contrast(1.25)";
        heatmapCtx.drawImage(image, x, y, MAP_TILE_SIZE, MAP_TILE_SIZE);
        heatmapCtx.restore();
      } else {
        heatmapCtx.fillStyle = (tileX + tileY) % 2 ? "#0e1420" : "#101725";
        heatmapCtx.fillRect(x, y, MAP_TILE_SIZE, MAP_TILE_SIZE);
      }
    }
  }

  heatmapCtx.fillStyle = "rgba(5, 7, 12, 0.24)";
  heatmapCtx.fillRect(0, 0, width, height);
}

function getMapTile(zoom, x, y) {
  const key = `${zoom}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);

  const image = new Image();
  image.decoding = "async";
  image.src = `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
  image.addEventListener("load", () => renderHeatmap(latestHeatmap, activeHeatmapLayer), { once: true });
  image.addEventListener("error", () => tileCache.delete(key), { once: true });
  tileCache.set(key, image);
  return image;
}

function drawHeatmapOverlay(points, values, layer, min, max, width, height) {
  mapState.samples = [];
  const samples = points
    .map((point, index) => {
      const value = values[index];
      if (!Number.isFinite(value)) return null;
      const position = projectToMapScreen(point.latitude, point.longitude, width, height);
      const sample = {
        ...point,
        value,
        normalized: normalizeValue(value, min, max),
        x: position.x,
        y: position.y,
      };

      if (position.x > -30 && position.x < width + 30 && position.y > -30 && position.y < height + 30) {
        mapState.samples.push(sample);
      }

      return sample;
    })
    .filter(Boolean);

  if (!samples.length) return;

  const smoothing = Math.max(width, height) / 18;
  const overlayWidth = Math.max(72, Math.round(width * HEATMAP_SCALE));
  const overlayHeight = Math.max(44, Math.round(height * HEATMAP_SCALE));
  const overlay = document.createElement("canvas");
  overlay.width = overlayWidth;
  overlay.height = overlayHeight;
  const overlayCtx = overlay.getContext("2d");
  const image = overlayCtx.createImageData(overlayWidth, overlayHeight);
  const data = image.data;

  for (let y = 0; y < overlayHeight; y += 1) {
    for (let x = 0; x < overlayWidth; x += 1) {
      const screenX = (x / overlayWidth) * width;
      const screenY = (y / overlayHeight) * height;
      const normalized = interpolateHeatmapAt(screenX, screenY, samples, smoothing);
      const color = getHeatmapChannels(normalized, layer);
      const offset = (y * overlayWidth + x) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = 132;
    }
  }

  overlayCtx.putImageData(image, 0, 0);

  heatmapCtx.save();
  heatmapCtx.imageSmoothingEnabled = true;
  heatmapCtx.imageSmoothingQuality = "high";
  heatmapCtx.filter = "blur(6px)";
  heatmapCtx.drawImage(overlay, -10, -10, width + 20, height + 20);
  heatmapCtx.restore();

  heatmapCtx.fillStyle = "rgba(5, 7, 12, 0.04)";
  heatmapCtx.fillRect(0, 0, width, height);
}

function interpolateHeatmapAt(x, y, samples, smoothing) {
  return interpolateSampleMetricAt(x, y, samples, smoothing, (sample) => sample.normalized) ?? 0;
}

function interpolateSampleMetricAt(x, y, samples, smoothing, getValue) {
  let weightedValue = 0;
  let weightTotal = 0;

  samples.forEach((sample) => {
    const sampleValue = getValue(sample);
    if (!Number.isFinite(sampleValue)) return;
    const distanceSquared = (sample.x - x) ** 2 + (sample.y - y) ** 2;
    const weight = 1 / (distanceSquared + smoothing ** 2);
    weightedValue += sampleValue * weight;
    weightTotal += weight;
  });

  return weightTotal ? weightedValue / weightTotal : null;
}

function drawMapPlaces(width, height) {
  const location = activeLocation || mapState.selected;
  if (!location) return;
  const selected = mapState.selected || location;
  const position = projectToMapScreen(selected.latitude, selected.longitude, width, height);

  if (position.x < -80 || position.x > width + 80 || position.y < -80 || position.y > height + 80) return;

  heatmapCtx.fillStyle = "#090a10";
  heatmapCtx.strokeStyle = "#f3f5f8";
  heatmapCtx.lineWidth = 3;
  heatmapCtx.beginPath();
  heatmapCtx.arc(position.x, position.y, 8, 0, Math.PI * 2);
  heatmapCtx.fill();
  heatmapCtx.stroke();

  heatmapCtx.font = "900 12px system-ui";
  const label = [selected.name, selected.admin, selected.country].filter(Boolean).join(", ");
  const labelWidth = heatmapCtx.measureText(label).width;
  const labelX = Math.max(8, Math.min(width - labelWidth - 14, position.x + 10));
  const labelY = Math.max(18, Math.min(height - 14, position.y + 4));
  heatmapCtx.fillStyle = "rgba(9, 11, 18, 0.78)";
  roundedRect(heatmapCtx, labelX - 4, labelY - 12, labelWidth + 8, 17, 5);
  heatmapCtx.fill();
  heatmapCtx.fillStyle = "#f3f5f8";
  heatmapCtx.fillText(label, labelX, labelY);
}

function drawMapOverlayText(width, text) {
  heatmapCtx.fillStyle = "#f3f5f8";
  heatmapCtx.font = "900 15px system-ui";
  heatmapCtx.fillText(text, 34, 28);
}

function getHeatmapValue(point, layer) {
  const hourly = point.hourly || {};
  const index = Math.min(activeMapHourOffset, Math.max(0, (hourly.time?.length || 1) - 1));
  const value = {
    temperature: hourly.temperature_2m?.[index],
    feels: hourly.apparent_temperature?.[index],
    dewpoint: hourly.dew_point_2m?.[index],
    humidity: hourly.relative_humidity_2m?.[index],
    precipitation: hourly.precipitation?.[index],
    precipProbability: hourly.precipitation_probability?.[index],
    wind: hourly.wind_speed_10m?.[index],
    gusts: hourly.wind_gusts_10m?.[index],
    pressure: hourly.pressure_msl?.[index],
    cloud: hourly.cloud_cover?.[index],
    visibility: hourly.visibility?.[index],
    cape: hourly.cape?.[index],
  }[layer];
  return value;
}

function normalizeValue(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  const range = max - min || 1;
  return Math.max(0, Math.min(1, (value - min) / range));
}

function getHeatmapColor(value, layer, alpha = 1) {
  const color = getHeatmapChannels(value, layer);
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function getHeatmapChannels(value, layer) {
  let color;
  if (layer === "precipitation" || layer === "precipProbability" || layer === "humidity" || layer === "cloud") {
    color = interpolateColor([
      [129, 197, 171],
      [114, 174, 230],
      [181, 171, 141],
      [207, 109, 114],
    ], value);
    return color;
  }

  if (layer === "wind" || layer === "gusts" || layer === "cape") {
    color = interpolateColor([
      [114, 174, 230],
      [129, 197, 171],
      [216, 160, 106],
      [207, 109, 114],
    ], value);
    return color;
  }

  color = interpolateColor([
    [114, 174, 230],
    [129, 197, 171],
    [216, 160, 106],
    [207, 109, 114],
  ], value);
  return color;
}

function interpolateColor(colors, value) {
  const scaled = value * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const start = colors[index];
  const end = colors[index + 1];
  const channels = start.map((channel, channelIndex) => Math.round(channel + (end[channelIndex] - channel) * mix));
  return channels;
}

function latLonToWorld(latitude, longitude, zoom) {
  const safeLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const sinLatitude = Math.sin((safeLatitude * Math.PI) / 180);
  const scale = MAP_TILE_SIZE * 2 ** zoom;
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * scale,
  };
}

function worldToLatLon(x, y, zoom) {
  const scale = MAP_TILE_SIZE * 2 ** zoom;
  const longitude = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { latitude, longitude };
}

function projectToMapScreen(latitude, longitude, width, height) {
  const zoom = Math.round(mapState.zoom);
  const centerWorld = latLonToWorld(mapState.center.latitude, mapState.center.longitude, zoom);
  const pointWorld = latLonToWorld(latitude, longitude, zoom);
  return {
    x: width / 2 + pointWorld.x - centerWorld.x,
    y: height / 2 + pointWorld.y - centerWorld.y,
  };
}

function screenToMapLocation(x, y, width, height) {
  const zoom = Math.round(mapState.zoom);
  const centerWorld = latLonToWorld(mapState.center.latitude, mapState.center.longitude, zoom);
  return worldToLatLon(centerWorld.x + x - width / 2, centerWorld.y + y - height / 2, zoom);
}

function setMapCenterFromWorld(world, zoom = mapState.zoom) {
  mapState.center = worldToLatLon(world.x, world.y, Math.round(zoom));
}

function clampMapZoom(zoom) {
  return Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, Math.round(zoom)));
}

function renderMapReadout(layer, min, max) {
  const coverage = latestHeatmapMeta
    ? `${latestHeatmapMeta.columns}x${latestHeatmapMeta.rows} samples · zoom ${latestHeatmapMeta.zoom}`
    : "Viewport coverage pending";
  elements.mapReadout.innerHTML = `
    <span>${escapeHTML(getHeatmapTitle(layer))}</span>
    <strong>${formatHeatmapValue(min, layer)} - ${formatHeatmapValue(max, layer)}</strong>
    <small>${coverage}</small>
  `;
}

function getHeatmapTitle(layer) {
  if (layer === "feels") return "Apparent temperature";
  if (layer === "dewpoint") return "Dew point";
  if (layer === "humidity") return "Relative humidity";
  if (layer === "precipitation") return "Current rain intensity";
  if (layer === "precipProbability") return "Rain probability";
  if (layer === "wind") return "Current wind speed";
  if (layer === "gusts") return "Wind gusts";
  if (layer === "pressure") return "Sea-level pressure";
  if (layer === "cloud") return "Cloud cover";
  if (layer === "visibility") return "Visibility";
  if (layer === "cape") return "CAPE";
  return "Current temperature";
}

function formatHeatmapValue(value, layer) {
  if (!Number.isFinite(value)) return "--";
  if (layer === "precipitation") return `${value.toFixed(1)} mm`;
  if (layer === "precipProbability" || layer === "humidity" || layer === "cloud") return `${Math.round(value)}%`;
  if (layer === "wind" || layer === "gusts") return `${Math.round(value)} km/h`;
  if (layer === "pressure") return `${Math.round(value)} hPa`;
  if (layer === "visibility") return `${Math.round(value / 1000)} km`;
  if (layer === "cape") return `${Math.round(value)} J/kg`;
  return `${value.toFixed(1)}°C`;
}

function renderHeatmapLegend(layer, min, max) {
  elements.heatmapLegend.innerHTML = `
    <span>${formatHeatmapValue(min, layer)}</span>
    <div class="heatmap-gradient ${layer}"></div>
    <span>${formatHeatmapValue(max, layer)}</span>
  `;
}

function getForecastHistory() {
  const parsed = readCookieJSON(HISTORY_KEY);
  return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY_ITEMS) : [];
}

function saveForecastSnapshot(location, forecast) {
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
    if (!writeCookieJSON(HISTORY_KEY, next)) throw new Error("cookie-write-failed");
    renderForecastHistory(next);
  } catch {
    addLog("Forecast history could not be saved in this browser.");
  }
}

function renderForecastHistory(history = getForecastHistory()) {
  if (!history.length) {
    elements.historyList.innerHTML = `<div class="empty-signal">No forecast snapshots saved yet.</div>`;
    return;
  }

  elements.historyList.innerHTML = history
    .map(
      (item) => `
        <div class="history-row">
          <div>
            <strong>${new Date(item.savedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</strong>
            <small>${escapeHTML(item.location)}</small>
          </div>
          <div><span>Now</span><strong>${formatNumber(item.temperature)}°C</strong></div>
          <div><span>Pressure</span><strong>${formatNumber(item.pressure)} hPa</strong></div>
          <div><span>Today</span><strong>${Math.round(item.todayHigh)}° / ${Math.round(item.todayLow)}°</strong></div>
          <div><span>Precip</span><strong>${formatNumber(item.todayPrecip)} mm</strong></div>
          <div><span>Condition</span><strong>${escapeHTML(item.condition)}</strong></div>
        </div>
      `,
    )
    .join("");
}

function getWatchlist() {
  const parsed = readCookieJSON(WATCHLIST_KEY);
  return Array.isArray(parsed) ? parsed : [];
}

function saveWatchlist(items) {
  const next = items.slice(0, 8);
  writeCookieJSON(WATCHLIST_KEY, next);
  renderWatchlist(next);
}

function pinCurrentLocation() {
  if (!activeLocation || !latestForecast) return;
  const existing = getWatchlist().filter((item) => Math.abs(item.latitude - activeLocation.latitude) > 0.01 || Math.abs(item.longitude - activeLocation.longitude) > 0.01);
  const risk = calculateStormRisk(latestForecast);
  saveWatchlist([
    {
      ...activeLocation,
      pinnedAt: new Date().toISOString(),
      temperature: latestForecast.current.temperature_2m,
      gusts: maxNext(latestForecast, "wind_gusts_10m", 24),
      rain: sumNext(latestForecast, "precipitation", 24),
      risk: risk.level,
    },
    ...existing,
  ]);
  addLog(`${activeLocation.name} pinned to stormwatch.`);
}

function renderWatchlist(items = getWatchlist()) {
  if (!items.length) {
    elements.watchlistGrid.innerHTML = `<div class="empty-signal">No pinned locations yet.</div>`;
    return;
  }

  elements.watchlistGrid.innerHTML = items
    .map(
      (item, index) => `
        <div class="watchlist-row">
          <div><strong>${escapeHTML([item.name, item.admin, item.country].filter(Boolean).join(", "))}</strong><small>${new Date(item.pinnedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div>
          <div><span>Temp</span><strong>${formatNumber(item.temperature)}°C</strong></div>
          <div><span>Gust</span><strong>${Math.round(item.gusts || 0)} km/h</strong></div>
          <div><span>Rain</span><strong>${formatNumber(item.rain)} mm</strong></div>
          <div><span>Risk</span><strong>${escapeHTML(item.risk || "--")}</strong></div>
          <button type="button" data-watch-index="${index}">Load</button>
        </div>
      `,
    )
    .join("");

  elements.watchlistGrid.querySelectorAll("button[data-watch-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const location = getWatchlist()[Number(button.dataset.watchIndex)];
      if (location) loadWeather(location);
    });
  });
}

function prepareCanvas(canvas, context) {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.round(rect.width));
  const height = Math.max(260, Math.round(rect.height));
  const scaledWidth = Math.round(width * pixelRatio);
  const scaledHeight = Math.round(height * pixelRatio);

  if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return { width, height };
}

function drawForecastChart(forecast) {
  const { width, height } = prepareCanvas(chartCanvas, chartCtx);
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
  const temperatureY = normalizeToRange(temperatures, chartTop, chartBottom);
  const precipY = precipitation.map((value) => chartBottom - ((value || 0) / 100) * chartHeight);
  const chartLeft = leftPadding;
  const chartRight = width - rightPadding;
  const xStep = (chartRight - chartLeft) / Math.max(1, indexes.length - 1);
  const tempMin = Math.min(...temperatures);
  const tempMax = Math.max(...temperatures);

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

  chartCtx.clearRect(0, 0, width, height);
  const background = chartCtx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#171c23");
  background.addColorStop(1, "#11161b");
  chartCtx.fillStyle = background;
  chartCtx.fillRect(0, 0, width, height);

  chartCtx.strokeStyle = "rgba(120, 134, 152, 0.36)";
  chartCtx.lineWidth = 1;
  for (let i = 0; i <= 5; i += 1) {
    const y = chartTop + (chartHeight / 5) * i;
    chartCtx.beginPath();
    chartCtx.moveTo(chartLeft, y);
    chartCtx.lineTo(chartRight, y);
    chartCtx.stroke();

    const labelValue = tempMax - ((tempMax - tempMin) / 5) * i;
    chartCtx.fillStyle = "#98a4b3";
    chartCtx.font = "700 12px system-ui";
    chartCtx.fillText(`${labelValue.toFixed(0)}°`, 14, y + 4);
  }

  precipitation.forEach((chance, offset) => {
    const barHeight = (chartHeight * chance) / 100;
    const barWidth = Math.max(8, Math.min(18, xStep * 0.5));
    const x = chartLeft + offset * xStep - barWidth / 2;
    const barGradient = chartCtx.createLinearGradient(0, chartBottom - barHeight, 0, chartBottom);
    barGradient.addColorStop(0, "rgba(114, 174, 230, 0.64)");
    barGradient.addColorStop(1, "rgba(114, 174, 230, 0.1)");
    chartCtx.fillStyle = barGradient;
    roundedRect(chartCtx, x, chartBottom - barHeight, barWidth, barHeight, 5);
    chartCtx.fill();
  });

  const areaGradient = chartCtx.createLinearGradient(0, chartTop, 0, chartBottom);
  areaGradient.addColorStop(0, "rgba(129, 197, 171, 0.22)");
  areaGradient.addColorStop(0.72, "rgba(129, 197, 171, 0.04)");
  areaGradient.addColorStop(1, "rgba(129, 197, 171, 0)");
  chartCtx.beginPath();
  temperatureY.forEach((y, offset) => {
    const x = chartLeft + offset * xStep;
    if (offset === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  });
  chartCtx.lineTo(chartRight, chartBottom);
  chartCtx.lineTo(chartLeft, chartBottom);
  chartCtx.closePath();
  chartCtx.fillStyle = areaGradient;
  chartCtx.fill();

  chartCtx.beginPath();
  chartCtx.strokeStyle = "#81c5ab";
  chartCtx.lineWidth = 4;
  chartCtx.lineJoin = "round";
  chartCtx.lineCap = "round";
  temperatureY.forEach((y, offset) => {
    const x = chartLeft + offset * xStep;
    if (offset === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  });
  chartCtx.stroke();

  chartState.points.forEach((point, offset) => {
    if (offset % 3 !== 0 && offset !== 0) return;
    drawSmallPoint(point.x, point.temperatureY, "#81c5ab");
  });

  if (chartState.hoverIndex !== null && chartState.points[chartState.hoverIndex]) {
    drawChartHover(chartState.points[chartState.hoverIndex], chartTop, chartBottom);
  }

  chartCtx.fillStyle = "#d5dde7";
  chartCtx.font = "700 15px system-ui";
  chartCtx.fillText("Temperature", chartLeft, 30);
  chartCtx.fillStyle = "#81c5ab";
  roundedRect(chartCtx, chartLeft + 105, 20, 28, 5, 3);
  chartCtx.fill();
  chartCtx.fillStyle = "#d5dde7";
  chartCtx.fillText("Rain chance", chartLeft + 154, 30);
  chartCtx.fillStyle = "#72aee6";
  roundedRect(chartCtx, chartLeft + 246, 20, 28, 5, 3);
  chartCtx.fill();

  chartCtx.fillStyle = "#98a4b3";
  chartCtx.font = "700 12px system-ui";
  indexes.forEach((index, offset) => {
    if (offset % 3 !== 0) return;
    const x = chartLeft + offset * xStep;
    const label = new Date(hourly.time[index]).toLocaleTimeString([], { hour: "2-digit" });
    chartCtx.fillText(label, x - 13, height - 22);
  });
}

function roundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function drawSmallPoint(x, y, color) {
  chartCtx.fillStyle = "#141a20";
  chartCtx.strokeStyle = color;
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();
  chartCtx.arc(x, y, 4, 0, Math.PI * 2);
  chartCtx.fill();
  chartCtx.stroke();
}

function drawChartHover(point, chartTop, chartBottom) {
  chartCtx.strokeStyle = "rgba(213, 221, 231, 0.28)";
  chartCtx.lineWidth = 1;
  chartCtx.beginPath();
  chartCtx.moveTo(point.x, chartTop);
  chartCtx.lineTo(point.x, chartBottom);
  chartCtx.stroke();

  drawPointMarker(point.x, point.temperatureY, "#81c5ab");
  drawPointMarker(point.x, point.precipY, "#72aee6");
}

function drawPointMarker(x, y, color) {
  chartCtx.fillStyle = "#141a20";
  chartCtx.strokeStyle = color;
  chartCtx.lineWidth = 3;
  chartCtx.beginPath();
  chartCtx.arc(x, y, 6, 0, Math.PI * 2);
  chartCtx.fill();
  chartCtx.stroke();
}

function updateChartTooltip(event) {
  if (!latestForecast || !chartState.points.length) return;

  const rect = chartCanvas.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  let nearestIndex = null;
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

function showChartTooltip(point, pointerX, pointerY, rect) {
  const time = new Date(point.time).toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  elements.chartTooltip.innerHTML = `
    <strong>${escapeHTML(time)}</strong>
    <span>Temperature: ${formatNumber(point.temperature)}°C</span>
    <span>Precip chance: ${point.precipitationProbability ?? "--"}%</span>
    <span>Precip amount: ${formatNumber(point.precipitationAmount)} mm</span>
    <span>Wind: ${Math.round(point.wind)} km/h</span>
  `;

  elements.chartTooltip.classList.add("visible");

  const tooltipWidth = elements.chartTooltip.offsetWidth;
  const tooltipHeight = elements.chartTooltip.offsetHeight;
  const left = Math.min(rect.width - tooltipWidth - 10, pointerX + 14);
  const top = Math.max(10, Math.min(rect.height - tooltipHeight - 10, pointerY - tooltipHeight - 10));

  elements.chartTooltip.style.left = `${Math.max(10, left)}px`;
  elements.chartTooltip.style.top = `${top}px`;
}

function hideChartTooltip() {
  if (chartState.hoverIndex === null && !elements.chartTooltip.classList.contains("visible")) return;
  chartState.hoverIndex = null;
  elements.chartTooltip.classList.remove("visible");
  if (latestForecast) drawForecastChart(latestForecast);
}

function updateMapTooltip(event) {
  if (!latestHeatmap?.length || mapState.drag || !(mapState.samples || []).length) return;

  const rect = heatmapCanvas.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const location = screenToMapLocation(pointerX, pointerY, rect.width, rect.height);
  const samples = mapState.samples || [];
  const smoothing = Math.max(rect.width, rect.height) / 18;
  const layerValue = interpolateSampleMetricAt(pointerX, pointerY, samples, smoothing, (sample) => sample.value);
  const temperature = interpolateSampleMetricAt(pointerX, pointerY, samples, smoothing, (sample) => sample.hourly?.temperature_2m?.[activeMapHourOffset]);
  const precipitation = interpolateSampleMetricAt(pointerX, pointerY, samples, smoothing, (sample) => sample.hourly?.precipitation?.[activeMapHourOffset]);
  const wind = interpolateSampleMetricAt(pointerX, pointerY, samples, smoothing, (sample) => sample.hourly?.wind_speed_10m?.[activeMapHourOffset]);

  elements.mapTooltip.innerHTML = `
    <strong>${formatHeatmapValue(layerValue, activeHeatmapLayer)}</strong>
    <span>${location.latitude.toFixed(3)}, ${location.longitude.toFixed(3)}</span>
    <span>Temp: ${formatNumber(temperature)}°C</span>
    <span>Rain: ${formatNumber(precipitation)} mm</span>
    <span>Wind: ${Number.isFinite(wind) ? Math.round(wind) : "--"} km/h</span>
  `;
  elements.mapTooltip.classList.add("visible");
  elements.mapHoverIndicator.classList.add("visible");
  elements.mapHoverIndicator.style.left = `${pointerX}px`;
  elements.mapHoverIndicator.style.top = `${pointerY}px`;

  const tooltipWidth = elements.mapTooltip.offsetWidth;
  const tooltipHeight = elements.mapTooltip.offsetHeight;
  const left = Math.min(rect.width - tooltipWidth - 10, pointerX + 14);
  const top = Math.max(10, Math.min(rect.height - tooltipHeight - 10, pointerY - tooltipHeight - 10));

  elements.mapTooltip.style.left = `${Math.max(10, left)}px`;
  elements.mapTooltip.style.top = `${top}px`;
  elements.mapTooltip.style.bottom = "auto";
}

function hideMapTooltip() {
  elements.mapTooltip.classList.remove("visible");
  elements.mapHoverIndicator.classList.remove("visible");
}

function resetMapView(location = activeLocation || mapState.selected) {
  if (!location) return;
  mapState.center = {
    latitude: location.latitude,
    longitude: location.longitude,
  };
  mapState.zoom = MAP_DEFAULT_ZOOM;
  hideMapTooltip();
  renderHeatmap(latestHeatmap, activeHeatmapLayer);
  scheduleHeatmapRefresh(0);
}

function zoomMap(delta) {
  const nextZoom = clampMapZoom(mapState.zoom + delta);
  if (nextZoom === mapState.zoom) return;
  mapState.zoom = nextZoom;
  hideMapTooltip();
  renderHeatmap(latestHeatmap, activeHeatmapLayer);
  scheduleHeatmapRefresh();
}

function queueMapRender() {
  if (mapState.renderQueued) return;
  mapState.renderQueued = true;
  requestAnimationFrame(() => {
    mapState.renderQueued = false;
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  });
}

function startMapDrag(event) {
  if (event.button !== 0) return;
  const rect = heatmapCanvas.getBoundingClientRect();
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
  heatmapCanvas.classList.add("dragging");
  heatmapCanvas.setPointerCapture(event.pointerId);
  hideMapTooltip();
}

function moveMapDrag(event) {
  if (!mapState.drag || mapState.drag.pointerId !== event.pointerId) {
    updateMapTooltip(event);
    return;
  }

  const dx = event.clientX - mapState.drag.startX;
  const dy = event.clientY - mapState.drag.startY;
  if (Math.hypot(dx, dy) > 5) {
    mapState.drag.moved = true;
  }
  setMapCenterFromWorld(
    {
      x: mapState.drag.centerWorld.x - dx,
      y: mapState.drag.centerWorld.y - dy,
    },
    mapState.drag.zoom,
  );
  queueMapRender();
}

function endMapDrag(event) {
  if (!mapState.drag || mapState.drag.pointerId !== event.pointerId) return;
  const drag = mapState.drag;
  mapState.drag = null;
  heatmapCanvas.classList.remove("dragging");

  if (!drag.moved) {
    const location = screenToMapLocation(drag.canvasX, drag.canvasY, drag.width, drag.height);
    selectMapLocation(location.latitude, location.longitude);
    return;
  }

  scheduleHeatmapRefresh();
}

async function selectMapLocation(latitude, longitude) {
  try {
    hideMapTooltip();
    addLog(`Looking up ${latitude.toFixed(3)}, ${longitude.toFixed(3)} from map click.`);
    const location = await reverseGeocodeLocation(latitude, longitude);
    elements.locationInput.value = [location.name, location.admin, location.country].filter(Boolean).join(", ");
    await loadWeather(location);
  } catch (error) {
    addLog(error.message);
  }
}

function normalizeToRange(values, top, bottom) {
  const finiteValues = values.filter(Number.isFinite);
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  const range = max - min || 1;

  return values.map((value) => bottom - ((value - min) / range) * (bottom - top));
}

async function resolveLocation(query) {
  if (!query) throw new Error("Location is required");
  const candidates = rankLocationCandidates(await geocodeLocationCandidates(query), query);
  const exactMatches = candidates.filter((candidate) => matchesLocationQuery(candidate, query));
  if (exactMatches.length === 1) return exactMatches[0];
  if (candidates.length === 1) return candidates[0];
  throw new Error("Choose the exact location from the suggestions.");
}

function savePreferredLocation(location) {
  writeCookieJSON(PREFERRED_LOCATION_KEY, location);
}

function getPreferredLocation() {
  return readCookieJSON(PREFERRED_LOCATION_KEY);
}

function clearLocationSuggestions() {
  activeLocationSuggestions = [];
  selectedLocationSuggestion = null;
  elements.locationSuggestions.innerHTML = "";
  elements.locationSuggestions.classList.remove("visible");
}

function selectLocationSuggestion(location, { submit = false } = {}) {
  selectedLocationSuggestion = location;
  elements.locationInput.value = formatLocationLabel(location);
  elements.locationSearchNote.textContent = "Exact location selected.";
  clearLocationSuggestions();
  selectedLocationSuggestion = location;
  if (submit) loadWeather(location);
}

function renderLocationSuggestions(candidates, query) {
  activeLocationSuggestions = candidates;
  if (!candidates.length) {
    clearLocationSuggestions();
    elements.locationSearchNote.textContent = "No matching locations found.";
    return;
  }

  elements.locationSuggestions.innerHTML = candidates
    .map((candidate, index) => `
      <button class="suggestion-item${matchesLocationQuery(candidate, query) ? " exact" : ""}" type="button" data-location-index="${index}">
        <strong>${escapeHTML(candidate.name)}</strong>
        <small>${escapeHTML([candidate.admin, candidate.country].filter(Boolean).join(", "))}</small>
      </button>
    `)
    .join("");
  elements.locationSuggestions.classList.add("visible");
  elements.locationSuggestions.querySelectorAll("[data-location-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const candidate = activeLocationSuggestions[Number(button.dataset.locationIndex)];
      if (candidate) selectLocationSuggestion(candidate, { submit: true });
    });
  });
}

async function searchLocationSuggestions(query) {
  const currentToken = ++searchRequestToken;
  if (query.length < 2) {
    clearLocationSuggestions();
    elements.locationSearchNote.textContent = "Search suggestions will appear as you type so you can choose the exact place.";
    return;
  }

  elements.locationSearchNote.textContent = "Searching for matching locations...";
  try {
    const candidates = rankLocationCandidates(await geocodeLocationCandidates(query), query);
    if (currentToken !== searchRequestToken) return;
    renderLocationSuggestions(candidates, query);
    elements.locationSearchNote.textContent = "Choose the exact city or region from the list.";
  } catch (error) {
    if (currentToken !== searchRequestToken) return;
    clearLocationSuggestions();
    elements.locationSearchNote.textContent = error.message;
  }
}

async function loadWeather(query) {
  try {
    const requestId = ++weatherLoadId;
    const queryLabel = typeof query === "string" ? query : query.name;
    const settings = getAppSettings();
    addLog(`Loading weather data for ${queryLabel}.`);
    activeLocation = typeof query === "string" ? await resolveLocation(query) : query;
    setLoadingState(`Loading live weather data for ${activeLocation.name}`);
    updateSettingsUI();
    setActiveMapHourOffset(settings.mapHourOffset);
    setActiveHeatmapLayer(settings.mapLayer);
    latestForecast = await fetchForecast(activeLocation);
    if (requestId !== weatherLoadId) return;
    updateCurrentConditions(activeLocation, latestForecast);
    updateWeatherWarning(latestForecast);
    renderPatterns(latestForecast);
    renderStormToolkit(latestForecast);
    renderConfidence(latestForecast);
    renderContext(latestForecast);
    mapState.center = {
      latitude: activeLocation.latitude,
      longitude: activeLocation.longitude,
    };
    mapState.selected = activeLocation;
    latestAirQuality = null;
    latestHeatmap = null;
    latestHeatmapMeta = null;
    elements.airGrid.innerHTML = `<div class="empty-signal">Loading air quality data.</div>`;
    renderHeatmapLoading();
    renderHourlyForecast(latestForecast);
    renderDailyForecast(latestForecast);
    renderWeeklyForecast(latestForecast);
    drawForecastChart(latestForecast);
    saveForecastSnapshot(activeLocation, latestForecast);
    renderWatchlist();
    updateSettingsUI();
    addLog(`Live Open-Meteo feed updated for ${activeLocation.name}.`);
    hydrateSupplementalWeather(activeLocation, requestId);
  } catch (error) {
    addLog(error.message);
    elements.warningBar.className = "weather-warning advisory";
    elements.warningLabel.textContent = "Weather Advisory";
    elements.warningTitle.textContent = "Weather feed unavailable";
    elements.warningCopy.textContent = "Live forecast warnings cannot be calculated until the Open-Meteo feed is reachable.";
    elements.tempTrend.textContent = "Weather feed unavailable";
    elements.pressureTrend.textContent = "Check network access or location";
    elements.windDirection.textContent = "No live wind data";
    elements.windCompass.textContent = "--";
    elements.watchCopy.textContent = "No live precipitation data";
  }
}

async function hydrateSupplementalWeather(location, requestId) {
  const [airResult, heatmapResult] = await Promise.allSettled([
    fetchAirQuality(location),
    fetchHeatmap(),
  ]);

  if (requestId !== weatherLoadId) return;

  if (airResult.status === "fulfilled") {
    latestAirQuality = airResult.value;
  } else {
    latestAirQuality = null;
    addLog(airResult.reason?.message || "Air quality request failed");
  }
  renderAirQuality(latestAirQuality);

  if (heatmapResult.status === "fulfilled") {
    latestHeatmap = heatmapResult.value.points;
    latestHeatmapMeta = heatmapResult.value.meta;
  } else {
    latestHeatmap = null;
    latestHeatmapMeta = null;
    addLog(heatmapResult.reason?.message || "Regional heatmap request failed");
  }
  renderHeatmap(latestHeatmap);
}

elements.locationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = elements.locationInput.value.trim();
  if (!query) return;
  if (selectedLocationSuggestion && normalizeSearchText(formatLocationLabel(selectedLocationSuggestion)) === normalizeSearchText(query)) {
    loadWeather(selectedLocationSuggestion);
    return;
  }
  resolveLocation(query)
    .then((location) => {
      selectedLocationSuggestion = location;
      loadWeather(location);
    })
    .catch(() => {
      searchLocationSuggestions(query);
      elements.locationSearchNote.textContent = "Choose the exact location from the suggestions before loading weather.";
    });
});

elements.locationInput.addEventListener("input", () => {
  selectedLocationSuggestion = null;
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchLocationSuggestions(elements.locationInput.value.trim());
  }, 180);
});

document.addEventListener("click", (event) => {
  if (!elements.locationForm.contains(event.target)) {
    elements.locationSuggestions.classList.remove("visible");
  }
});

elements.refreshButton.addEventListener("click", () => {
  const query = activeLocation || elements.locationInput.value.trim() || getPreferredLocation();
  if (query) loadWeather(query);
});

elements.clearHistoryButton.addEventListener("click", () => {
  clearSavedHistory();
});

elements.pinLocationButton.addEventListener("click", pinCurrentLocation);
elements.mapHourSlider.addEventListener("input", () => {
  setActiveMapHourOffset(elements.mapHourSlider.value, { persist: true });
});

window.addEventListener("resize", () => {
  hideChartTooltip();
  hideMapTooltip();
  if (latestForecast) drawForecastChart(latestForecast);
  if (latestHeatmap) {
    renderHeatmap(latestHeatmap);
    scheduleHeatmapRefresh(220);
  }
});

chartCanvas.addEventListener("pointermove", updateChartTooltip);
chartCanvas.addEventListener("pointerleave", hideChartTooltip);
heatmapCanvas.addEventListener("pointerdown", startMapDrag);
heatmapCanvas.addEventListener("pointermove", moveMapDrag);
heatmapCanvas.addEventListener("pointerup", endMapDrag);
heatmapCanvas.addEventListener("pointercancel", endMapDrag);
heatmapCanvas.addEventListener("pointerleave", hideMapTooltip);
heatmapCanvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    zoomMap(event.deltaY > 0 ? -1 : 1);
  },
  { passive: false },
);
elements.mapZoomIn.addEventListener("click", () => zoomMap(1));
elements.mapZoomOut.addEventListener("click", () => zoomMap(-1));
elements.mapReset.addEventListener("click", () => resetMapView());

heatmapButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveHeatmapLayer(button.dataset.layer, { persist: true });
  });
});

elements.setDefaultLocationButton.addEventListener("click", saveCurrentAsPreferredLocation);
elements.resetDefaultLocationButton.addEventListener("click", clearPreferredLocationSetting);
elements.settingsMapLayer.addEventListener("change", () => {
  setActiveHeatmapLayer(elements.settingsMapLayer.value, { persist: true });
});
elements.settingsStartHour.addEventListener("change", () => {
  setActiveMapHourOffset(elements.settingsStartHour.value, { persist: true });
});
elements.clearWatchlistButton.addEventListener("click", clearSavedWatchlist);
elements.clearHistorySettingsButton.addEventListener("click", clearSavedHistory);
elements.exportSettingsButton.addEventListener("click", exportSettingsPreset);
elements.importSettingsButton.addEventListener("click", () => {
  elements.importSettingsFile.click();
});
elements.importSettingsFile.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  importSettingsPreset(file);
});

const initialSettings = getAppSettings();
setActiveHeatmapLayer(initialSettings.mapLayer);
setActiveMapHourOffset(initialSettings.mapHourOffset);
renderForecastHistory();
renderWatchlist();
updateSettingsUI();

const preferredLocation = getPreferredLocation();
if (preferredLocation) {
  if (typeof preferredLocation === "string") {
    elements.locationInput.value = preferredLocation;
  } else {
    elements.locationInput.value = formatLocationLabel(preferredLocation);
  }
  loadWeather(preferredLocation);
}
