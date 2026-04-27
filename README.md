# Precip

Precip is a static, browser-only weather operations dashboard built for weather enthusiasts and stormwatching. It uses Open-Meteo for forecast and air-quality data, Open-Meteo geocoding for location search, and OpenStreetMap/Nominatim for map tiles and click-to-select location lookup.
It also pulls NOAA GOES sector imagery by discovering the current animated GIF links from NOAA STAR sector pages in the browser.

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
- `logo.svg` - site mark and favicon source
- `deploy/deploy.sh` - copy files to nginx web root and reload nginx
- `deploy/precip.kerrick.ca.conf` - nginx config for `precip.kerrick.ca`

## Runtime Model

Precip is a static site. There is no backend, account system, or write API.

All weather data is requested directly from the browser:

- `https://api.open-meteo.com`
- `https://air-quality-api.open-meteo.com`
- `https://geocoding-api.open-meteo.com`
- `https://tile.openstreetmap.org`
- `https://nominatim.openstreetmap.org`
- `https://www.star.nesdis.noaa.gov`
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
2. installs the nginx site config
3. validates nginx config
4. reloads nginx

The deployed bundle must include:

- `index.html`
- `welcome.html`
- `styles.css`
- `app.js`
- `logo.svg`

## Security Model

- Public read-only dashboard
- Only `GET`, `HEAD`, and `OPTIONS` are allowed by nginx
- CSP restricts network access to Open-Meteo, OpenStreetMap, and NOAA services used by the app
- No destructive server-side actions
- Preference resets only clear browser cookies for the current visitor

If a backend or hardware receiver is added later, keep it on a separate read-only API surface rather than mixing it into the public static site.
