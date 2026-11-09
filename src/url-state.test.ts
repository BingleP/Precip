import { test, expect } from "bun:test";

// url-state imports ./state, whose module load queries the DOM. Stub the
// minimum DOM surface before the dynamic import so tests run under Bun
// without a browser.
const g = globalThis as unknown as Record<string, unknown>;
if (!g.document) {
  g.document = {
    cookie: "",
    hidden: false,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => ({ getContext: () => null }),
  };
}
if (!g.window) {
  g.window = { location: { pathname: "/", search: "" }, history: {} };
}
if (!g.navigator) {
  g.navigator = { onLine: true };
}

const { parseUrlState, buildUrlQuery } = await import("./url-state");

test("parseUrlState reads a full share URL", () => {
  const state = parseUrlState("?lat=43.65&lon=-79.38&z=11&layer=temperature&overlay=radar&hour=5&opacity=0.6");
  expect(state.latitude).toBe(43.65);
  expect(state.longitude).toBe(-79.38);
  expect(state.zoom).toBe(11);
  expect(state.layer).toBe("temperature");
  expect(state.overlay).toBe("radar");
  expect(state.hour).toBe(5);
  expect(state.opacity).toBe(0.6);
});

test("parseUrlState returns nulls for an empty query", () => {
  const state = parseUrlState("");
  expect(state.latitude).toBeNull();
  expect(state.zoom).toBeNull();
  expect(state.layer).toBeNull();
  expect(state.overlay).toBeUndefined();
  expect(state.hour).toBeNull();
  expect(state.opacity).toBeNull();
});

test("parseUrlState clamps zoom, hour, opacity and rejects junk", () => {
  const state = parseUrlState("?lat=999&lon=-79.38&z=99&layer=bogus&overlay=bogus&hour=99&opacity=5");
  expect(state.latitude).toBeNull();
  expect(state.longitude).toBeNull();
  expect(state.zoom).toBe(15);
  expect(state.layer).toBeNull();
  expect(state.overlay).toBeNull();
  expect(state.hour).toBe(23);
  expect(state.opacity).toBe(1);
});

test("parseUrlState requires both coordinates for a location", () => {
  const state = parseUrlState("?lat=43.65");
  expect(state.latitude).toBeNull();
  expect(state.longitude).toBeNull();
});

test("parseUrlState treats overlay=none as disabled", () => {
  const state = parseUrlState("?overlay=none");
  expect(state.overlay).toBeNull();
});

test("buildUrlQuery round-trips through parseUrlState", () => {
  const query = buildUrlQuery();
  const state = parseUrlState(`?${query}`);
  expect(state.zoom).not.toBeNull();
  expect(state.layer).not.toBeNull();
  // buildUrlQuery always writes an overlay value (or "none").
  expect(state.overlay !== undefined).toBe(true);
  expect(state.hour).not.toBeNull();
  expect(state.opacity).not.toBeNull();
});
