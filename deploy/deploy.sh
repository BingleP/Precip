#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

sudo install -d -m 755 /var/www/precip
sudo install -d -m 755 /opt/precip
sudo install -m 644 index.html welcome.html styles.css app.js logo.svg /var/www/precip/
sudo install -m 644 proxy_server.py /opt/precip/proxy_server.py
sudo install -m 644 deploy/precip.kerrick.ca.conf /etc/nginx/sites-available/precip.conf
sudo install -m 644 deploy/precip-proxy.service /etc/systemd/system/precip-proxy.service

if [ ! -e /etc/nginx/sites-enabled/precip.conf ]; then
  sudo ln -s /etc/nginx/sites-available/precip.conf /etc/nginx/sites-enabled/precip.conf
fi

sudo systemctl daemon-reload
sudo systemctl enable --now precip-proxy.service
sudo nginx -t
sudo systemctl restart precip-proxy.service
sudo systemctl reload nginx
