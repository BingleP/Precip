import threading
import time


CACHE_TTLS = {
    "/api/forecast": 600,
    "/api/air-quality": 1200,
    "/api/geocode": 86400,
    "/api/reverse-geocode": 86400,
    "/api/noaa-sector": 600,
    "/api/alerts": 300,
    "/api/spc-outlook": 600,
    "/api/ca-alerts": 300,
    "/api/all-alerts": 300,
    "/api/slider-catalog": 600,
    "/api/slider-image": 300,
    "/api/slider-latest-times": 600,
    "/api/wildfires": 900,
    "/api/nhc-active": 600,
    "/api/nhc-forecast": 900,
    "/api/nhc-cone": 900,
    "/api/earthquakes-us": 300,
    "/api/earthquakes-ca": 300,
}

MAX_CACHE_ENTRIES = 500
CACHE_EVICT_BATCH = 50

cache = {}
cache_lock = threading.Lock()

# Zone geometry cache (county boundaries rarely change)
ZONE_GEOMETRY_TTL = 86400  # 24 hours
_zone_geometry_cache = {}
_zone_cache_lock = threading.Lock()


def zone_geometry_get(url):
    with _zone_cache_lock:
        entry = _zone_geometry_cache.get(url)
        if entry and entry["expires_at"] > time.time():
            return entry["geometry"]
    return None


def zone_geometry_set(url, geometry):
    with _zone_cache_lock:
        _zone_geometry_cache[url] = {
            "geometry": geometry,
            "expires_at": time.time() + ZONE_GEOMETRY_TTL,
        }


def cache_get(key, allow_stale=False):
    with cache_lock:
        entry = cache.get(key)
        if not entry:
            return None
        if not allow_stale and entry["expires_at"] < time.time():
            return None
        entry["hit_count"] = entry.get("hit_count", 0) + 1
        entry["last_access"] = time.time()
        return entry


def _evict_lru():
    if len(cache) <= MAX_CACHE_ENTRIES:
        return
    sorted_entries = sorted(cache.items(), key=lambda kv: kv[1].get("last_access", 0))
    for key, _ in sorted_entries[:CACHE_EVICT_BATCH]:
        del cache[key]


def cache_set(key, value, ttl, content_type):
    with cache_lock:
        cache[key] = {
            "body": value,
            "content_type": content_type,
            "expires_at": time.time() + ttl,
            "hit_count": 0,
            "last_access": time.time(),
        }
        _evict_lru()


def cache_stats():
    with cache_lock:
        now = time.time()
        total = len(cache)
        active = sum(1 for e in cache.values() if e["expires_at"] > now)
        total_hits = sum(e.get("hit_count", 0) for e in cache.values())
        expired = total - active
        return {
            "total_entries": total,
            "active_entries": active,
            "expired_entries": expired,
            "total_hits": total_hits,
            "max_entries": MAX_CACHE_ENTRIES,
        }


def rounded(value, digits=4):
    return f"{float(value):.{digits}f}"


def rounded_list(value, digits=4):
    return ",".join(rounded(item, digits) for item in str(value).split(","))
