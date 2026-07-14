import type { Location, Forecast, AirQuality, HeatmapSample, HeatmapResult, MapState } from "./types";
import { MAP_DEFAULT_ZOOM } from "./config";
import { getMapState } from "./map";

export let activeLocation: Location | null = null;
export let latestForecast: Forecast | null = null;
export let latestHeatmap: HeatmapSample[] | null = null;
export let latestHeatmapMeta: HeatmapResult["meta"] | null = null;
export let latestAirQuality: AirQuality | null = null;
export let activeHeatmapLayer = "temperature";
export let activeMapHourOffset = 0;

export function setActiveLocation(v: Location | null): void { activeLocation = v; }
export function setLatestForecast(v: Forecast | null): void { latestForecast = v; }
export function setLatestHeatmap(v: HeatmapSample[] | null): void { latestHeatmap = v; }
export function setLatestHeatmapMeta(v: HeatmapResult["meta"] | null): void { latestHeatmapMeta = v; }
export function setLatestAirQuality(v: AirQuality | null): void { latestAirQuality = v; }
export function setActiveHeatmapLayerState(v: string): void { activeHeatmapLayer = v; }
export function setActiveMapHourOffsetState(v: number): void { activeMapHourOffset = v; }

export const mapState: MapState = getMapState();
export const activePointers = new Map<number, { x: number; y: number }>();
export const pinchState = { startDist: 0, startZoom: MAP_DEFAULT_ZOOM };
export let weatherLoadId = 0;
export function setWeatherLoadId(v: number): void { weatherLoadId = v; }
export let heatmapRefreshToken = 0;
export function setHeatmapRefreshToken(v: number): void { heatmapRefreshToken = v; }
export let heatmapRefreshTimer: ReturnType<typeof setTimeout> | null = null;
export function setHeatmapRefreshTimer(v: ReturnType<typeof setTimeout> | null): void { heatmapRefreshTimer = v; }
export let heatmapRetryDelay = 1000;
export function setHeatmapRetryDelay(v: number): void { heatmapRetryDelay = v; }
export let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
export function setSearchDebounceTimer(v: ReturnType<typeof setTimeout> | null): void { searchDebounceTimer = v; }
export let selectedLocationSuggestion: Location | null = null;
export function setSelectedLocationSuggestion(v: Location | null): void { selectedLocationSuggestion = v; }
export let resizeTimer: ReturnType<typeof setTimeout> | null = null;
export function setResizeTimer(v: ReturnType<typeof setTimeout> | null): void { resizeTimer = v; }
export let mapAnimationTimer: ReturnType<typeof setInterval> | null = null;
export function setMapAnimationTimer(v: ReturnType<typeof setInterval> | null): void { mapAnimationTimer = v; }
export let mapAnimationPlaying = false;
export function setMapAnimationPlaying(v: boolean): void { mapAnimationPlaying = v; }
export let tooltipRaf: number | null = null;
export function setTooltipRaf(v: number | null): void { tooltipRaf = v; }
export const cachedMetricUnits = [...document.querySelectorAll(".metric-card .metric-unit")] as HTMLElement[];
export let satelliteOverlayDrag: { startX: number; startY: number; left: number; top: number } | null = null;
export function setSatelliteOverlayDrag(v: typeof satelliteOverlayDrag): void { satelliteOverlayDrag = v; }
export let satelliteOverlayResizeDrag: { startX: number; startY: number; width: number; height: number } | null = null;
export function setSatelliteOverlayResizeDrag(v: typeof satelliteOverlayResizeDrag): void { satelliteOverlayResizeDrag = v; }

export interface Elements {
  stationTitle: HTMLElement | null;
  stationCopy: HTMLElement | null;
  stationCoordinates: HTMLElement | null;
  updatedAt: HTMLElement | null;
  heroKicker: HTMLElement | null;
  heroLocation: HTMLElement | null;
  heroCopy: HTMLElement | null;
  heroTimezone: HTMLElement | null;
  temperature: HTMLElement | null;
  currentCondition: HTMLElement | null;
  conditionCopy: HTMLElement | null;
  pressure: HTMLElement | null;
  wind: HTMLElement | null;
  windCompass: HTMLElement | null;
  tempTrend: HTMLElement | null;
  pressureTrend: HTMLElement | null;
  windDirection: HTMLElement | null;
  humidity: HTMLElement | null;
  humidityTrend: HTMLElement | null;
  watchLevel: HTMLElement | null;
  watchCopy: HTMLElement | null;
  warningBar: HTMLElement | null;
  warningLabel: HTMLElement | null;
  warningTitle: HTMLElement | null;
  warningCopy: HTMLElement | null;
  eventLog: HTMLElement | null;
  patternList: HTMLElement | null;
  dailyGrid: HTMLElement | null;
  weeklyList: HTMLElement | null;
  historyList: HTMLElement | null;
  hourlyStrip: HTMLElement | null;
  refreshButton: HTMLElement | null;
  clearHistoryButton: HTMLElement | null;
  chartTooltip: HTMLElement | null;
  heatmapLegend: HTMLElement | null;
  mapHourSlider: HTMLInputElement | null;
  mapHourLabel: HTMLElement | null;
  mapPlayButton: HTMLElement | null;
  mapReadout: HTMLElement | null;
  mapTooltip: HTMLElement | null;
  mapHoverIndicator: HTMLElement | null;
  mapTitle: HTMLElement | null;
  mapCopy: HTMLElement | null;
  mapZoomIn: HTMLElement | null;
  mapZoomOut: HTMLElement | null;
  mapReset: HTMLElement | null;
  satelliteStatus: HTMLElement | null;
  satelliteCopy: HTMLElement | null;
  satelliteSectorSelect: HTMLSelectElement | null;
  satelliteProductSelect: HTMLSelectElement | null;
  satelliteLink: HTMLAnchorElement | null;
  satelliteImage: HTMLImageElement | null;
  satelliteEmpty: HTMLElement | null;
  locationForm: HTMLFormElement | null;
  locationInput: HTMLInputElement | null;
  locationSearchNote: HTMLElement | null;
  locationSuggestions: HTMLElement | null;
  defaultLocationLabel: HTMLElement | null;
  setDefaultLocationButton: HTMLButtonElement | null;
  resetDefaultLocationButton: HTMLButtonElement | null;
  settingsMapLayer: HTMLSelectElement | null;
  settingsStartHour: HTMLSelectElement | null;
  clearWatchlistButton: HTMLButtonElement | null;
  clearHistorySettingsButton: HTMLButtonElement | null;
  exportSettingsButton: HTMLButtonElement | null;
  importSettingsButton: HTMLButtonElement | null;
  importSettingsFile: HTMLInputElement | null;
  stormHeading: HTMLElement | null;
  stormGrid: HTMLElement | null;
  stormSignals: HTMLElement | null;
  stormRiskBadge: HTMLElement | null;
  stormRiskFill: HTMLElement | null;
  airGrid: HTMLElement | null;
  confidenceGrid: HTMLElement | null;
  contextGrid: HTMLElement | null;
  watchlistGrid: HTMLElement | null;
  pinLocationButton: HTMLButtonElement | null;
  tornadoGrid: HTMLElement | null;
  satelliteOverlay: HTMLElement | null;
  satelliteOverlayHeader: HTMLElement | null;
  satelliteOverlayClose: HTMLButtonElement | null;
  satelliteOverlayResize: HTMLElement | null;
}

export const elements: Elements = {
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

export const chartCanvas = document.querySelector("#weather-chart") as HTMLCanvasElement;
export const heatmapCanvas = document.querySelector("#heatmap-canvas") as HTMLCanvasElement;
export const heatmapButtons = [...document.querySelectorAll(".heatmap-button")] as HTMLElement[];
