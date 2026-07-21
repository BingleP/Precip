import concurrent.futures
import csv
import datetime
import io
import json
import os
import sys
import urllib.parse
import urllib.request

from proxy_estimators import estimate_sunrise_sunset, estimate_gust_kmh, estimate_visibility_meters, estimate_cape_jkg, estimate_apparent_temperature, estimate_surface_pressure, estimate_solar_hour_angle, estimate_uv_index, dew_point_celsius
from proxy_cache import rounded, rounded_list, zone_geometry_get, zone_geometry_set


USER_AGENT = "PrecipProxy/1.0 (+https://precip.kerrick.ca)"
PLACE_CLASSES = {"place", "boundary"}
CA_RISK_MAP = {"red": "Extreme", "orange": "Severe", "yellow": "Moderate"}

FIRMS_MAP_KEY = os.environ.get("FIRMS_MAP_KEY", "")
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
    "/api/all-alerts",
    "/api/wildfires",
    "/api/slider-catalog",
    "/api/slider-image",
    "/api/slider-latest-times",
    "/api/nhc-active",
    "/api/nhc-forecast",
    "/api/nhc-cone",
    "/api/earthquakes-us",
    "/api/earthquakes-ca",
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

    if path == "/api/spc-outlook":
        layer = query.get("layer", ["1"])[0].strip()
        if layer not in ("1", "2", "3", "9", "10", "11", "17", "18", "19"):
            raise ValueError("invalid layer")
        return f"https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer/{layer}/query?where=1%3D1&outFields=*&returnGeometry=true&f=geojson", "application/json"

    if path == "/api/slider-catalog":
        satellite = require(query, "satellite").strip()
        sector = require(query, "sector").strip()
        return f"{SLIDER_BASE}/data/json/{satellite}/{sector}/", "text/html; charset=utf-8"

    if path == "/api/slider-latest-times":
        satellite = require(query, "satellite").strip()
        sector = require(query, "sector").strip()
        product = require(query, "product").strip()
        return f"{SLIDER_BASE}/data/json/{satellite}/{sector}/{product}/latest_times.json", "application/json"

    if path == "/api/earthquakes-us":
        min_magnitude = float(query.get("minMagnitude", ["2.5"])[0])
        return f"https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude={min_magnitude}&eventtype=earthquake&orderby=magnitude", "application/json"

    raise ValueError("unsupported endpoint")


def fetch_slider_image(satellite, sector, product, timestamp):
    date_path = f"{timestamp[:4]}/{timestamp[4:6]}/{timestamp[6:8]}"
    url = f"{SLIDER_BASE}/data/imagery/{date_path}/{satellite}---{sector}/{product}/{timestamp}/00/000_000.png"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=25) as response:
        body = response.read()
        content_type = response.headers.get_content_type() or "image/png"
        return body, content_type


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


def _enrich_zone_geometries(features):
    """Enrich geometry-less US alert features with zone polygon geometries (in-place)."""
    zone_fetch_tasks = []
    for f in features:
        if f.get("geometry") is None:
            zones = f.get("properties", {}).get("affectedZones", [])
            if zones:
                zone_fetch_tasks.append((f, zones))

    if not zone_fetch_tasks:
        return

    all_zone_urls = list(set(z for _, zones in zone_fetch_tasks for z in zones))
    zone_geometries = {}

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        future_to_url = {
            executor.submit(_fetch_zone_geometry, url): url
            for url in all_zone_urls
        }
        for future in concurrent.futures.as_completed(future_to_url):
            url = future_to_url[future]
            try:
                geom = future.result()
                if geom:
                    zone_geometries[url] = geom
            except Exception:
                pass

    for f, zones in zone_fetch_tasks:
        zone_polys = []
        for z in zones:
            geom = zone_geometries.get(z)
            if geom:
                if geom["type"] == "Polygon":
                    zone_polys.append(geom["coordinates"])
                elif geom["type"] == "MultiPolygon":
                    zone_polys.extend(geom["coordinates"])
        if zone_polys:
            if len(zone_polys) == 1:
                f["geometry"] = {"type": "Polygon", "coordinates": zone_polys[0]}
            else:
                f["geometry"] = {"type": "MultiPolygon", "coordinates": zone_polys}


def build_all_alerts_payload():
    us_url = "https://api.weather.gov/alerts/active?status=actual"
    ca_url = "https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=500"
    us_features = []
    all_features = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(fetch_json, us_url),
            executor.submit(fetch_json, ca_url),
        ]
        for future in concurrent.futures.as_completed(futures):
            try:
                data = future.result()
                features = data.get("features") or []
                if future in (futures[1],):
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
                        all_features.append({
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
                else:
                    us_features = features
            except Exception as exc:
                print(f"All-alerts upstream failed: {exc}", file=sys.stderr)
                continue

    _enrich_zone_geometries(us_features)
    for f in us_features:
        if "properties" in f and "source" not in f["properties"]:
            f["properties"]["source"] = "NWS"
    all_features.extend(us_features)
    return json.dumps({"type": "FeatureCollection", "features": all_features}).encode("utf-8")


def _fetch_zone_geometry(zone_url):
    """Fetch and cache a single NWS forecast zone polygon geometry."""
    cached = zone_geometry_get(zone_url)
    if cached:
        return cached
    try:
        data = fetch_json(zone_url)
        g = data.get("geometry")
        if g and g.get("type") in ("Polygon", "MultiPolygon"):
            zone_geometry_set(zone_url, g)
            return g
    except Exception:
        pass
    return None


def build_us_alerts_payload(latitude, longitude):
    """Fetch NWS alerts and enrich geometry-less alerts with zone polygons."""
    url = f"https://api.weather.gov/alerts/active?point={latitude},{longitude}"
    data = fetch_json(url)
    features = data.get("features") or []

    # Collect alerts without geometry that have affectedZones
    zone_fetch_tasks = []
    for f in features:
        if f.get("geometry") is None:
            zones = f.get("properties", {}).get("affectedZones", [])
            if zones:
                zone_fetch_tasks.append((f, zones))

    if zone_fetch_tasks:
        all_zone_urls = list(set(z for _, zones in zone_fetch_tasks for z in zones))
        zone_geometries = {}

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            future_to_url = {
                executor.submit(_fetch_zone_geometry, url): url
                for url in all_zone_urls
            }
            for future in concurrent.futures.as_completed(future_to_url):
                url = future_to_url[future]
                try:
                    geom = future.result()
                    if geom:
                        zone_geometries[url] = geom
                except Exception:
                    pass

        for f, zones in zone_fetch_tasks:
            zone_polys = []
            for z in zones:
                geom = zone_geometries.get(z)
                if geom:
                    if geom["type"] == "Polygon":
                        zone_polys.append(geom["coordinates"])
                    elif geom["type"] == "MultiPolygon":
                        zone_polys.extend(geom["coordinates"])
            if zone_polys:
                if len(zone_polys) == 1:
                    f["geometry"] = {"type": "Polygon", "coordinates": zone_polys[0]}
                else:
                    f["geometry"] = {"type": "MultiPolygon", "coordinates": zone_polys}

    return json.dumps(data).encode("utf-8")


CWFIS_GEO = "https://cwfis.cfs.nrcan.gc.ca/geoserver/wfs"
FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
FIRMS_SOURCES = ["VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT", "MODIS_NRT"]


def _cwfis_query(type_names, bbox_str, sort_by=None, max_features=500):
    """Query CWFIS WFS with pagination and return features matching bbox.
    Bbox filtering uses intersection (polygon-bbox overlap) rather than vertex containment."""
    sort_param = f"&sortBy={sort_by}" if sort_by else ""
    west, south, east, north = (float(x) for x in bbox_str.split(","))
    all_features = []
    start_index = 0
    count = min(max_features, 1000)
    while True:
        url = (
            f"{CWFIS_GEO}?request=GetFeature&service=WFS&version=2.0.0"
            f"&typeNames={type_names}&outputFormat=application/json"
            f"&srsName=EPSG:4326&count={count}&startIndex={start_index}{sort_param}"
        )
        try:
            data = fetch_json(url)
            features = data.get("features") or []
            number_matched = data.get("numberMatched")
            all_features.extend(features)
            if len(features) < count:
                break
            if number_matched is not None and len(all_features) >= int(number_matched):
                break
            if len(all_features) >= max_features:
                break
            start_index += count
        except Exception as exc:
            print(f"CWFIS {type_names} fetch failed at startIndex={start_index}: {exc}", file=sys.stderr)
            break

    filtered = []
    for f in all_features:
        g = f.get("geometry")
        if not g:
            continue
        if g["type"] == "Point":
            coords = g["coordinates"]
            if west <= coords[0] <= east and south <= coords[1] <= north:
                filtered.append(f)
        elif g["type"] in ("Polygon", "MultiPolygon"):
            rings = [g["coordinates"][0]] if g["type"] == "Polygon" else [p[0] for p in g["coordinates"]]
            in_bbox = False
            for ring in rings:
                min_lon = min(p[0] for p in ring)
                max_lon = max(p[0] for p in ring)
                min_lat = min(p[1] for p in ring)
                max_lat = max(p[1] for p in ring)
                if max_lon < west or min_lon > east or max_lat < south or min_lat > north:
                    continue
                in_bbox = True
                break
            if in_bbox:
                filtered.append(f)
    return filtered


def _fetch_cwfis_hotspots(bbox_str):
    """Fetch CWFIS hotspot point detections and normalize to unified format."""
    features = _cwfis_query("public:hotspots", bbox_str, sort_by="rep_date%20D")
    result = []
    for f in features:
        p = f.get("properties") or {}
        g = f.get("geometry")
        if not g:
            continue
        result.append({
            "type": "Feature",
            "geometry": g,
            "properties": {
                "id": p.get("id") or p.get("objectid") or "",
                "featureType": "hotspot",
                "source": "CWFIS",
                "date": p.get("rep_date", ""),
                "agency": p.get("agency", ""),
                "sensor": p.get("sensor", ""),
                "satellite": p.get("satellite", ""),
                "temperature": p.get("temp"),
                "confidence": "",
            },
        })
    return result


def _fetch_cwfis_perimeters(bbox_str):
    """Fetch CWFIS fire perimeter polygons and normalize to unified format."""
    features = _cwfis_query("public:m3_polygons_current", bbox_str, max_features=2000)
    result = []
    for f in features:
        p = f.get("properties") or {}
        g = f.get("geometry")
        if not g:
            continue
        result.append({
            "type": "Feature",
            "geometry": g,
            "properties": {
                "id": p.get("id") or p.get("objectid") or "",
                "featureType": "perimeter",
                "source": "CWFIS",
                "firstDate": p.get("firstdate", ""),
                "lastDate": p.get("lastdate", ""),
                "hotspotCount": p.get("hcount"),
                "areaHa": p.get("area"),
            },
        })
    return result


def _parse_firms_csv(text):
    """Parse FIRMS CSV text into GeoJSON features."""
    result = []
    try:
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            lat = row.get("latitude")
            lon = row.get("longitude")
            if not lat or not lon:
                continue
            conf = (row.get("confidence") or "").lower()
            if conf and conf not in ("h", "high", "n", "nominal"):
                pass
            result.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
                "properties": {
                    "id": "",
                    "featureType": "hotspot",
                    "source": "FIRMS",
                    "date": f"{row.get('acq_date', '')}T{row.get('acq_time', ''):0>4s}Z",
                    "agency": "",
                    "sensor": row.get("instrument", ""),
                    "satellite": row.get("satellite", ""),
                    "temperature": float(row.get("bright_ti4", 0) or 0),
                    "confidence": "high" if conf.startswith("h") else "nominal" if conf.startswith("n") else conf,
                },
            })
    except Exception as exc:
        print(f"FIRMS CSV parse failed: {exc}", file=sys.stderr)
    return result


def _fetch_firms_hotspots(bbox_str):
    """Fetch FIRMS hotspot data. Returns empty if no MAP_KEY configured."""
    if not FIRMS_MAP_KEY:
        return []
    all_features = []
    for source in FIRMS_SOURCES:
        url = f"{FIRMS_BASE}/{FIRMS_MAP_KEY}/{source}/{bbox_str}/1"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=20) as resp:
                text = resp.read().decode("utf-8")
                if not text.startswith("latitude"):
                    continue
                all_features.extend(_parse_firms_csv(text))
        except Exception as exc:
            print(f"FIRMS {source} failed: {exc}", file=sys.stderr)
            continue
    return all_features


def build_wildfires_payload(bbox_str):
    """Fetch wildfire data from CWFIS and FIRMS, return unified GeoJSON."""
    all_features = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            executor.submit(_fetch_cwfis_hotspots, bbox_str): "cwfis_hotspots",
            executor.submit(_fetch_cwfis_perimeters, bbox_str): "cwfis_perimeters",
            executor.submit(_fetch_firms_hotspots, bbox_str): "firms_hotspots",
        }
        for future in concurrent.futures.as_completed(futures):
            try:
                all_features.extend(future.result())
            except Exception as exc:
                src = futures[future]
                print(f"Wildfire fetch ({src}) failed: {exc}", file=sys.stderr)

    return json.dumps({"type": "FeatureCollection", "features": all_features}).encode("utf-8")


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


NHC_CONE_RADII_NM = {
    0: 0, 12: 26, 24: 39, 36: 52, 48: 65, 60: 78, 72: 91, 96: 120, 120: 150,
}

STORM_TYPES = {
    "DB": "Tropical Depression", "TD": "Tropical Depression",
    "TS": "Tropical Storm", "HU": "Hurricane",
    "TY": "Typhoon", "ST": "Super Typhoon", "TC": "Tropical Cyclone",
    "SD": "Subtropical Depression", "SS": "Subtropical Storm",
    "EX": "Extratropical", "LO": "Low", "WV": "Tropical Wave",
    "IN": "Invest", "MD": "Monsoon Depression",
}

BASINS = {"al": "Atlantic", "ep": "Eastern Pacific", "cp": "Central Pacific"}


def _interpolate_cone_radius(tau):
    if tau in NHC_CONE_RADII_NM:
        return NHC_CONE_RADII_NM[tau]
    keys = sorted(NHC_CONE_RADII_NM.keys())
    if tau <= keys[0]:
        return NHC_CONE_RADII_NM[keys[0]]
    if tau >= keys[-1]:
        return NHC_CONE_RADII_NM[keys[-1]]
    for i in range(len(keys) - 1):
        if keys[i] <= tau <= keys[i + 1]:
            frac = (tau - keys[i]) / (keys[i + 1] - keys[i])
            return NHC_CONE_RADII_NM[keys[i]] + frac * (NHC_CONE_RADII_NM[keys[i + 1]] - NHC_CONE_RADII_NM[keys[i]])
    return NHC_CONE_RADII_NM[keys[-1]]


def _parse_atcf_lat(lat_str):
    lat_str = lat_str.strip()
    if not lat_str:
        return 0.0
    hemisphere = lat_str[-1].upper()
    value = float(lat_str[:-1]) / 10.0
    return -value if hemisphere == "S" else value


def _parse_atcf_lon(lon_str):
    lon_str = lon_str.strip()
    if not lon_str:
        return 0.0
    hemisphere = lon_str[-1].upper()
    value = float(lon_str[:-1]) / 10.0
    return -value if hemisphere == "W" else value


def _storm_category(max_wind):
    if max_wind >= 137: return 5
    if max_wind >= 113: return 4
    if max_wind >= 96: return 3
    if max_wind >= 83: return 2
    if max_wind >= 64: return 1
    return 0


def _validate_storm_id(storm_id):
    if not storm_id or not isinstance(storm_id, str):
        raise ValueError("invalid storm id")
    storm_id = storm_id.strip().lower()
    if not (2 <= len(storm_id) <= 10) or not storm_id.isalnum():
        raise ValueError("invalid storm id")
    return storm_id


def _fetch_atcf_text(storm_id, url_template):
    url = url_template.format(storm_id=storm_id)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def _parse_ofcl_lines(text):
    ofcl = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 11:
            continue
        if parts[4].upper() != "OFCL":
            continue
        ofcl.append(parts)
    if not ofcl:
        return []
    max_init = max(p[2].strip() for p in ofcl)
    return [p for p in ofcl if p[2].strip() == max_init]


def build_earthquakes_ca_payload(days_str):
    days = max(1, min(90, int(float(days_str))))
    start = datetime.date.today() - datetime.timedelta(days=days)
    url = f"https://www.earthquakescanada.nrcan.gc.ca/fdsnws/event/1/query?format=text&starttime={start.isoformat()}&minmagnitude=2.5"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=25) as resp:
        text = resp.read().decode("utf-8")
    features = []
    for line in text.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        parts = line.split("|")
        if len(parts) < 8:
            continue
        event_id = parts[0].strip()
        time_str = parts[1].strip()
        lat = float(parts[2].strip())
        lon = float(parts[3].strip())
        depth = float(parts[4].strip() or "0")
        mag = float(parts[6].strip() or "0")
        location = parts[7].strip()
        if "/" in location:
            location = location.split("/")[0].strip()
        features.append({
            "type": "Feature",
            "id": event_id,
            "geometry": {"type": "Point", "coordinates": [lon, lat, depth]},
            "properties": {"magnitude": mag, "place": location, "time": time_str},
        })
    return json.dumps({"type": "FeatureCollection", "features": features}).encode("utf-8")


def build_nhc_active_payload():
    data = fetch_json("https://www.nhc.noaa.gov/CurrentStorms.json")
    active = data.get("activeStorms") or []
    storms = []
    for s in active:
        basin_code = (s.get("id") or "xx")[:2].lower()
        basin = BASINS.get(basin_code, "Unknown")
        classification = (s.get("classification") or "").upper()
        storm_type = STORM_TYPES.get(classification, "Tropical Storm")
        max_wind = float(s.get("intensity") or 0)
        category = _storm_category(max_wind) if storm_type == "Hurricane" else 0
        storms.append({
            "id": s.get("id", ""),
            "name": s.get("name", ""),
            "stormType": storm_type,
            "category": category or None,
            "latitude": float(s.get("latitudeNumeric") or s.get("latitude") or 0),
            "longitude": float(s.get("longitudeNumeric") or s.get("longitude") or 0),
            "maxWindSpeed": max_wind,
            "minPressure": float(s.get("pressure") or 0),
            "movement": {
                "direction": float(s.get("movementDir") or 0),
                "speed": float(s.get("movementSpeed") or 0),
            },
            "lastUpdate": s.get("lastUpdate", ""),
            "basin": basin,
        })
    return json.dumps({"activeStorms": storms}).encode("utf-8")


def build_nhc_forecast_payload(storm_id):
    storm_id = _validate_storm_id(storm_id)
    text = _fetch_atcf_text(storm_id, "https://ftp.nhc.noaa.gov/atcf/fst/{storm_id}.fst")
    if text is None:
        return json.dumps({"track": []}).encode("utf-8")
    ofcl_lines = _parse_ofcl_lines(text)
    if not ofcl_lines:
        return json.dumps({"track": []}).encode("utf-8")
    seen_tau = set()
    track = []
    for parts in ofcl_lines:
        try:
            tau = int(parts[5].strip())
        except (ValueError, IndexError):
            continue
        if tau in seen_tau:
            continue
        seen_tau.add(tau)
        lat = _parse_atcf_lat(parts[6])
        lon = _parse_atcf_lon(parts[7])
        vmax = float(parts[8]) if len(parts) > 8 else 0
        intensity = parts[10].strip().upper() if len(parts) > 10 else ""
        storm_type = STORM_TYPES.get(intensity, "Tropical Storm")
        try:
            init_dt = datetime.datetime.strptime(parts[2].strip(), "%Y%m%d%H")
            valid_time = (init_dt + datetime.timedelta(hours=tau)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        except (ValueError, TypeError):
            valid_time = ""
        track.append({
            "validTime": valid_time,
            "latitude": lat,
            "longitude": lon,
            "maxWindSpeed": vmax,
            "stormType": storm_type,
        })
    track.sort(key=lambda p: p["validTime"])
    return json.dumps({"track": track}).encode("utf-8")


def build_nhc_cone_payload(storm_id):
    storm_id = _validate_storm_id(storm_id)
    text = _fetch_atcf_text(storm_id, "https://ftp.nhc.noaa.gov/atcf/fst/{storm_id}.fst")
    if text is None:
        return json.dumps({"cone": []}).encode("utf-8")
    ofcl_lines = _parse_ofcl_lines(text)
    if not ofcl_lines:
        return json.dumps({"cone": []}).encode("utf-8")
    seen_tau = set()
    cone = []
    for parts in ofcl_lines:
        try:
            tau = int(parts[5].strip())
        except (ValueError, IndexError):
            continue
        if tau in seen_tau:
            continue
        seen_tau.add(tau)
        lat = _parse_atcf_lat(parts[6])
        lon = _parse_atcf_lon(parts[7])
        radius = _interpolate_cone_radius(tau)
        try:
            init_dt = datetime.datetime.strptime(parts[2].strip(), "%Y%m%d%H")
            valid_time = (init_dt + datetime.timedelta(hours=tau)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        except (ValueError, TypeError):
            valid_time = ""
        cone.append({
            "validTime": valid_time,
            "centerLat": lat,
            "centerLon": lon,
            "radius": radius,
        })
    cone.sort(key=lambda p: p["validTime"])
    return json.dumps({"cone": cone}).encode("utf-8")


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
