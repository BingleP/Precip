#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

sudo rm -rf /var/www/precip
sudo cp -r dist /var/www/precip
sudo install -d -m 755 /opt/precip
sudo install -m 644 proxy_server.py proxy_cache.py proxy_upstream.py proxy_estimators.py /opt/precip/
sudo install -m 644 deploy/precip.kerrick.ca.conf /etc/nginx/sites-available/precip.conf
sudo install -m 644 deploy/precip-proxy.service /etc/systemd/system/precip-proxy.service

if [ ! -f /opt/precip/.env ]; then
  cat > /opt/precip/.env << 'EOF'
# FIRMS_MAP_KEY is required for NASA FIRMS hotspot data
# Get yours at https://firms.modaps.eosdis.nasa.gov/api/map_key/
# FIRMS_MAP_KEY=your_key_here
EOF
  echo "Created /opt/precip/.env — add FIRMS_MAP_KEY=... to enable FIRMS wildfire data"
fi

if [ ! -e /etc/nginx/sites-enabled/precip.conf ]; then
  sudo ln -s /etc/nginx/sites-available/precip.conf /etc/nginx/sites-enabled/precip.conf
fi

sudo systemctl daemon-reload
sudo systemctl enable --now precip-proxy.service
sudo nginx -t
sudo systemctl restart precip-proxy.service
sudo systemctl reload nginx
