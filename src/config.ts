import type { NoaaSector, Location } from "./types";

export const HOURS_TO_SHOW = 24;
export const HEATMAP_MIN_COLUMNS = 5;
export const HEATMAP_MAX_COLUMNS = 5;
export const HEATMAP_MIN_ROWS = 4;
export const HEATMAP_MAX_ROWS = 4;
export const HEATMAP_VIEW_PADDING = 120;
export const HEATMAP_CACHE_TTL_MS = 15 * 60 * 1000;
export const HEATMAP_MAX_CACHE_ENTRIES = 24;
export const FORECAST_CACHE_TTL_MS = 10 * 60 * 1000;
export const AIR_QUALITY_CACHE_TTL_MS = 20 * 60 * 1000;
export const API_RATE_LIMIT_BACKOFF_MS = 60 * 1000;
export const MAP_TILE_SIZE = 256;
export const MAP_MIN_ZOOM = 8;
export const MAP_MAX_ZOOM = 15;
export const MAP_DEFAULT_ZOOM = 10;
export const HEATMAP_SCALE = 0.22;
export const MAX_HISTORY_ITEMS = 12;
export const MAP_HOURS_TO_SHOW = 24;
export const LOCATION_SUGGESTION_LIMIT = 8;
export const SATELLITE_CACHE_TTL_MS = 10 * 60 * 1000;

export const INITIAL_MAP_CENTER: Location = {
  name: "Center of US",
  latitude: 39.8283,
  longitude: -98.5795,
};

export const HISTORY_KEY = "precip.forecastHistory.v1";
export const WATCHLIST_KEY = "precip.watchlist.v1";
export const PREFERRED_LOCATION_KEY = "precip.preferredLocation.v1";
export const SETTINGS_KEY = "precip.settings.v1";

export const DEFAULT_APP_SETTINGS = {
  mapLayer: "temperature" as const,
  mapHourOffset: 0,
  useImperial: false,
};

export const NOAA_SECTORS: NoaaSector[] = [
  { id: "ak", name: "Alaska", sat: "G18", latitude: 64.2, longitude: -150.0 },
  { id: "cak", name: "Central Alaska", sat: "G18", latitude: 64.8, longitude: -149.5 },
  { id: "sea", name: "Southeastern Alaska", sat: "G18", latitude: 58.3, longitude: -135.5 },
  { id: "can", name: "Canada/Northern U.S.", sat: "G19", latitude: 49.0, longitude: -86.0 },
  { id: "na", name: "Northern Atlantic", sat: "G19", latitude: 43.0, longitude: -49.0 },
  { id: "np", name: "Northern Pacific", sat: "G18", latitude: 42.0, longitude: -154.0 },
  { id: "wus", name: "U.S. Pacific Coast", sat: "G18", latitude: 37.5, longitude: -123.5 },
  { id: "pnw", name: "Pacific Northwest", sat: "G18", latitude: 46.0, longitude: -121.5 },
  { id: "nr", name: "Northern Rockies", sat: "G19", latitude: 46.5, longitude: -111.5 },
  { id: "umv", name: "Upper Mississippi Valley", sat: "G19", latitude: 44.5, longitude: -92.0 },
  { id: "cgl", name: "Great Lakes", sat: "G19", latitude: 44.0, longitude: -84.5 },
  { id: "ne", name: "Northeast", sat: "G19", latitude: 42.5, longitude: -72.0 },
  { id: "psw", name: "Pacific Southwest", sat: "G18", latitude: 34.0, longitude: -117.5 },
  { id: "sr", name: "Southern Rockies", sat: "G19", latitude: 37.0, longitude: -106.5 },
  { id: "sp", name: "Southern Plains", sat: "G19", latitude: 34.5, longitude: -98.0 },
  { id: "smv", name: "Southern Mississippi Valley", sat: "G19", latitude: 33.0, longitude: -90.5 },
  { id: "se", name: "Southeast", sat: "G19", latitude: 32.5, longitude: -84.0 },
  { id: "eus", name: "U.S. Atlantic Coast", sat: "G19", latitude: 33.5, longitude: -77.5 },
  { id: "mex", name: "Mexico", sat: "G19", latitude: 23.0, longitude: -102.0 },
  { id: "ga", name: "Gulf of America", sat: "G19", latitude: 25.5, longitude: -89.5 },
  { id: "car", name: "Caribbean", sat: "G19", latitude: 17.5, longitude: -71.0 },
  { id: "pr", name: "Puerto Rico", sat: "G19", latitude: 18.2, longitude: -66.5 },
  { id: "taw", name: "Tropical Atlantic", sat: "G19", latitude: 18.0, longitude: -52.0 },
  { id: "hi", name: "Hawaii", sat: "G18", latitude: 20.5, longitude: -157.0 },
  { id: "tpw", name: "Tropical Pacific", sat: "G18", latitude: 13.0, longitude: -145.0 },
  { id: "tsp", name: "South Pacific", sat: "G18", latitude: -15.0, longitude: -145.0 },
  { id: "eep", name: "Eastern East Pacific", sat: "G19", latitude: 14.0, longitude: -107.0 },
  { id: "cam", name: "Central America", sat: "G19", latitude: 14.0, longitude: -88.0 },
];

export const NOAA_AUTO_SECTOR_IDS = [
  "ak", "can", "na", "np", "wus", "pnw", "psw", "sr", "sp", "smv",
  "se", "eus", "mex", "ga", "car", "pr", "hi", "taw", "tpw", "eep", "cam",
];

export const NWS_SEVERITY_ORDER: Record<string, number> = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
};

export const TORNADO_EVENTS = new Set([
  "Tornado Warning",
  "Tornado Watch",
  "Severe Thunderstorm Warning",
  "Severe Thunderstorm Watch",
]);

export const ALERT_SEVERITY_COLORS: Record<string, { fill: string; stroke: string }> = {
  Extreme: { fill: "rgba(201, 106, 110, 0.15)", stroke: "rgba(201, 106, 110, 0.8)" },
  Severe: { fill: "rgba(217, 144, 74, 0.15)", stroke: "rgba(217, 144, 74, 0.8)" },
  Moderate: { fill: "rgba(201, 180, 88, 0.15)", stroke: "rgba(201, 180, 88, 0.8)" },
  Minor: { fill: "rgba(88, 152, 201, 0.12)", stroke: "rgba(88, 152, 201, 0.6)" },
  Unknown: { fill: "rgba(136, 136, 136, 0.1)", stroke: "rgba(136, 136, 136, 0.5)" },
};

export const SPC_CATEGORIES: Record<number, { label: string; name: string; color: string }> = {
  2: { label: "TSTM", name: "General Thunderstorms", color: "#55BB55" },
  3: { label: "MRGL", name: "Marginal", color: "#66A366" },
  4: { label: "SLGT", name: "Slight", color: "#DDAA00" },
  5: { label: "ENH", name: "Enhanced", color: "#FF9933" },
  6: { label: "MDT", name: "Moderate", color: "#FF3333" },
  7: { label: "HIGH", name: "High", color: "#FF0099" },
};

export const SPC_TORNADO_PROB: Record<number, { pct: string; color: string }> = {
  2: { pct: "2%", color: "#79BA7A" },
  4: { pct: "5%", color: "#55BB55" },
  6: { pct: "10%", color: "#DDAA00" },
  8: { pct: "15%", color: "#FF9933" },
  10: { pct: "30%", color: "#FF3333" },
  12: { pct: "45%", color: "#FF0099" },
  14: { pct: "60%", color: "#CC0066" },
};

export const WEATHER_CODES: Record<number, string> = {
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
