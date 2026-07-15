import concurrent.futures
import json
import os
import sys
import urllib.parse
import urllib.request

from proxy_estimators import estimate_sunrise_sunset, estimate_gust_kmh, estimate_visibility_meters, estimate_cape_jkg, estimate_apparent_temperature, estimate_surface_pressure, estimate_solar_hour_angle, estimate_uv_index, dew_point_celsius
from proxy_cache import rounded, rounded_list


USER_AGENT = "PrecipProxy/1.0 (+https://precip.kerrick.ca)"
PLACE_CLASSES = {"place", "boundary"}
CA_RISK_MAP = {"red": "Extreme", "orange": "Severe", "yellow": "Moderate"}

SLIDER_BASE = "https://slider.cira.colostate.edu"

ALLOWED_ENDPOINTS = {
    "/api/forecast",
    "/api/air-quality",
    "/api/geocode",
    "/api/reverse-geocode",
    "/api/noaa-sector",
    "/api/alerts",
    "/api/spc-outlook",
    "/api/ca-alerts",
    "/api/slider-catalog",
    "/health",
}


def require(query, name):
    values = query.get(name)
    if not values or not values[0]:
        raise ValueError(f"missing {name}")
    return values[0]


def fetch_upstream(url, content_type):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=25) as response:
        body = response.read()
        content_length = response.headers.get("Content-Length")
        if content_length is not None:
            expected = int(content_length)
            if len(body) < expected:
                raise ValueError(f"upstream truncated response: got {len(body)} of {expected} bytes")
        upstream_type = response.headers.get_content_type()
        return body, response.status, content_type if content_type.startswith("text/html") else f"{upstream_type}; charset=utf-8"


def fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.load(response)


def build_upstream(path, query):
    if path == "/api/forecast":
        scope = query.get("scope", ["forecast"])[0]
        digits = 2
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

    if path == "/api/alerts":
        latitude = require(query, "latitude").strip()
        longitude = require(query, "longitude").strip()
        return f"https://api.weather.gov/alerts/active?point={latitude},{longitude}", "application/json"

    if path == "/api/spc-outlook":
        layer = query.get("layer", ["1"])[0].strip()
        if layer not in ("1", "2", "3", "9", "10", "11", "17", "18", "19"):
            raise ValueError("invalid layer")
        return f"https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer/{layer}/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson", "application/json"

    if path == "/api/slider-catalog":
        satellite = require(query, "satellite").strip()
        sector = require(query, "sector").strip()
        return f"{SLIDER_BASE}/data/json/{satellite}/{sector}/", "text/html; charset=utf-8"

    raise ValueError("unsupported endpoint")


def normalize_text(value):
    return " ".join(str(value or "").strip().lower().split())


def build_open_meteo_geocode_url(name, count):
    return "https://geocoding-api.open-meteo.com/v1/search?" + urllib.parse.urlencode({
        "name": name,
        "count": str(count),
        "language": "en",
        "format": "json",
    })


def build_nominatim_search_url(name, count):
    return "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({
        "q": name,
        "format": "jsonv2",
        "addressdetails": "1",
        "limit": str(count * 2),
    })


def convert_open_meteo_result(result):
    return {
        "id": result.get("id"),
        "name": result.get("name"),
        "latitude": result.get("latitude"),
        "longitude": result.get("longitude"),
        "country_code": result.get("country_code"),
        "country": result.get("country"),
        "admin1": result.get("admin1"),
        "timezone": result.get("timezone"),
        "population": result.get("population") or 0,
    }


def convert_nominatim_result(result):
    address = result.get("address") or {}
    osm_class = result.get("category") or result.get("class")
    if osm_class not in PLACE_CLASSES:
        return None

    name = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("municipality")
        or address.get("hamlet")
        or address.get("county")
        or result.get("name")
        or (result.get("display_name") or "").split(",")[0].strip()
    )
    if not name:
        return None

    return {
        "id": f"osm-{result.get('osm_type', 'x')}-{result.get('osm_id', '0')}",
        "name": name,
        "latitude": float(result.get("lat")),
        "longitude": float(result.get("lon")),
        "country_code": (address.get("country_code") or "").upper() or None,
        "country": address.get("country"),
        "admin1": address.get("state") or address.get("province") or address.get("region") or address.get("county"),
        "timezone": "auto",
        "population": 0,
    }


def geocode_dedupe_key(result):
    return "|".join([
        normalize_text(result.get("name")),
        normalize_text(result.get("admin1")),
        normalize_text(result.get("country")),
    ])


def build_geocode_payload(name, count):
    open_meteo_url = build_open_meteo_geocode_url(name, count)
    nominatim_url = build_nominatim_search_url(name, count)
    sources = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(fetch_json, open_meteo_url),
            executor.submit(fetch_json, nominatim_url),
        ]
        for future in concurrent.futures.as_completed(futures):
            try:
                sources.append(future.result())
            except Exception as exc:
                print(f"Geocode upstream failed: {exc}", file=sys.stderr)
                continue

    merged = []
    seen = set()

    for payload in sources:
        if isinstance(payload, dict):
            raw_results = payload.get("results") or []
            converted = [convert_open_meteo_result(item) for item in raw_results]
        else:
            converted = [convert_nominatim_result(item) for item in payload]

        for item in converted:
            if not item or not item.get("name"):
                continue
            key = geocode_dedupe_key(item)
            if key in seen:
                continue
            seen.add(key)
            merged.append(item)

    normalized_query = normalize_text(name)
    merged.sort(key=lambda item: (
        0 if normalize_text(item.get("name")) == normalized_query else 1,
        0 if normalize_text(item.get("admin1")) == normalized_query else 1,
        -(item.get("population") or 0),
        normalize_text(item.get("country")),
        normalize_text(item.get("admin1")),
    ))

    return json.dumps({
        "results": merged[:count],
        "generationtime_ms": 0,
    }).encode("utf-8")


def build_ca_alerts_payload(latitude, longitude):
    half_span = 1.0
    raw_north = float(latitude) + half_span
    raw_south = float(latitude) - half_span
    bbox_north = min(83.1, max(raw_north, raw_south + 0.1))
    bbox_south = max(41.7, min(raw_south, raw_north - 0.1))
    bbox_east = min(-52.6, float(longitude) + half_span)
    bbox_west = max(-141.0, float(longitude) - half_span)
    url = f"https://api.weather.gc.ca/collections/weather-alerts/items?f=json&bbox={bbox_west},{bbox_south},{bbox_east},{bbox_north}&limit=50"
    data = fetch_json(url)
    features = data.get("features") or []
    normalized = []
    for f in features:
        p = f.get("properties") or {}
        risk = (p.get("risk_colour_en") or "yellow").lower()
        severity = CA_RISK_MAP.get(risk, "Moderate")
        event = p.get("alert_name_en") or p.get("alert_short_name_en") or "Weather alert"
        alert_type = (p.get("alert_type") or "").capitalize()
        location_name = (p.get("feature_name_en") or "")
        province = (p.get("province") or "")
        headline = f"{alert_type}: {event}"
        if location_name:
            headline += f" for {location_name}"
        if province:
            headline += f", {province}"
        description = (p.get("alert_text_en") or "").strip()
        normalized.append({
            "type": "Feature",
            "geometry": f.get("geometry"),
            "properties": {
                "id": p.get("id") or f.get("id"),
                "event": event,
                "headline": headline,
                "description": description[:2000] if description else "",
                "severity": severity,
                "source": "ECCC",
            },
        })
    return json.dumps({"type": "FeatureCollection", "features": normalized}).encode("utf-8")


def aggregate_daily(hourly_times, hourly_temp, hourly_precip, hourly_precip_prob, hourly_wind, hourly_gusts, hourly_codes, latitude=None, longitude=None, hourly_cloud=None):
    import datetime as _dt
    import math as _math

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
        daily["weather_code"].append(max(set(codes), key=codes.count) if codes else 2)
        daily["temperature_2m_max"].append(max(temps) if temps else None)
        daily["temperature_2m_min"].append(min(temps) if temps else None)
        daily["precipitation_sum"].append(round(sum(rain), 1))
        daily["precipitation_probability_max"].append(max(rain_prob) if rain_prob else 0)
        daily["wind_speed_10m_max"].append(max(winds) if winds else 0)
        daily["wind_gusts_10m_max"].append(max(gusts) if gusts else 0)

        sunrise, sunset = estimate_sunrise_sunset(latitude or 40, longitude or 0, day)
        if sunrise and sunset:
            daily["sunrise"].append(sunrise)
            daily["sunset"].append(sunset)
        else:
            daily["sunrise"].append(f"{day}T06:00:00Z")
            daily["sunset"].append(f"{day}T18:00:00Z")

        noon_index = indexes[len(indexes) // 2]
        noon_cloud = hourly_cloud[noon_index] if hourly_cloud and noon_index < len(hourly_cloud) else None
        solar_elev = max(0, 90 - abs(float(latitude or 40) - 90 + 23.44 * _math.cos(2 * _math.pi * (_dt.datetime.strptime(day[:10], "%Y-%m-%d").timetuple().tm_yday - 81) / 365)))
        daily["uv_index_max"].append(estimate_uv_index(solar_elev, noon_cloud))

    return daily


def handle_geocode(query):
    encoded = build_geocode_payload(require(query, "name").strip(), min(10, max(1, int(query.get("count", ["8"])[0]))))
    return encoded, "application/json"


def handle_ca_alerts(query):
    latitude = require(query, "latitude").strip()
    longitude = require(query, "longitude").strip()
    encoded = build_ca_alerts_payload(latitude, longitude)
    return encoded, "application/json"


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
