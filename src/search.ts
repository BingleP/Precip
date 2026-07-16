import type { Location, GeocodingResult, NwsAlert } from "./types";
import { LOCATION_SUGGESTION_LIMIT, NWS_SEVERITY_ORDER } from "./config";
import { buildApiUrl } from "./api";
import { escapeHTML, normalizeSearchText, formatLocationLabel } from "./ui";

export async function geocodeLocationCandidates(
  query: string,
  count = LOCATION_SUGGESTION_LIMIT,
): Promise<Location[]> {
  const url = buildApiUrl("/geocode");
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(count));

  const response = await fetch(url);
  if (!response.ok) throw new Error("Location lookup failed");

  const data = await response.json();
  if (!data.results?.length) throw new Error(`No weather location found for "${query}"`);

  return (data.results as GeocodingResult[])
    .map((result) => ({
      name: result.name,
      admin: result.admin1,
      country: result.country,
      countryCode: result.country_code,
      latitude: result.latitude,
      longitude: result.longitude,
      timezone: result.timezone,
      population: result.population || 0,
    }))
    .sort((a, b) => b.population - a.population);
}

export async function reverseGeocodeLocation(
  latitude: number,
  longitude: number,
): Promise<Location> {
  const url = buildApiUrl("/reverse-geocode");
  url.searchParams.set("latitude", latitude.toFixed(6));
  url.searchParams.set("longitude", longitude.toFixed(6));

  const response = await fetch(url);
  if (!response.ok) throw new Error("Map location lookup failed");

  const data = await response.json();
  const address = data.address || {};
  const name =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.hamlet ||
    address.county ||
    data.name ||
    "Selected location";

  return {
    name,
    admin: address.state || address.region || address.province || address.county,
    country: address.country || (address.country_code || "").toUpperCase(),
    countryCode: (address.country_code || "").toUpperCase(),
    latitude,
    longitude,
    timezone: "auto",
  };
}

export function locationSearchVariants(location: Location): string[] {
  return [
    location.name,
    [location.name, location.admin].filter(Boolean).join(", "),
    formatLocationLabel(location),
  ]
    .map(normalizeSearchText)
    .filter(Boolean);
}

export function matchesLocationQuery(location: Location, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  return locationSearchVariants(location).some((variant) => variant === normalizedQuery);
}

export function rankLocationCandidates(candidates: Location[], query: string): Location[] {
  const normalizedQuery = normalizeSearchText(query);
  return [...candidates].sort((left, right) => {
    const leftVariants = locationSearchVariants(left);
    const rightVariants = locationSearchVariants(right);
    const leftExact = leftVariants.includes(normalizedQuery) ? 1 : 0;
    const rightExact = rightVariants.includes(normalizedQuery) ? 1 : 0;
    if (leftExact !== rightExact) return rightExact - leftExact;

    const leftStarts = leftVariants.some((variant) => variant.startsWith(normalizedQuery)) ? 1 : 0;
    const rightStarts = rightVariants.some((variant) => variant.startsWith(normalizedQuery)) ? 1 : 0;
    if (leftStarts !== rightStarts) return rightStarts - leftStarts;

    return (right.population || 0) - (left.population || 0);
  });
}

export async function resolveLocation(
  query: string,
  _eventLogEl?: HTMLElement | null,
): Promise<Location> {
  if (!query) throw new Error("Location is required");
  const candidates = rankLocationCandidates(await geocodeLocationCandidates(query), query);
  const exactMatches = candidates.filter((candidate) => matchesLocationQuery(candidate, query));
  if (exactMatches.length === 1) return exactMatches[0];
  if (candidates.length === 1) return candidates[0];
  throw new Error("Choose the exact location from the suggestions.");
}

let activeLocationSuggestions: Location[] = [];
let searchRequestToken = 0;

export function clearLocationSuggestions(
  suggestionsEl: HTMLElement | null | undefined,
  _searchNoteEl?: HTMLElement | null | undefined,
): void {
  activeLocationSuggestions = [];
  if (suggestionsEl) {
    suggestionsEl.innerHTML = "";
    suggestionsEl.classList.remove("visible");
  }
}

export function selectLocationSuggestion(
  location: Location,
  options: { submit?: boolean; inputEl?: HTMLInputElement | null; searchNoteEl?: HTMLElement | null; suggestionsEl?: HTMLElement | null; onLoad?: (loc: Location) => void } = {},
): void {
  const { submit = false, inputEl, searchNoteEl, suggestionsEl, onLoad } = options;
  if (inputEl) inputEl.value = formatLocationLabel(location);
  if (searchNoteEl) searchNoteEl.textContent = "Exact location selected.";
  clearLocationSuggestions(suggestionsEl);
  if (submit && onLoad) onLoad(location);
}

export function renderLocationSuggestions(
  candidates: Location[],
  query: string,
  suggestionsEl: HTMLElement | null,
  searchNoteEl: HTMLElement | null,
  inputEl: HTMLInputElement | null,
  onSelect: (location: Location) => void,
): void {
  activeLocationSuggestions = candidates;
  if (!candidates.length) {
    clearLocationSuggestions(suggestionsEl);
    if (searchNoteEl) searchNoteEl.textContent = "No matching locations found.";
    return;
  }

  if (suggestionsEl) {
    suggestionsEl.innerHTML = candidates
      .map(
        (candidate, index) => `
          <button class="suggestion-item${matchesLocationQuery(candidate, query) ? " exact" : ""}" type="button" data-location-index="${index}">
            <strong>${escapeHTML(candidate.name)}</strong>
            <small>${escapeHTML([candidate.admin, candidate.country].filter(Boolean).join(", "))}</small>
          </button>
        `,
      )
      .join("");
    suggestionsEl.classList.add("visible");

    suggestionsEl.querySelectorAll("[data-location-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const candidate = activeLocationSuggestions[Number((button as HTMLElement).dataset.locationIndex)];
        if (candidate) {
          selectLocationSuggestion(candidate, { submit: true, inputEl, searchNoteEl, suggestionsEl, onLoad: onSelect });
        }
      });
    });
  }
}

export async function searchLocationSuggestions(
  query: string,
  _eventLogEl?: HTMLElement | null,
  searchNoteEl?: HTMLElement | null,
  suggestionsEl?: HTMLElement | null,
  inputEl?: HTMLInputElement | null,
): Promise<void> {
  const currentToken = ++searchRequestToken;
  if (query.length < 2) {
    clearLocationSuggestions(suggestionsEl || null, searchNoteEl);
    if (searchNoteEl) {
      searchNoteEl.textContent = "Search suggestions will appear as you type so you can choose the exact place.";
    }
    return;
  }

  if (searchNoteEl) searchNoteEl.textContent = "Searching for matching locations...";
  try {
    const candidates = rankLocationCandidates(await geocodeLocationCandidates(query), query);
    if (currentToken !== searchRequestToken) return;
    renderLocationSuggestions(
      candidates,
      query,
      suggestionsEl || null,
      searchNoteEl || null,
      inputEl || null,
      (location) => {
        selectLocationSuggestion(location, {
          submit: true,
          inputEl: inputEl || null,
          searchNoteEl: searchNoteEl || null,
          suggestionsEl: suggestionsEl || null,
          onLoad: (_loc) => {
            // Will be handled by the caller
          },
        });
      },
    );
    if (searchNoteEl) searchNoteEl.textContent = "Choose the exact city or region from the list.";
  } catch (error) {
    if (currentToken !== searchRequestToken) return;
    clearLocationSuggestions(suggestionsEl || null);
    if (searchNoteEl) searchNoteEl.textContent = (error as Error).message;
  }
}


export function getAlertCentroid(alert: NwsAlert): { lat: number; lon: number } | null {
  if (!alert.geometry) return null;
  const coords = alert.geometry.coordinates;
  let ring: number[][];
  if (alert.geometry.type === "MultiPolygon") {
    ring = (coords[0] as unknown as number[][][])[0];
  } else if (alert.geometry.type === "Polygon") {
    ring = coords[0] as number[][];
  } else {
    return null;
  }
  if (!ring.length) return null;
  let sumLat = 0, sumLon = 0;
  for (const [lon, lat] of ring) {
    sumLat += lat;
    sumLon += lon;
  }
  return { lat: sumLat / ring.length, lon: sumLon / ring.length };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let alertSearchRequestToken = 0;

export async function searchAlertSuggestions(
  query: string,
  allAlerts: NwsAlert[],
  suggestionsEl: HTMLElement | null,
  searchNoteEl: HTMLElement | null,
  onSelect: (alert: NwsAlert) => void,
): Promise<void> {
  const currentToken = ++alertSearchRequestToken;

  if (!query.trim() || !allAlerts?.length) {
    if (suggestionsEl) suggestionsEl.classList.remove("visible");
    return;
  }

  const lower = query.toLowerCase();

  const textMatches = allAlerts.filter((a) => {
    const p = a.properties;
    const text = [p.event, p.headline, p.description].filter(Boolean).join(" ").toLowerCase();
    return text.includes(lower);
  });

  if (searchNoteEl) searchNoteEl.textContent = "Searching...";

  let locationResults: Location[] = [];
  try {
    locationResults = await geocodeLocationCandidates(query, 3);
  } catch {}

  if (currentToken !== alertSearchRequestToken) return;

  type Scored = { alert: NwsAlert; lat: number; lon: number; dist?: number };
  const scored: Scored[] = [];
  const textMatchIds = new Set(textMatches.map((a) => a.properties.id));

  if (locationResults.length > 0) {
    const loc = locationResults[0];
    for (const alert of textMatches) {
      const c = getAlertCentroid(alert);
      if (c) {
        scored.push({ alert, lat: c.lat, lon: c.lon, dist: haversineKm(loc.latitude, loc.longitude, c.lat, c.lon) });
      } else {
        scored.push({ alert, lat: 0, lon: 0 });
      }
    }
    for (const alert of allAlerts) {
      if (textMatchIds.has(alert.properties.id)) continue;
      const c = getAlertCentroid(alert);
      if (c) {
        const dist = haversineKm(loc.latitude, loc.longitude, c.lat, c.lon);
        if (dist < 200) {
          scored.push({ alert, lat: c.lat, lon: c.lon, dist });
        }
      }
    }
  } else {
    for (const alert of textMatches) {
      scored.push({ alert, lat: 0, lon: 0 });
    }
  }

  scored.sort((a, b) => {
    if (a.dist !== undefined && b.dist !== undefined) return a.dist - b.dist;
    if (a.dist !== undefined) return -1;
    if (b.dist !== undefined) return 1;
    return (NWS_SEVERITY_ORDER[b.alert.properties.severity] || 0) - (NWS_SEVERITY_ORDER[a.alert.properties.severity] || 0);
  });

  const results = scored.slice(0, 8);

  if (currentToken !== alertSearchRequestToken) return;

  if (!results.length) {
    if (suggestionsEl) suggestionsEl.classList.remove("visible");
    if (searchNoteEl) searchNoteEl.textContent = `No alerts matching "${query}".`;
    return;
  }

  if (suggestionsEl) {
    suggestionsEl.innerHTML = results
      .map((item, i) => {
        const p = item.alert.properties;
        const severity = p.severity || "Unknown";
        const event = escapeHTML(p.event || "Weather alert");
        const headline = escapeHTML(p.headline || "");
        const distStr = item.dist !== undefined ? ` · ${Math.round(item.dist)} km` : "";
        return `
          <button class="suggestion-item alert-suggestion" type="button" data-alert-index="${i}">
            <span class="suggestion-alert-severity severity-${severity}">${severity.slice(0, 3)}</span>
            <div>
              <strong>${event}${distStr}</strong>
              <small>${headline}</small>
            </div>
          </button>
        `;
      })
      .join("");
    suggestionsEl.classList.add("visible");
    if (searchNoteEl) searchNoteEl.textContent = results.length + (locationResults.length > 0 ? " nearby" : "") + " alert" + (results.length > 1 ? "s" : "") + " found.";

    suggestionsEl.querySelectorAll(".alert-suggestion").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number((btn as HTMLElement).dataset.alertIndex);
        onSelect(results[idx].alert);
        if (suggestionsEl) suggestionsEl.classList.remove("visible");
      });
    });
  }
}
