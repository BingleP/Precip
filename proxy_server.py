#!/usr/bin/env python3
import json
import math
import os
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = os.environ.get("PRECIP_PROXY_HOST", "127.0.0.1")
PORT = int(os.environ.get("PRECIP_PROXY_PORT", "7428"))
USER_AGENT = "PrecipProxy/1.0 (+https://precip.kerrick.ca)"

CACHE_TTLS = {
    "/api/forecast": 600,
    "/api/air-quality": 1200,
    "/api/geocode": 86400,
    "/api/reverse-geocode": 86400,
    "/api/noaa-sector": 600,
}

ALLOWED_ENDPOINTS = {
    "/api/forecast",
    "/api/air-quality",
    "/api/geocode",
    "/api/reverse-geocode",
    "/api/noaa-sector",
    "/health",
}

cache = {}
cache_lock = threading.Lock()


def cache_get(key, allow_stale=False):
    with cache_lock:
        entry = cache.get(key)
        if not entry:
            return None
        if not allow_stale and entry["expires_at"] < time.time():
            return None
        return entry


def cache_set(key, value, ttl, content_type):
    with cache_lock:
        cache[key] = {
            "body": value,
            "content_type": content_type,
            "expires_at": time.time() + ttl,
        }


def rounded(value, digits=4):
    return f"{float(value):.{digits}f}"


def rounded_list(value, digits=4):
    return ",".join(rounded(item, digits) for item in str(value).split(","))


def build_upstream(path, query):
    if path == "/api/forecast":
        scope = query.get("scope", ["forecast"])[0]
        digits = 4 if scope == "heatmap" else 2
        latitude = rounded_list(require(query, "latitude"), digits)
        longitude = rounded_list(require(query, "longitude"), digits)
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "timezone": "auto",
        }
        if scope == "heatmap":
            params["hourly"] = "temperature_2m,dew_point_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,pressure_msl,cloud_cover,visibility,cape"
            params["forecast_hours"] = "24"
        else:
            params["current"] = "temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,precipitation,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,cloud_cover"
            params["hourly"] = "temperature_2m,dew_point_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,rain,showers,snowfall,snow_depth,weather_code,pressure_msl,surface_pressure,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,wind_speed_10m,wind_speed_100m,wind_direction_10m,wind_direction_100m,wind_gusts_10m,cape,vapour_pressure_deficit,soil_temperature_0cm,soil_moisture_0_to_1cm"
            params["daily"] = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset,uv_index_max"
            params["forecast_days"] = "7"
        url = urllib.parse.urlencode(params)
        return f"https://api.open-meteo.com/v1/forecast?{url}", "application/json"

    if path == "/api/air-quality":
        latitude = rounded(require(query, "latitude"), 2)
        longitude = rounded(require(query, "longitude"), 2)
        url = urllib.parse.urlencode({
            "latitude": latitude,
            "longitude": longitude,
            "timezone": "auto",
            "hourly": "pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone,uv_index,us_aqi",
            "forecast_days": "2",
        })
        return f"https://air-quality-api.open-meteo.com/v1/air-quality?{url}", "application/json"

    if path == "/api/geocode":
        name = require(query, "name").strip()
        count = min(10, max(1, int(query.get("count", ["8"])[0])))
        url = urllib.parse.urlencode({
            "name": name,
            "count": str(count),
            "language": "en",
            "format": "json",
        })
        return f"https://geocoding-api.open-meteo.com/v1/search?{url}", "application/json"

    if path == "/api/reverse-geocode":
        latitude = rounded(require(query, "latitude"))
        longitude = rounded(require(query, "longitude"))
        url = urllib.parse.urlencode({
            "lat": latitude,
            "lon": longitude,
            "format": "jsonv2",
        })
        return f"https://nominatim.openstreetmap.org/reverse?{url}", "application/json"

    if path == "/api/noaa-sector":
        sat = require(query, "sat").strip()
        sector = require(query, "sector").strip()
        if sat not in {"G18", "G19"}:
            raise ValueError("invalid satellite")
        if not sector.replace("-", "").isalnum():
            raise ValueError("invalid sector")
        url = urllib.parse.urlencode({
            "sat": sat,
            "sector": sector,
        })
        return f"https://www.star.nesdis.noaa.gov/goes/sector.php?{url}", "text/html; charset=utf-8"

    raise ValueError("unsupported endpoint")


def require(query, name):
    values = query.get(name)
    if not values or not values[0]:
        raise ValueError(f"missing {name}")
    return values[0]


def fetch_upstream(url, content_type):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=25) as response:
        body = response.read()
        upstream_type = response.headers.get_content_type()
        return body, response.status, content_type if content_type.startswith("text/html") else f"{upstream_type}; charset=utf-8"


def dew_point_celsius(temp_c, humidity):
    if temp_c is None or humidity is None or humidity <= 0:
        return None
    a = 17.27
    b = 237.7
    alpha = ((a * temp_c) / (b + temp_c)) + math.log(humidity / 100.0)
    return round((b * alpha) / (a - alpha), 1)


def symbol_to_weather_code(symbol):
    symbol = (symbol or "").lower()
    if "thunder" in symbol:
        return 95
    if "snow" in symbol or "sleet" in symbol:
        return 71
    if "heavyrain" in symbol:
        return 65
    if "rainshowers" in symbol or "showers" in symbol:
        return 80
    if "rain" in symbol:
        return 63
    if "fog" in symbol:
        return 45
    if "cloudy" in symbol:
        return 3
    if "partlycloudy" in symbol:
        return 2
    if "fair" in symbol:
        return 1
    if "clearsky" in symbol:
        return 0
    return 2


def aggregate_daily(hourly_times, hourly_temp, hourly_precip, hourly_precip_prob, hourly_wind, hourly_gusts, hourly_codes):
    days = {}
    for index, time_text in enumerate(hourly_times):
        day = time_text[:10]
        days.setdefault(day, []).append(index)

    ordered_days = list(days.keys())[:7]
    daily = {
        "time": [],
        "weather_code": [],
        "temperature_2m_max": [],
        "temperature_2m_min": [],
        "precipitation_sum": [],
        "precipitation_probability_max": [],
        "wind_speed_10m_max": [],
        "wind_gusts_10m_max": [],
        "sunrise": [],
        "sunset": [],
        "uv_index_max": [],
    }

    for day in ordered_days:
        indexes = days[day]
        temps = [hourly_temp[i] for i in indexes if hourly_temp[i] is not None]
        rain = [hourly_precip[i] or 0 for i in indexes]
        rain_prob = [hourly_precip_prob[i] or 0 for i in indexes]
        winds = [hourly_wind[i] or 0 for i in indexes]
        gusts = [hourly_gusts[i] or 0 for i in indexes]
        codes = [hourly_codes[i] for i in indexes if hourly_codes[i] is not None]
        daily["time"].append(day)
        daily["weather_code"].append(max(codes, key=codes.count) if codes else 2)
        daily["temperature_2m_max"].append(max(temps) if temps else None)
        daily["temperature_2m_min"].append(min(temps) if temps else None)
        daily["precipitation_sum"].append(round(sum(rain), 1))
        daily["precipitation_probability_max"].append(max(rain_prob) if rain_prob else 0)
        daily["wind_speed_10m_max"].append(max(winds) if winds else 0)
        daily["wind_gusts_10m_max"].append(max(gusts) if gusts else 0)
        daily["sunrise"].append(f"{day}T06:00:00Z")
        daily["sunset"].append(f"{day}T18:00:00Z")
        daily["uv_index_max"].append(None)
    return daily


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
        hourly["time"].append(item.get("time"))
        hourly["temperature_2m"].append(temperature)
        hourly["dew_point_2m"].append(dew_point_celsius(temperature, humidity))
        hourly["apparent_temperature"].append(temperature)
        hourly["relative_humidity_2m"].append(humidity)
        hourly["precipitation_probability"].append(100 if precipitation and precipitation > 0 else 0)
        hourly["precipitation"].append(precipitation)
        hourly["rain"].append(precipitation)
        hourly["showers"].append(precipitation)
        hourly["snowfall"].append(0)
        hourly["snow_depth"].append(None)
        hourly["weather_code"].append(symbol_to_weather_code(symbol_code))
        hourly["pressure_msl"].append(instant.get("air_pressure_at_sea_level"))
        hourly["surface_pressure"].append(instant.get("air_pressure_at_sea_level"))
        hourly["cloud_cover"].append(instant.get("cloud_area_fraction"))
        hourly["cloud_cover_low"].append(None)
        hourly["cloud_cover_mid"].append(None)
        hourly["cloud_cover_high"].append(None)
        hourly["visibility"].append(None)
        hourly["wind_speed_10m"].append(wind_speed)
        hourly["wind_speed_100m"].append(None)
        hourly["wind_direction_10m"].append(instant.get("wind_from_direction"))
        hourly["wind_direction_100m"].append(None)
        hourly["wind_gusts_10m"].append(wind_gust)
        hourly["cape"].append(None)
        hourly["vapour_pressure_deficit"].append(None)
        hourly["soil_temperature_0cm"].append(None)
        hourly["soil_moisture_0_to_1cm"].append(None)

    current_instant = timeseries[0].get("data", {}).get("instant", {}).get("details", {})
    current_precip = timeseries[0].get("data", {}).get("next_1_hours", {}).get("details", {}).get("precipitation_amount", 0.0)
    current_symbol = timeseries[0].get("data", {}).get("next_1_hours", {}).get("summary", {}).get("symbol_code")
    forecast = {
        "latitude": float(latitude),
        "longitude": float(longitude),
        "timezone": "UTC",
        "current": {
            "time": timeseries[0].get("time"),
            "temperature_2m": current_instant.get("air_temperature"),
            "relative_humidity_2m": current_instant.get("relative_humidity"),
            "apparent_temperature": current_instant.get("air_temperature"),
            "dew_point_2m": dew_point_celsius(current_instant.get("air_temperature"), current_instant.get("relative_humidity")),
            "precipitation": current_precip,
            "pressure_msl": current_instant.get("air_pressure_at_sea_level"),
            "surface_pressure": current_instant.get("air_pressure_at_sea_level"),
            "wind_speed_10m": current_instant.get("wind_speed"),
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
        ),
    }
    return json.dumps(forecast).encode("utf-8")


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
            body = json.dumps({"ok": True}).encode("utf-8")
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
                except Exception:
                    pass
            payload = json.dumps({"error": f"upstream {error.code}"}).encode("utf-8")
            self.send_response(error.code)
            self.send_common_headers("application/json; charset=utf-8", len(payload))
            self.end_headers()
            self.wfile.write(payload)
            return
        except Exception as error:
            self.write_error(400, str(error))
            return

        cache_set(cache_key, body, CACHE_TTLS[parsed.path], content_type)
        self.send_response(status)
        self.send_common_headers(content_type, len(body))
        self.send_header("X-Precip-Cache", "MISS")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return

    def write_error(self, status, message):
        payload = json.dumps({"error": message}).encode("utf-8")
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
