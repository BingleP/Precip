import type { NwsAlert } from "../types";
import { NWS_SEVERITY_ORDER } from "../config";
import { fetchAllAlerts } from "../api";
import { setAllAlerts, getAllAlerts } from "../alerts";

export function renderLocalAlerts(alerts: NwsAlert[]): void {
  const grid = document.querySelector("#alerts-local-grid");
  if (!grid) return;

  if (!alerts?.length) {
    grid.innerHTML = `<div class="empty-signal">No active alerts for this area.</div>`;
    return;
  }

  const sorted = [...alerts].sort(
    (a, b) => (NWS_SEVERITY_ORDER[b.properties.severity] || 0) - (NWS_SEVERITY_ORDER[a.properties.severity] || 0),
  );

  grid.innerHTML = sorted.map((alert) => renderAlertCard(alert)).join("");
}

function renderAlertCard(alert: NwsAlert): string {
  const p = alert.properties;
  const severity = p.severity || "Unknown";
  const source = p.source === "ECCC" ? "ECCC" : "NWS";
  const event = p.event || "Weather alert";
  const headline = p.headline || "";
  const description = (p.description || "").slice(0, 500);

  return `
    <article class="alert-card severity-${severity}">
      <span class="alert-severity-badge severity-${severity}"></span>
      <div class="alert-event">
        ${escapeHtml(event)}
        <small>${source} · ${severity}</small>
      </div>
      ${headline ? `<div class="alert-headline">${escapeHtml(headline)}</div>` : ""}
      ${description ? `<div class="alert-description">${escapeHtml(description)}</div>` : ""}
    </article>
  `;
}

export async function loadBrowseAlerts(): Promise<void> {
  const grid = document.querySelector("#alerts-browse-grid");
  if (!grid) return;

  const existing = getAllAlerts();
  if (existing && existing.length > 0) {
    renderBrowsePanel(existing);
    return;
  }

  grid.innerHTML = `<div class="empty-signal">Loading all active alerts...</div>`;

  try {
    const alerts = await fetchAllAlerts();
    setAllAlerts(alerts);
    renderBrowsePanel(alerts);
  } catch {
    grid.innerHTML = `<div class="empty-signal">Failed to load alerts. Try again later.</div>`;
  }
}

export function renderBrowsePanel(alerts: NwsAlert[] | null): void {
  const grid = document.querySelector("#alerts-browse-grid");
  const countEl = document.querySelector("#browse-alert-count");
  if (!grid) return;

  if (!alerts?.length) {
    grid.innerHTML = `<div class="empty-signal">No active alerts found.</div>`;
    if (countEl) countEl.textContent = "";
    return;
  }

  const sorted = [...alerts].sort(
    (a, b) => (NWS_SEVERITY_ORDER[b.properties.severity] || 0) - (NWS_SEVERITY_ORDER[a.properties.severity] || 0),
  );

  if (countEl) {
    countEl.textContent = `${sorted.length} active`;
    countEl.className = "status-pill";
  }

  grid.innerHTML = sorted.map((alert) => renderAlertCard(alert)).join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
