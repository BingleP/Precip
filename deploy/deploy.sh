#!/bin/sh
# Deploy Precip (server: bingle@10.0.0.25, nginx + python proxy)
#
# Production layout:
#   ~/Projects/precip     - git checkout used for building (this repo)
#   /var/www/precip       - static site root, bind-mounted read-only into the
#                           container and served directly by the outer nginx
#   ~/docker/precip       - Dockerfile + compose + proxy sources, image
#                           precip-site:latest (alternate instance on :8093)
#   /opt/precip           - proxy sources used by the public API
#                           (outer nginx -> 127.0.0.1:7428 ->
#                           systemd precip-proxy.service)
#
# Both proxy copies must be updated: the public site's /api/ requests go to
# the systemd service in /opt/precip, not to the container.
#
# This script runs ON the server from inside ~/Projects/precip:
#   sh deploy/deploy.sh
set -eu

cd "$(dirname "$0")/.."

git pull --ff-only

# Static site: copy the built dist/ into the live root (preserve the directory
# itself; the container bind-mounts it read-only).
sudo cp -a dist/. /var/www/precip/

# Proxy sources: keep the container image and the public systemd service in
# sync. The systemd service reads FIRMS_MAP_KEY from /opt/precip/.env, which is
# not touched here.
PROXY_FILES="proxy_server.py proxy_cache.py proxy_upstream.py proxy_estimators.py"
cp -a $PROXY_FILES ~/docker/precip/
sudo cp -a $PROXY_FILES /opt/precip/
for file in $PROXY_FILES; do
  expected=$(md5sum "$file" | cut -d' ' -f1)
  for dest in "$HOME/docker/precip" /opt/precip; do
    actual=$(sudo md5sum "$dest/$file" | cut -d' ' -f1)
    [ "$expected" = "$actual" ] || {
      echo "ERROR: $dest/$file differs from the repo copy" >&2
      exit 1
    }
  done
done
sudo systemctl restart precip-proxy.service

# Rebuild + recreate the container. `docker compose` is not available to root
# without DOCKER_CONFIG.
cd ~/docker/precip
sudo env DOCKER_CONFIG=/home/bingle/.docker docker compose build
sudo env DOCKER_CONFIG=/home/bingle/.docker docker compose up -d --force-recreate

echo "Deployed. Verifying..."
sleep 2

# The public /api/ path goes to the systemd proxy, so assert its allowlist is
# current. A 404 here is the signature of a stale copy (the outage this check
# exists to prevent); upstream 429/5xx responses are not deploy failures.
verify_proxy() {
  base=$1
  label=$2
  health=$(curl -sf "$base/health") || {
    echo "ERROR: $label /health failed" >&2
    exit 1
  }
  for endpoint in /api/field /api/radar-index /api/radar-wms /api/forecast-wms; do
    printf '%s' "$health" | grep -q "\"$endpoint\"" || {
      echo "ERROR: $label allowlist is missing $endpoint" >&2
      exit 1
    }
  done
  for probe in \
    "/api/field?layer=wind&hour=0&span=24&bbox=-79.4,43.6,-79.3,43.8&cols=6&rows=4" \
    "/api/radar-wms?bbox=-9090000,5260000,-8590000,5565000&width=64&height=64" \
    "/api/forecast-wms?product=gdps-precip&bbox=-9090000,5260000,-8590000,5565000&width=64&height=64"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "$base$probe")
    [ "$code" != "404" ] || {
      echo "ERROR: $label returned 404 for $probe" >&2
      exit 1
    }
  done
  build=$(printf '%s' "$health" | sed -n 's/.*"build": "\([^"]*\)".*/\1/p')
  echo "$label OK (build $build)"
}

sudo systemctl is-active --quiet precip-proxy.service || {
  echo "ERROR: precip-proxy.service is not active" >&2
  exit 1
}
verify_proxy "http://127.0.0.1:7428" "Public proxy"
verify_proxy "http://127.0.0.1:8093" "Container proxy"
curl -sf -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36" -o /dev/null "https://precip.kerrick.ca/" && echo "Site OK"
