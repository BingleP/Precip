"""Unit tests for the Precip proxy helpers (no network, no server boot).

Run with:  python3 -m unittest discover -s tests -v
"""

import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import proxy_cache
from proxy_upstream import _clamp_wildfire_bbox, build_field_payload


class ProxyCacheTests(unittest.TestCase):
    def setUp(self):
        proxy_cache.cache.clear()
        proxy_cache.cache_bytes = 0

    def test_set_get_round_trip(self):
        self.assertTrue(proxy_cache.cache_set("k", b"hello", 60, "application/json"))
        entry = proxy_cache.cache_get("k")
        self.assertIsNotNone(entry)
        self.assertEqual(entry["body"], b"hello")
        self.assertEqual(entry["hit_count"], 1)

    def test_expired_entry_is_not_returned(self):
        proxy_cache.cache_set("k", b"stale", ttl=-1, content_type="application/json")
        self.assertIsNone(proxy_cache.cache_get("k"))
        # Stale entries are still visible when explicitly allowed.
        self.assertIsNotNone(proxy_cache.cache_get("k", allow_stale=True))

    def test_oversized_entry_is_not_cached(self):
        oversized = b"x" * (proxy_cache.MAX_ENTRY_BYTES + 1)
        self.assertFalse(proxy_cache.cache_set("big", oversized, 60, "application/json"))
        self.assertIsNone(proxy_cache.cache_get("big"))

    def test_stats_include_byte_budget(self):
        proxy_cache.cache_set("a", b"12345", 60, "application/json")
        stats = proxy_cache.cache_stats()
        self.assertEqual(stats["bytes"], 5)
        self.assertEqual(stats["max_bytes"], proxy_cache.MAX_CACHE_BYTES)
        self.assertEqual(stats["total_entries"], 1)

    def test_overwrite_updates_byte_accounting(self):
        proxy_cache.cache_set("k", b"12345", 60, "application/json")
        proxy_cache.cache_set("k", b"1234567", 60, "application/json")
        self.assertEqual(proxy_cache.cache_stats()["bytes"], 7)
        self.assertEqual(proxy_cache.cache_stats()["total_entries"], 1)

    def test_hit_count_and_expiry_reporting(self):
        proxy_cache.cache_set("k", b"v", 60, "application/json")
        proxy_cache.cache_get("k")
        proxy_cache.cache_get("k")
        stats = proxy_cache.cache_stats()
        self.assertEqual(stats["total_hits"], 2)
        self.assertEqual(stats["active_entries"], 1)
        self.assertEqual(stats["expired_entries"], 0)


class WildfireBboxTests(unittest.TestCase):
    def test_small_bbox_is_unchanged(self):
        self.assertEqual(_clamp_wildfire_bbox("-79.4,43.6,-79.2,43.8"), "-79.4000,43.6000,-79.2000,43.8000")

    def test_wide_span_is_shrunk_to_60_degrees(self):
        west, south, east, north = (float(p) for p in _clamp_wildfire_bbox("-180,0,180,10").split(","))
        self.assertAlmostEqual(east - west, 60.0)
        self.assertAlmostEqual((west + east) / 2, 0.0)

    def test_tall_span_is_shrunk_to_60_degrees(self):
        west, south, east, north = (float(p) for p in _clamp_wildfire_bbox("-1,-85,1,85").split(","))
        self.assertAlmostEqual(north - south, 60.0)

    def test_out_of_range_is_clamped(self):
        west, south, east, north = (float(p) for p in _clamp_wildfire_bbox("-200,-100,200,100").split(","))
        self.assertGreaterEqual(west, -180.0)
        self.assertLessEqual(east, 180.0)
        self.assertGreaterEqual(south, -85.0)
        self.assertLessEqual(north, 85.0)

    def test_invalid_bbox_is_returned_verbatim(self):
        self.assertEqual(_clamp_wildfire_bbox("bogus"), "bogus")
        self.assertEqual(_clamp_wildfire_bbox(""), "")


class FieldValidationTests(unittest.TestCase):
    def _query(self, **overrides):
        base = {
            "layer": ["wind"],
            "hour": ["0"],
            "bbox": ["-79.4,43.6,-79.2,43.8"],
            "cols": ["4"],
            "rows": ["4"],
        }
        base.update(overrides)
        return base

    def test_unknown_layer_rejected(self):
        with self.assertRaises(ValueError):
            build_field_payload(self._query(layer=["bogus"]))

    def test_hour_out_of_range_rejected(self):
        with self.assertRaises(ValueError):
            build_field_payload(self._query(hour=["24"]))

    def test_span_out_of_range_rejected(self):
        with self.assertRaises(ValueError):
            build_field_payload(self._query(span=["25"]))
        with self.assertRaises(ValueError):
            build_field_payload(self._query(span=["0"]))

    def test_bad_bbox_rejected(self):
        with self.assertRaises(ValueError):
            build_field_payload(self._query(bbox=["1,2,3"]))
        # Empty bbox (west == east) and inverted bbox (west > east).
        with self.assertRaises(ValueError):
            build_field_payload(self._query(bbox=["-79,43,-79,43"]))
        with self.assertRaises(ValueError):
            build_field_payload(self._query(bbox=["-170,10,-180,0"]))


if __name__ == "__main__":
    unittest.main()
