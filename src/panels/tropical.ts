import type { TropicalCyclone } from "../types";
import { getActiveCyclones, getStormForecast, getStormCone } from "../alerts";

export function renderTropicalPanel(): void {
  const container = document.querySelector("#tropical-storm-list");
  const countEl = document.querySelector("#tropical-storm-count");
  if (!container) return;

  const storms = getActiveCyclones();

  if (!storms?.length) {
    container.innerHTML = `<div class="empty-signal">No active tropical cyclones at this time.</div>`;
    if (countEl) countEl.textContent = "0 active";
    return;
  }

  if (countEl) {
    countEl.textContent = `${storms.length} active`;
    countEl.className = "status-pill";
  }

  container.innerHTML = storms
    .map((storm) => renderStormCard(storm))
    .join("");
}

function getStormCategoryClass(category?: number): string {
  if (!category || category < 1) return "category-0";
  if (category >= 5) return "category-5";
  return `category-${category}`;
}

function getStormCategoryName(stormType: string, category?: number): string {
  if (stormType === "Tropical Depression") return "TD";
  if (stormType === "Tropical Storm") return "TS";
  if (category && category >= 1) return `${stormType} ${category}`;
  return stormType;
}

function getStormColor(category?: number): string {
  const colors = ["#00ff00", "#ffa500", "#ff8c00", "#ff4500", "#ff0000", "#8b0000"];
  return colors[Math.min(category || 0, 5)];
}

function renderStormCard(storm: TropicalCyclone): string {
  const forecast = getStormForecast(storm.id);
  const cone = getStormCone(storm.id);
  const catColor = getStormColor(storm.category);

  return `
    <article class="storm-card" style="border-left: 4px solid ${catColor}">
      <div class="storm-header">
        <div class="storm-name-section">
          <strong class="storm-name">${escapeHtml(storm.name)}</strong>
          <span class="storm-category ${getStormCategoryClass(storm.category)}">
            ${getStormCategoryName(storm.stormType, storm.category)}
          </span>
        </div>
        <span class="storm-basin">${storm.basin}</span>
      </div>
      <div class="storm-details">
        <div class="detail-row">
          <span>Max Sustained Winds</span>
          <strong>${storm.maxWindSpeed} kt (${knotsToMph(storm.maxWindSpeed)} mph)</strong>
        </div>
        <div class="detail-row">
          <span>Min Central Pressure</span>
          <strong>${storm.minPressure} mb</strong>
        </div>
        <div class="detail-row">
          <span>Movement</span>
          <strong>${storm.movement.direction}° at ${storm.movement.speed} kt</strong>
        </div>
        <div class="detail-row">
          <span>Position</span>
          <strong>${storm.latitude.toFixed(2)}°${storm.latitude >= 0 ? "N" : "S"}, ${storm.longitude.toFixed(2)}°${storm.longitude >= 0 ? "E" : "W"}</strong>
        </div>
        <div class="detail-row">
          <span>Last Update</span>
          <strong>${formatStormTime(storm.lastUpdate)}</strong>
        </div>
        ${forecast?.length ? `
        <div class="detail-row">
          <span>Forecast Points</span>
          <strong>${forecast.length}</strong>
        </div>
        ` : ""}
        ${cone?.length ? `
        <div class="detail-row">
          <span>Cone Radii</span>
          <strong>${cone.length} time steps</strong>
        </div>
        ` : ""}
      </div>
      <a class="storm-link" href="https://www.nhc.noaa.gov/" target="_blank" rel="noreferrer">
        NHC Advisory ↗
      </a>
    </article>
  `;
}

function knotsToMph(knots: number): number {
  return Math.round(knots * 1.15078);
}

function formatStormTime(iso: string): string {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
