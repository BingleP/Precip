import { test, expect } from "bun:test";
import {
  normalizeMapLayer,
  normalizeMapOverlayLayer,
  normalizeMapLayerOpacity,
  normalizeMapHourOffset,
} from "./storage";
import { DEFAULT_APP_SETTINGS } from "./config";

test("normalizeMapLayer accepts known layers, falls back to wind", () => {
  expect(normalizeMapLayer("wind")).toBe("wind");
  expect(normalizeMapLayer("temperature")).toBe("temperature");
  expect(normalizeMapLayer("bogus")).toBe("wind");
  expect(normalizeMapLayer(undefined)).toBe("wind");
});

test("normalizeMapOverlayLayer only accepts raster layers", () => {
  expect(normalizeMapOverlayLayer("radar")).toBe("radar");
  expect(normalizeMapOverlayLayer("fcastPrecip")).toBe("fcastPrecip");
  // Scalar layers cannot be overlays.
  expect(normalizeMapOverlayLayer("wind")).toBeNull();
  expect(normalizeMapOverlayLayer(null)).toBeNull();
  expect(normalizeMapOverlayLayer(undefined)).toBeNull();
  expect(normalizeMapOverlayLayer("bogus")).toBeNull();
});

test("normalizeMapLayerOpacity clamps to [0.1, 1]", () => {
  expect(normalizeMapLayerOpacity(0.5)).toBe(0.5);
  expect(normalizeMapLayerOpacity(0)).toBe(0.1);
  expect(normalizeMapLayerOpacity(2)).toBe(1);
  expect(normalizeMapLayerOpacity(undefined)).toBe(DEFAULT_APP_SETTINGS.mapLayerOpacity);
});

test("normalizeMapLayerOpacity rounds to two decimals", () => {
  expect(normalizeMapLayerOpacity(0.526)).toBe(0.53);
});

test("normalizeMapHourOffset clamps to 0..23 and rounds", () => {
  expect(normalizeMapHourOffset(0)).toBe(0);
  expect(normalizeMapHourOffset(23)).toBe(23);
  expect(normalizeMapHourOffset(-4)).toBe(0);
  expect(normalizeMapHourOffset(99)).toBe(23);
  expect(normalizeMapHourOffset(5.6)).toBe(6);
  expect(normalizeMapHourOffset(Number.NaN)).toBe(DEFAULT_APP_SETTINGS.mapHourOffset);
});
