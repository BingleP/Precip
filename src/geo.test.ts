import { test, expect } from "bun:test";
import {
  latLonToWorld,
  worldToLatLon,
  projectToMapScreen,
  clampMapZoom,
  haversineDistance,
  getLocationCacheKey,
  pointInPolygon,
  screenToMapLocation,
} from "./geo";

test("latLon/world round-trips", () => {
  const world = latLonToWorld(43.65, -79.38, 10);
  const back = worldToLatLon(world.x, world.y, 10);
  expect(back.latitude).toBeCloseTo(43.65, 8);
  expect(back.longitude).toBeCloseTo(-79.38, 8);
});

test("screenToMapLocation inverts projectToMapScreen", () => {
  const width = 800;
  const height = 600;
  const projected = projectToMapScreen(43.65, -79.38, width, height, 43.65, -79.38, 10);
  expect(projected.x).toBeCloseTo(width / 2, 6);
  expect(projected.y).toBeCloseTo(height / 2, 6);

  const roundTrip = screenToMapLocation(projected.x, projected.y, width, height, 43.65, -79.38, 10);
  expect(roundTrip.latitude).toBeCloseTo(43.65, 8);
  expect(roundTrip.longitude).toBeCloseTo(-79.38, 8);
});

test("clampMapZoom rounds and clamps", () => {
  expect(clampMapZoom(10.4, 3, 15)).toBe(10);
  expect(clampMapZoom(10.6, 3, 15)).toBe(11);
  expect(clampMapZoom(1, 3, 15)).toBe(3);
  expect(clampMapZoom(99, 3, 15)).toBe(15);
});

test("haversineDistance Toronto to Montreal", () => {
  const km = haversineDistance(43.65, -79.38, 45.5, -73.56);
  // ~505 km great-circle. Guard against factor-of-two or degrees/radians bugs.
  expect(km).toBeGreaterThan(490);
  expect(km).toBeLessThan(520);
});

test("getLocationCacheKey rounds to two decimals", () => {
  expect(getLocationCacheKey({ latitude: 43.65444, longitude: -79.38324 })).toBe("43.65,-79.38");
});

test("pointInPolygon inside/outside", () => {
  const square = [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]];
  expect(pointInPolygon(0, 0, square)).toBe(true);
  expect(pointInPolygon(2, 0, square)).toBe(false);
});
