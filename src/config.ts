import type { NoaaSector, Location, SliderSatellite } from "./types";

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
export const MAP_MIN_ZOOM = 3;
export const MAP_MAX_ZOOM = 15;
export const MAP_DEFAULT_ZOOM = 10;
export const HEATMAP_SCALE = 0.22;
export const MAX_HISTORY_ITEMS = 12;
export const MAP_HOURS_TO_SHOW = 24;
export const LOCATION_SUGGESTION_LIMIT = 8;
export const SATELLITE_CACHE_TTL_MS = 10 * 60 * 1000;
export const ALERT_CACHE_TTL_MS = 5 * 60 * 1000;

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
  showAlerts: true,
  showWildfires: true,
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

export const SLIDER_BASE = "https://slider.cira.colostate.edu";

export const SLIDER_SATELLITES: SliderSatellite[] = [
  {
    id: "goes-19",
    name: "GOES-19 (East)",
    sectors: [
      { id: "full_disk", name: "Full Disk", latitude: 0, longitude: -75.2 },
      { id: "conus", name: "CONUS", latitude: 39.8, longitude: -98.6 },
      { id: "mesoscale_01", name: "Mesoscale 1", latitude: 35, longitude: -90 },
      { id: "mesoscale_02", name: "Mesoscale 2", latitude: 30, longitude: -80 },
    ],
  },
  {
    id: "goes-18",
    name: "GOES-18 (West)",
    sectors: [
      { id: "full_disk", name: "Full Disk", latitude: 0, longitude: -137.2 },
      { id: "conus", name: "CONUS", latitude: 39.8, longitude: -98.6 },
      { id: "mesoscale_01", name: "Mesoscale 1", latitude: 35, longitude: -120 },
      { id: "mesoscale_02", name: "Mesoscale 2", latitude: 30, longitude: -130 },
    ],
  },
  {
    id: "himawari",
    name: "Himawari-9",
    sectors: [
      { id: "full_disk", name: "Full Disk", latitude: 0, longitude: 140.7 },
      { id: "japan", name: "Japan", latitude: 36, longitude: 138 },
      { id: "mesoscale_01", name: "Mesoscale 1", latitude: 25, longitude: 130 },
    ],
  },
  {
    id: "meteosat-0deg",
    name: "Meteosat-11 (0°)",
    sectors: [
      { id: "full_disk", name: "Full Disk", latitude: 0, longitude: 0 },
    ],
  },
  {
    id: "meteosat-9",
    name: "Meteosat-9 (45.5°E)",
    sectors: [
      { id: "full_disk", name: "Full Disk", latitude: 0, longitude: 45.5 },
    ],
  },
  {
    id: "gk2a",
    name: "GK-2A",
    sectors: [
      { id: "full_disk", name: "Full Disk", latitude: 0, longitude: 128.2 },
    ],
  },
  {
    id: "jpss",
    name: "JPSS (Polar)",
    sectors: [
      { id: "northern_hemisphere", name: "Northern Hemisphere", latitude: 60, longitude: 0 },
      { id: "southern_hemisphere", name: "Southern Hemisphere", latitude: -60, longitude: 0 },
    ],
  },
];

export const SLIDER_PRODUCT_NAMES: Record<string, string> = {
  cira_geocolor: "GeoColor",
  geocolor: "GeoColor",
  band_01: "Band 1 (Blue Vis)",
  band_02: "Band 2 (Red Vis)",
  band_03: "Band 3 (Veggie Near-IR)",
  band_04: "Band 4 (Cirrus Near-IR)",
  band_05: "Band 5 (Snow/Cloud Near-IR)",
  band_06: "Band 6 (Cloud/Ash Near-IR)",
  band_07: "Band 7 (Shortwave IR)",
  band_08: "Band 8 (Upper WV)",
  band_09: "Band 9 (Mid WV)",
  band_10: "Band 10 (Low WV)",
  band_11: "Band 11 (Cloud Top Phase)",
  band_12: "Band 12 (Cloud Top Phase)",
  band_13: "Band 13 (Clean LW IR)",
  band_14: "Band 14 (LW IR)",
  band_15: "Band 15 (Dirty LW IR)",
  band_16: "Band 16 (CO2 LW IR)",
  natural_color: "Natural Color",
  rgb_air_mass: "Air Mass RGB",
  day_cloud_type_rgb: "Day Cloud Type RGB",
  day_cloud_phase_microphysics_rgb: "Day Cloud Phase RGB",
  cira_natural_fire_color: "Fire Color",
  cira_geosst: "Sea Surface Temp",
  cira_geofire: "Fire Detection",
  cira_geodust: "Dust Detection",
  fire_temperature: "Fire Temperature",
  dust_fire_rgb: "Dust/Fire RGB",
  night_microphysics_rgb: "Night Microphysics",
  cira_glm_l2_group_counts: "GLM Lightning",
  cira_glm_l2_group_energy: "GLM Lightning Energy",
  "split_window_difference_10_3-12_3": "Split Window Diff",
  acspo_sst: "Sea Surface Temp (ACSPO)",
  awips_dust: "Dust RGB",
  awips_fog: "Fog/Low Cloud RGB",
  awips_snow: "Snow Cloud RGB",
  awips_tpw: "Total Precipitable Water",
  day_snow_fog_rgb: "Snow/Fog RGB",
  dust_rgb: "Dust (EUMETSAT)",
  fire_power: "Fire Power",
  fog_rgb: "Fog RGB",
  rgb_cimss_nd_tc: "Tropical Cyclone RGB",
  rgb_enhanced_aerosol: "Aerosol RGB",
  rgb_enhanced_ash: "Ash RGB",
  rgb_natural_enhanced: "Enhanced Natural Color",
  rgb_stormtop: "Storm Top RGB",
  rgb_true_color: "True Color",
};
