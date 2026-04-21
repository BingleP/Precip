const DEFAULT_LOCATION = {
  name: "Chatham",
  admin: "Ontario",
  country: "CA",
  latitude: 42.4048,
  longitude: -82.191,
  timezone: "America/Toronto",
};
const HOURS_TO_SHOW = 24;
const HEATMAP_GRID_SIZE = 7;
const HEATMAP_RADIUS = 0.42;
const HEATMAP_PLACES = [
  { name: "Chatham", latitude: 42.4048, longitude: -82.191 },
  { name: "Wallaceburg", latitude: 42.593, longitude: -82.388 },
  { name: "Dresden", latitude: 42.591, longitude: -82.179 },
  { name: "Tilbury", latitude: 42.264, longitude: -82.432 },
  { name: "Ridgetown", latitude: 42.439, longitude: -81.887 },
  { name: "Blenheim", latitude: 42.333, longitude: -82.0 },
  { name: "Leamington", latitude: 42.054, longitude: -82.599 },
  { name: "Sarnia", latitude: 42.974, longitude: -82.406 },
];
const HISTORY_KEY = "precip.forecastHistory.v1";
const MAX_HISTORY_ITEMS = 12;

const elements = {
  stationTitle: document.querySelector("#station-title"),
  stationCopy: document.querySelector("#station-copy"),
  updatedAt: document.querySelector("#updated-at"),
  temperature: document.querySelector("#temperature"),
  currentCondition: document.querySelector("#current-condition"),
  conditionCopy: document.querySelector("#condition-copy"),
  pressure: document.querySelector("#pressure"),
  wind: document.querySelector("#wind"),
  windCompass: document.querySelector("#wind-compass"),
  tempTrend: document.querySelector("#temp-trend"),
  pressureTrend: document.querySelector("#pressure-trend"),
  windDirection: document.querySelector("#wind-direction"),
  watchLevel: document.querySelector("#watch-level"),
  watchCopy: document.querySelector("#watch-copy"),
  warningBar: document.querySelector("#weather-warning"),
  warningLabel: document.querySelector("#warning-label"),
  warningTitle: document.querySelector("#warning-title"),
  warningCopy: document.querySelector("#warning-copy"),
  eventLog: document.querySelector("#event-log"),
  patternList: document.querySelector("#pattern-list"),
  dailyGrid: document.querySelector("#daily-grid"),
  weeklyList: document.querySelector("#weekly-list"),
  historyList: document.querySelector("#history-list"),
  hourlyStrip: document.querySelector("#hourly-strip"),
  refreshButton: document.querySelector("#refresh-button"),
  clearHistoryButton: document.querySelector("#clear-history-button"),
  chartTooltip: document.querySelector("#chart-tooltip"),
  heatmapLegend: document.querySelector("#heatmap-legend"),
  locationForm: document.querySelector("#location-form"),
  locationInput: document.querySelector("#location-input"),
};

const chartCanvas = document.querySelector("#weather-chart");
const chartCtx = chartCanvas.getContext("2d");
const heatmapCanvas = document.querySelector("#heatmap-canvas");
const heatmapCtx = heatmapCanvas.getContext("2d");

let activeLocation = null;
let latestForecast = null;
let latestHeatmap = null;
let activeHeatmapLayer = "temperature";
const chartState = {
  hoverIndex: null,
  points: [],
};

function addLog(message) {
  const item = document.createElement("li");
  const text = document.createElement("span");
  const timestamp = document.createElement("time");
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  text.textContent = message;
  timestamp.textContent = time;
  item.append(text, timestamp);
  elements.eventLog.prepend(item);

  while (elements.eventLog.children.length > 7) {
    elements.eventLog.lastElementChild.remove();
  }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getPrecipBarClass(value) {
  const normalized = Math.max(0, Math.min(100, Number(value) || 0));
  return `bar-${Math.round(normalized / 10) * 10}`;
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function degreesToCompass(degrees) {
  if (!Number.isFinite(degrees)) return "--";
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(degrees / 45) % 8];
}

function describeWeatherCode(code) {
  const codes = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    80: "Rain showers",
    81: "Showers",
    82: "Heavy showers",
    95: "Thunderstorm",
    96: "Thunderstorm hail",
    99: "Severe storm",
  };

  return codes[code] || "Mixed conditions";
}

function formatDay(dateText, style = "short") {
  return new Date(`${dateText}T12:00:00`).toLocaleDateString([], {
    weekday: style,
    month: "short",
    day: "numeric",
  });
}

function describeDelta(value, unit, risingText, fallingText) {
  if (!Number.isFinite(value)) return "Trend unavailable";
  if (Math.abs(value) < 0.1) return "Stable last 3 hours";
  const direction = value > 0 ? risingText : fallingText;
  return `${direction} ${Math.abs(value).toFixed(1)} ${unit} last 3 hours`;
}

function findCurrentIndex(times) {
  const now = Date.now();
  let bestIndex = 0;
  let smallestDiff = Infinity;

  times.forEach((time, index) => {
    const diff = Math.abs(new Date(time).getTime() - now);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      bestIndex = index;
    }
  });

  return bestIndex;
}

async function geocodeLocation(query) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url);
  if (!response.ok) throw new Error("Location lookup failed");

  const data = await response.json();
  if (!data.results?.length) throw new Error(`No weather location found for "${query}"`);

  const result = data.results[0];
  return {
    name: result.name,
    admin: result.admin1,
    country: result.country_code,
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone,
  };
}

async function fetchForecast(location) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", location.latitude);
  url.searchParams.set("longitude", location.longitude);
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,precipitation,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m");
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,precipitation,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset");
  url.searchParams.set("forecast_days", "7");

  const response = await fetch(url);
  if (!response.ok) throw new Error("Weather data request failed");
  return response.json();
}

async function fetchHeatmap(location) {
  const points = buildHeatmapPoints(location);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", points.map((point) => point.latitude.toFixed(4)).join(","));
  url.searchParams.set("longitude", points.map((point) => point.longitude.toFixed(4)).join(","));
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("current", "temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,pressure_msl");

  const response = await fetch(url);
  if (!response.ok) throw new Error("Regional heatmap request failed");

  const data = await response.json();
  const rows = Array.isArray(data) ? data : [data];
  return points.map((point, index) => ({
    ...point,
    current: rows[index]?.current || {},
  }));
}

function buildHeatmapPoints(location) {
  const points = [];
  const step = (HEATMAP_RADIUS * 2) / (HEATMAP_GRID_SIZE - 1);

  for (let row = 0; row < HEATMAP_GRID_SIZE; row += 1) {
    for (let column = 0; column < HEATMAP_GRID_SIZE; column += 1) {
      points.push({
        row,
        column,
        latitude: location.latitude + HEATMAP_RADIUS - row * step,
        longitude: location.longitude - HEATMAP_RADIUS + column * step,
      });
    }
  }

  return points;
}

function setLoadingState(message) {
  elements.tempTrend.textContent = message;
  elements.pressureTrend.textContent = "Waiting for API response";
  elements.windDirection.textContent = "Waiting for API response";
  elements.watchCopy.textContent = "Waiting for API response";
}

function updateCurrentConditions(location, forecast) {
  const current = forecast.current;
  const hourly = forecast.hourly;
  const daily = forecast.daily;
  const currentIndex = findCurrentIndex(hourly.time);
  const previousIndex = Math.max(0, currentIndex - 3);
  const nextIndex = Math.min(hourly.time.length - 1, currentIndex + 1);

  const temperatureDelta = current.temperature_2m - hourly.temperature_2m[previousIndex];
  const pressureDelta = current.pressure_msl - hourly.pressure_msl[previousIndex];
  const nextPrecip = hourly.precipitation[nextIndex] ?? current.precipitation;
  const nextPrecipChance = hourly.precipitation_probability[nextIndex];

  const placeName = [location.name, location.admin, location.country].filter(Boolean).join(", ");
  elements.stationTitle.textContent = placeName;
  elements.stationCopy.textContent = `Live forecast feed for ${location.name}. Hardware receiver feed is separate.`;
  elements.updatedAt.textContent = new Date(current.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  elements.temperature.textContent = formatNumber(current.temperature_2m);
  elements.currentCondition.textContent = describeWeatherCode(daily.weather_code[0]);
  elements.conditionCopy.textContent = `${Math.round(daily.temperature_2m_max[0])}° high, ${Math.round(daily.temperature_2m_min[0])}° low today`;
  elements.pressure.textContent = formatNumber(current.pressure_msl);
  elements.wind.textContent = Math.round(current.wind_speed_10m);
  elements.windCompass.textContent = degreesToCompass(current.wind_direction_10m);
  elements.tempTrend.textContent = describeDelta(temperatureDelta, "°C", "Warming", "Cooling");
  elements.pressureTrend.textContent = describeDelta(pressureDelta, "hPa", "Rising", "Falling");
  elements.windDirection.textContent = `From ${Math.round(current.wind_direction_10m)}° with gusts to ${Math.round(current.wind_gusts_10m)} km/h`;
  elements.watchLevel.textContent = formatNumber(nextPrecip);
  elements.watchCopy.textContent = Number.isFinite(nextPrecipChance)
    ? `${nextPrecipChance}% chance in the next hour`
    : "Next-hour probability unavailable";
}

function updateWeatherWarning(forecast) {
  const hourly = forecast.hourly;
  const daily = forecast.daily;
  const currentIndex = findCurrentIndex(hourly.time);
  const nextTwelveHours = hourly.time.slice(currentIndex, currentIndex + 12).map((_, offset) => currentIndex + offset);
  const nextSixHours = hourly.time.slice(currentIndex, currentIndex + 6).map((_, offset) => currentIndex + offset);
  const maxGust = Math.max(...nextTwelveHours.map((index) => hourly.wind_gusts_10m[index] || 0));
  const maxPrecipChance = Math.max(...nextTwelveHours.map((index) => hourly.precipitation_probability[index] || 0));
  const precipTotal = nextTwelveHours.reduce((total, index) => total + (hourly.precipitation[index] || 0), 0);
  const pressureNow = hourly.pressure_msl[currentIndex];
  const pressureLater = hourly.pressure_msl[Math.min(hourly.pressure_msl.length - 1, currentIndex + 6)];
  const pressureDrop = pressureNow - pressureLater;
  const stormToday = [95, 96, 99].includes(daily.weather_code[0]);
  const heavyRainToday = [65, 82].includes(daily.weather_code[0]);

  let level = "clear";
  let label = "Weather Status";
  let title = "No major weather warnings indicated";
  let copy = "Forecast-based scan is quiet for the next 12 hours. Check official alerts before travel or severe weather decisions.";

  if (stormToday || maxGust >= 70) {
    level = "warning";
    label = "Weather Warning";
    title = stormToday ? "Thunderstorm risk in the forecast" : "Damaging gust potential";
    copy = stormToday
      ? `Storm conditions appear in today's forecast. Peak gusts may reach ${Math.round(maxGust)} km/h.`
      : `Forecast gusts may reach ${Math.round(maxGust)} km/h in the next 12 hours.`;
  } else if (heavyRainToday || precipTotal >= 10 || maxPrecipChance >= 75) {
    level = "watch";
    label = "Weather Watch";
    title = "Rain risk is elevated";
    copy = `${precipTotal.toFixed(1)} mm is forecast over the next 12 hours, with peak probability near ${maxPrecipChance}%.`;
  } else if (maxGust >= 45 || pressureDrop >= 3 || precipTotal >= 3) {
    level = "advisory";
    label = "Weather Advisory";
    title = maxGust >= 45 ? "Gusty winds possible" : "Changing weather pattern";
    copy =
      maxGust >= 45
        ? `Gusts may reach ${Math.round(maxGust)} km/h in the next 12 hours.`
        : `Pressure may fall ${pressureDrop.toFixed(1)} hPa over 6 hours with ${precipTotal.toFixed(1)} mm possible.`;
  }

  elements.warningBar.className = `weather-warning ${level}`;
  elements.warningLabel.textContent = label;
  elements.warningTitle.textContent = title;
  elements.warningCopy.textContent = copy;
}

function renderPatterns(forecast) {
  const hourly = forecast.hourly;
  const currentIndex = findCurrentIndex(hourly.time);
  const nextSixHours = hourly.time.slice(currentIndex, currentIndex + 6).map((_, offset) => currentIndex + offset);
  const nextPrecipTotal = nextSixHours.reduce((total, index) => total + (hourly.precipitation[index] || 0), 0);
  const maxPrecipChance = Math.max(...nextSixHours.map((index) => hourly.precipitation_probability[index] || 0));
  const pressureNow = hourly.pressure_msl[currentIndex];
  const pressureLater = hourly.pressure_msl[Math.min(hourly.pressure_msl.length - 1, currentIndex + 6)];
  const windNow = hourly.wind_speed_10m[currentIndex];
  const windLater = hourly.wind_speed_10m[Math.min(hourly.wind_speed_10m.length - 1, currentIndex + 6)];

  const patterns = [
    {
      level: pressureLater < pressureNow - 1.5 ? "high" : "low",
      title: "Pressure Trend",
      copy:
        pressureLater < pressureNow - 1.5
          ? `Pressure may fall ${(pressureNow - pressureLater).toFixed(1)} hPa in the next 6 hours.`
          : `Pressure is fairly steady over the next 6 hours: ${(pressureLater - pressureNow).toFixed(1)} hPa.`,
    },
    {
      level: maxPrecipChance >= 60 || nextPrecipTotal >= 2 ? "medium" : "low",
      title: "Rain Window",
      copy: `${nextPrecipTotal.toFixed(1)} mm forecast over 6 hours, with peak probability at ${maxPrecipChance}%.`,
    },
    {
      level: windLater > windNow + 8 ? "medium" : "low",
      title: "Wind Change",
      copy: `Wind changes from ${Math.round(windNow)} to ${Math.round(windLater)} km/h over the next 6 hours.`,
    },
  ];

  elements.patternList.innerHTML = patterns
    .map(
      (pattern) => `
        <div class="pattern-item ${pattern.level}">
          <span></span>
          <div>
            <strong>${pattern.title}</strong>
            <p>${pattern.copy}</p>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderDailyForecast(forecast) {
  const daily = forecast.daily;
  const dayIndexes = [0, 1].filter((index) => daily.time[index]);

  elements.dailyGrid.innerHTML = dayIndexes
    .map((index) => {
      const label = index === 0 ? "Today" : "Tomorrow";
      return `
        <article class="forecast-card">
          <div>
            <span>${label}</span>
            <strong>${describeWeatherCode(daily.weather_code[index])}</strong>
          </div>
          <div class="forecast-temp">
            <strong>${Math.round(daily.temperature_2m_max[index])}°</strong>
            <small>${Math.round(daily.temperature_2m_min[index])}° low</small>
          </div>
          <dl class="forecast-details">
            <div><dt>Precip</dt><dd>${formatNumber(daily.precipitation_sum[index])} mm</dd></div>
            <div><dt>Chance</dt><dd>${daily.precipitation_probability_max[index] ?? "--"}%</dd></div>
            <div><dt>Wind</dt><dd>${Math.round(daily.wind_speed_10m_max[index])} km/h</dd></div>
            <div><dt>Gusts</dt><dd>${Math.round(daily.wind_gusts_10m_max[index])} km/h</dd></div>
            <div><dt>Sunrise</dt><dd>${new Date(daily.sunrise[index]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd></div>
            <div><dt>Sunset</dt><dd>${new Date(daily.sunset[index]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd></div>
          </dl>
        </article>
      `;
    })
    .join("");
}

function renderWeeklyForecast(forecast) {
  const daily = forecast.daily;

  elements.weeklyList.innerHTML = daily.time
    .map(
      (day, index) => `
        <div class="weekly-row">
          <div>
            <strong>${formatDay(day)}</strong>
            <small>${describeWeatherCode(daily.weather_code[index])}</small>
          </div>
          <div class="weekly-temp">
            <span>${Math.round(daily.temperature_2m_max[index])}°</span>
            <small>${Math.round(daily.temperature_2m_min[index])}°</small>
          </div>
          <div class="weekly-bar" aria-hidden="true">
            <span class="${getPrecipBarClass(daily.precipitation_probability_max[index])}"></span>
          </div>
          <div class="weekly-meta">
            <span>${daily.precipitation_probability_max[index] ?? "--"}%</span>
            <small>${formatNumber(daily.precipitation_sum[index])} mm</small>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderHourlyForecast(forecast) {
  const hourly = forecast.hourly;
  const currentIndex = findCurrentIndex(hourly.time);
  const indexes = hourly.time.slice(currentIndex, currentIndex + HOURS_TO_SHOW).map((_, offset) => currentIndex + offset);

  elements.hourlyStrip.innerHTML = indexes
    .map((index, offset) => {
      const time = offset === 0 ? "Now" : new Date(hourly.time[index]).toLocaleTimeString([], { hour: "2-digit" });
      const chance = hourly.precipitation_probability[index] ?? 0;
      return `
        <article class="hourly-card">
          <span>${time}</span>
          <strong>${Math.round(hourly.temperature_2m[index])}°</strong>
          <small>${chance}% rain</small>
          <small>${Math.round(hourly.wind_speed_10m[index])} km/h</small>
        </article>
      `;
    })
    .join("");
}

function renderHeatmap(points = latestHeatmap, layer = activeHeatmapLayer) {
  if (!points?.length) return;

  const { width, height } = prepareCanvas(heatmapCanvas, heatmapCtx);
  const mapPadding = 34;
  const legendHeight = 34;
  const mapWidth = width - mapPadding * 2;
  const mapHeight = height - mapPadding * 2 - legendHeight;
  const cellWidth = mapWidth / HEATMAP_GRID_SIZE;
  const cellHeight = mapHeight / HEATMAP_GRID_SIZE;
  const values = points.map((point) => getHeatmapValue(point, layer));
  const finiteValues = values.filter(Number.isFinite);
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);

  heatmapCtx.clearRect(0, 0, width, height);
  heatmapCtx.fillStyle = "#061013";
  heatmapCtx.fillRect(0, 0, width, height);

  points.forEach((point, index) => {
    const value = values[index];
    const normalized = normalizeValue(value, min, max);
    const x = mapPadding + point.column * cellWidth;
    const y = mapPadding + point.row * cellHeight;
    heatmapCtx.fillStyle = getHeatmapColor(normalized, layer);
    heatmapCtx.fillRect(x, y, cellWidth + 1, cellHeight + 1);
  });

  drawMapGrid(width, height, mapPadding, mapWidth, mapHeight);
  drawHeatmapPlaces(activeLocation || DEFAULT_LOCATION, mapPadding, mapWidth, mapHeight);
  drawHeatmapLabels(width, height, layer, min, max);
  renderHeatmapLegend(layer, min, max);
}

function getHeatmapValue(point, layer) {
  if (layer === "precipitation") return point.current.precipitation;
  if (layer === "wind") return point.current.wind_speed_10m;
  return point.current.temperature_2m;
}

function normalizeValue(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  const range = max - min || 1;
  return Math.max(0, Math.min(1, (value - min) / range));
}

function getHeatmapColor(value, layer) {
  if (layer === "precipitation") {
    return interpolateColor([
      [6, 16, 19],
      [30, 91, 130],
      [81, 167, 255],
    ], value);
  }

  if (layer === "wind") {
    return interpolateColor([
      [7, 20, 26],
      [53, 208, 165],
      [242, 184, 75],
    ], value);
  }

  return interpolateColor([
    [24, 78, 122],
    [53, 208, 165],
    [242, 184, 75],
  ], value);
}

function interpolateColor(colors, value) {
  const scaled = value * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const start = colors[index];
  const end = colors[index + 1];
  const channels = start.map((channel, channelIndex) => Math.round(channel + (end[channelIndex] - channel) * mix));
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

function drawMapGrid(width, height, padding, mapWidth, mapHeight) {
  heatmapCtx.strokeStyle = "rgba(203, 214, 212, 0.18)";
  heatmapCtx.lineWidth = 1;
  for (let index = 0; index <= HEATMAP_GRID_SIZE; index += 1) {
    const x = padding + (mapWidth / HEATMAP_GRID_SIZE) * index;
    const y = padding + (mapHeight / HEATMAP_GRID_SIZE) * index;
    heatmapCtx.beginPath();
    heatmapCtx.moveTo(x, padding);
    heatmapCtx.lineTo(x, padding + mapHeight);
    heatmapCtx.stroke();
    heatmapCtx.beginPath();
    heatmapCtx.moveTo(padding, y);
    heatmapCtx.lineTo(padding + mapWidth, y);
    heatmapCtx.stroke();
  }

  heatmapCtx.strokeStyle = "rgba(203, 214, 212, 0.35)";
  heatmapCtx.strokeRect(padding, padding, mapWidth, mapHeight);
  heatmapCtx.fillStyle = "#cbd6d4";
  heatmapCtx.font = "800 12px system-ui";
  heatmapCtx.fillText("NW", padding + 8, padding + 18);
  heatmapCtx.fillText("NE", width - padding - 28, padding + 18);
  heatmapCtx.fillText("SW", padding + 8, padding + mapHeight - 10);
  heatmapCtx.fillText("SE", width - padding - 28, padding + mapHeight - 10);
}

function drawHeatmapPlaces(location, padding, mapWidth, mapHeight) {
  const bounds = {
    north: location.latitude + HEATMAP_RADIUS,
    south: location.latitude - HEATMAP_RADIUS,
    west: location.longitude - HEATMAP_RADIUS,
    east: location.longitude + HEATMAP_RADIUS,
  };

  HEATMAP_PLACES.forEach((place) => {
    if (place.latitude > bounds.north || place.latitude < bounds.south || place.longitude < bounds.west || place.longitude > bounds.east) {
      return;
    }

    const position = projectHeatmapPlace(place, bounds, padding, mapWidth, mapHeight);
    const isCenter = place.name === "Chatham";
    heatmapCtx.fillStyle = isCenter ? "#050a0d" : "rgba(5, 10, 13, 0.8)";
    heatmapCtx.strokeStyle = isCenter ? "#eff6f4" : "rgba(239, 246, 244, 0.82)";
    heatmapCtx.lineWidth = isCenter ? 3 : 2;
    heatmapCtx.beginPath();
    heatmapCtx.arc(position.x, position.y, isCenter ? 8 : 5, 0, Math.PI * 2);
    heatmapCtx.fill();
    heatmapCtx.stroke();

    heatmapCtx.font = isCenter ? "900 12px system-ui" : "800 11px system-ui";
    const labelWidth = heatmapCtx.measureText(place.name).width;
    const labelX = Math.min(padding + mapWidth - labelWidth - 7, position.x + 9);
    const labelY = Math.max(padding + 14, Math.min(padding + mapHeight - 6, position.y + 4));
    heatmapCtx.fillStyle = "rgba(5, 10, 13, 0.68)";
    roundedRect(heatmapCtx, labelX - 4, labelY - 12, labelWidth + 8, 17, 5);
    heatmapCtx.fill();
    heatmapCtx.fillStyle = isCenter ? "#eff6f4" : "#d8e3e1";
    heatmapCtx.fillText(place.name, labelX, labelY);
  });
}

function projectHeatmapPlace(place, bounds, padding, mapWidth, mapHeight) {
  return {
    x: padding + ((place.longitude - bounds.west) / (bounds.east - bounds.west)) * mapWidth,
    y: padding + ((bounds.north - place.latitude) / (bounds.north - bounds.south)) * mapHeight,
  };
}

function drawHeatmapLabels(width, height, layer, min, max) {
  heatmapCtx.fillStyle = "#eff6f4";
  heatmapCtx.font = "900 15px system-ui";
  heatmapCtx.fillText(getHeatmapTitle(layer), 34, 24);
  heatmapCtx.fillStyle = "#82909a";
  heatmapCtx.font = "800 12px system-ui";
  heatmapCtx.fillText(`${formatHeatmapValue(min, layer)} low`, width - 190, 24);
  heatmapCtx.fillText(`${formatHeatmapValue(max, layer)} high`, width - 98, 24);
}

function getHeatmapTitle(layer) {
  if (layer === "precipitation") return "Current rain intensity";
  if (layer === "wind") return "Current wind speed";
  return "Current temperature";
}

function formatHeatmapValue(value, layer) {
  if (!Number.isFinite(value)) return "--";
  if (layer === "precipitation") return `${value.toFixed(1)} mm`;
  if (layer === "wind") return `${Math.round(value)} km/h`;
  return `${value.toFixed(1)}°C`;
}

function renderHeatmapLegend(layer, min, max) {
  elements.heatmapLegend.innerHTML = `
    <span>${formatHeatmapValue(min, layer)}</span>
    <div class="heatmap-gradient ${layer}"></div>
    <span>${formatHeatmapValue(max, layer)}</span>
  `;
}

function getForecastHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY_ITEMS) : [];
  } catch {
    return [];
  }
}

function saveForecastSnapshot(location, forecast) {
  const current = forecast.current;
  const daily = forecast.daily;
  const snapshot = {
    id: `${Date.now()}`,
    savedAt: new Date().toISOString(),
    location: [location.name, location.admin, location.country].filter(Boolean).join(", "),
    temperature: current.temperature_2m,
    pressure: current.pressure_msl,
    wind: current.wind_speed_10m,
    todayHigh: daily.temperature_2m_max[0],
    todayLow: daily.temperature_2m_min[0],
    todayPrecip: daily.precipitation_sum[0],
    todayChance: daily.precipitation_probability_max[0],
    condition: describeWeatherCode(daily.weather_code[0]),
  };

  try {
    const existing = getForecastHistory();
    const next = [snapshot, ...existing].slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    renderForecastHistory(next);
  } catch {
    addLog("Forecast history could not be saved in this browser.");
  }
}

function renderForecastHistory(history = getForecastHistory()) {
  if (!history.length) {
    elements.historyList.innerHTML = `<div class="empty-signal">No forecast snapshots saved yet.</div>`;
    return;
  }

  elements.historyList.innerHTML = history
    .map(
      (item) => `
        <div class="history-row">
          <div>
            <strong>${new Date(item.savedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</strong>
            <small>${escapeHTML(item.location)}</small>
          </div>
          <div><span>Now</span><strong>${formatNumber(item.temperature)}°C</strong></div>
          <div><span>Pressure</span><strong>${formatNumber(item.pressure)} hPa</strong></div>
          <div><span>Today</span><strong>${Math.round(item.todayHigh)}° / ${Math.round(item.todayLow)}°</strong></div>
          <div><span>Precip</span><strong>${formatNumber(item.todayPrecip)} mm</strong></div>
          <div><span>Condition</span><strong>${escapeHTML(item.condition)}</strong></div>
        </div>
      `,
    )
    .join("");
}

function prepareCanvas(canvas, context) {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.round(rect.width));
  const height = Math.max(260, Math.round(rect.height));
  const scaledWidth = Math.round(width * pixelRatio);
  const scaledHeight = Math.round(height * pixelRatio);

  if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
  }

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return { width, height };
}

function drawForecastChart(forecast) {
  const { width, height } = prepareCanvas(chartCanvas, chartCtx);
  const leftPadding = Math.max(46, Math.min(68, width * 0.065));
  const rightPadding = 28;
  const bottomPadding = 52;
  const topPadding = 64;
  const hourly = forecast.hourly;
  const currentIndex = findCurrentIndex(hourly.time);
  const indexes = hourly.time.slice(currentIndex, currentIndex + HOURS_TO_SHOW).map((_, offset) => currentIndex + offset);
  const temperatures = indexes.map((index) => hourly.temperature_2m[index]);
  const precipitation = indexes.map((index) => hourly.precipitation_probability[index]);
  const chartTop = topPadding;
  const chartBottom = height - bottomPadding;
  const chartHeight = chartBottom - chartTop;
  const temperatureY = normalizeToRange(temperatures, chartTop, chartBottom);
  const precipY = precipitation.map((value) => chartBottom - ((value || 0) / 100) * chartHeight);
  const chartLeft = leftPadding;
  const chartRight = width - rightPadding;
  const xStep = (chartRight - chartLeft) / Math.max(1, indexes.length - 1);
  const tempMin = Math.min(...temperatures);
  const tempMax = Math.max(...temperatures);

  chartState.points = indexes.map((index, offset) => ({
    index,
    offset,
    x: chartLeft + offset * xStep,
    temperatureY: temperatureY[offset],
    precipY: precipY[offset],
    time: hourly.time[index],
    temperature: temperatures[offset],
    precipitationProbability: precipitation[offset],
    precipitationAmount: hourly.precipitation[index],
    wind: hourly.wind_speed_10m[index],
  }));

  chartCtx.clearRect(0, 0, width, height);
  const background = chartCtx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#07161a");
  background.addColorStop(1, "#050c10");
  chartCtx.fillStyle = background;
  chartCtx.fillRect(0, 0, width, height);

  chartCtx.strokeStyle = "rgba(47, 71, 80, 0.65)";
  chartCtx.lineWidth = 1;
  for (let i = 0; i <= 5; i += 1) {
    const y = chartTop + (chartHeight / 5) * i;
    chartCtx.beginPath();
    chartCtx.moveTo(chartLeft, y);
    chartCtx.lineTo(chartRight, y);
    chartCtx.stroke();

    const labelValue = tempMax - ((tempMax - tempMin) / 5) * i;
    chartCtx.fillStyle = "#7f9098";
    chartCtx.font = "700 12px system-ui";
    chartCtx.fillText(`${labelValue.toFixed(0)}°`, 14, y + 4);
  }

  precipitation.forEach((chance, offset) => {
    const barHeight = (chartHeight * chance) / 100;
    const barWidth = Math.max(8, Math.min(18, xStep * 0.5));
    const x = chartLeft + offset * xStep - barWidth / 2;
    const barGradient = chartCtx.createLinearGradient(0, chartBottom - barHeight, 0, chartBottom);
    barGradient.addColorStop(0, "rgba(81, 167, 255, 0.7)");
    barGradient.addColorStop(1, "rgba(81, 167, 255, 0.14)");
    chartCtx.fillStyle = barGradient;
    roundedRect(chartCtx, x, chartBottom - barHeight, barWidth, barHeight, 5);
    chartCtx.fill();
  });

  const areaGradient = chartCtx.createLinearGradient(0, chartTop, 0, chartBottom);
  areaGradient.addColorStop(0, "rgba(53, 208, 165, 0.28)");
  areaGradient.addColorStop(0.72, "rgba(53, 208, 165, 0.04)");
  areaGradient.addColorStop(1, "rgba(53, 208, 165, 0)");
  chartCtx.beginPath();
  temperatureY.forEach((y, offset) => {
    const x = chartLeft + offset * xStep;
    if (offset === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  });
  chartCtx.lineTo(chartRight, chartBottom);
  chartCtx.lineTo(chartLeft, chartBottom);
  chartCtx.closePath();
  chartCtx.fillStyle = areaGradient;
  chartCtx.fill();

  chartCtx.beginPath();
  chartCtx.strokeStyle = "#35d0a5";
  chartCtx.lineWidth = 4;
  chartCtx.lineJoin = "round";
  chartCtx.lineCap = "round";
  temperatureY.forEach((y, offset) => {
    const x = chartLeft + offset * xStep;
    if (offset === 0) chartCtx.moveTo(x, y);
    else chartCtx.lineTo(x, y);
  });
  chartCtx.stroke();

  chartState.points.forEach((point, offset) => {
    if (offset % 3 !== 0 && offset !== 0) return;
    drawSmallPoint(point.x, point.temperatureY, "#35d0a5");
  });

  if (chartState.hoverIndex !== null && chartState.points[chartState.hoverIndex]) {
    drawChartHover(chartState.points[chartState.hoverIndex], chartTop, chartBottom);
  }

  chartCtx.fillStyle = "#cbd6d4";
  chartCtx.font = "700 15px system-ui";
  chartCtx.fillText("Temperature", chartLeft, 30);
  chartCtx.fillStyle = "#35d0a5";
  roundedRect(chartCtx, chartLeft + 105, 20, 28, 5, 3);
  chartCtx.fill();
  chartCtx.fillStyle = "#cbd6d4";
  chartCtx.fillText("Rain chance", chartLeft + 154, 30);
  chartCtx.fillStyle = "#51a7ff";
  roundedRect(chartCtx, chartLeft + 246, 20, 28, 5, 3);
  chartCtx.fill();

  chartCtx.fillStyle = "#82909a";
  chartCtx.font = "700 12px system-ui";
  indexes.forEach((index, offset) => {
    if (offset % 3 !== 0) return;
    const x = chartLeft + offset * xStep;
    const label = new Date(hourly.time[index]).toLocaleTimeString([], { hour: "2-digit" });
    chartCtx.fillText(label, x - 13, height - 22);
  });
}

function roundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function drawSmallPoint(x, y, color) {
  chartCtx.fillStyle = "#061013";
  chartCtx.strokeStyle = color;
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();
  chartCtx.arc(x, y, 4, 0, Math.PI * 2);
  chartCtx.fill();
  chartCtx.stroke();
}

function drawChartHover(point, chartTop, chartBottom) {
  chartCtx.strokeStyle = "rgba(203, 214, 212, 0.32)";
  chartCtx.lineWidth = 1;
  chartCtx.beginPath();
  chartCtx.moveTo(point.x, chartTop);
  chartCtx.lineTo(point.x, chartBottom);
  chartCtx.stroke();

  drawPointMarker(point.x, point.temperatureY, "#35d0a5");
  drawPointMarker(point.x, point.precipY, "#51a7ff");
}

function drawPointMarker(x, y, color) {
  chartCtx.fillStyle = "#061013";
  chartCtx.strokeStyle = color;
  chartCtx.lineWidth = 3;
  chartCtx.beginPath();
  chartCtx.arc(x, y, 6, 0, Math.PI * 2);
  chartCtx.fill();
  chartCtx.stroke();
}

function updateChartTooltip(event) {
  if (!latestForecast || !chartState.points.length) return;

  const rect = chartCanvas.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  let nearestIndex = null;
  let nearestDistance = Infinity;

  chartState.points.forEach((point, index) => {
    const distance = Math.min(
      Math.hypot(pointerX - point.x, pointerY - point.temperatureY),
      Math.hypot(pointerX - point.x, pointerY - point.precipY),
    );

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  if (nearestIndex === null || nearestDistance > 32) {
    hideChartTooltip();
    return;
  }

  chartState.hoverIndex = nearestIndex;
  drawForecastChart(latestForecast);
  showChartTooltip(chartState.points[nearestIndex], pointerX, pointerY, rect);
}

function showChartTooltip(point, pointerX, pointerY, rect) {
  const time = new Date(point.time).toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  elements.chartTooltip.innerHTML = `
    <strong>${escapeHTML(time)}</strong>
    <span>Temperature: ${formatNumber(point.temperature)}°C</span>
    <span>Precip chance: ${point.precipitationProbability ?? "--"}%</span>
    <span>Precip amount: ${formatNumber(point.precipitationAmount)} mm</span>
    <span>Wind: ${Math.round(point.wind)} km/h</span>
  `;

  elements.chartTooltip.classList.add("visible");

  const tooltipWidth = elements.chartTooltip.offsetWidth;
  const tooltipHeight = elements.chartTooltip.offsetHeight;
  const left = Math.min(rect.width - tooltipWidth - 10, pointerX + 14);
  const top = Math.max(10, Math.min(rect.height - tooltipHeight - 10, pointerY - tooltipHeight - 10));

  elements.chartTooltip.style.left = `${Math.max(10, left)}px`;
  elements.chartTooltip.style.top = `${top}px`;
}

function hideChartTooltip() {
  if (chartState.hoverIndex === null && !elements.chartTooltip.classList.contains("visible")) return;
  chartState.hoverIndex = null;
  elements.chartTooltip.classList.remove("visible");
  if (latestForecast) drawForecastChart(latestForecast);
}

function normalizeToRange(values, top, bottom) {
  const finiteValues = values.filter(Number.isFinite);
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  const range = max - min || 1;

  return values.map((value) => bottom - ((value - min) / range) * (bottom - top));
}

async function resolveLocation(query) {
  if (!query || query === DEFAULT_LOCATION.name || query === "Chatham, Ontario, Canada") {
    return DEFAULT_LOCATION;
  }

  return geocodeLocation(query);
}

async function loadWeather(query = DEFAULT_LOCATION.name) {
  try {
    setLoadingState("Loading live weather data");
    const queryLabel = typeof query === "string" ? query : query.name;
    addLog(`Loading weather data for ${queryLabel}.`);
    activeLocation = typeof query === "string" ? await resolveLocation(query) : query;
    latestForecast = await fetchForecast(activeLocation);
    try {
      latestHeatmap = await fetchHeatmap(activeLocation);
    } catch (error) {
      latestHeatmap = null;
      addLog(error.message);
    }
    updateCurrentConditions(activeLocation, latestForecast);
    updateWeatherWarning(latestForecast);
    renderPatterns(latestForecast);
    renderHeatmap(latestHeatmap);
    renderHourlyForecast(latestForecast);
    renderDailyForecast(latestForecast);
    renderWeeklyForecast(latestForecast);
    drawForecastChart(latestForecast);
    saveForecastSnapshot(activeLocation, latestForecast);
    addLog(`Live Open-Meteo feed updated for ${activeLocation.name}.`);
  } catch (error) {
    addLog(error.message);
    elements.warningBar.className = "weather-warning advisory";
    elements.warningLabel.textContent = "Weather Advisory";
    elements.warningTitle.textContent = "Weather feed unavailable";
    elements.warningCopy.textContent = "Live forecast warnings cannot be calculated until the Open-Meteo feed is reachable.";
    elements.tempTrend.textContent = "Weather feed unavailable";
    elements.pressureTrend.textContent = "Check network access or location";
    elements.windDirection.textContent = "No live wind data";
    elements.windCompass.textContent = "--";
    elements.watchCopy.textContent = "No live precipitation data";
  }
}

elements.locationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = elements.locationInput.value.trim();
  if (query) loadWeather(query);
});

elements.refreshButton.addEventListener("click", () => {
  loadWeather(activeLocation || elements.locationInput.value || DEFAULT_LOCATION);
});

elements.clearHistoryButton.addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderForecastHistory([]);
  addLog("Forecast history cleared.");
});

window.addEventListener("resize", () => {
  hideChartTooltip();
  if (latestForecast) drawForecastChart(latestForecast);
  if (latestHeatmap) renderHeatmap(latestHeatmap);
});

chartCanvas.addEventListener("pointermove", updateChartTooltip);
chartCanvas.addEventListener("pointerleave", hideChartTooltip);

document.querySelectorAll(".heatmap-button").forEach((button) => {
  button.addEventListener("click", () => {
    activeHeatmapLayer = button.dataset.layer;
    document.querySelectorAll(".heatmap-button").forEach((item) => item.classList.toggle("active", item === button));
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  });
});

renderForecastHistory();
loadWeather(DEFAULT_LOCATION);
