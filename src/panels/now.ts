import type { Location, Forecast } from "../types";
import { elements } from "../state";
import {
  findCurrentIndex, formatTemp, formatSpeed,
  formatPrecip, formatPressure, formatNumber,
  describeWeatherCode, isImperial, degreesToCompass,
} from "../weather";

export function updateWarningBar(level: string, label: string, title: string, copy: string): void {
  if (elements.warningBar) elements.warningBar.className = `weather-warning ${level}`;
  if (elements.warningLabel) elements.warningLabel.textContent = label;
  if (elements.warningTitle) elements.warningTitle.textContent = title;
  if (elements.warningCopy) elements.warningCopy.textContent = copy;
}

export function updateCurrentConditions(location: Location, forecast: Forecast): void {
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

  const imp = isImperial();
  const placeName = [location.name, location.admin, location.country].filter(Boolean).join(", ");
  const regionalName = [location.admin, location.country].filter(Boolean).join(", ");

  if (elements.stationTitle) elements.stationTitle.textContent = placeName;
  if (elements.stationCopy) elements.stationCopy.textContent = `Live forecast feed for ${location.name}. Hardware receiver feed is separate.`;
  if (elements.stationCoordinates) elements.stationCoordinates.textContent = `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`;
  if (elements.updatedAt) elements.updatedAt.textContent = new Date(current.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (elements.heroKicker) elements.heroKicker.textContent = regionalName ? `Live weather brief for ${regionalName}` : "Live weather brief";
  if (elements.heroLocation) elements.heroLocation.textContent = location.name;
  if (elements.heroTimezone) elements.heroTimezone.textContent = location.timezone || forecast.timezone || "Local timezone unavailable";

  const hi = imp ? `${Math.round(daily.temperature_2m_max[0] * 9 / 5 + 32)}°F` : `${Math.round(daily.temperature_2m_max[0])}°C`;
  const lo = imp ? `${Math.round(daily.temperature_2m_min[0] * 9 / 5 + 32)}°F` : `${Math.round(daily.temperature_2m_min[0])}°C`;
  const currentConditionText = describeWeatherCode(current.weather_code);
  const dailyConditionText = describeWeatherCode(daily.weather_code[0]);
  if (elements.heroCopy) elements.heroCopy.textContent = currentConditionText === dailyConditionText
    ? `${currentConditionText} with ${hi} / ${lo} today. Next-hour precipitation signal is ${Number.isFinite(nextPrecipChance) ? `${nextPrecipChance}%` : "unavailable"}.`
    : `${currentConditionText} now. Today: ${dailyConditionText}, ${hi} / ${lo}. Next-hour precipitation signal is ${Number.isFinite(nextPrecipChance) ? `${nextPrecipChance}%` : "unavailable"}.`;

  if (elements.mapTitle) elements.mapTitle.textContent = `${location.name} Regional Weather Field`;
  if (elements.mapCopy) elements.mapCopy.textContent = `Interactive forecast map centered on ${placeName}. Click any point on the map to switch the briefing to that area.`;
  if (elements.locationInput) elements.locationInput.value = placeName;

  if (elements.temperature) elements.temperature.textContent = formatNumber(current.temperature_2m);

  const peekTemp = document.querySelector("#peek-temp") as HTMLElement | null;
  const peekCondition = document.querySelector("#peek-condition") as HTMLElement | null;
  if (peekTemp) peekTemp.textContent = formatTemp(current.temperature_2m);
  if (peekCondition) peekCondition.textContent = describeWeatherCode(current.weather_code);

  if (elements.currentCondition) elements.currentCondition.textContent = describeWeatherCode(current.weather_code);
  if (elements.conditionCopy) elements.conditionCopy.textContent = `${imp ? `${Math.round(daily.temperature_2m_max[0] * 9 / 5 + 32)}°F` : `${Math.round(daily.temperature_2m_max[0])}°C`} high, ${imp ? `${Math.round(daily.temperature_2m_min[0] * 9 / 5 + 32)}°F` : `${Math.round(daily.temperature_2m_min[0])}°C`} low today`;

  if (elements.pressure) elements.pressure.textContent = imp ? (current.pressure_msl / 33.864).toFixed(2) : String(Math.round(current.pressure_msl));
  if (elements.wind) elements.wind.textContent = imp ? String(Math.round(current.wind_speed_10m / 1.609)) : String(Math.round(current.wind_speed_10m));
  if (elements.windCompass) elements.windCompass.textContent = degreesToCompass(current.wind_direction_10m);

  if (elements.tempTrend) elements.tempTrend.textContent = `${temperatureDelta >= 0 ? "Warming" : "Cooling"} ${Math.abs(temperatureDelta).toFixed(1)}${imp ? "°F" : "°C"} in 3h`;
  if (elements.pressureTrend) elements.pressureTrend.textContent = `${pressureDelta >= 0 ? "Rising" : "Falling"} ${Math.abs(pressureDelta).toFixed(1)}${imp ? " inHg" : " hPa"} in 3h`;
  if (elements.windDirection) elements.windDirection.textContent = `From ${Math.round(current.wind_direction_10m)}° with gusts to ${formatSpeed(current.wind_gusts_10m)}`;

  const cachedMetricUnits = [...document.querySelectorAll(".metric-card .metric-unit")] as HTMLElement[];
  cachedMetricUnits.forEach((el) => {
    const card = el.closest(".metric-card");
    if (!card) return;
    const label = card.querySelector("span:first-child")?.textContent;
    if (label === "Temperature") el.textContent = imp ? "°F" : "°C";
    else if (label === "Pressure") el.textContent = imp ? " inHg" : " hPa";
    else if (label === "Wind") el.textContent = imp ? " mph" : " km/h";
    else if (label?.includes("Precip")) el.textContent = imp ? " in" : " mm";
  });

  if (elements.humidity) elements.humidity.textContent = Number.isFinite(current.relative_humidity_2m) ? String(Math.round(current.relative_humidity_2m)) : "--";
  if (elements.humidityTrend) elements.humidityTrend.textContent = Number.isFinite(current.relative_humidity_2m) && Number.isFinite(hourly.relative_humidity_2m?.[previousIndex])
    ? `${
        current.relative_humidity_2m - hourly.relative_humidity_2m![previousIndex] >= 0 ? "Rising" : "Falling"
      } ${Math.abs(current.relative_humidity_2m - hourly.relative_humidity_2m![previousIndex]).toFixed(0)}% in 3h`
    : "Awaiting data";
  if (elements.watchLevel) elements.watchLevel.textContent = formatNumber(nextPrecip);
  if (elements.watchCopy) elements.watchCopy.textContent = Number.isFinite(nextPrecipChance)
    ? `${nextPrecipChance}% chance in the next hour`
    : "Next-hour probability unavailable";
}

export function updateWeatherWarning(forecast: Forecast): void {
  const hourly = forecast.hourly;
  const daily = forecast.daily;
  const currentIndex = findCurrentIndex(hourly.time);
  const nextTwelveIndexes = hourly.time.slice(currentIndex, currentIndex + 12).map((_, offset) => currentIndex + offset);
  const maxGust = Math.max(...nextTwelveIndexes.map((index) => hourly.wind_gusts_10m[index] || 0));
  const maxPrecipChance = Math.max(...nextTwelveIndexes.map((index) => hourly.precipitation_probability[index] || 0));
  const precipTotal = nextTwelveIndexes.reduce((total, index) => total + (hourly.precipitation[index] || 0), 0);
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
      ? `Storm conditions appear in today's forecast. Peak gusts may reach ${formatSpeed(maxGust)}.`
      : `Forecast gusts may reach ${formatSpeed(maxGust)} in the next 12 hours.`;
  } else if (heavyRainToday || precipTotal >= 10 || maxPrecipChance >= 75) {
    level = "watch";
    label = "Weather Watch";
    title = "Rain risk is elevated";
    copy = `${formatPrecip(precipTotal)} is forecast over the next 12 hours, with peak probability near ${maxPrecipChance}%.`;
  } else if (maxGust >= 45 || pressureDrop >= 3 || precipTotal >= 3) {
    level = "advisory";
    label = "Weather Advisory";
    title = maxGust >= 45 ? "Gusty winds possible" : "Changing weather pattern";
    copy = maxGust >= 45
      ? `Gusts may reach ${formatSpeed(maxGust)} in the next 12 hours.`
      : `Pressure may fall ${formatPressure(pressureDrop)} over 6 hours with ${formatPrecip(precipTotal)} possible.`;
  }

  updateWarningBar(level, label, title, copy);
}
