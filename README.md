# Precip

Static weather monitoring dashboard for Chatham, Ontario.

## Public Hosting Notes

This app is designed to be hosted as a read-only static site behind Nginx. It has no account system, no server-side write endpoints, and no backend actions. Weather data is fetched directly in the browser from Open-Meteo:

- `https://api.open-meteo.com`
- `https://geocoding-api.open-meteo.com`

Use `nginx/precip.conf` as a starting server block. Replace:

- `weather.example.com`
- `/var/www/precip`

Recommended deployment:

1. Copy `index.html`, `styles.css`, and `app.js` to your Nginx web root.
2. Install the Nginx server block from `nginx/precip.conf`.
3. Put the site behind HTTPS before exposing it publicly.
4. Enable the HSTS line in the config only after HTTPS is confirmed working.
5. Do not expose any future hardware receiver endpoint directly to the open internet unless it is read-only and separately secured.

## Security Model

- Public read-only dashboard.
- No destructive server actions.
- The `Clear` history button only clears forecast snapshots from the current visitor's browser `localStorage`.
- CSP restricts scripts and styles to this site and allows network connections only to Open-Meteo.
- The receiver endpoint field is currently informational only; the app does not fetch from it.

If you later add a backend or hardware feed, keep it behind a separate read-only API route and avoid exposing serial, radio, or filesystem controls publicly.
