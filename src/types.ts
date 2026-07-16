export interface Location {
  name: string;
  admin?: string;
  country?: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  population?: number;
}

export interface GeocodingResult {
  name: string;
  admin1?: string;
  country?: string;
  country_code?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  population?: number;
}

export interface Forecast {
  current: CurrentConditions;
  hourly: HourlyData;
  daily: DailyData;
  timezone?: string;
  timezone_abbreviation?: string;
  __precipCacheMeta?: CacheMeta;
}

export interface CurrentConditions {
  time: string;
  temperature_2m: number;
  apparent_temperature?: number;
  precipitation: number;
  rain?: number;
  weather_code: number;
  pressure_msl: number;
  wind_speed_10m: number;
  wind_direction_10m: number;
  wind_gusts_10m: number;
  relative_humidity_2m: number;
}

export interface HourlyData {
  time: string[];
  temperature_2m: number[];
  apparent_temperature?: number[];
  dew_point_2m?: number[];
  precipitation: number[];
  precipitation_probability: number[];
  weather_code: number[];
  pressure_msl: number[];
  wind_speed_10m: number[];
  wind_gusts_10m: number[];
  wind_direction_10m?: number[];
  wind_speed_100m?: number[];
  relative_humidity_2m?: number[];
  cloud_cover: number[];
  visibility?: number[];
  cape?: number[];
  snowfall?: number[];
  vapour_pressure_deficit?: number[];
  soil_temperature_0cm?: number[];
}

export interface DailyData {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
  precipitation_probability_max: number[];
  wind_speed_10m_max: number[];
  wind_gusts_10m_max: number[];
  sunrise: string[];
  sunset: string[];
  uv_index_max?: number[];
}

export interface AirQuality {
  hourly: {
    time: string[];
    us_aqi?: number[];
    pm2_5?: number[];
    pm10?: number[];
    ozone?: number[];
    nitrogen_dioxide?: number[];
    carbon_monoxide?: number[];
    uv_index?: number[];
  };
}

export interface CacheMeta {
  stale: boolean;
  age: number;
  backedOff?: boolean;
  rateLimited?: boolean;
  fallback?: boolean;
}

export interface NwsAlert {
  properties: {
    id?: string;
    event: string;
    headline?: string;
    description?: string;
    severity: string;
    source?: string;
  };
  geometry?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][];
  };
}

export interface WildfireFeature {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: any;
  };
  properties: {
    id?: string;
    featureType: "hotspot" | "perimeter";
    source: "CWFIS" | "FIRMS";
    date?: string;
    agency?: string;
    sensor?: string;
    satellite?: string;
    confidence?: string;
    temperature?: number;
    firstDate?: string;
    lastDate?: string;
    hotspotCount?: number;
    areaHa?: number;
  };
}

export interface SpcFeature {
  type: string;
  properties: {
    dn: number;
    label: string;
    label2?: string;
  };
  geometry: {
    type: string;
    coordinates: number[][][];
  };
}

export interface SpcCollection {
  features: SpcFeature[];
}

export interface NoaaSector {
  id: string;
  name: string;
  sat: string;
  latitude: number;
  longitude: number;
}

export interface SliderSatellite {
  id: string;
  name: string;
  sectors: SliderSector[];
}

export interface SliderSector {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export type SatelliteSource = "noaa" | "slider";

export interface NoaaProduct {
  key: string;
  title: string;
  url: string;
}

export interface NoaaCatalog {
  products: NoaaProduct[];
}

export interface MapState {
  center: {
    latitude: number;
    longitude: number;
  };
  zoom: number;
  drag: MapDrag | null;
  selected: Location | null;
  renderQueued: boolean;
  samples?: HeatmapSample[];
}

export interface MapDrag {
  pointerId: number;
  startX: number;
  startY: number;
  canvasX: number;
  canvasY: number;
  width: number;
  height: number;
  centerWorld: { x: number; y: number };
  zoom: number;
  moved: boolean;
}

export interface HeatmapSample {
  row: number;
  column: number;
  latitude: number;
  longitude: number;
  hourly?: Partial<HourlyData>;
  value?: number;
  normalized?: number;
  x?: number;
  y?: number;
}

export interface HeatmapViewport {
  zoom: number;
  width: number;
  height: number;
  padding: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  columns: number;
  rows: number;
  cacheKey?: string;
  fetchedAt?: number;
}

export interface HeatmapResult {
  points: HeatmapSample[];
  meta: HeatmapViewport;
}

export interface ChartPoint {
  index: number;
  offset: number;
  x: number;
  temperatureY: number;
  precipY: number;
  time: string;
  temperature: number;
  precipitationProbability: number;
  precipitationAmount: number;
  wind: number;
}

export interface ChartState {
  hoverIndex: number | null;
  points: ChartPoint[];
}

export interface AppSettings {
  mapLayer: string;
  mapHourOffset: number;
  useImperial: boolean;
  showAlerts: boolean;
  showWildfires: boolean;
}

export interface StormRisk {
  score: number;
  level: string;
  cape: number;
  dewPoint: number;
  gusts: number;
  rainChance: number;
  rainTotal: number;
  pressureDrop: number;
  shear: number;
}

export interface ForecastSnapshot {
  id: string;
  savedAt: string;
  location: string;
  temperature: number;
  pressure: number;
  wind: number;
  todayHigh: number;
  todayLow: number;
  todayPrecip: number;
  todayChance: number;
  condition: string;
}

export interface SettingsPreset {
  version: number;
  exportedAt: string;
  preferredLocation: Location | null;
  settings: AppSettings;
  watchlist: Location[];
  history: ForecastSnapshot[];
}

export interface WatchlistItem extends Location {
  pinnedAt: string;
  temperature: number;
  gusts: number;
  rain: number;
  risk: string;
}

export interface AlertPolygon {
  points: { x: number; y: number }[];
  coords: number[][];
  severity: string;
  event: string;
  headline: string;
  description: string;
  id: string;
}

export type HeatmapLayer =
  | "temperature"
  | "feels"
  | "dewpoint"
  | "humidity"
  | "precipitation"
  | "precipProbability"
  | "wind"
  | "gusts"
  | "pressure"
  | "cloud"
  | "visibility"
  | "cape";

export interface TropicalCyclone {
  id: string;
  name: string;
  stormType: string;
  category?: number;
  latitude: number;
  longitude: number;
  maxWindSpeed: number;
  minPressure: number;
  movement: {
    direction: number;
    speed: number;
  };
  lastUpdate: string;
  basin: string;
}

export interface StormTrackPoint {
  validTime: string;
  latitude: number;
  longitude: number;
  maxWindSpeed: number;
  stormType: string;
}

export interface ConePoint {
  validTime: string;
  centerLat: number;
  centerLon: number;
  radius: number;
}
