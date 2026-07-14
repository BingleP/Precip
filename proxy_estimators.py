import datetime
import math


def dew_point_celsius(temp_c, humidity):
    if temp_c is None or humidity is None or humidity <= 0:
        return None
    a = 17.27
    b = 237.7
    alpha = ((a * temp_c) / (b + temp_c)) + math.log(humidity / 100.0)
    return round((b * alpha) / (a - alpha), 1)


def estimate_visibility_meters(humidity, cloud_cover, precipitation):
    if humidity is None and cloud_cover is None and precipitation is None:
        return None

    visibility = 24000
    if humidity is not None:
        visibility -= max(0, humidity - 55) * 110
    if cloud_cover is not None:
        visibility -= max(0, cloud_cover - 40) * 55
    if precipitation is not None:
        visibility -= precipitation * 3200
    return max(800, min(24000, round(visibility)))


def estimate_gust_kmh(wind_speed):
    if wind_speed is None:
        return None
    return round(max(wind_speed, wind_speed * 1.35), 1)


def estimate_cape_jkg(temperature, dew_point, precipitation):
    if temperature is None or dew_point is None:
        return 0
    spread = max(0.0, temperature - dew_point)
    moisture_bonus = max(0.0, dew_point - 8.0) * 28
    instability_penalty = spread * 22
    precipitation_bonus = max(0.0, precipitation or 0.0) * 35
    return max(0, round(moisture_bonus + precipitation_bonus - instability_penalty))


def estimate_apparent_temperature(temp_c, wind_kmh, humidity):
    if temp_c is None:
        return None
    if temp_c <= 10 and wind_kmh is not None and wind_kmh > 4.8:
        v = wind_kmh / 3.6
        wind_chill = 13.12 + 0.6215 * temp_c - 11.37 * v ** 0.16 + 0.3965 * temp_c * v ** 0.16
        return round(min(temp_c, wind_chill), 1)
    if temp_c >= 27 and humidity is not None and humidity > 40:
        hi = -8.784695 + 1.61139411 * temp_c + 2.338549 * humidity - 0.14611605 * temp_c * humidity - 0.012308094 * temp_c ** 2 - 0.016424828 * humidity ** 2 + 0.002211732 * temp_c ** 2 * humidity + 0.00072546 * temp_c * humidity ** 2 - 0.000003582 * temp_c ** 2 * humidity ** 2
        return round(max(temp_c, hi), 1)
    return round(temp_c, 1)


def estimate_surface_pressure(pressure_msl, elevation_m=200):
    if pressure_msl is None:
        return None
    return round(pressure_msl * (1 - 0.0000226 * elevation_m) ** 5.225, 1)


def estimate_solar_hour_angle(dectime_hours, longitude, day_of_year):
    equation_of_time = 229.18 * (0.000075 + 0.001868 * math.cos(2 * math.pi * (day_of_year - 1) / 365) - 0.032077 * math.sin(2 * math.pi * (day_of_year - 1) / 365) - 0.014615 * math.cos(4 * math.pi * (day_of_year - 1) / 365) - 0.04089 * math.sin(4 * math.pi * (day_of_year - 1) / 365))
    solar_time = dectime_hours + longitude / 15 + equation_of_time / 60
    return (solar_time - 12) * 15


def estimate_sunrise_sunset(latitude, longitude, day_str):
    try:
        dt = datetime.datetime.strptime(day_str[:10], "%Y-%m-%d")
        day_of_year = dt.timetuple().tm_yday
        declination = 23.44 * math.sin(2 * math.pi * (day_of_year - 81) / 365)
        lat_rad = math.radians(latitude)
        dec_rad = math.radians(declination)
        cos_ho = -math.tan(lat_rad) * math.tan(dec_rad)
        cos_ho = max(-1, min(1, cos_ho))
        half_day_degrees = math.degrees(math.acos(cos_ho))
        sunrise_hour = 12 - half_day_degrees / 15
        sunset_hour = 12 + half_day_degrees / 15
        sunrise_utc = sunrise_hour - longitude / 15
        sunset_utc = sunset_hour - longitude / 15
        def fmt(h):
            h = h % 24
            return f"{day_str[:10]}T{int(h):02d}:{int((h % 1) * 60):02d}:00Z"
        return fmt(sunrise_utc), fmt(sunset_utc)
    except Exception:
        return None, None


def estimate_uv_index(solar_elevation, cloud_cover):
    if solar_elevation is None or solar_elevation <= 0:
        return 0
    clear_uv = max(0, solar_elevation) * 0.1
    if cloud_cover is not None:
        clear_uv *= max(0.3, 1 - cloud_cover / 100 * 0.6)
    return max(0, round(clear_uv, 1))
