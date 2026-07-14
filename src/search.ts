import type { Location, GeocodingResult } from "./types";
import { LOCATION_SUGGESTION_LIMIT } from "./config";
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
    country: address.country_code ? address.country_code.toUpperCase() : address.country,
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
