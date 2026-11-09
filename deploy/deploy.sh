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
cp -a proxy_server.py proxy_cache.py proxy_upstream.py proxy_estimators.py ~/docker/precip/
sudo cp -a proxy_server.py proxy_cache.py proxy_upstream.py proxy_estimators.py /opt/precip/
sudo systemctl restart precip-proxy.service

# Rebuild + recreate the container. `docker compose` is not available to root
# without DOCKER_CONFIG.
cd ~/docker/precip
sudo env DOCKER_CONFIG=/home/bingle/.docker docker compose build
sudo env DOCKER_CONFIG=/home/bingle/.docker docker compose up -d --force-recreate

echo "Deployed. Verifying..."
sleep 2
curl -sf -o /dev/null "http://127.0.0.1:7428/health" && echo "Public proxy OK"
curl -sf -o /dev/null "http://127.0.0.1:8093/health" && echo "Container proxy OK"
curl -sf -o /dev/null "https://precip.kerrick.ca/" && echo "Site OK"
