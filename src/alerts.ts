import type { NwsAlert, AlertPolygon, SpcCollection, WildfireFeature } from "./types";
import { NWS_SEVERITY_ORDER, TORNADO_EVENTS, ALERT_SEVERITY_COLORS, SPC_CATEGORIES, SPC_TORNADO_PROB } from "./config";
import { pointInPolygon, projectToMapScreenFast } from "./geo";

let latestAlerts: NwsAlert[] | null = null;
let mapCenterAlerts: NwsAlert[] | null = null;
let latestSpcCat: SpcCollection | null = null;
let latestSpcTorn: SpcCollection | null = null;
let alertPolygonsCache: AlertPolygon[] = [];
let allAlerts: NwsAlert[] | null = null;

// Memoization state for drawMapAlertPolygons
let lastDrawnAlertsRef: NwsAlert[] | null = null;
let lastDrawnCenterKey = "";
let lastDrawnZoom = -1;
let lastDrawnWidth = -1;
let lastDrawnHeight = -1;
let mapCenterWildfires: WildfireFeature[] | null = null;

interface WildfireHotspotEntry {
  x: number; y: number; radius: number;
  feature: WildfireFeature;
}
interface WildfirePerimeterEntry {
  points: { x: number; y: number }[];
  feature: WildfireFeature;
}
let wildfireHotspotCache: WildfireHotspotEntry[] = [];
let wildfirePerimeterCache: WildfirePerimeterEntry[] = [];

export function getLatestAlerts(): NwsAlert[] | null {
  return latestAlerts;
}

export function setLatestAlerts(alerts: NwsAlert[] | null): void {
  latestAlerts = alerts;
}

export function getMapCenterAlerts(): NwsAlert[] | null {
  return mapCenterAlerts;
}

export function setMapCenterAlerts(alerts: NwsAlert[] | null): void {
  mapCenterAlerts = alerts;
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
  buildSpatialIndex();
}

export function getAllAlerts(): NwsAlert[] | null {
  return allAlerts;
}

export function setAllAlerts(alerts: NwsAlert[] | null): void {
  allAlerts = alerts;
}

export function getMapCenterWildfires(): WildfireFeature[] | null {
  return mapCenterWildfires;
}

export function setMapCenterWildfires(features: WildfireFeature[] | null): void {
  mapCenterWildfires = features;
}

export function updateNwsAlerts(
  alerts: NwsAlert[],
  _elements: Record<string, HTMLElement | null>,
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
  centerWorld: { x: number; y: number },
  zoom: number,
  alertsOverride?: NwsAlert[] | null,
): AlertPolygon[] {
  const alerts = (alertsOverride && alertsOverride.length) ? alertsOverride : latestAlerts;
  if (!alerts?.length) {
    alertPolygonsCache = [];
    lastDrawnAlertsRef = null;
    return alertPolygonsCache;
  }

  const polyAlerts = alerts.filter(
    (a) => a.geometry?.type === "Polygon" || a.geometry?.type === "MultiPolygon",
  );
  if (!polyAlerts.length) {
    alertPolygonsCache = [];
    lastDrawnAlertsRef = null;
    return alertPolygonsCache;
  }

  const centerKey = `${centerWorld.x.toFixed(2)},${centerWorld.y.toFixed(2)}`;
  const zoomRound = Math.round(zoom);

  const cacheHit =
    alerts === lastDrawnAlertsRef &&
    centerKey === lastDrawnCenterKey &&
    zoomRound === lastDrawnZoom &&
    width === lastDrawnWidth &&
    height === lastDrawnHeight;

  if (cacheHit) {
    drawCachedAlertPolygons(ctx, alertPolygonsCache);
    return alertPolygonsCache;
  }

  const cache: AlertPolygon[] = [];
  const margin = 60;

  for (const alert of polyAlerts) {
    const coords = alert.geometry!.coordinates;
    const rings = alert.geometry!.type === "MultiPolygon"
      ? coords[0]
      : [coords[0]];
    const ring = rings[0] as number[][];

    // Frustum cull: compute lat/lon bbox and check screen-space visibility
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const [lon, lat] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    const nw = projectToMapScreenFast(maxLat, minLon, width, height, centerWorld, zoom);
    const ne = projectToMapScreenFast(maxLat, maxLon, width, height, centerWorld, zoom);
    const sw = projectToMapScreenFast(minLat, minLon, width, height, centerWorld, zoom);
    const se = projectToMapScreenFast(minLat, maxLon, width, height, centerWorld, zoom);
    const sx1 = Math.min(nw.x, ne.x, sw.x, se.x);
    const sy1 = Math.min(nw.y, ne.y, sw.y, se.y);
    const sx2 = Math.max(nw.x, ne.x, sw.x, se.x);
    const sy2 = Math.max(nw.y, ne.y, sw.y, se.y);
    if (sx2 < -margin || sx1 > width + margin || sy2 < -margin || sy1 > height + margin) {
      continue;
    }

    const severity = alert.properties.severity || "Unknown";
    const screenPoints = ring.map(([lon, lat]) =>
      projectToMapScreenFast(lat, lon, width, height, centerWorld, zoom),
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
  }

  drawCachedAlertPolygons(ctx, cache);

  alertPolygonsCache = cache;
  lastDrawnAlertsRef = alerts;
  lastDrawnCenterKey = centerKey;
  lastDrawnZoom = zoomRound;
  lastDrawnWidth = width;
  lastDrawnHeight = height;
  return cache;
}

function drawCachedAlertPolygons(
  ctx: CanvasRenderingContext2D,
  polygons: AlertPolygon[],
): void {
  for (const polygon of polygons) {
    const { points, severity } = polygon;
    if (!points.length) continue;
    const colors = ALERT_SEVERITY_COLORS[severity] || ALERT_SEVERITY_COLORS.Unknown;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
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

// Spatial index for fast point-in-polygon queries
const spatialGrid = new Map<string, AlertPolygon[]>();
const GRID_CELL_SIZE = 100;

function buildSpatialIndex(): void {
  spatialGrid.clear();
  for (const polygon of alertPolygonsCache) {
    if (!polygon.points.length) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of polygon.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const startCol = Math.floor(minX / GRID_CELL_SIZE);
    const endCol = Math.floor(maxX / GRID_CELL_SIZE);
    const startRow = Math.floor(minY / GRID_CELL_SIZE);
    const endRow = Math.floor(maxY / GRID_CELL_SIZE);
    for (let col = startCol; col <= endCol; col++) {
      for (let row = startRow; row <= endRow; row++) {
        const key = `${col},${row}`;
        const bucket = spatialGrid.get(key);
        if (bucket) bucket.push(polygon);
        else spatialGrid.set(key, [polygon]);
      }
    }
  }
}

export function isInsideAlertPolygonSpatial(px: number, py: number): AlertPolygon | null {
  const col = Math.floor(px / GRID_CELL_SIZE);
  const row = Math.floor(py / GRID_CELL_SIZE);
  const bucket = spatialGrid.get(`${col},${row}`);
  if (!bucket || !bucket.length) return null;
  for (const polygon of bucket) {
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

export function setWildfireHitCache(
  hotspots: { x: number; y: number; radius: number; feature: WildfireFeature }[],
  perimeters: { points: { x: number; y: number }[]; feature: WildfireFeature }[],
): void {
  wildfireHotspotCache = hotspots;
  wildfirePerimeterCache = perimeters;
}

export function getWildfireAtPoint(px: number, py: number): WildfireFeature | null {
  for (const h of wildfireHotspotCache) {
    const dx = px - h.x;
    const dy = py - h.y;
    if (dx * dx + dy * dy <= h.radius * h.radius) {
      return h.feature;
    }
  }
  for (const p of wildfirePerimeterCache) {
    const { points } = p;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    if (inside) return p.feature;
  }
  return null;
}
