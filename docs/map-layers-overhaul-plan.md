# Map Layers Overhaul Plan

Status: Phase 0–6 complete. Phase 6 deployed live on
precip.kerrick.ca (2026-11-07); all phases verified locally and on
production. Remaining scope: none (Phase 6 closed the overhaul).
Scope: fix two known defects, then replace the single fog-like heatmap with a
stack of real weather layers (radar, satellite cloud, forecast cloud/precip,
scalar fields) that are legible over the dark basemap.

---

## 1. Fix the two known defects first

These are small, independent, and should land before the map overhaul so the
baseline is clean.

### 1.1 Production CSP blocks inline styles

**Symptom**

On production only, the console reports:

```
Applying inline style violates the following Content Security Policy directive
'style-src 'self''
```

(nix `styles.css` is same-origin, so no violation there.)

**Root causes**

Inline `style="..."` attributes in generated markup and in static HTML:

- `src/alerts.ts` – three SPC/toolkit cards use
  `style="color:${cat.color}"`, `style="color:${prob.color}"`,
  `style="color:#c96a6e"`.
- `src/panels/tropical.ts` – storm card uses
  `style="border-left: 4px solid ${catColor}"`.
- `index.html` – two map-tools rows use `style="margin-top:4px"`.

The production CSP is `style-src 'self'`, so the browser drops all of them.

**Fix**

- Move the SPC risk and tornado-probability colours into a small fixed set of
  CSS classes (`.spc-risk-*`, `.spc-torn-*`) in `styles.css`; the source data
  already maps to a fixed categorical palette.
- Move storm category colours to `.storm-cat-0` … `.storm-cat-5`.
- Replace the two `margin-top:4px` inline styles with a utility class
  (`.map-tools-row-spaced` or a gap on the parent).
- Add a guardrail: a small script or CI grep that fails on
  `style="` in `src/` and `index.html`. CSSOM assignments such as
  `el.style.left = ...` are allowed and must stay allowed.
- If dynamic colours are ever unavoidable, create the element and assign
  `el.style.color = ...` (CSSOM). Do **not** build `style="..."` strings.

**Verification**

- Local: `bun run typecheck && bun run build`.
- Production: reload with DevTools, assert zero CSP violations on first load
  and after opening the Alerts, Storm, and Tropical tabs.
- Regression check that SPC cards still show their colours.

### 1.2 `/api/alerts` returns 400 for non-US points

**Symptom**

```
GET /api/alerts?latitude=43.7000&longitude=-79.4200 -> 400
```

**Root cause**

`fetchAlerts` chooses the endpoint with
`location.countryCode === "CA"`. If `countryCode` is missing (legacy cookie,
manually supplied coordinates, some reverse-geocode results), a Canadian point
is sent to the US NWS `point=` endpoint, which rejects out-of-coverage points
with 400.

**Fix (client)**

- Treat a location as Canadian when
  `countryCode === "CA"` **or** `country` matches `Canada` case-insensitively.
- Only call `/api/alerts` when the country is the US (`countryCode === "US"` or
  country `United States`).
- For every other country, return `[]` and set a clear status note
  ("Alerts are available for the US and Canada") instead of firing a request
  that is guaranteed to fail.
- Backfill `countryCode` when saving/loading preferred locations and watchlist
  entries so old cookies heal themselves. Keep a country-name fallback for
  entries that cannot be healed.

**Fix (proxy)**

- In `build_us_alerts_payload`, catch upstream HTTP 400/404 and return an empty
  `FeatureCollection` instead of propagating the error. Border/coastal points
  can still fall outside NWS coverage even with a correct country.
- Validate `latitude`/`longitude` ranges before calling upstream (return 400
  for truly invalid input, but not for valid non-US points).

**Verification**

- Toronto (CA), Buffalo (US), and a point in Mexico/Europe: no console error;
  US/CA alerts still render.
- Add a browser audit step for a Canadian and a US location.

---

## 2. Current state and why it feels like "just colours"

- One `<canvas id="heatmap-canvas">` draws dark OSM tiles, then a 5×4 grid of
  Open-Meteo point forecasts, smoothed with inverse-distance weighting, blurred,
  and painted at ~52% alpha.
- 12 flat layer buttons (Temp, Feels, Dew, Humidity, Rain, Chance, Wind, Gusts,
  Pressure, Cloud, Visibility, CAPE) all use the same four-colour ramp with
  only a tiny palette variation.
- The result is a low-resolution colour fog. It does not look like cloud, rain,
  or a real weather field, and it hides the basemap detail.
- The only true imagery today is the separate Satellite overlay (NOAA/SLIDER),
  which is an animation panel, not a map layer.

Target: a weather map where cloud looks like cloud, rain looks like rain, and
scalar fields are crisp enough to read values from.

### 2.1 Files to touch

| Area | Files |
|---|---|
| Layer registry / types | `src/config.ts` or new `src/map-layers.ts`, `src/types.ts` |
| Renderer | `src/map.ts`, `src/panels/data.ts`, `src/heatmap.ts`, `src/geo.ts` |
| Fetch / cache | `src/api.ts`, `src/storage.ts`, `src/state.ts` |
| Controls / styles | `index.html`, `styles.css`, `src/main.ts` |
| Proxy | `proxy_upstream.py`, `proxy_server.py`, `proxy_cache.py` |
| Documentation | `README.md`, this file |

---

## 3. Target design

### 3.1 Layer model

Introduce a typed registry instead of a flat list of button values:

```ts
type LayerKind = "scalar" | "raster" | "vector";

interface LayerDefinition {
  id: string;
  kind: LayerKind;
  group: "observations" | "forecast" | "impacts";
  label: string;
  unit?: string;
  source?: "rainviewer" | "geomet" | "iem" | "gibs" | "open-meteo";
  timeMode?: "observed" | "forecast" | "latest";
  legend?: LegendDefinition;
  renderer: "field" | "tiles" | "wms" | "vector";
  defaultOpacity: number;
  attribution?: string;
}
```

- One registry in `src/config.ts` (or a new `src/map-layers.ts`) drives the UI,
  the renderer, the legend, and persistence.
- `AppSettings` stores `mapLayer`, optional `mapOverlayLayers`, and per-layer
  opacity.
- Existing vector toggles (Alerts, Fires, Tracks, Quakes) stay as overlays, not
  weather layers.

### 3.2 Layer groups

**Observations**
- Radar – RainViewer (global) / ECCC GeoMet (Canada high-res) / IEM (US)
- Satellite cloud – GOES-East/West infrared (day/night) or GeoColor (day)
- Lightning – future, not in v1

**Forecast**
- Cloud cover – GDPS 15 km total cloud (global), CAPS 3 km for Canada
- Precipitation rate – GDPS 15 km / CAPS 3 km
- Rain / snow type – GDPS precip type (legend only in v1)
- Scalars – temperature, feels like, dew point, humidity, wind, gusts,
  pressure, visibility, CAPE

**Impacts (existing)**
- Alerts, wildfires, storm tracks, earthquakes, satellite panel

### 3.3 Render order

1. Base OSM tiles (existing dark filter)
2. Observed rasters (radar, satellite cloud)
3. Forecast rasters (cloud, precip)
4. Scalar field (if selected)
5. Vector overlays (alerts, fires, tracks, quakes)
6. Labels, location marker, tooltips

Hard cap: one scalar field + up to two raster weather layers at a time. More
than that becomes mud and destroys mobile frame rate.

---

## 4. Data sources (all verified reachable)

| Layer | Source | Endpoint / layer | Coverage | Cadence | Notes |
|---|---|---|---|---|---|
| Radar (global) | RainViewer | `api.rainviewer.com/public/weather-maps.json` + `tilecache.rainviewer.com` XYZ 512 px | Global radar networks | ~5 min, 13 past frames | Transparent PNG; free for personal/educational use; attribution "Weather data by RainViewer" required; no key |
| Radar (Canada) | ECCC GeoMet WMS | `RADAR_1KM_RRAI`, `RADAR_1KM_RSNO` | Canada | 6 min | 1 km, transparent, high quality |
| Radar (US) | IEM | `mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png` | US | ~5 min | Good fallback for RainViewer gaps; credit Iowa Environmental Mesonet |
| Satellite cloud | NASA GIBS WMTS | `GOES-East_ABI_Band13_Clean_Infrared` (Level 6), `GOES-East_ABI_GeoColor` (Level 7), same for West, plus `Himawari_AHI_Band13_Clean_Infrared` | GOES East/West + Himawari disks | 10 min | RGBA PNG; IR works day/night; GeoColor day only; no key |
| Forecast cloud | ECCC GeoMet WMS | `GDPS_15km_TotalCloudCover` (global), `CAPS_3km_TotalCloudCover` (Canada) | Global / N. America | Hourly | Grayscale with alpha; global; supports `TIME` |
| Forecast precip | ECCC GeoMet WMS | `GDPS_15km_PrecipRate`, `CAPS_3km_PrecipRate` | Global / N. America | Hourly | Same WMS path as cloud |
| Scalars | Open-Meteo | existing `/api/forecast` multi-point | Global | Hourly | Raise grid resolution; chunk through proxy |
| Satellite animation | NOAA STAR / SLIDER | existing | Sector / global | 5–10 min | Keep as the current overlay panel |

Implementation notes:

- All imagery must go through the same-origin proxy. No CSP changes are needed
  for radar/cloud if they are proxied.
- Do not fetch GeoMet `GetCapabilities` at runtime (≈40 MB). Hardcode the
  whitelisted layer names, dimensions, and styles. Refresh metadata manually
  when ECCC changes layers.
- RainViewer is free for personal/educational use and this site qualifies, but
  attribution is mandatory. Add a visible "Weather data by RainViewer" link in
  the legend/attribution area. Cache aggressively (the terms ask for it).
- GIBS GOES products occasionally have gaps or stale frames. Check the latest
  timestamp before drawing, and fall back West/East, Himawari, or GeoMet cloud
  when a tile set is empty.
- Attribution summary: RainViewer (radar), NASA GIBS (satellite), ECCC GeoMet
  (radar/cloud/forecast), Iowa Environmental Mesonet (US radar), OpenStreetMap
  (basemap). Put all of these in the map attribution control.
- A GeoMet `TIME` request has been spot-checked: `now+6h` returns a valid and
  different cloud image, so the forecast-hour slider can drive the WMS layer
  directly.

---

## 5. Rendering strategy

### 5.1 Projection and compositing

- Keep the existing custom Web Mercator canvas and `prepareCanvas` DPR cap.
- Tile sources (RainViewer, IEM, GIBS) use the same tile math as OSM, so they
  align by construction.
- WMS sources (GeoMet) get one `GetMap` per viewport in `EPSG:3857`, using the
  exact canvas BBOX converted from world pixels to metres. Draw the returned
  image across the canvas. Snap the BBOX to a coarse grid (≈0.05°) so cache
  keys are reusable.
- Draw rasters with `globalAlpha` and, where useful, `globalCompositeOperation`
  (`screen` for bright cloud IR, source-over for radar). Never use `filter:
  blur()` on the full canvas for these layers.
- Cross-fade layer changes over 150–250 ms; while a raster is loading, keep the
  previous frame or the lower-zoom parent tile visible.

### 5.2 Radar

- Radar tiles are already transparent and colour-coded. Draw them directly.
- Add a proper dBZ legend (light rain → heavy rain) and an "Observed" badge.
- Loop the last 2 hours: index → frame list → prefetch ±2 frames. Pause the
  loop when the tab is hidden.
- Choose the provider by coverage: GeoMet inside Canada, IEM inside the US,
  RainViewer elsewhere. If the active provider has no tiles for the viewport,
  fall back to RainViewer.

### 5.3 Satellite cloud

- Default: GIBS Band 13 clean infrared, which works day and night.
- Convert IR luminance to a cloud mask: bright cloud tops get high alpha and a
  cool white tint; dark ground/ocean gets near-zero alpha. Do this in an
  offscreen canvas at modest resolution, then upscale smoothly.
- Optional "GeoColor" style for daytime, drawn at reduced opacity with a
  slight desaturation so the basemap still reads.
- Cache by `layer/z/x/y/time`; prefetch the next frame in the loop.

### 5.4 Forecast cloud and precipitation

- Use GeoMet WMS with `TIME = now_utc_rounded_to_hour + activeMapHourOffset`.
- Cloud: grayscale + alpha is already close; tint it slightly blue-white,
  apply an opacity curve so 0–30% cover is invisible and 70–100% is a clear
  veil. This is the "actual cloud cover" layer.
- Precip: use the ECCC rate layer (mm/h) with a radar-like palette, or keep the
  existing Open-Meteo precip field rendered as discrete cells. Prefer the WMS
  raster because it looks like a real field and is cheap.
- For snow, switch to the snow rate/type layer when the model says snow.

### 5.5 Scalar fields (temperature, wind, etc.)

- Raise the Open-Meteo grid from 5×4 to an adaptive ~25×15 on desktop and
  ~15×9 on mobile. Add a chunked proxy endpoint (`/api/field`) that batches
  points and caches the result.
- Replace inverse-distance weighting with bilinear interpolation plus a light
  edge-preserving smoothing pass. Render from a colour LUT, not per-pixel
  branching.
- Do not blur the whole canvas. Keep the field crisp and lower its alpha over
  the basemap.
- Add value legibility:
  - Temperature: isotherm contours every 5 °C with sparse labels.
  - Pressure: isobars every 4 hPa.
  - Wind: speed ramp + animated particle streamlines (phase 5, optional).
  - CAPE: contours + hatch pattern.
- Trim the default layer list to the six most useful (Temp, Feels, Rain, Wind,
  Cloud, Pressure) and move the rest behind "More". Fewer, better layers.

### 5.6 Vectors and labels

- Keep the current alert polygons, wildfire perimeters, storm tracks, quakes,
  place labels, and tap tooltip.
- Ensure raster weather layers are drawn **below** vectors so warnings stay
  readable.
- Tooltip: show the layer name, value with unit, source, and valid time.

---

## 6. UI / UX

- Replace the 12 flat buttons with a grouped "Weather layers" panel:
  - Primary layer select, grouped by Observations / Forecast.
  - Optional secondary overlay select (radar or satellite cloud).
  - Opacity slider for the active weather layer (persisted).
  - Legend card: colour ramp / cloud key, units, source, valid time,
    Observed/Forecast badge, attribution link.
- Keep the quick layer chips for the top 6, with a "More layers" entry.
- Timeline behaviour follows the layer:
  - Observed radar: "Past 2 h" loop with frame ticks.
  - Satellite: latest frame or last hour.
  - Forecast layers: existing +0…+24 h slider, labelled "Forecast".
- Switching from an observed layer to a forecast layer keeps the same area and
  resets the time control to "Now" with a visible mode change.
- Mobile: the layer panel becomes a bottom sheet; opacity and timeline stay
  reachable; no horizontal overflow at 390 px.
- Persist `mapLayer`, overlay choice, opacity, and hour offset in app settings.
- Accessibility: legend text uses real units, not just colour; layer buttons
  have `aria-pressed`; the map canvas gets an updated `aria-label`.

---

## 7. Performance and resilience

- Proxy TTLs: radar 120 s, satellite 300 s, forecast cloud/precip 900 s,
  scalar field 600 s; stale-while-revalidate for upstream failures.
- Cache keys round BBOX and time to avoid cache explosion.
- Client caches: LRU per source (256 tiles), decoded via `createImageBitmap`
  where available; abort in-flight requests on pan/zoom.
- Request coalescing: one in-flight request per layer/bbox.
- Fallback chain: GeoMet → IEM → RainViewer for radar; GIBS East → West →
  GeoMet cloud for satellite; Open-Meteo → met.no for scalars.
- Do not draw weather rasters during active drag; redraw on pointer-up with the
  cached frame, same as vectors today.
- Mobile budgets: ≤30 fps minimum while panning, ≤150 MB JS heap, no more than
  two raster layers active.

---

## 8. Implementation phases

### Phase 0 – Baseline fixes (small) ✅ complete & live 2026-11-06

- CSP inline-style cleanup (alerts, tropical, index.html). Done: class-based
  colours (`.spc-risk-*`, `.spc-torn-*`, `.spc-alert-active`,
  `.storm-border-0…5`, `.map-tools-row-spaced`); guardrail
  `scripts/check-no-inline-styles.py` wired into `bun run check-inline-styles`
  and CI. Also fixed a bonus one found by live browser audit: the `data:` SVG
  select arrow → `public/select-arrow.svg` (`img-src 'self'`).
- Alerts country detection (`src/location.ts` + name fallback, cookie healing)
  + proxy 400 hardening (empty FeatureCollection on upstream 400/404, input
  range validation). Verified locally and in production: Toronto/Buffalo/
  Mexico City/Sydney return 200; malformed input returns 400. Live browser
  audit confirmed Toronto routes to `/api/ca-alerts`.
- Deployment docs corrected to the real Docker flow
  (`~/docker/precip` + `precip-site:latest`); `deploy/deploy.sh` rewritten;
  README deployment section updated.
- Production: zero app CSP violations on first load and across
  Now/Storm/Tropical/Alerts tabs. (Cloudflare's own injected beacon +
  challenge scripts are blocked by `script-src 'self'` — expected, not a bug.)
- Commits: `782c074`, `7e3eb53`, `1e36ea2`. Container rebuilt and recreated.

### Phase 1 – Layer foundation ✅ implemented 2026-11-06 (locally verified)

- `src/map-layers.ts`: typed registry (`LayerKind`, `LayerGroup`,
  `LayerTimeMode`, `LayerRenderer`, `MapLayer`) with the 12 scalar layers,
  primary/more split, and helpers. Raster entries arrive in Phases 2–4.
- Settings: `mapLayer`, `mapOverlayLayer`, `mapLayerOpacity` persisted and
  normalized (registry-based); export/import presets updated.
- Renderer: `drawHeatmapOverlay` takes an alpha; raster drawing seam added
  (`drawRasterWeatherLayer`, no-op until Phase 2) between tiles and the scalar
  field; legend card rebuilt (`renderLayerLegend`) with title, Observed/
  Forecast badge, gradient range, unit, source, valid time, attribution slot.
- UI shell in the map-tools popover: 6 primary chips + collapsible "More"
  (auto-expands when a non-primary layer is active), weather-overlay select
  (disabled placeholder until Phase 2), opacity slider with % readout.
- Verified in the dev browser: layer switch + "More" expansion + opacity
  slider all work and persist; legend card renders; basemap unchanged.
- Acceptance: no visual regression; layer switch and persistence work.

### Phase 2 – Radar (headline feature) — **implemented + verified** (2026-11-07, deploy held with Phase 1)

Status: complete in code and browser-verified. Client in `src/radar.ts`
(provider auto-select by viewport: ECCC GeoMet inside the CA bbox, IEM NEXRAD
inside the US bbox, RainViewer elsewhere; async tile/WMS caches; offscreen
compose + cross-fade; loop; failure fallback to RainViewer), wiring in
`src/panels/data.ts` (radar-primary/overlay branches, timeline scrubber,
play/pause) and `src/map.ts` (`drawRadarLayer`, `renderRadarLegend`,
`renderRadarReadout`).

- Proxy endpoints for RainViewer index/tiles, GeoMet radar, IEM tiles.
  Verified 200 with real imagery; invalid inputs return clean 400s.
- Radar layer with provider selection, loop, dBZ legend, attribution.
- Time control switches to "Observed / Past 2 h" (slider 0–frames−1,
  label "Observed · N min ago").
- Acceptance: radar aligns with coastlines and known precipitation (Toronto
  GeoMet band verified on-screen); loop plays smoothly; mobile frame rate
  holds — pending deploy, covered by Phase 6 acceptance run.

Debugging record (so this is never re-investigated): a session-long suspicion
that RainViewer/IEM tiles "draw but never appear" was **not** a paint defect:

1. Instrumentation (visible markers + offscreen pixel reads after enabling a
   same-origin dev setup) proved the tiles→offscreen→canvas composite is
   correct on every render, and tile loads trigger redraws.
2. The visible cause was the persisted layer-opacity slider sitting at 11%,
   i.e. the radar legibly paints at the default 52%.
3. The apparent "Paris has no radar" was data sparsity: RainViewer's current
   frames contained no precipitation over Paris' z9/z10 viewport (rain sits
   ~40–100 km away); radar appears at wider viewports/scans.

Dev-environment hardening landed during this work (both safe for prod, prod
behaviour unchanged):

- `src/api.ts` now always uses `window.location.origin` for `/api`, so the
  vite dev proxy serves weather data same-origin as in production.
- Basemap tile images set `crossOrigin="anonymous"` (tile.openstreetmap.org
  sends `Access-Control-Allow-Origin: *`), which keeps the map canvas
  untainted so `getImageData` works in dev and for future pixel features.

### Phase 3 – Satellite cloud — **implemented + verified** (2026-11-07, deploy held)

Status: complete in code and browser-verified. Client in `src/cloud.ts`
(provider auto-select by center longitude — Himawari at lon ≥ 90 or < −170,
GOES-West at lon < −135, else GOES-East; raw + processed tile caches;
offscreen composite; 80%-fail one-shot switch to the neighbouring disk;
five-minute "latest" refresh while the tab is visible), wiring in
`src/panels/data.ts` (cloud-primary/overlay branches, timeline shows
"Observed · Latest imagery", single frame — slider max 0, no loop) and
`src/map.ts` (`drawRasterWeatherLayer` dispatches on `layer.id`,
`renderCloudLegend`, `renderCloudReadout`).

- Proxy endpoint `/api/satellite-tile` for GIBS WMTS with layer/time
  whitelist (`goes-east`, `goes-west`, `himawari` → the Band 13 clean-IR
  products, GoogleMapsCompatible_Level6, zoom cap 6). URL shape is
  `.../{LAYER}/default/{TIME}/...` where `default` is the STYLE and
  `TIME` is `default` (newest granule) or `YYYY-MM-DD` (404 outside the
  granule retention window). Verified 200 for all three providers;
  invalid layer/date/zoom/missing params return clean 400s.
- IR→alpha processing: the false-colour clean-IR product puts warm ground
  near luminance 145–162 and cold cloud tops at 180+, so the veil uses
  LOW 148 / HIGH 205 with a sub-unity gamma (0.85, max alpha 230) and a
  neutral grey→white tint (not blue, so it can't be confused with radar
  colours). Tuned against live tiles: LOW 112 washed the ground; the
  final curve keeps clear land transparent while cloud texture reads
  clearly. (Visual tuning note: at zoom ≥ 7 the z6 tiles upscale
  smoothly, which reads as soft cloud — acceptable.)
- Provider-boundary bug caught during verification: the first pick used
  −55° as the GOES-West edge, which put the Great Lakes on GOES-West —
  outside that disk, so tiles came back blank. The disk reaches ~85°W;
  the boundary is now −135° (GOES-East looks straight on well past it),
  and the failover switches east↔west unconditionally.
- Timeline semantics: `isRadarActive()` is radar-only; new
  `isSatCloudActive()` (primary `satCloud` only) forces the single-frame
  timeline. A scalar primary with a cloud overlay keeps the forecast-hours
  timeline and shows the cloud legend.
- Overlay mode: "Clouds" is selectable in the Weather overlay dropdown
  and as a chip in the "More" layers row; `satCloud` is a normal registry
  entry (`src/map-layers.ts`) so persistence/opacity/More-open-state all
  work. The tap-to-inspect tooltip shows "Satellite cloud · observed"
  for raster primaries (radar included).
- Acceptance: verified on-screen at Toronto (GOES-East, cloud system over
  Lake Ontario paints as a neutral-white veil), Paris (GOES-East, cloud
  west of the city), Tokyo (Himawari, requests via `layer=himawari`),
  scalar+overlay mode, and a radar-primary regression (ECCC GeoMet frames,
  "Observed · 2 min ago"); no CSP errors; 5-min refresh uses the same
  redraw path. GOES-East/West outside their disks are no longer a thing
  (boundary fix above); a truly blank disk (e.g. mid-Pacific on an edge
  case) renders nothing, which is the correct fallback.
- Deferred: GeoColor (`GOES-*_ABI_GeoColor`, Level7) for day-time true
  colour — it needs its own matrix/zoom cap and alpha handling (the PNG
  already carries alpha), so it is a follow-up, not a Phase 3 blocker.

### Phase 4 – Forecast cloud and precipitation — **implemented + verified** (2026-11-07, deploy held)

Status: complete in code and browser-verified. Client in
`src/forecast-raster.ts` (WMS GetMap per viewport in EPSG:3857 with a
5 km snap grid like the radar WMS path; image + processed caches;
adjacent-hour prefetch), wiring in `src/panels/data.ts`
(forecast-primary/overlay branches; forecast rasters ride the existing
forecast-hour slider with valid-time display) and `src/map.ts`
(`drawRasterWeatherLayer` dispatches on `layer.id`,
`renderForecastRasterLegend`/`renderForecastRasterReadout`).

- Proxy endpoint `/api/forecast-wms` with a product whitelist
  (`gdps-cloud`, `gdps-precip`; 900 s TTL). URL shape mirrors the radar
  WMS plus a strict ISO8601 `time` (`YYYY-MM-DDTHH:MM:SSZ`, real-date
  validated). Styles: `CLOUD` (greyscale total-cover ramp) for cloud,
  `PRECIPPRTMMH` (discrete palette 0.01–50+ mm/h) for precip. Verified
  200 with real imagery; invalid product/time/bbox/missing params
  return clean 400s.
- Layer names discovered from GeoMet GetCapabilities (40 MB) and
  verified: `GDPS_15km_TotalCloudCover`, `GDPS_15km_PrecipRate`
  (global, hourly `time` dimension, CLOUD + PRECIPPRTMMH styles).
- CAPS finding (why GDPS-only): `CAPS_3km_TotalCloudCover` and
  `CAPS_3km_PrecipRate` returned fully transparent (empty) images for
  every style (CLOUD, CLOUD-50, CloudCover_50-100Pct_Dis), every valid
  time tested, with and without `reference_time`, over both Toronto
  and Vancouver. GDPS worked at the same bboxes/times. The CAPS product
  ids were removed from the whitelist; if CAPS is restored later it
  should be re-verified with a GetMap-over-Canada probe, not assumed.
  (Two early offline probes at "Toronto" that suggested CAPS worked
  turned out — on audit — to have used a botched EPSG:3857 y (R mistaken
  for the half-circumference), i.e. Arctic bboxes. The browser path
  always used the correct math.)
- Cloud opacity curve: the CLOUD ramp gives luminance 0→255 over
  0→100% cover. The veil maps luminance→alpha (LOW 30, HIGH 230,
  γ0.8, max 235, neutral white tint), tuned against live tiles —
  thin model cloud stays near-invisible while overcast regions read
  clearly. Precip draws the server palette directly (already
  radar-like).
- Timeline: forecast rasters use the forecast-hour slider (+0…+24h,
  `syncTimelineUI` falls into the scalar branch — slider max 23,
  label "Now"/local time; legend + readout show the exact valid time
  in UTC, e.g. "Valid 2026-11-07 16:00 UTC (+12h)"). Scrubbing fires
  the new valid-time request immediately and prefetches ±1h.
- Overlay mode: "Forecast cloud"/"Forecast rain" join the Weather
  overlay dropdown, plus "F.Cloud"/"F.Rain" chips in the More row;
  scalar+overlay keeps the forecast-hours timeline and shows the
  forecast legend. The tap-to-inspect tooltip now shows the layer's
  own timeMode ("· forecast" for these, "· observed" for radar/cloud).
- Acceptance: verified on-screen at Toronto (GDPS veil over scattered
  model cloud; +12h scrub swaps imagery and valid time), Vancouver
  (overcast matches 100% GDPS cover), and Seattle (precip palette over
  Puget Sound marine rain), scalar+overlay mode, no console errors.
  GDPS 15 km blockiness is visible at high zoom — kept (honest to the
  source); smoothing softens the edges.

### Phase 5 – Scalar field upgrade — **implemented + verified** (2026-11-07, deploy held)

Status: complete in code and browser-verified. Proxy `/api/field`
(stack of `src/field.ts` + `build_field_payload` in proxy_upstream.py)
fetches a dense lat/lon grid from Open-Meteo in 100-point chunks and
reshapes it into a compact row-major payload (`cols/rows/lats/lons/
values/u/v/validTime/unit`, SI values; wind returns speed plus
eastward/northward components for streamlines). Client renders the
grid crisply (per-pixel bilinear + per-layer LUT into an offscreen
buffer at 0.75 scale, composited with the layer opacity), with
marching-squares isotherms (2 °C) / isobars (4 hPa) and RK2 wind
streamlines. The legacy coarse fog overlay remains only as the
first-paint fallback while a field loads.

- Adaptive grid: cols/rows from viewport size and zoom
  (`getFieldGridSpec`, 10–28 × 4–22), bounds snapped to half a grid
  cell in world coordinates so pans reuse the server (600 s) and
  client (LRU 24) caches. Hour key comes from the forecast-hour
  slider (the scalar path already indexes forecasts by hour).
- LUTs: per-layer stops for all 12 scalar layers (temperature family,
  humidity/probability, PRECIPPRTMMH-like precip with value-scaled
  alpha, wind/gusts, pressure, cloud veil ramp, visibility, CAPE).
- Contours: temperature → isotherms; pressure → isobars; other
  layers draw no lines. Streamlines: wind layer only; seeds on the
  grid, dead-calm (< 2 km/h) seeds skipped, alpha-free single path.
- Trim: primary chips are now Radar / Temp / Rain / Wind; Feels,
  Cloud and Pressure moved into "More" (`primary: false` in the
  registry + HTML moved), so any of them still auto-expands More
  when active. The settings default-layer select (static) is
  unchanged and still lists every layer.
- Acceptance: verified on-screen at z10 (Toronto temperature field
  + isotherms), z9 (wide field, lake-effect warm blob, isotherms),
  wind streamlines converging over Lake Ontario, pressure field,
  chip trim + More auto-expand, scrub integration, no console
  errors. Contour lines are grid-resolution polylines (honest to
  the source cell size); finer contours would need a denser grid —
  deferred to a future adaptive-density pass. Label overlap and the
  mobile budget belong to the Phase 6 performance pass.

### Phase 6 – Polish and rollout — **complete + deployed live** (2026-11-07)

Status: deployed to precip.kerrick.ca and verified on production.

- Accessibility: `aria-pressed` on every layer chip and every overlay
  toggle, synced on switch and on load; map canvas `aria-label`
  follows the active layer ("Regional weather map: X (observed /
  forecast)"); tap/hover tooltip now shows the valid time for
  forecast rasters ("Valid 2026-11-07 05:00 UTC (+Nh)").
- Mobile: the ≤768px bottom-sheet layout already existed; audited
  with the layer stack (peek handle, 44px touch targets, 16px
  search input to stop iOS zoom, legend/timeline offset above the
  peek). Desktop checked for horizontal overflow (none). No
  device-emulation tooling is available in the dev harness, so a
  physical 390×844 run still belongs with the user's device — the
  CSS bounds are media-query driven, not pixel driven.
- Performance: 61 fps rAF average (p95 16.8 ms) during zoom/pan with
  a WMS raster active; 30 synthetic pan steps produced 0 new
  `/api/field` requests (snap + client + server caches coalesce).
- Docs: README now documents the layer stack, both new upstreams
  (GeoMet WMS, GIBS), and the six layer-stack endpoints.
- Deploy: server git synced, `dist/` recopied to /var/www/precip,
  proxy sources recopied, container rebuilt + recreated
  (`precip-site:latest`, nginx + proxy on 127.0.0.1:8093/:7428).
- Live verification on precip.kerrick.ca: new bundle
  (`main-2eJEuC7-`) serving; satellite cloud (GOES-East, latest),
  forecast cloud (GDPS + valid time + prefetch), scalar field
  request (19×12 grid), ECCC GeoMet radar ("Observed · 9 min ago")
  all render; zero app console/CSP errors (Cloudflare's own beacon +
  challenge script remain blocked by `script-src 'self'` — expected,
  not an app bug). Timeline/hour modes, chips/More, and overlay
  overlays behave as locally measured.

---

## 9. Verification and acceptance criteria

**Functional**

- Radar, satellite cloud, forecast cloud, and forecast precip each render in
  the right place at z3–z10 (coastline alignment within 1–2 px).
- Observed vs forecast is obvious in the UI and legend.
- Time slider matches the active layer type and changes the raster/texture.
- Opacity control affects only the active weather layer.
- Existing overlays (alerts, fires, tracks, quakes), satellite panel, drag,
  resize, and mobile tap tooltip still work.

**Quality**

- Cloud looks like cloud and rain looks like rain; no rainbow fog.
- Scalar fields are crisp, with units and values readable on hover.
- Legends include source, units, valid time, and attribution.
- No CSP violations on production first load or after opening alert/storm tabs.
- No 400s for Canadian, US, or unsupported-country locations.

**Performance**

- Desktop: ≥45 fps while panning with one raster layer; layer switch <500 ms
  when cached.
- Mobile 390×844: ≥30 fps panning; no horizontal overflow; memory within
  budget.
- No request storms on rapid pan/zoom (coalescing verified in the network log).

**Deployment**

- `bun run typecheck && bun run build` pass.
- Proxy modules compile; Docker image rebuild + container recreate succeeds.
- Production asset hashes match the build; `/api` endpoints return 200 and the
  expected payload shape.

---

## 10. Risks and open decisions

**Risks**

- RainViewer is best-effort (no availability guarantee) and adds an external
  dependency; GeoMet/IEM remain the fallback. Attribution is mandatory.
- GIBS GOES data can be stale or gapped; ECCC GOES composites and SLIDER are
  fallbacks.
- WMS time dimensions and model run changes can produce 404/empty images;
  validate with a nearest-time probe and cache the resolved time.
- High-resolution scalar grids can hit Open-Meteo rate limits; chunking,
  caching, and the met.no fallback must be in place before raising density.
- Stacked translucent layers can become unreadable; enforce the two-raster cap.
- Canvas 2D may not be enough for smooth wind streamlines; keep that phase
  optional and consider WebGL only if profiling demands it.

**Decisions confirmed (2026-11-06)**

1. **First release focus**: **observations first** (radar + satellite cloud).
   Forecast fields and sharper scalars follow in later phases.
2. **Stacking**: **one primary + one optional overlay**.
3. **Scalar list**: **6 primary + "More"** (Temp, Feels, Rain, Wind, Cloud,
   Pressure visible; the rest behind More).
4. **RainViewer**: **accepted** — free for personal/educational use; add a
   visible "Weather data by RainViewer" credit. GeoMet/IEM remain fallbacks.
5. **Satellite relationship**: **keep separate** — the Satellite animation
   panel stays its own feature; the map gets a static/looping cloud raster
   layer.
