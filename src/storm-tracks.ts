import type { TropicalCyclone, StormTrackPoint, ConePoint } from "./types";
import { projectToMapScreenFast } from "./geo";

export const STORM_COLORS: Record<string, string> = {
  "Tropical Depression": "#00ff00",
  "Tropical Storm": "#ffff00",
  Hurricane: "#ffa500",
  "Category 1": "#ff8c00",
  "Category 2": "#ff4500",
  "Category 3": "#ff0000",
  "Category 4": "#d40000",
  "Category 5": "#8b0000",
};

let activeCyclones: TropicalCyclone[] = [];
let stormForecasts: Map<string, StormTrackPoint[]> = new Map();
let stormCones: Map<string, ConePoint[]> = new Map();

export function getActiveCyclones(): TropicalCyclone[] {
  return activeCyclones;
}

export function setActiveCyclones(storms: TropicalCyclone[]): void {
  activeCyclones = storms;
}

export function getStormForecast(stormId: string): StormTrackPoint[] | undefined {
  return stormForecasts.get(stormId);
}

export function setStormForecast(stormId: string, forecast: StormTrackPoint[]): void {
  stormForecasts.set(stormId, forecast);
}

export function getStormCone(stormId: string): ConePoint[] | undefined {
  return stormCones.get(stormId);
}

export function setStormCone(stormId: string, cone: ConePoint[]): void {
  stormCones.set(stormId, cone);
}

export function clearStormData(): void {
  activeCyclones = [];
  stormForecasts.clear();
  stormCones.clear();
}

export function drawStormTracks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  centerWorld: { x: number; y: number },
  zoom: number,
): void {
  for (const storm of activeCyclones) {
    const forecast = stormForecasts.get(storm.id);
    const cone = stormCones.get(storm.id);

    if (cone?.length) {
      drawConeOfUncertainty(ctx, cone, width, height, centerWorld, zoom);
    }
    if (forecast?.length) {
      drawForecastTrack(ctx, forecast, width, height, centerWorld, zoom);
    }
    drawCurrentPosition(ctx, storm, width, height, centerWorld, zoom);
  }
}

function getStormColor(stormType: string, category?: number): string {
  if (category && category >= 1) {
    const catKey = `Category ${category}` as keyof typeof STORM_COLORS;
    return STORM_COLORS[catKey] || STORM_COLORS.Hurricane;
  }
  return STORM_COLORS[stormType] || STORM_COLORS.Hurricane;
}

function drawConeOfUncertainty(
  ctx: CanvasRenderingContext2D,
  cone: ConePoint[],
  width: number,
  height: number,
  centerWorld: { x: number; y: number },
  zoom: number,
): void {
  for (const point of cone) {
    const { x, y } = projectToMapScreenFast(
      point.centerLat,
      point.centerLon,
      width,
      height,
      centerWorld,
      zoom,
    );
    const radiusPixels = (point.radius * 1852) / (111320 * Math.cos(point.centerLat * Math.PI / 180)) * Math.pow(2, zoom);

    ctx.beginPath();
    ctx.arc(x, y, Math.max(4, radiusPixels), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawForecastTrack(
  ctx: CanvasRenderingContext2D,
  forecast: StormTrackPoint[],
  width: number,
  height: number,
  centerWorld: { x: number; y: number },
  zoom: number,
): void {
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();

  forecast.forEach((point, index) => {
    const { x, y } = projectToMapScreenFast(
      point.latitude, point.longitude,
      width, height, centerWorld, zoom,
    );
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  forecast.forEach((point) => {
    const { x, y } = projectToMapScreenFast(
      point.latitude, point.longitude,
      width, height, centerWorld, zoom,
    );
    const color = getStormColor(point.stormType);

    ctx.fillStyle = color;
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
}

function drawCurrentPosition(
  ctx: CanvasRenderingContext2D,
  storm: TropicalCyclone,
  width: number,
  height: number,
  centerWorld: { x: number; y: number },
  zoom: number,
): void {
  const { x, y } = projectToMapScreenFast(
    storm.latitude, storm.longitude,
    width, height, centerWorld, zoom,
  );

  const color = getStormColor(storm.stormType, storm.category);

  ctx.fillStyle = color;
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.font = "bold 12px system-ui";
  ctx.textAlign = "left";
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 3;
  ctx.strokeText(storm.name, x + 14, y + 4);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(storm.name, x + 14, y + 4);
}
