import type { Forecast, HourlyData, StormRisk, AppSettings } from "./types";
import { WEATHER_CODES } from "./config";
import { getAppSettings } from "./storage";

export function isImperial(): boolean {
  return getAppSettings().useImperial;
}

export function formatTemp(celsius: number | undefined | null): string {
  if (celsius == null || !Number.isFinite(celsius)) return "--";
  const imp = isImperial();
  return imp ? `${Math.round(celsius * 9 / 5 + 32)}°F` : `${celsius.toFixed(1)}°C`;
}

export function formatSpeed(kmh: number | undefined | null): string {
  if (kmh == null || !Number.isFinite(kmh)) return "--";
  const imp = isImperial();
  return imp ? `${Math.round(kmh / 1.609)} mph` : `${Math.round(kmh)} km/h`;
}

export function formatPrecip(mm: number | undefined | null): string {
  if (mm == null || !Number.isFinite(mm)) return "--";
  const imp = isImperial();
  return imp ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(1)} mm`;
}

export function formatPressure(hpa: number | undefined | null): string {
  if (hpa == null || !Number.isFinite(hpa)) return "--";
  const imp = isImperial();
  return imp ? `${(hpa / 33.864).toFixed(2)} inHg` : `${Math.round(hpa)} hPa`;
}

export function degreesToCompass(degrees: number | undefined | null): string {
  if (degrees == null || !Number.isFinite(degrees)) return "--";
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return directions[Math.round(degrees / 22.5) % 16];
}

export function describeWeatherCode(code: number | undefined): string {
  if (code === undefined || code === null) return "Mixed conditions";
  return WEATHER_CODES[code] || "Mixed conditions";
}

export function formatDay(dateText: string, style: "short" | "long" = "short"): string {
  return new Date(`${dateText}T12:00:00`).toLocaleDateString([], {
    weekday: style,
    month: "short",
    day: "numeric",
  });
}

export function describeDelta(
  value: number | undefined | null,
  unit: string,
  risingText: string,
  fallingText: string,
): string {
  if (value == null || !Number.isFinite(value)) return "Trend unavailable";
  if (Math.abs(value) < 0.1) return "Stable last 3 hours";
  const direction = value > 0 ? risingText : fallingText;
  return `${direction} ${Math.abs(value).toFixed(1)} ${unit} last 3 hours`;
}

export function findCurrentIndex(times: string[]): number {
  const now = Date.now();
  let bestIndex = 0;
  let smallestDiff = Infinity;

  times.forEach((time, index) => {
    const timeMs = new Date(time).getTime();
    const diff = Math.abs(timeMs - now);
    if (diff < smallestDiff || (diff === smallestDiff && timeMs <= now)) {
      smallestDiff = diff;
      bestIndex = index;
    }
  });

  return bestIndex;
}

export function getCurrentHourlyIndex(forecast: Forecast): number {
  return findCurrentIndex(forecast.hourly.time);
}

type NumericHourlyKey =
  | "temperature_2m" | "apparent_temperature" | "dew_point_2m"
  | "precipitation" | "precipitation_probability" | "weather_code"
  | "pressure_msl" | "wind_speed_10m" | "wind_gusts_10m"
  | "wind_direction_10m" | "wind_speed_100m"
  | "relative_humidity_2m" | "cloud_cover"
  | "visibility" | "cape" | "snowfall"
  | "vapour_pressure_deficit" | "soil_temperature_0cm";

export function hourlyValue(forecast: Forecast, key: NumericHourlyKey, offset = 0): number | undefined {
  const hourly = forecast.hourly as unknown as Record<string, unknown>;
  const arr = hourly[key] as number[] | undefined;
  if (!arr) return undefined;
  const index = Math.min(arr.length - 1, getCurrentHourlyIndex(forecast) + offset);
  return arr[index];
}

export function maxNext(forecast: Forecast, key: NumericHourlyKey, hours = 12): number {
  const hourly = forecast.hourly as unknown as Record<string, unknown>;
  const arr = hourly[key] as number[] | undefined;
  if (!arr) return NaN;
  const start = getCurrentHourlyIndex(forecast);
  const values = arr.slice(start, start + hours).filter(Number.isFinite);
  return values.length ? Math.max(...values) : NaN;
}

export function sumNext(forecast: Forecast, key: NumericHourlyKey, hours = 12): number {
  const hourly = forecast.hourly as unknown as Record<string, unknown>;
  const arr = hourly[key] as number[] | undefined;
  if (!arr) return 0;
  const start = getCurrentHourlyIndex(forecast);
  return arr.slice(start, start + hours).reduce((total, v) => total + (v || 0), 0);
}

export function calculateStormRisk(forecast: Forecast): StormRisk {
  const cape = maxNext(forecast, "cape", 12);
  const dewPoint = maxNext(forecast, "dew_point_2m", 12);
  const gusts = maxNext(forecast, "wind_gusts_10m", 12);
  const rainChance = maxNext(forecast, "precipitation_probability", 12);
  const rainTotal = sumNext(forecast, "precipitation", 12);
  const pressureDrop = (hourlyValue(forecast, "pressure_msl", 0) || 0) - (hourlyValue(forecast, "pressure_msl", 6) || 0);
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

export function getHeatmapTitle(layer: string): string {
  const titles: Record<string, string> = {
    temperature: "Current temperature",
    feels: "Apparent temperature",
    dewpoint: "Dew point",
    humidity: "Relative humidity",
    precipitation: "Current rain intensity",
    precipProbability: "Rain probability",
    wind: "Current wind speed",
    gusts: "Wind gusts",
    pressure: "Sea-level pressure",
    cloud: "Cloud cover",
    visibility: "Visibility",
    cape: "CAPE",
  };
  return titles[layer] || "Current temperature";
}

export function formatHeatmapValue(value: number | undefined | null, layer: string): string {
  if (value == null || !Number.isFinite(value)) return "--";
  if (layer === "precipitation") return formatPrecip(value);
  if (layer === "precipProbability" || layer === "humidity" || layer === "cloud") return `${Math.round(value)}%`;
  if (layer === "wind" || layer === "gusts") return formatSpeed(value);
  if (layer === "pressure") return formatPressure(value);
  if (layer === "visibility") return isImperial() ? `${(value / 1609.34).toFixed(1)} mi` : `${Math.round(value / 1000)} km`;
  if (layer === "cape") return `${Math.round(value)} J/kg`;
  return formatTemp(value);
}

export function getHeatmapValue(
  point: { hourly?: Partial<HourlyData> },
  layer: string,
  hourOffset: number,
): number | undefined {
  const hourly = point.hourly || {};
  const index = Math.min(hourOffset, Math.max(0, (hourly.time?.length || 1) - 1));
  const valueMap: Record<string, (number | undefined)[] | undefined> = {
    temperature: hourly.temperature_2m as (number | undefined)[] | undefined,
    feels: hourly.apparent_temperature as (number | undefined)[] | undefined,
    dewpoint: hourly.dew_point_2m as (number | undefined)[] | undefined,
    humidity: hourly.relative_humidity_2m as (number | undefined)[] | undefined,
    precipitation: hourly.precipitation as (number | undefined)[] | undefined,
    precipProbability: hourly.precipitation_probability as (number | undefined)[] | undefined,
    wind: hourly.wind_speed_10m as (number | undefined)[] | undefined,
    gusts: hourly.wind_gusts_10m as (number | undefined)[] | undefined,
    pressure: hourly.pressure_msl as (number | undefined)[] | undefined,
    cloud: hourly.cloud_cover as (number | undefined)[] | undefined,
    visibility: hourly.visibility as (number | undefined)[] | undefined,
    cape: hourly.cape as (number | undefined)[] | undefined,
  };
  return valueMap[layer]?.[index];
}



export function normalizeValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  const range = max - min || 1;
  return Math.max(0, Math.min(1, (value - min) / range));
}

export function getPrecipBarClass(value: number): string {
  const normalized = Math.max(0, Math.min(100, Number(value) || 0));
  return `bar-${Math.round(normalized / 10) * 10}`;
}

export function formatNumber(value: number | undefined, digits = 1): string {
  return Number.isFinite(value) ? value!.toFixed(digits) : "--";
}
