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
    "/api/slider-products": 600,
    "/api/slider-image": 300,
    "/api/slider-latest-times": 600,
    "/api/wildfires": 900,
    "/api/nhc-active": 600,
    "/api/nhc-forecast": 900,
    "/api/nhc-cone": 900,
    "/api/field": 600,
    "/api/earthquakes-us": 300,
    "/api/earthquakes-ca": 300,
    "/api/radar-index": 300,
    "/api/radar-tile": 120,
    "/api/radar-wms": 120,
    "/api/forecast-wms": 900,
    "/api/satellite-tile": 300,
}

MAX_CACHE_ENTRIES = 500
# Entries are mostly JSON, but raster endpoints return PNGs and wildfire
# payloads can reach several MB. A count-only limit lets a handful of large
# responses pin hundreds of MB, so also enforce a byte budget.
MAX_CACHE_BYTES = 64 * 1024 * 1024
MAX_ENTRY_BYTES = 8 * 1024 * 1024
CACHE_EVICT_BATCH = 50

cache = {}
cache_bytes = 0
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
    global cache_bytes
    while len(cache) > MAX_CACHE_ENTRIES or cache_bytes > MAX_CACHE_BYTES:
        sorted_entries = sorted(cache.items(), key=lambda kv: kv[1].get("last_access", 0))
        if not sorted_entries:
            return
        # Evict a batch at a time so a burst of large responses does not
        # re-sort the whole cache on every insertion.
        for key, _ in sorted_entries[:CACHE_EVICT_BATCH]:
            entry = cache.pop(key, None)
            if entry:
                cache_bytes -= entry.get("size", 0)
        if len(sorted_entries) < CACHE_EVICT_BATCH:
            return


def cache_set(key, value, ttl, content_type):
    global cache_bytes
    size = len(value)
    # Oversized bodies still get served; they just do not displace the rest
    # of the cache.
    if size > MAX_ENTRY_BYTES:
        return False
    with cache_lock:
        previous = cache.pop(key, None)
        if previous:
            cache_bytes -= previous.get("size", 0)
        cache[key] = {
            "body": value,
            "content_type": content_type,
            "expires_at": time.time() + ttl,
            "hit_count": 0,
            "last_access": time.time(),
            "size": size,
        }
        cache_bytes += size
        _evict_lru()
        return True


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
            "bytes": cache_bytes,
            "max_bytes": MAX_CACHE_BYTES,
        }


def rounded(value, digits=4):
    return f"{float(value):.{digits}f}"


def rounded_list(value, digits=4):
    return ",".join(rounded(item, digits) for item in str(value).split(","))
