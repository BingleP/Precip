# Precip

Precip is a full-screen map-centric weather dashboard for weather enthusiasts and stormwatchers. It uses a small same-host cache proxy to stay resilient against upstream rate limits, and pulls from Open-Meteo, NOAA, NWS, ECCC/GeoMet, and the SPC.

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
- Real-time weather alerts:
  - NWS alerts for US locations
  - ECCC/GeoMet alerts for Canadian locations
  - severity-sorted weather warning bar with alert count badge on the Now tab
  - toast notifications for new alerts
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
- `proxy_server.py` - same-host cache proxy for weather/geocoding/NOAA/NWS/SPC/ECCC requests
- `precip.png` - site mark in the tab bar
- `tab.png` - browser tab icon
- `vite.config.ts` - Vite build configuration
- `deploy/deploy.sh` - copy dist/ to nginx web root and reload nginx
- `deploy/precip.kerrick.ca.conf` - nginx config for `precip.kerrick.ca`
- `deploy/precip-proxy.service` - systemd unit for the cache proxy

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

Map tiles and satellite imagery load directly in the browser from:

- `https://tile.openstreetmap.org`
- `https://cdn.star.nesdis.noaa.gov` (NOAA GOES animated GIFs)
- `https://rammb-slider.cira.colostate.edu` (SLIDER global satellite tiles and JSON catalogs)

Cache TTLs vary by endpoint (5 min for alerts, 10 min for forecasts and SPC, 15 min for heatmap, 24 h for geocoding).

User state is stored in browser cookies. No app data is written to the server.

## Local Preview

```bash
python3 proxy_server.py           # cache proxy on port 7428
npm run dev                       # Vite dev server + proxy

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

The deployed bundle must include:

- `dist/` - Vite build output (copied to web root)

When deploying, the nginx CSP must allow the SLIDER tile origin:

```
img-src 'self' https://tile.openstreetmap.org https://cdn.star.nesdis.noaa.gov https://rammb-slider.cira.colostate.edu;
```

## API Endpoints (proxy)

| Path | Upstream | Params |
|---|---|---|
| `/api/forecast` | Open-Meteo | `latitude`, `longitude`, `scope` (forecast/heatmap) |
| `/api/air-quality` | Open-Meteo | `latitude`, `longitude` |
| `/api/geocode` | Open-Meteo + Nominatim (merged) | `name`, `count` |
| `/api/reverse-geocode` | Nominatim | `latitude`, `longitude` |
| `/api/noaa-sector` | NOAA STAR | `sat`, `sector` |
| `/api/alerts` | NWS API | `latitude`, `longitude` |
| `/api/ca-alerts` | GeoMet-OGC-API | `latitude`, `longitude` |
| `/api/spc-outlook` | SPC ArcGIS | `layer` |

## Security Model

- Public read-only dashboard
- Only `GET`, `HEAD`, and `OPTIONS` are allowed by nginx
- CSP restricts browser network access to same-origin `/api/*`, OpenStreetMap tiles, and NOAA imagery
- No destructive server-side actions
- Preference resets only clear browser cookies for the current visitor
