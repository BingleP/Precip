import type { NwsAlert, AlertPolygon, Location, Forecast, StormRisk, SpcCollection } from "./types";
import { NWS_SEVERITY_ORDER, TORNADO_EVENTS, ALERT_SEVERITY_COLORS, SPC_CATEGORIES, SPC_TORNADO_PROB } from "./config";
import { pointInPolygon, projectToMapScreen } from "./geo";

let latestAlerts: NwsAlert[] | null = null;
let latestSpcCat: SpcCollection | null = null;
let latestSpcTorn: SpcCollection | null = null;
let alertPolygonsCache: AlertPolygon[] = [];

export function getLatestAlerts(): NwsAlert[] | null {
  return latestAlerts;
}

export function setLatestAlerts(alerts: NwsAlert[] | null): void {
  latestAlerts = alerts;
}

export function getLatestSpcCat(): SpcCollection | null {
  return latestSpcCat;
}

export function setLatestSpcCat(cat: SpcCollection | null): void {
  latestSpcCat = cat;
}

export function getLatestSpcTorn(): SpcCollection | null {
  return latestSpcTorn;
}

export function setLatestSpcTorn(torn: SpcCollection | null): void {
  latestSpcTorn = torn;
}

export function getAlertPolygonsCache(): AlertPolygon[] {
  return alertPolygonsCache;
}

export function setAlertPolygonsCache(cache: AlertPolygon[]): void {
  alertPolygonsCache = cache;
}

export function updateNwsAlerts(
  alerts: NwsAlert[],
  elements: Record<string, HTMLElement | null>,
  showToastFn: (message: string, type?: string, duration?: number) => void,
  updateWarningBar: (level: string, label: string, title: string, copy: string) => void,
): void {
  latestAlerts = alerts;
  const alertBadge = document.querySelector('.tab-button[data-tab="now"] .alert-badge') as HTMLElement | null;

  if (!alerts?.length) {
    updateWarningBar("clear", "Weather Status", "No active alerts", "No weather alerts are currently active for this area.");
    if (alertBadge) alertBadge.remove();
    return;
  }

  const sorted = [...alerts].sort(
    (a, b) => (NWS_SEVERITY_ORDER[b.properties.severity] || 0) - (NWS_SEVERITY_ORDER[a.properties.severity] || 0),
  );
  const top = sorted[0].properties;
  const severity = top.severity || "Unknown";
  const level = severity === "Extreme" || severity === "Severe" ? "warning" : severity === "Moderate" ? "watch" : "advisory";

  const source = top.source === "ECCC" ? "ECCC" : "NWS";
  const label = `${source} ${severity.toUpperCase()} — ${alerts.length} alert${alerts.length > 1 ? "s" : ""}`;
  updateWarningBar(level, label, top.event || top.headline || "Weather alert", (top.headline || top.description || "").slice(0, 300));

  if (!alertBadge) {
    const badge = document.createElement("span");
    badge.className = "alert-badge";
    badge.textContent = alerts.length > 9 ? "9+" : String(alerts.length);
    document.querySelector('.tab-button[data-tab="now"]')?.appendChild(badge);
  } else {
    alertBadge.textContent = alerts.length > 9 ? "9+" : String(alerts.length);
  }

  showToastFn(
    `${severity}: ${top.event || "Weather alert"}`,
    severity === "Extreme" || severity === "Severe" ? "error" : "info",
    5000,
  );
}

export function drawMapAlertPolygons(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  centerLat: number,
  centerLon: number,
  zoom: number,
): AlertPolygon[] {
  const cache: AlertPolygon[] = [];
  if (!latestAlerts?.length) return cache;

  const polyAlerts = latestAlerts.filter(
    (a) => a.geometry?.type === "Polygon" || a.geometry?.type === "MultiPolygon",
  );
  if (!polyAlerts.length) return cache;

  for (const alert of polyAlerts) {
    const coords = alert.geometry!.coordinates;
    const rings = alert.geometry!.type === "MultiPolygon"
      ? coords[0]
      : [coords[0]];
    const ring = rings[0] as number[][];
    const severity = alert.properties.severity || "Unknown";
    const colors = ALERT_SEVERITY_COLORS[severity] || ALERT_SEVERITY_COLORS.Unknown;
    const screenPoints = ring.map(([lon, lat]) =>
      projectToMapScreen(lat, lon, width, height, centerLat, centerLon, zoom),
    );

    cache.push({
      points: screenPoints,
      coords: ring,
      severity,
      event: alert.properties.event,
      headline: alert.properties.headline || "",
      description: (alert.properties.description || "").slice(0, 300),
      id: alert.properties.id || "",
    });

    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
    for (let i = 1; i < screenPoints.length; i++) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = colors.fill;
    ctx.fill();
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = severity === "Extreme" || severity === "Severe" ? 2.5 : 1.5;
    ctx.setLineDash(severity === "Extreme" || severity === "Severe" ? [] : [6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  alertPolygonsCache = cache;
  return cache;
}

export function isInsideAlertPolygon(px: number, py: number): AlertPolygon | null {
  for (const polygon of alertPolygonsCache) {
    const { points } = polygon;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    if (inside) return polygon;
  }
  return null;
}

function findRiskForLocation(collection: SpcCollection, center: { latitude: number; longitude: number }): SpcCollection["features"][0] | null {
  if (!collection?.features?.length) return null;
  for (const feature of collection.features) {
    const coords = feature.geometry.coordinates as number[][][][] | number[][][];
    const polygons = feature.geometry.type === "Polygon"
      ? [coords as number[][][]]
      : coords as number[][][][];
    for (const polygon of polygons) {
      if (pointInPolygon(center.longitude, center.latitude, polygon)) {
        return feature;
      }
    }
  }
  return null;
}

export function renderSpcOutlook(center: { latitude: number; longitude: number }): string {
  const items: string[] = [];

  if (latestSpcCat) {
    const match = findRiskForLocation(latestSpcCat, center);
    if (match) {
      const cat = SPC_CATEGORIES[match.properties.dn] || {
        label: match.properties.label,
        name: match.properties.label2 || "",
        color: "#888",
      };
      items.push(
        `<article class="toolkit-card"><span>Day 1 Risk</span><strong style="color:${cat.color}">${cat.name}</strong><small>SPC categorical convective outlook</small></article>`,
      );
    }
  }

  if (latestSpcTorn) {
    const match = findRiskForLocation(latestSpcTorn, center);
    if (match) {
      const prob = SPC_TORNADO_PROB[match.properties.dn] || { pct: match.properties.label, color: "#888" };
      items.push(
        `<article class="toolkit-card"><span>Tornado Prob</span><strong style="color:${prob.color}">${prob.pct}</strong><small>Day 1 tornado probability</small></article>`,
      );
    }
  }

  if (latestAlerts?.length) {
    const tornadoWarnings = latestAlerts.filter((a) => TORNADO_EVENTS.has(a.properties.event));
    if (tornadoWarnings.length) {
      const worst = tornadoWarnings.sort(
        (a, b) => (NWS_SEVERITY_ORDER[b.properties.severity] || 0) - (NWS_SEVERITY_ORDER[a.properties.severity] || 0),
      )[0].properties;
      items.push(
        `<article class="toolkit-card"><span>Active Alert</span><strong style="color:#c96a6e">${worst.event}</strong><small>${(worst.headline || worst.description || "").slice(0, 120)}</small></article>`,
      );
    }
  }

  if (!items.length) {
    return `<div class="empty-signal">No SPC convective outlook risk for this area today.</div>`;
  }
  return items.join("");
}
