# Precip

Precip is a weather operations dashboard built for weather enthusiasts and stormwatching. The UI is still static, but live data now goes through a small same-host cache proxy so the public site is less vulnerable to upstream rate limits.
The app uses Open-Meteo for forecast and air-quality data, Open-Meteo geocoding for location search, OpenStreetMap/Nominatim for map tiles and click-to-select location lookup, and NOAA STAR for GOES sector imagery.

The current app is global rather than single-city. Users choose a starting location on first visit, then the dashboard saves preferences in browser cookies.

## Current Feature Set

- First-visit setup flow in `welcome.html`
- Exact-match location search with suggestions
- Cookie-backed saved preferences
  - default location
  - default map layer
  - default map hour
  - pinned locations
  - forecast history
- Import/export settings presets as JSON
- Interactive dark-mode map with:
  - zoom and pan
  - click-to-load any map point
  - viewport-based heatmap sampling
  - cursor hover readout with coordinates and interpolated weather values
- NOAA GOES satellite panel with:
  - nearest-sector auto selection from the active location
  - manual sector override
  - live animated imagery product selection
- Current conditions, hourly forecast, daily forecast, weekly outlook
- Stormwatch metrics, air quality, forecast confidence, and regional context

## Project Files

- `index.html` - main dashboard
- `welcome.html` - first-visit location setup page
- `styles.css` - full application styling
- `app.js` - client-side app logic and data fetching
- `proxy_server.py` - same-host cache proxy for weather/geocoding/NOAA sector requests
- `logo.svg` - site mark and favicon source
- `deploy/deploy.sh` - copy files to nginx web root and reload nginx
- `deploy/precip.kerrick.ca.conf` - nginx config for `precip.kerrick.ca`
- `deploy/precip-proxy.service` - systemd unit for the cache proxy

## Runtime Model

Precip is a mostly static site with a small read-only cache proxy. There is no account system and no write API.

The browser talks to same-origin `/api/*` routes. That proxy fetches and caches:

- `https://api.open-meteo.com`
- `https://air-quality-api.open-meteo.com`
- `https://geocoding-api.open-meteo.com`
- `https://nominatim.openstreetmap.org`
- `https://www.star.nesdis.noaa.gov`

Map tiles and NOAA imagery still load directly in the browser from:

- `https://tile.openstreetmap.org`
- `https://cdn.star.nesdis.noaa.gov`

User state is stored in browser cookies. No app data is written to the server.

## Local Preview

From the project directory:

```bash
python3 -m http.server 8088
```

Then open:

- `http://127.0.0.1:8088/welcome.html`
- `http://127.0.0.1:8088/index.html`

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

- `index.html`
- `welcome.html`
- `styles.css`
- `app.js`
- `proxy_server.py`
- `logo.svg`

## Security Model

- Public read-only dashboard
- Only `GET`, `HEAD`, and `OPTIONS` are allowed by nginx
- CSP restricts browser network access to same-origin `/api/*`, OpenStreetMap tiles, and NOAA imagery
- No destructive server-side actions
- Preference resets only clear browser cookies for the current visitor

If a backend or hardware receiver is added later, keep it on a separate read-only API surface rather than mixing it into the public static site.
