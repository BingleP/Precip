#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

sudo install -d -m 755 /var/www/precip
sudo install -m 644 index.html styles.css app.js logo.svg /var/www/precip/
sudo install -m 644 deploy/precip.kerrick.ca.conf /etc/nginx/sites-available/precip.conf

if [ ! -e /etc/nginx/sites-enabled/precip.conf ]; then
  sudo ln -s /etc/nginx/sites-available/precip.conf /etc/nginx/sites-enabled/precip.conf
fi

sudo nginx -t
sudo systemctl reload nginx
