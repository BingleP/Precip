import type { Earthquake } from "./types";
import { projectToMapScreenFast } from "./geo";

export const EARTHQUAKE_COLORS: Record<string, string> = {
  minor: "#00ff00",       // M2.5-4.0
  light: "#ffff00",       // M4.0-5.0
  moderate: "#ffa500",    // M5.0-6.0
  strong: "#ff4500",      // M6.0-7.0
  major: "#ff0000",       // M7.0-8.0
  great: "#8b0000",      // M8.0+
};

function getMagnitudeColor(magnitude: number): string {
  if (magnitude >= 8) return EARTHQUAKE_COLORS.great;
  if (magnitude >= 7) return EARTHQUAKE_COLORS.major;
  if (magnitude >= 6) return EARTHQUAKE_COLORS.strong;
  if (magnitude >= 5) return EARTHQUAKE_COLORS.moderate;
  if (magnitude >= 4) return EARTHQUAKE_COLORS.light;
  return EARTHQUAKE_COLORS.minor;
}

function getMagnitudeRadius(magnitude: number): number {
  if (magnitude >= 8) return 14;
  if (magnitude >= 7) return 11;
  if (magnitude >= 6) return 9;
  if (magnitude >= 5) return 7;
  if (magnitude >= 4) return 5;
  return 4;
}

export function drawEarthquakes(
  ctx: CanvasRenderingContext2D,
  earthquakes: Earthquake[],
  width: number,
  height: number,
  centerWorld: { x: number; y: number },
  zoom: number,
): void {
  if (!earthquakes?.length) return;

  for (const eq of earthquakes) {
    const { x, y } = projectToMapScreenFast(
      eq.latitude,
      eq.longitude,
      width,
      height,
      centerWorld,
      zoom,
    );

    // Frustum culling
    const margin = 20;
    if (x < -margin || x > width + margin || y < -margin || y > height + margin) continue;

    const color = getMagnitudeColor(eq.magnitude);
    const radius = getMagnitudeRadius(eq.magnitude);

    // Outer glow
    ctx.beginPath();
    ctx.arc(x, y, radius + 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.25;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Main circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }
}
