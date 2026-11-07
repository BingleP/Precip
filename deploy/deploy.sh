#!/bin/sh
# Deploy Precip (server: bingle@10.0.0.25, nginx+python proxy in a Docker container)
#
# Production layout:
#   ~/Projects/precip     - git checkout used for building (this repo)
#   /var/www/precip       - static site root, bind-mounted read-only into the container
#   ~/docker/precip       - Dockerfile + compose + proxy sources, image precip-site:latest
#
# This script runs ON the server from inside ~/Projects/precip:
#   sh deploy/deploy.sh
set -eu

cd "$(dirname "$0")/.."

git pull --ff-only

# Static site: copy the built dist/ into the live root (preserve the directory
# itself; the container bind-mounts it read-only).
sudo cp -a dist/. /var/www/precip/

# Proxy: the Python sources are baked into the image at build time.
cp -a proxy_server.py proxy_cache.py proxy_upstream.py proxy_estimators.py ~/docker/precip/

# Rebuild + recreate the container. `docker compose` is not available to root
# without DOCKER_CONFIG.
cd ~/docker/precip
sudo env DOCKER_CONFIG=/home/bingle/.docker docker compose build
sudo env DOCKER_CONFIG=/home/bingle/.docker docker compose up -d

echo "Deployed. Verifying..."
sleep 2
curl -sf -o /dev/null "http://127.0.0.1:8093/health" && echo "Container proxy OK"
curl -sf -o /dev/null "https://precip.kerrick.ca/" && echo "Site OK"
