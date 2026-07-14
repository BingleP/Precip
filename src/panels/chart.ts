import type { Forecast } from "../types";
import { elements, chartCanvas, latestForecast } from "../state";
import { HOURS_TO_SHOW } from "../config";
import { chartState } from "../chart";
import { findCurrentIndex, formatTemp, formatPrecip, formatSpeed, isImperial } from "../weather";
import { prepareCanvas, escapeHTML, roundedRect } from "../ui";

export function drawForecastChart(forecast: Forecast): void {
  if (!chartCanvas) return;
  const ctx = chartCanvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = prepareCanvas(chartCanvas, ctx);
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

  const finiteTemps = temperatures.filter(Number.isFinite);
  const tempMin = Math.min(...finiteTemps);
  const tempMax = Math.max(...finiteTemps);
  const tempRange = tempMax - tempMin || 1;

  const temperatureY = temperatures.map((value) =>
    chartBottom - ((value - tempMin) / tempRange) * chartHeight,
  );
  const precipY = precipitation.map((value) =>
    chartBottom - ((value || 0) / 100) * chartHeight,
  );
  const chartLeft = leftPadding;
  const chartRight = width - rightPadding;
  const xStep = (chartRight - chartLeft) / Math.max(1, indexes.length - 1);

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

  ctx.clearRect(0, 0, width, height);
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#171c23");
  background.addColorStop(1, "#11161b");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(120, 134, 152, 0.36)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i += 1) {
    const y = chartTop + (chartHeight / 5) * i;
    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.stroke();

    const labelValue = tempMax - ((tempMax - tempMin) / 5) * i;
    ctx.textAlign = "right";
    ctx.fillStyle = "#98a4b3";
    ctx.font = "700 12px system-ui";
    ctx.fillText(
      `${isImperial() ? `${(labelValue * 9 / 5 + 32).toFixed(0)}°` : `${labelValue.toFixed(0)}°`}`,
      chartLeft - 8,
      y + 4,
    );
  }
  ctx.textAlign = "start";

  precipitation.forEach((chance, offset) => {
    const barHeight = (chartHeight * (chance || 0)) / 100;
    const barWidth = Math.max(8, Math.min(18, xStep * 0.5));
    const x = chartLeft + offset * xStep - barWidth / 2;
    const barGradient = ctx.createLinearGradient(0, chartBottom - barHeight, 0, chartBottom);
    barGradient.addColorStop(0, "rgba(114, 174, 230, 0.64)");
    barGradient.addColorStop(1, "rgba(114, 174, 230, 0.1)");
    ctx.fillStyle = barGradient;
    roundedRect(ctx, x, chartBottom - barHeight, barWidth, barHeight, 5);
    ctx.fill();
  });

  const areaGradient = ctx.createLinearGradient(0, chartTop, 0, chartBottom);
  areaGradient.addColorStop(0, "rgba(129, 197, 171, 0.22)");
  areaGradient.addColorStop(0.72, "rgba(129, 197, 171, 0.04)");
  areaGradient.addColorStop(1, "rgba(129, 197, 171, 0)");
  ctx.beginPath();
  temperatureY.forEach((y, offset) => {
    const x = chartLeft + offset * xStep;
    if (offset === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(chartRight, chartBottom);
  ctx.lineTo(chartLeft, chartBottom);
  ctx.closePath();
  ctx.fillStyle = areaGradient;
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = "#81c5ab";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  temperatureY.forEach((y, offset) => {
    const x = chartLeft + offset * xStep;
    if (offset === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  chartState.points.forEach((point, offset) => {
    if (offset % 3 !== 0 && offset !== 0) return;
    ctx.fillStyle = "#141a20";
    ctx.strokeStyle = "#81c5ab";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(point.x, point.temperatureY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });

  if (chartState.hoverIndex !== null && chartState.points[chartState.hoverIndex]) {
    const point = chartState.points[chartState.hoverIndex];
    ctx.strokeStyle = "rgba(213, 221, 231, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(point.x, chartTop);
    ctx.lineTo(point.x, chartBottom);
    ctx.stroke();

    const drawMarker = (x: number, y: number, color: string) => {
      ctx.fillStyle = "#141a20";
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    drawMarker(point.x, point.temperatureY, "#81c5ab");
    drawMarker(point.x, point.precipY, "#72aee6");
  }

  ctx.font = "700 13px system-ui";
  const tempW = ctx.measureText("Temp").width;
  const rainW = ctx.measureText("Rain").width;
  const gap1 = 22, gap2 = 18, dotR = 5;
  const totalW = tempW + gap1 + rainW + gap2 + dotR * 2;
  let legX = chartRight - totalW;
  if (legX < chartLeft) legX = chartLeft;
  ctx.textAlign = "left";
  ctx.fillStyle = "#d5dde7";
  ctx.fillText("Temp", legX, 29);
  ctx.fillStyle = "#81c5ab";
  ctx.beginPath();
  ctx.arc(legX + tempW + 6, 25, dotR, 0, Math.PI * 2);
  ctx.fill();
  legX += tempW + gap1;
  ctx.fillStyle = "#d5dde7";
  ctx.fillText("Rain", legX, 29);
  ctx.fillStyle = "#72aee6";
  ctx.beginPath();
  ctx.arc(legX + rainW + 6, 25, dotR, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = "center";
  ctx.fillStyle = "#98a4b3";
  ctx.font = "700 12px system-ui";
  const labelStep = width < 400 ? 6 : 3;
  indexes.forEach((index, offset) => {
    if (offset % labelStep !== 0) return;
    const x = chartLeft + offset * xStep;
    const label = new Date(hourly.time[index]).toLocaleTimeString([], { hour: "2-digit" });
    ctx.fillText(label, x, height - 22);
  });
  ctx.textAlign = "start";
}

export function showChartTooltip(point: typeof chartState.points[0], pointerX: number, pointerY: number, rect: DOMRect): void {
  if (!elements.chartTooltip) return;
  const time = new Date(point.time).toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  elements.chartTooltip.innerHTML = `
    <strong>${escapeHTML(time)}</strong>
    <span>Temperature: ${formatTemp(point.temperature)}</span>
    <span>Precip chance: ${point.precipitationProbability ?? "--"}%</span>
    <span>Precip amount: ${formatPrecip(point.precipitationAmount)}</span>
    <span>Wind: ${formatSpeed(point.wind)}</span>
  `;
  elements.chartTooltip.classList.add("visible");

  const tooltipWidth = elements.chartTooltip.offsetWidth;
  const tooltipHeight = elements.chartTooltip.offsetHeight;
  const left = Math.min(rect.width - tooltipWidth - 10, pointerX + 14);
  const top = Math.max(10, Math.min(rect.height - tooltipHeight - 10, pointerY - tooltipHeight - 10));
  elements.chartTooltip.style.left = `${Math.max(10, left)}px`;
  elements.chartTooltip.style.top = `${top}px`;
}

export function hideChartTooltip(): void {
  if (!elements.chartTooltip) return;
  if (chartState.hoverIndex === null && !elements.chartTooltip.classList.contains("visible")) return;
  chartState.hoverIndex = null;
  elements.chartTooltip.classList.remove("visible");
  if (latestForecast) drawForecastChart(latestForecast);
}

export function updateChartTooltip(event: PointerEvent): void {
  if (!latestForecast || !chartState.points.length) return;
  const rect = chartCanvas.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  let nearestIndex: number | null = null;
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
