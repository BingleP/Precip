/**
 * Typed registry of map weather layers.
 *
 * This is the single source of truth for what can be rendered on the map.
 * Phases 2–4 add raster layers (radar, satellite cloud, forecast cloud/precip)
 * as new entries; the renderer and UI read everything from here.
 *
 * Render order (see renderMapScene in map.ts):
 *   base tiles → raster (observed) → raster (forecast) → scalar field →
 *   vector overlays → labels/tooltip.
 */

export type LayerKind = "scalar" | "raster";
export type LayerGroup = "observations" | "forecast";
export type LayerTimeMode = "observed" | "forecast";
export type LayerRenderer = "field" | "tiles" | "wms";

export interface MapLayer {
  id: string;
  kind: LayerKind;
  group: LayerGroup;
  /** Full display name, e.g. "Temperature". */
  label: string;
  /** Short chip label, e.g. "Temp". */
  shortLabel: string;
  /** Headline used by the map readout. */
  title: string;
  /** Unit hint shown in the legend (may be replaced by the value formatter). */
  unit: string;
  source: string;
  timeMode: LayerTimeMode;
  renderer: LayerRenderer;
  defaultOpacity: number;
  /** One of the six primary chips; the rest live behind "More". */
  primary: boolean;
  attribution?: string;
}

const SCALAR_HEATMAP_ALPHA = 0.52; // matches the historical heatmap alpha (132/255)

function scalar(
  id: string,
  label: string,
  shortLabel: string,
  title: string,
  unit: string,
  primary = false,
): MapLayer {
  return {
    id,
    kind: "scalar",
    group: "forecast",
    label,
    shortLabel,
    title,
    unit,
    source: "Open-Meteo",
    timeMode: "forecast",
    renderer: "field",
    defaultOpacity: SCALAR_HEATMAP_ALPHA,
    primary,
  };
}

export const MAP_LAYERS: MapLayer[] = [
  {
    id: "radar",
    kind: "raster",
    group: "observations",
    label: "Weather radar",
    shortLabel: "Radar",
    title: "Weather radar",
    unit: "dBZ",
    source: "RainViewer",
    timeMode: "observed",
    renderer: "tiles",
    defaultOpacity: 0.85,
    primary: true,
    attribution: "Weather data by RainViewer",
  },
  {
    id: "satCloud",
    kind: "raster",
    group: "observations",
    label: "Satellite cloud",
    shortLabel: "Clouds",
    title: "Satellite cloud",
    unit: "IR",
    source: "NASA GIBS",
    timeMode: "observed",
    renderer: "tiles",
    defaultOpacity: 0.8,
    primary: false,
    attribution: "NASA GIBS / NOAA",
  },
  {
    id: "fcastCloud",
    kind: "raster",
    group: "forecast",
    label: "Forecast cloud cover",
    shortLabel: "F.Cloud",
    title: "Forecast cloud cover",
    unit: "%",
    source: "ECCC GeoMet",
    timeMode: "forecast",
    renderer: "wms",
    defaultOpacity: 0.85,
    primary: false,
    attribution: "ECCC GeoMet (GDPS)",
  },
  {
    id: "fcastPrecip",
    kind: "raster",
    group: "forecast",
    label: "Forecast precipitation rate",
    shortLabel: "F.Rain",
    title: "Forecast precipitation rate",
    unit: "mm/h",
    source: "ECCC GeoMet",
    timeMode: "forecast",
    renderer: "wms",
    defaultOpacity: 0.85,
    primary: false,
    attribution: "ECCC GeoMet (GDPS)",
  },
  scalar("temperature", "Temperature", "Temp", "Current temperature", "°C", true),
  scalar("feels", "Feels like", "Feels", "Apparent temperature", "°C"),
  scalar("precipitation", "Rain intensity", "Rain", "Current rain intensity", "mm/h", true),
  scalar("wind", "Wind speed", "Wind", "Current wind speed", "km/h", true),
  scalar("cloud", "Cloud cover", "Cloud", "Cloud cover", "%"),
  scalar("pressure", "Sea-level pressure", "Pressure", "Sea-level pressure", "hPa"),
  scalar("dewpoint", "Dew point", "Dew", "Dew point", "°C"),
  scalar("humidity", "Relative humidity", "Humidity", "Relative humidity", "%"),
  scalar("precipProbability", "Rain probability", "Chance", "Rain probability", "%"),
  scalar("gusts", "Wind gusts", "Gusts", "Wind gusts", "km/h"),
  scalar("visibility", "Visibility", "Visibility", "Visibility", "km"),
  scalar("cape", "CAPE", "CAPE", "CAPE", "J/kg"),
];

export const DEFAULT_LAYER_ID = "temperature";
export const MAX_RASTER_LAYERS = 2;

const layerById = new Map(MAP_LAYERS.map((layer) => [layer.id, layer]));

export function getLayer(id: string | null | undefined): MapLayer | null {
  if (!id) return null;
  return layerById.get(id) ?? null;
}

export function isLayerId(id: string | null | undefined): boolean {
  return getLayer(id) !== null;
}

export function getPrimaryLayers(): MapLayer[] {
  return MAP_LAYERS.filter((layer) => layer.primary);
}

export function getMoreLayers(): MapLayer[] {
  return MAP_LAYERS.filter((layer) => !layer.primary);
}

export function getLayersByGroup(group: LayerGroup): MapLayer[] {
  return MAP_LAYERS.filter((layer) => layer.group === group);
}

export function getRasterLayers(): MapLayer[] {
  return MAP_LAYERS.filter((layer) => layer.kind === "raster");
}

export function normalizeLayerId(id: string | null | undefined): string {
  return isLayerId(id) ? (id as string) : DEFAULT_LAYER_ID;
}
