#!/usr/bin/env python3
import concurrent.futures
import datetime
import json
import math
import os
import sys
import traceback
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from proxy_cache import CACHE_TTLS, cache_get, cache_set, cache_stats, rounded, rounded_list
from proxy_upstream import (
    ALLOWED_ENDPOINTS, require, fetch_upstream, fetch_json,
    build_upstream, build_geocode_payload, build_ca_alerts_payload, build_all_alerts_payload,
    aggregate_daily, symbol_to_weather_code,
)
from proxy_estimators import (
    dew_point_celsius, estimate_visibility_meters, estimate_gust_kmh,
    estimate_cape_jkg, estimate_apparent_temperature,
    estimate_surface_pressure, estimate_solar_hour_angle,
    estimate_sunrise_sunset, estimate_uv_index,
)


HOST = os.environ.get("PRECIP_PROXY_HOST", "127.0.0.1")
PORT = int(os.environ.get("PRECIP_PROXY_PORT", "7428"))
USER_AGENT = "PrecipProxy/1.0 (+https://precip.kerrick.ca)"


def build_met_no_forecast(latitude, longitude):
    url = "https://api.met.no/weatherapi/locationforecast/2.0/complete?" + urllib.parse.urlencode({
        "lat": rounded(latitude, 2),
        "lon": rounded(longitude, 2),
    })
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=25) as response:
        payload = json.load(response)

    timeseries = payload.get("properties", {}).get("timeseries", [])
    if not timeseries:
        raise ValueError("fallback forecast unavailable")

    hourly = {
        "time": [],
        "temperature_2m": [],
        "dew_point_2m": [],
        "apparent_temperature": [],
        "relative_humidity_2m": [],
        "precipitation_probability": [],
        "precipitation": [],
        "rain": [],
        "showers": [],
        "snowfall": [],
        "snow_depth": [],
        "weather_code": [],
        "pressure_msl": [],
        "surface_pressure": [],
        "cloud_cover": [],
        "cloud_cover_low": [],
        "cloud_cover_mid": [],
        "cloud_cover_high": [],
        "visibility": [],
        "wind_speed_10m": [],
        "wind_speed_100m": [],
        "wind_direction_10m": [],
        "wind_direction_100m": [],
        "wind_gusts_10m": [],
        "cape": [],
        "vapour_pressure_deficit": [],
        "soil_temperature_0cm": [],
        "soil_moisture_0_to_1cm": [],
    }

    for item in timeseries[:168]:
        instant = item.get("data", {}).get("instant", {}).get("details", {})
        next_1 = item.get("data", {}).get("next_1_hours", {})
        next_6 = item.get("data", {}).get("next_6_hours", {})
        symbol_code = next_1.get("summary", {}).get("symbol_code") or next_6.get("summary", {}).get("symbol_code")
        precipitation = next_1.get("details", {}).get("precipitation_amount", 0.0)
        temperature = instant.get("air_temperature")
        humidity = instant.get("relative_humidity")
        wind_speed = instant.get("wind_speed")
        wind_gust = instant.get("wind_speed_of_gust")
        cloud_cover = instant.get("cloud_area_fraction")
        dew_point = dew_point_celsius(temperature, humidity)
        apparent = estimate_apparent_temperature(temperature, wind_speed, humidity)
        pressure_msl = instant.get("air_pressure_at_sea_level")
        surface_pressure = estimate_surface_pressure(pressure_msl)
        hourly["time"].append(item.get("time"))
        hourly["temperature_2m"].append(temperature)
        hourly["dew_point_2m"].append(dew_point)
        hourly["apparent_temperature"].append(apparent)
        hourly["relative_humidity_2m"].append(humidity)
        hourly["precipitation_probability"].append(100 if precipitation and precipitation > 0 else 0)
        hourly["precipitation"].append(precipitation)
        hourly["rain"].append(precipitation if symbol_code and "snow" not in symbol_code else 0)
        hourly["showers"].append(0)
        hourly["snowfall"].append(precipitation if symbol_code and "snow" in symbol_code else 0)
        hourly["snow_depth"].append(precipitation if symbol_code and "snow" in symbol_code else None)
        hourly["weather_code"].append(symbol_to_weather_code(symbol_code))
        hourly["pressure_msl"].append(pressure_msl)
        hourly["surface_pressure"].append(surface_pressure)
        hourly["cloud_cover"].append(cloud_cover)
        hourly["cloud_cover_low"].append(None)
        hourly["cloud_cover_mid"].append(None)
        hourly["cloud_cover_high"].append(None)
        hourly["visibility"].append(estimate_visibility_meters(humidity, cloud_cover, precipitation))
        hourly["wind_speed_10m"].append(wind_speed)
        hourly["wind_speed_100m"].append(None)
        hourly["wind_direction_10m"].append(instant.get("wind_from_direction"))
        hourly["wind_direction_100m"].append(None)
        hourly["wind_gusts_10m"].append(wind_gust if wind_gust is not None else estimate_gust_kmh(wind_speed))
        hourly["cape"].append(estimate_cape_jkg(temperature, dew_point, precipitation))
        hourly["vapour_pressure_deficit"].append(None)
        hourly["soil_temperature_0cm"].append(None)
        hourly["soil_moisture_0_to_1cm"].append(None)

    current_instant = timeseries[0].get("data", {}).get("instant", {}).get("details", {})
    current_precip = timeseries[0].get("data", {}).get("next_1_hours", {}).get("details", {}).get("precipitation_amount", 0.0)
    current_symbol = timeseries[0].get("data", {}).get("next_1_hours", {}).get("summary", {}).get("symbol_code")
    current_wind = current_instant.get("wind_speed")
    current_humidity = current_instant.get("relative_humidity")
    current_pressure_msl = current_instant.get("air_pressure_at_sea_level")
    forecast = {
        "latitude": float(latitude),
        "longitude": float(longitude),
        "timezone": "UTC",
        "current": {
            "time": timeseries[0].get("time"),
            "temperature_2m": current_instant.get("air_temperature"),
            "relative_humidity_2m": current_humidity,
            "apparent_temperature": estimate_apparent_temperature(current_instant.get("air_temperature"), current_wind, current_humidity),
            "dew_point_2m": dew_point_celsius(current_instant.get("air_temperature"), current_humidity),
            "precipitation": current_precip,
            "pressure_msl": current_pressure_msl,
            "surface_pressure": estimate_surface_pressure(current_pressure_msl),
            "wind_speed_10m": current_wind,
            "wind_direction_10m": current_instant.get("wind_from_direction"),
            "wind_gusts_10m": current_instant.get("wind_speed_of_gust"),
            "weather_code": symbol_to_weather_code(current_symbol),
            "cloud_cover": current_instant.get("cloud_area_fraction"),
        },
        "hourly": hourly,
        "daily": aggregate_daily(
            hourly["time"],
            hourly["temperature_2m"],
            hourly["precipitation"],
            hourly["precipitation_probability"],
            hourly["wind_speed_10m"],
            hourly["wind_gusts_10m"],
            hourly["weather_code"],
            latitude=float(latitude),
            longitude=float(longitude),
            hourly_cloud=hourly["cloud_cover"],
        ),
    }
    return json.dumps(forecast).encode("utf-8")


def build_met_no_heatmap_batch(latitude_value, longitude_value):
    latitudes = [float(item) for item in str(latitude_value).split(",")]
    longitudes = [float(item) for item in str(longitude_value).split(",")]
    if len(latitudes) != len(longitudes):
        raise ValueError("latitude/longitude point counts do not match")

    def build_point(index):
        forecast = json.loads(build_met_no_forecast(latitudes[index], longitudes[index]).decode("utf-8"))
        return {"hourly": forecast.get("hourly", {})}

    max_workers = min(8, max(1, len(latitudes)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        rows = list(executor.map(build_point, range(len(latitudes))))

    return json.dumps(rows).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_common_headers("text/plain; charset=utf-8", 0)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path not in ALLOWED_ENDPOINTS:
            self.write_error(404, "Not found")
            return

        if parsed.path == "/health":
            body = json.dumps({"ok": True, "cache": cache_stats()}).encode("utf-8")
            self.send_response(200)
            self.send_common_headers("application/json; charset=utf-8", len(body))
            self.end_headers()
            self.wfile.write(body)
            return

        query = urllib.parse.parse_qs(parsed.query, keep_blank_values=False)
        cache_key = f"{parsed.path}?{urllib.parse.urlencode(sorted((k, v[0]) for k, v in query.items()))}"
        cached = cache_get(cache_key)
        if cached:
            self.send_response(200)
            self.send_common_headers(cached["content_type"], len(cached["body"]))
            self.send_header("X-Precip-Cache", "HIT")
            self.end_headers()
            self.wfile.write(cached["body"])
            return

        try:
            if parsed.path == "/api/geocode":
                name = require(query, "name").strip()
                count = min(10, max(1, int(query.get("count", ["8"])[0])))
                body = build_geocode_payload(name, count)
                cache_set(cache_key, body, CACHE_TTLS[parsed.path], "application/json; charset=utf-8")
                self.send_response(200)
                self.send_common_headers("application/json; charset=utf-8", len(body))
                self.send_header("X-Precip-Cache", "MISS")
                self.end_headers()
                self.wfile.write(body)
                return

            if parsed.path == "/api/ca-alerts":
                latitude = require(query, "latitude").strip()
                longitude = require(query, "longitude").strip()
                body = build_ca_alerts_payload(latitude, longitude)
                cache_set(cache_key, body, CACHE_TTLS[parsed.path], "application/json; charset=utf-8")
                self.send_response(200)
                self.send_common_headers("application/json; charset=utf-8", len(body))
                self.send_header("X-Precip-Cache", "MISS")
                self.end_headers()
                self.wfile.write(body)
                return

            if parsed.path == "/api/all-alerts":
                body = build_all_alerts_payload()
                cache_set(cache_key, body, CACHE_TTLS[parsed.path], "application/json; charset=utf-8")
                self.send_response(200)
                self.send_common_headers("application/json; charset=utf-8", len(body))
                self.send_header("X-Precip-Cache", "MISS")
                self.end_headers()
                self.wfile.write(body)
                return

            upstream_url, expected_type = build_upstream(parsed.path, query)
            body, status, content_type = fetch_upstream(upstream_url, expected_type)
        except urllib.error.HTTPError as error:
            stale = cache_get(cache_key, allow_stale=True)
            if error.code == 429 and stale:
                self.send_response(200)
                self.send_common_headers(stale["content_type"], len(stale["body"]))
                self.send_header("X-Precip-Cache", "STALE")
                self.end_headers()
                self.wfile.write(stale["body"])
                return
            if error.code == 429 and parsed.path == "/api/forecast" and query.get("scope", ["forecast"])[0] == "forecast":
                try:
                    fallback_body = build_met_no_forecast(require(query, "latitude"), require(query, "longitude"))
                    cache_set(cache_key, fallback_body, CACHE_TTLS[parsed.path], "application/json; charset=utf-8")
                    self.send_response(200)
                    self.send_common_headers("application/json; charset=utf-8", len(fallback_body))
                    self.send_header("X-Precip-Cache", "FALLBACK")
                    self.end_headers()
                    self.wfile.write(fallback_body)
                    return
                except Exception as exc:
                    print(f"MET Norway fallback failed: {exc}", file=sys.stderr)
                    traceback.print_exc(file=sys.stderr)
            if error.code == 429 and parsed.path == "/api/forecast" and query.get("scope", ["heatmap"])[0] == "heatmap":
                try:
                    fallback_body = build_met_no_heatmap_batch(require(query, "latitude"), require(query, "longitude"))
                    cache_set(cache_key, fallback_body, CACHE_TTLS[parsed.path], "application/json; charset=utf-8")
                    self.send_response(200)
                    self.send_common_headers("application/json; charset=utf-8", len(fallback_body))
                    self.send_header("X-Precip-Cache", "FALLBACK")
                    self.end_headers()
                    self.wfile.write(fallback_body)
                    return
                except Exception as exc:
                    print(f"MET Norway heatmap fallback failed: {exc}", file=sys.stderr)
                    traceback.print_exc(file=sys.stderr)
            payload = json.dumps({
                "error": f"upstream {error.code}",
                "code": error.code,
                "type": "upstream_error",
                "retry_after": error.headers.get("Retry-After") if hasattr(error, "headers") else None,
            }).encode("utf-8")
            self.send_response(error.code)
            self.send_common_headers("application/json; charset=utf-8", len(payload))
            self.end_headers()
            self.wfile.write(payload)
            return
        except Exception as error:
            print(f"Unexpected proxy error for {parsed.path}: {error}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            if isinstance(error, urllib.error.URLError):
                self.write_error(502, str(error), "upstream_unreachable")
            elif isinstance(error, ValueError):
                self.write_error(400, str(error), "bad_request")
            else:
                self.write_error(500, str(error), "internal")
            return

        cache_set(cache_key, body, CACHE_TTLS[parsed.path], content_type)
        self.send_response(status)
        self.send_common_headers(content_type, len(body))
        self.send_header("X-Precip-Cache", "MISS")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return

    def write_error(self, status, message, error_type="internal"):
        payload = json.dumps({
            "error": message,
            "code": status,
            "type": error_type,
        }).encode("utf-8")
        self.send_response(status)
        self.send_common_headers("application/json; charset=utf-8", len(payload))
        self.end_headers()
        self.wfile.write(payload)

    def send_common_headers(self, content_type, length):
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()
