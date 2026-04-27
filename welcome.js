const form = document.querySelector("#welcome-form");
const input = document.querySelector("#welcome-location-input");
const note = document.querySelector("#welcome-note");
const searchNote = document.querySelector("#welcome-search-note");
const suggestions = document.querySelector("#welcome-suggestions");
const cookieName = "precip.preferredLocation.v1";
const apiBaseUrl = ["127.0.0.1", "localhost"].includes(window.location.hostname)
  ? "http://127.0.0.1:7428"
  : window.location.origin;

let activeSelection = null;
let searchTimer = null;
let searchToken = 0;

function buildApiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(`/api${normalizedPath}`, apiBaseUrl);
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatLabel(item) {
  return [item.name, item.admin, item.country].filter(Boolean).join(", ");
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[^\w\s,]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function matchesQuery(item, query) {
  const normalized = normalize(query);
  const variants = [item.name, [item.name, item.admin].filter(Boolean).join(", "), formatLabel(item)].map(normalize);
  return variants.some((variant) => variant === normalized);
}

async function fetchCandidates(query) {
  const url = buildApiUrl("/geocode");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "8");
  const response = await fetch(url);
  if (!response.ok) throw new Error("Location lookup failed");
  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];
  return results
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

function renderSuggestions(items, query) {
  if (!items.length) {
    suggestions.classList.remove("visible");
    suggestions.innerHTML = "";
    activeSelection = null;
    return;
  }

  suggestions.innerHTML = items
    .map((item, index) => {
      const exact = matchesQuery(item, query);
      return `
        <button class="suggestion-item${exact ? " exact" : ""}" type="button" data-suggestion-index="${index}">
          <strong>${escapeHTML(item.name)}</strong>
          <small>${escapeHTML([item.admin, item.country].filter(Boolean).join(", "))}</small>
        </button>
      `;
    })
    .join("");

  suggestions.classList.add("visible");
  suggestions.querySelectorAll("[data-suggestion-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = items[Number(button.dataset.suggestionIndex)];
      activeSelection = item;
      input.value = formatLabel(item);
      searchNote.textContent = "Exact location selected.";
      suggestions.classList.remove("visible");
    });
  });
}

async function runSearch(query) {
  const token = ++searchToken;
  if (query.length < 2) {
    activeSelection = null;
    suggestions.classList.remove("visible");
    suggestions.innerHTML = "";
    searchNote.textContent = "Choose an exact match from the suggestions before opening the dashboard.";
    return;
  }

  searchNote.textContent = "Searching for matching locations...";
  try {
    const items = await fetchCandidates(query);
    if (token !== searchToken) return;
    renderSuggestions(items, query);
    searchNote.textContent = items.length ? "Pick the exact city or region from the list." : "No matching locations found yet.";
  } catch (error) {
    if (token !== searchToken) return;
    suggestions.classList.remove("visible");
    suggestions.innerHTML = "";
    searchNote.textContent = error.message;
  }
}

input.addEventListener("input", () => {
  activeSelection = null;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(input.value.trim()), 180);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!activeSelection) {
    searchNote.textContent = "Select an exact location from the suggestions to continue.";
    runSearch(input.value.trim());
    return;
  }
  if (!input.value.trim()) {
    note.textContent = "Enter a city, region, or country to continue.";
    return;
  }
  document.cookie = `${cookieName}=${encodeURIComponent(JSON.stringify(activeSelection))}; path=/; max-age=31536000; samesite=lax`;
  window.location.href = "index.html";
});
