import type { Forecast, AirQuality } from "../types";
import { elements } from "../state";
import {
  findCurrentIndex, formatSpeed, formatPrecip, formatPressure,
  formatNumber, formatHeatmapValue, formatTemp,
  getCurrentHourlyIndex, hourlyValue, maxNext, sumNext,
} from "../weather";
import { calculateStormRisk } from "../weather";

export function renderPatterns(forecast: Forecast): void {
  if (!elements.patternList) return;
  const hourly = forecast.hourly;
  const currentIndex = findCurrentIndex(hourly.time);
  const nextSixIndexes = hourly.time.slice(currentIndex, currentIndex + 6).map((_, offset) => currentIndex + offset);
  const nextPrecipTotal = nextSixIndexes.reduce((total, index) => total + (hourly.precipitation[index] || 0), 0);
  const maxPrecipChance = Math.max(...nextSixIndexes.map((index) => hourly.precipitation_probability[index] || 0));
  const pressureNow = hourly.pressure_msl[currentIndex];
  const pressureLater = hourly.pressure_msl[Math.min(hourly.pressure_msl.length - 1, currentIndex + 6)];
  const windNow = hourly.wind_speed_10m[currentIndex];
  const windLater = hourly.wind_speed_10m[Math.min(hourly.wind_speed_10m.length - 1, currentIndex + 6)];

  const patterns = [
    {
      level: pressureLater < pressureNow - 1.5 ? "high" : "low",
      title: "Pressure Trend",
      copy: pressureLater < pressureNow - 1.5
        ? `Pressure may fall ${formatPressure(pressureNow - pressureLater)} in the next 6 hours.`
        : `Pressure is fairly steady over the next 6 hours: ${formatPressure(pressureLater - pressureNow)}.`,
    },
    {
      level: maxPrecipChance >= 60 || nextPrecipTotal >= 2 ? "medium" : "low",
      title: "Rain Window",
      copy: `${formatPrecip(nextPrecipTotal)} forecast over 6 hours, with peak probability at ${maxPrecipChance}%.`,
    },
    {
      level: windLater > windNow + 8 ? "medium" : "low",
      title: "Wind Change",
      copy: `Wind changes from ${formatSpeed(windNow)} to ${formatSpeed(windLater)} over the next 6 hours.`,
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

export function renderStormToolkit(forecast: Forecast): void {
  const risk = calculateStormRisk(forecast);
  if (elements.stormRiskBadge) elements.stormRiskBadge.textContent = `${risk.level} ${Math.round(risk.score)}`;
  if (elements.stormRiskFill) elements.stormRiskFill.style.width = `${Math.round(risk.score)}%`;

  if (elements.stormHeading) {
    const headings: Record<string, string> = {
      Quiet: "Clear Conditions — No Significant Storm Threat",
      Monitor: "Monitoring — Marginal Convective Signals Detected",
      Elevated: "Elevated Risk — Supportive Environment for Storms",
      High: "High Risk — Favorable Setup for Severe Storms",
    };
    elements.stormHeading.textContent = headings[risk.level] || "Convective Setup and Severe Potential";
  }

  if (elements.stormGrid) {
    elements.stormGrid.innerHTML = [
      ["CAPE", formatHeatmapValue(risk.cape, "cape"), "Convective available potential energy"],
      ["Dew point", formatHeatmapValue(risk.dewPoint, "dewpoint"), "Moisture available near the surface"],
      ["Peak gust", formatHeatmapValue(risk.gusts, "gusts"), "Highest gust in the next 12 hours"],
      ["Rain chance", formatHeatmapValue(risk.rainChance, "precipProbability"), "Peak probability in the next 12 hours"],
      ["12h rain", formatHeatmapValue(risk.rainTotal, "precipitation"), "Total precipitation window"],
      ["Pressure drop", `${formatPressure(risk.pressureDrop)}`, "Six-hour pressure tendency"],
      ["Wind shear proxy", `${formatSpeed(risk.shear)}`, "100 m minus 10 m wind speed"],
      ["Visibility", formatHeatmapValue(hourlyValue(forecast, "visibility"), "visibility"), "Near-term surface visibility"],
    ]
      .map(([label, value, copy]) => `<article class="toolkit-card"><span>${label}</span><strong>${value}</strong><small>${copy}</small></article>`)
      .join("");
  }

  if (elements.stormSignals) {
    const signals = [
      risk.cape >= 800 ? "Instability is supportive of convection." : "Instability signal is limited.",
      risk.pressureDrop >= 3 ? "Pressure is falling quickly enough to monitor." : "Pressure tendency is not strongly concerning.",
      risk.gusts >= 55 ? "Wind gusts may become hazardous." : "Gust signal remains below severe thresholds.",
    ];
    elements.stormSignals.innerHTML = signals
      .map((copy) => `<div class="pattern-item low"><span></span><div><strong>Signal</strong><p>${copy}</p></div></div>`)
      .join("");
  }
}

export function renderAirQuality(airQuality: AirQuality | null): void {
  if (!airQuality?.hourly?.time) {
    if (elements.airGrid) elements.airGrid.innerHTML = `<div class="empty-signal">Air quality data unavailable.</div>`;
    return;
  }
  const index = findCurrentIndex(airQuality.hourly.time);
  const hourly = airQuality.hourly;

  if (elements.airGrid) {
    elements.airGrid.innerHTML = [
      ["US AQI", hourly.us_aqi?.[index], "", "Overall air quality index"],
      ["PM2.5", hourly.pm2_5?.[index], " ug/m3", "Fine particulate/smoke indicator"],
      ["PM10", hourly.pm10?.[index], " ug/m3", "Coarse particulate load"],
      ["Ozone", hourly.ozone?.[index], " ug/m3", "Surface ozone concentration"],
      ["NO2", hourly.nitrogen_dioxide?.[index], " ug/m3", "Traffic/combustion signal"],
      ["CO", hourly.carbon_monoxide?.[index], " ug/m3", "Carbon monoxide"],
      ["UV", hourly.uv_index?.[index], "", "Sun exposure index"],
      ["Next AQI peak", Math.max(...(hourly.us_aqi || []).filter(Number.isFinite)), "", "Highest available forecast value"],
    ]
      .map(([label, value, unit, copy]) =>
        `<article class="toolkit-card"><span>${label}</span><strong>${Number.isFinite(value) ? Math.round(value as number) + String(unit || "") : "--"}</strong><small>${copy}</small></article>`,
      )
      .join("");
  }
}

export function renderConfidence(forecast: Forecast): void {
  if (!elements.confidenceGrid) return;
  const pressureChange = Math.abs(
    (hourlyValue(forecast, "pressure_msl", 0) || 0) - (hourlyValue(forecast, "pressure_msl", 12) || 0),
  );
  const gustSpread = maxNext(forecast, "wind_gusts_10m", 24) - (hourlyValue(forecast, "wind_gusts_10m") || 0);
  const rainWindow = maxNext(forecast, "precipitation_probability", 24);
  const startIdx = getCurrentHourlyIndex(forecast);
  const cloudMin = Math.min(
    ...forecast.hourly.cloud_cover.slice(startIdx, startIdx + 24).filter(Number.isFinite),
  );
  const cloudRange = maxNext(forecast, "cloud_cover", 24) - cloudMin;
  const confidence = Math.max(
    0,
    Math.min(100, 100 - pressureChange * 5 - gustSpread * 0.5 - cloudRange * 0.15 - (rainWindow > 50 ? 8 : 0)),
  );

  elements.confidenceGrid.innerHTML = [
    ["Confidence", `${Math.round(confidence)}%`, "Lower when pressure, cloud, rain, and gust signals vary sharply"],
    ["Gust spread", `${formatSpeed(gustSpread)}`, "Change from now to the peak gust window"],
    ["Cloud range", `${Math.round(cloudRange)}%`, "Cloud cover variability over 24 hours"],
    ["Rain peak", `${Math.round(rainWindow)}%`, "Peak precipitation probability over 24 hours"],
  ]
    .map(([label, value, copy]) => `<article class="toolkit-card"><span>${label}</span><strong>${value}</strong><small>${copy}</small></article>`)
    .join("");
}

export function renderContext(forecast: Forecast): void {
  if (!elements.contextGrid) return;
  const rain24 = sumNext(forecast, "precipitation", 24);
  const snow24 = sumNext(forecast, "snowfall", 24);
  const peakCape = maxNext(forecast, "cape", 24);
  const peakGust = maxNext(forecast, "wind_gusts_10m", 24);
  const uv = forecast.daily.uv_index_max?.[0];

  elements.contextGrid.innerHTML = [
    ["24h rain", formatHeatmapValue(rain24, "precipitation"), "Upcoming local accumulation"],
    ["24h snow", `${formatNumber(snow24)} cm`, "Snowfall forecast where applicable"],
    ["Peak CAPE", formatHeatmapValue(peakCape, "cape"), "Instability peak over 24 hours"],
    ["Peak gust", formatHeatmapValue(peakGust, "gusts"), "Maximum gust forecast"],
    ["UV max", Number.isFinite(uv) ? formatNumber(uv) : "--", "Daily maximum UV index"],
    ["Cloud now", formatHeatmapValue(hourlyValue(forecast, "cloud_cover"), "cloud"), "Current cloud cover"],
    ["VPD", `${formatNumber(hourlyValue(forecast, "vapour_pressure_deficit"))} kPa`, "Drying/evaporation stress"],
    ["Soil temp", formatTemp(hourlyValue(forecast, "soil_temperature_0cm")), "Surface soil temperature"],
  ]
    .map(([label, value, copy]) => `<article class="toolkit-card"><span>${label}</span><strong>${value}</strong><small>${copy}</small></article>`)
    .join("");
}
