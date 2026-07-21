# Precip

Precip is a full-screen map-centric weather dashboard for weather enthusiasts and stormwatchers. It uses a small same-host cache proxy to stay resilient against upstream rate limits, and pulls from Open-Meteo, NOAA, NWS, ECCC/GeoMet, CWFIS, FIRMS, and the SPC.

## Current Feature Set

- First-visit setup flow in `welcome.html`
- Location search with suggestions (Open-Meteo + Nominatim)
- Cookie-backed saved preferences
  - default location, map layer, map hour
  - pinned locations, forecast history
  - metric/imperial unit toggle
- Import/export settings presets as JSON
- Interactive dark-mode map with:
  - zoom, pan, pinch-to-zoom
  - click-to-load any map point
  - viewport-based heatmap sampling (overlay skipped during drag)
  - cursor hover readout with coordinates and interpolated weather values
  - NWS/ECCC alert polygon overlays with severity-colored boundaries and hover tooltips
  - **wildfire overlay**: CWFIS hotspots (color-coded by age), CWFIS fire perimeters, and NASA FIRMS hotspots (when configured) with hover tooltips showing source, date, confidence, temperature, and area
  - frustum culling for 600+ alert polygons and wildfire perimeters (off-screen geometry skipped)
- Real-time weather alerts:
  - NWS alerts for US locations (zone-geometry enriched for alerts without polygon data)
  - ECCC/GeoMet alerts for Canadian locations
  - **all alerts rendered on map at all times** — no pop-in/out when panning (5 min cache, in-flight request deduplication)
  - **Hurricane tracking** — Hurricane Warnings/Watches, Tropical Storm Warnings/Watches, and Storm Surge Warnings/Watches automatically displayed via NWS alerts with severity-colored polygons
  - severity-sorted weather warning bar with alert count badge on the Now tab
  - toast notifications for new alerts
  - browse/search all active US + Canada alerts from the Alerts tab
- Wildfire data (proxy-fetched, 15 min cache):
  - **CWFIS hotspots** — VIIRS/MODIS satellite detections via GeoMet WFS (`public:hotspots`), sorted by recency, **batched by age bucket (3 draw calls)**, frustum culled, **clustered at low zoom**
  - **CWFIS fire perimeters** — current-season polygon boundaries (`public:m3_polygons_current`) from CWFIS
  - **NASA FIRMS hotspots** — VIIRS NOAA20/SNPP and MODIS NRT detections via FIRMS API (requires `FIRMS_MAP_KEY`)
- Storm Prediction Center outlooks:
  - Day 1–3 categorical convective outlook
  - Day 1–2 tornado probability
  - auto-detects local risk via point-in-polygon
- Satellite imagery with dual source support:
  - NOAA GOES (North America) with nearest-sector auto selection and live animated GIFs
  - RAMMB/CIRA SLIDER (global coverage) with **proxied** tile-based imagery, timestamp resolution via `/api/slider-latest-times`, and automatic 404 retry
  - Supported SLIDER satellites: GOES-18/19 (CONUS/hemispheres), Himawari, Meteosat (0°/45.5°E), GK-2A (Full Disk, East Asia, Korea), JPSS (CONUS, hemispheres)
  - Switchable source selector in the satellite overlay header
- **Earthquake tracking**:
  - **USGS earthquakes** — real-time seismic events (M2.5+) from the US Geological Survey
  - **NRCAN earthquakes** — real-time seismic events from Natural Resources Canada
   - Combined US + Canada quake layer on the map with magnitude-colored markers (minor=green, light=yellow, moderate=orange, strong=dark orange, major=red, great=dark red)
   - Circle size scales with magnitude
   - Toggle overlay in map tools panel
   - **Age filter** in map tools panel to limit quakes by recency (1h, 6h, 12h, 24h, 48h, 72h, or all)
- **Hurricane tracking**:
   - **Active storms** — current-season storms from NHC (TC advisory locations, wind radii, motion, pressure)
   - **Forecast track** — official NHC forecast (OFCL) for a given storm, parsed from ATCF text advisories
   - **Cone of uncertainty** — 2–5 day track cone built from NHC forecast track + hardcoded radii table (per-season)
   - All NHC data is fetched, parsed, and cached by the proxy (storm list: 10 min, forecast + cone: 15 min)
- **Performance optimizations:**
  - **Heatmap**: screen coordinate memoization + 4×4 interpolation grid (avoids O(pixels×samples) per frame)
  - **Wildfire hotspots**: color-bucket batching (3 draw calls vs N), spatial clustering at zoom < 7, frustum culling
  - **Alert polygons**: full screen-coordinate memoization + grid spatial index for hover hit-testing
  - **Forecast chart**: static layer cached to offscreen canvas; only hover indicator redrawn on mouse move
  - **Map tiles**: pre-composited dark-style filter (brightness/saturate/contrast) on load, eliminates per-frame `ctx.filter`
  - **Label positions**: memoized by viewport state
- 9-tab data panel (collapsible): Now, Hourly, Outlook, Storm, Alerts, Air, Trends, Pins, Settings
- Current conditions, hourly forecast, daily forecast, weekly outlook
- Stormwatch metrics, air quality, forecast confidence, regional context
- Timeline animation: play/pause hourly weather through the map
- Keyboard shortcuts: Cmd+K (search), Escape (tooltips), 1–9 tabs

## Project Files

- `src/` - TypeScript source files (Vite build)
- `index.html` / `welcome.html` - Vite entry points (main dashboard + setup flow)
- `styles.css` - full application styling
- `proxy_server.py` - HTTP server entry point for the cache proxy
- `proxy_upstream.py` - upstream fetch logic (NWS, ECCC, CWFIS, FIRMS, SPC, etc.)
- `proxy_cache.py` - in-memory cache with TTL and GeoMet zone-geometry cache
- `proxy_estimators.py` - derived weather value estimators (gust, visibility, CAPE, etc.)
- `precip.png` - site mark in the tab bar
- `tab.png` - browser tab icon
- `vite.config.ts` - Vite build configuration
- `deploy/deploy.sh` - copy dist/ to nginx web root, install proxy + .py files, reload nginx
- `deploy/precip.kerrick.ca.conf` - nginx config for `precip.kerrick.ca`
- `deploy/precip-proxy.service` - systemd unit for the cache proxy (reads `FIRMS_MAP_KEY` from `/opt/precip/.env`)

## Runtime Model

Precip is a mostly static site with a small read-only cache proxy. No account system, no write API.

The browser talks to same-origin `/api/*` routes. The proxy fetches and caches:

- `https://api.open-meteo.com` (forecasts, air quality)
- `https://geocoding-api.open-meteo.com`
- `https://nominatim.openstreetmap.org` (reverse geocode, search fallback)
- `https://www.star.nesdis.noaa.gov` (GOES sector info)
- `https://api.weather.gov` (NWS alerts)
- `https://api.weather.gc.ca` (Canadian weather alerts via GeoMet-OGC-API)
- `https://mapservices.weather.noaa.gov` (SPC convective outlook contours)
- `https://cwfis.cfs.nrcan.gc.ca/geoserver/wfs` (CWFIS wildfire hotspots + perimeters via WFS)
- `https://firms.modaps.eosdis.nasa.gov` (NASA FIRMS hotspot CSV data, requires `FIRMS_MAP_KEY`)
- `https://earthquake.usgs.gov` (USGS earthquake data)
- `https://www.earthquakescanada.nrcan.gc.ca` (Natural Resources Canada seismic data)
- `https://www.nhc.noaa.gov` (NHC active storms, ATCF forecast text, storm data)

Map tiles and NOAA GOES animated GIFs load directly in the browser from:

- `https://tile.openstreetmap.org`
- `https://cdn.star.nesdis.noaa.gov`

SLIDER global satellite imagery is **proxied** through the cache server (`/api/slider-image` for tiles, `/api/slider-latest-times` for timestamps) to bypass CSP restrictions on slider.cira.colostate.edu.

Cache TTLs vary by endpoint (5 min for alerts, 10 min for forecasts/SPC/SLIDER latest-times/NHC active storms, 15 min for heatmap/wildfires/SLIDER images/NHC forecast+cone, 24 h for geocoding and zone geometry).

User state is stored in browser cookies. No app data is written to the server.

## Local Preview

```bash
bun install                       # install dependencies (first time)
python3 proxy_server.py           # cache proxy on port 7428
bun run dev                       # Vite dev server + proxy

open http://localhost:5173
```

The proxy defaults to `127.0.0.1:7428` and can be overridden with `PRECIP_PROXY_HOST` and `PRECIP_PROXY_PORT`.

## Deployment

This repo ships with a deployment helper for the live site:

```bash
cd /home/bingle/Projects/precip
./deploy/deploy.sh
```

That script:
1. copies the static site bundle into `/var/www/precip`
2. installs the proxy server into `/opt/precip`
3. installs the nginx and systemd service configs
4. enables/restarts the proxy service
5. validates nginx config
6. reloads nginx

The proxy also requires all four `.py` files to be present at `/opt/precip/` (the deploy script handles this).

### FIRMS API Key

To enable NASA FIRMS hotspot data on the wildfire overlay, create `/opt/precip/.env` with:

```
FIRMS_MAP_KEY=your_key_here
```

Get a key at https://firms.modaps.eosdis.nasa.gov/api/map_key/. The deploy script creates a template `.env` if one doesn't exist. The `.env` file is never committed to the repo.

### Nginx CSP for imagery

```
img-src 'self' https://tile.openstreetmap.org https://cdn.star.nesdis.noaa.gov;
```

## API Endpoints (proxy)

| Path | Upstream | Params |
|---|---|---|
| `/api/forecast` | Open-Meteo | `latitude`, `longitude`, `scope` (forecast/heatmap) |
| `/api/air-quality` | Open-Meteo | `latitude`, `longitude` |
| `/api/geocode` | Open-Meteo + Nominatim (merged) | `name`, `count` |
| `/api/reverse-geocode` | Nominatim | `latitude`, `longitude` |
| `/api/noaa-sector` | NOAA STAR | `sat`, `sector` |
| `/api/alerts` | NWS API (bbox-filtered, zone-enriched) | `latitude`, `longitude` |
| `/api/ca-alerts` | GeoMet-OGC-API (bbox-filtered) | `latitude`, `longitude` |
| `/api/all-alerts` | NWS + ECCC (zone-enriched, no bbox filter) | none |
| `/api/spc-outlook` | SPC ArcGIS | `layer` |
| `/api/wildfires` | CWFIS WFS + NASA FIRMS | `bbox` (west,south,east,north) |
| `/api/slider-catalog` | RAMMB/CIRA SLIDER | `satellite`, `sector` |
| `/api/slider-image` | RAMMB/CIRA SLIDER | `satellite`, `sector`, `product`, `timestamp` |
| `/api/slider-latest-times` | RAMMB/CIRA SLIDER | `satellite`, `sector`, `product` |
| `/api/earthquakes-us` | USGS FDSNWS | `minMagnitude` |
| `/api/earthquakes-ca` | Natural Resources Canada | `days` |
| `/api/nhc-active` | NHC CurrentStorms.json | none |
| `/api/nhc-forecast` | NHC ATCF text | `stormId` (e.g. `al022026`) |
| `/api/nhc-cone` | NHC ATCF text (same as forecast) | `stormId` |

## Security Model

- Public read-only dashboard
- Only `GET`, `HEAD`, and `OPTIONS` are allowed by nginx
- CSP restricts browser network access to same-origin `/api/*`, OpenStreetMap tiles, and NOAA imagery
- No destructive server-side actions
- Preference resets only clear browser cookies for the current visitor
- API keys (e.g. `FIRMS_MAP_KEY`) are read from `/opt/precip/.env` on the server, which is excluded from version control by `.gitignore`
