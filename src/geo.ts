import { MAP_TILE_SIZE } from "./config";

export function latLonToWorld(latitude: number, longitude: number, zoom: number): { x: number; y: number } {
  const safeLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const sinLatitude = Math.sin((safeLatitude * Math.PI) / 180);
  const scale = MAP_TILE_SIZE * 2 ** zoom;
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * scale,
  };
}

export function worldToLatLon(x: number, y: number, zoom: number): { latitude: number; longitude: number } {
  const scale = MAP_TILE_SIZE * 2 ** zoom;
  const longitude = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { latitude, longitude };
}

export function projectToMapScreen(
  latitude: number,
  longitude: number,
  width: number,
  height: number,
  centerLat: number,
  centerLon: number,
  zoom: number,
): { x: number; y: number } {
  const centerWorld = latLonToWorld(centerLat, centerLon, zoom);
  const pointWorld = latLonToWorld(latitude, longitude, zoom);
  return {
    x: width / 2 + pointWorld.x - centerWorld.x,
    y: height / 2 + pointWorld.y - centerWorld.y,
  };
}

export function screenToMapLocation(
  x: number,
  y: number,
  width: number,
  height: number,
  centerLat: number,
  centerLon: number,
  zoom: number,
): { latitude: number; longitude: number } {
  const centerWorld = latLonToWorld(centerLat, centerLon, zoom);
  return worldToLatLon(centerWorld.x + x - width / 2, centerWorld.y + y - height / 2, zoom);
}

export function setMapCenterFromWorld(
  world: { x: number; y: number },
  zoom: number,
): { latitude: number; longitude: number } {
  return worldToLatLon(world.x, world.y, Math.round(zoom));
}

export function clampMapZoom(zoom: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(zoom)));
}

export function haversineDistance(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latDelta = toRadians(latitudeB - latitudeA);
  const lonDelta = toRadians(longitudeB - longitudeA);
  const startLatitude = toRadians(latitudeA);
  const endLatitude = toRadians(latitudeB);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(lonDelta / 2) ** 2;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getRoundedCoordinate(value: number, digits = 2): number {
  return Number(Number(value).toFixed(digits));
}

export function getLocationCacheKey(location: { latitude: number; longitude: number }): string {
  return [getRoundedCoordinate(location.latitude), getRoundedCoordinate(location.longitude)].join(",");
}

export function pointInPolygon(lon: number, lat: number, coords: number[][][]): boolean {
  let inside = false;
  for (const ring of coords) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}
