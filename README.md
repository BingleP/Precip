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
  - **all alerts rendered on map at all times** — no pop-in/out when panning (5 min cache)
  - severity-sorted weather warning bar with alert count badge on the Now tab
  - toast notifications for new alerts
  - browse/search all active US + Canada alerts from the Alerts tab
- Wildfire data (proxy-fetched, 15 min cache):
  - **CWFIS hotspots** — VIIRS/MODIS satellite detections via GeoMet WFS (`public:hotspots`), sorted by recency
  - **CWFIS fire perimeters** — current-season polygon boundaries (`public:m3_polygons_current`) from CWFIS
  - **NASA FIRMS hotspots** — VIIRS NOAA20/SNPP and MODIS NRT detections via FIRMS API (requires `FIRMS_MAP_KEY`)
- Storm Prediction Center outlooks:
  - Day 1–3 categorical convective outlook
  - Day 1–2 tornado probability
  - auto-detects local risk via point-in-polygon
- Satellite imagery with dual source support:
  - NOAA GOES (North America) with nearest-sector auto selection and live animated GIFs
  - RAMMB/CIRA SLIDER (global coverage) with tile-based imagery, timestamp fallback, and automatic 404 retry
  - Switchable source selector in the satellite overlay header
- 11-tab data panel (collapsible): Now, Hourly, Outlook, Storm, Satellite, Air, Trends, Pins, History, Settings, System
- Current conditions, hourly forecast, daily forecast, weekly outlook
- Stormwatch metrics, air quality, forecast confidence, regional context
- Timeline animation: play/pause hourly weather through the map
- Keyboard shortcuts: Cmd+K (search), Escape (tooltips), 1–9 tabs, 0 (System)

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

Map tiles and satellite imagery load directly in the browser from:

- `https://tile.openstreetmap.org`
- `https://cdn.star.nesdis.noaa.gov` (NOAA GOES animated GIFs)
- `https://slider.cira.colostate.edu` (SLIDER global satellite tiles and JSON catalogs)

Cache TTLs vary by endpoint (5 min for alerts, 10 min for forecasts and SPC, 15 min for heatmap and wildfires, 24 h for geocoding and zone geometry).

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
img-src 'self' https://tile.openstreetmap.org https://cdn.star.nesdis.noaa.gov https://slider.cira.colostate.edu;
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

## Security Model

- Public read-only dashboard
- Only `GET`, `HEAD`, and `OPTIONS` are allowed by nginx
- CSP restricts browser network access to same-origin `/api/*`, OpenStreetMap tiles, and NOAA imagery
- No destructive server-side actions
- Preference resets only clear browser cookies for the current visitor
- API keys (e.g. `FIRMS_MAP_KEY`) are read from `/opt/precip/.env` on the server, which is excluded from version control by `.gitignore`
