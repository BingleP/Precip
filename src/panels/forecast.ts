import type { Forecast } from "../types";
import { elements } from "../state";
import { HOURS_TO_SHOW } from "../config";
import {
  findCurrentIndex,
  describeWeatherCode, formatDay, formatPrecip, formatSpeed,
  getPrecipBarClass, isImperial,
} from "../weather";

export function renderDailyForecast(forecast: Forecast): void {
  if (!elements.dailyGrid) return;
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
            <strong>${isImperial() ? `${Math.round(daily.temperature_2m_max[index] * 9 / 5 + 32)}°` : `${Math.round(daily.temperature_2m_max[index])}°`}</strong>
            <small>${isImperial() ? `${Math.round(daily.temperature_2m_min[index] * 9 / 5 + 32)}°` : `${Math.round(daily.temperature_2m_min[index])}°`} low</small>
          </div>
          <dl class="forecast-details">
            <div><dt>Precip</dt><dd>${formatPrecip(daily.precipitation_sum[index])}</dd></div>
            <div><dt>Chance</dt><dd>${daily.precipitation_probability_max[index] ?? "--"}%</dd></div>
            <div><dt>Wind</dt><dd>${formatSpeed(daily.wind_speed_10m_max[index])}</dd></div>
            <div><dt>Gusts</dt><dd>${formatSpeed(daily.wind_gusts_10m_max[index])}</dd></div>
            <div><dt>Sunrise</dt><dd>${new Date(daily.sunrise[index]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd></div>
            <div><dt>Sunset</dt><dd>${new Date(daily.sunset[index]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd></div>
          </dl>
        </article>
      `;
    })
    .join("");
}

export function renderWeeklyForecast(forecast: Forecast): void {
  if (!elements.weeklyList) return;
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
            <span>${isImperial() ? `${Math.round(daily.temperature_2m_max[index] * 9 / 5 + 32)}°` : `${Math.round(daily.temperature_2m_max[index])}°`}</span>
            <small>${isImperial() ? `${Math.round(daily.temperature_2m_min[index] * 9 / 5 + 32)}°` : `${Math.round(daily.temperature_2m_min[index])}°`}</small>
          </div>
          <div class="weekly-bar" aria-hidden="true">
            <span class="${getPrecipBarClass(daily.precipitation_probability_max[index])}"></span>
          </div>
          <div class="weekly-meta">
            <span>${daily.precipitation_probability_max[index] ?? "--"}%</span>
            <small>${formatPrecip(daily.precipitation_sum[index])}</small>
          </div>
        </div>
      `,
    )
    .join("");
}

export function renderHourlyForecast(forecast: Forecast): void {
  if (!elements.hourlyStrip) return;
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
          <strong>${isImperial() ? `${Math.round(hourly.temperature_2m[index] * 9 / 5 + 32)}°` : `${Math.round(hourly.temperature_2m[index])}°`}</strong>
          <small class="rain-badge">${chance > 0 ? `${chance}%` : "—"}</small>
          <small class="wind-value">${formatSpeed(hourly.wind_speed_10m[index])}</small>
        </article>
      `;
    })
    .join("");
}
