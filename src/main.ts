// Bootstrap redirect: if no saved location, send to welcome page
if (!document.cookie.split("; ").find((row) => row.startsWith("precip.preferredLocation.v1="))) {
  if (!window.location.pathname.includes("welcome")) {
    window.location.replace("welcome.html");
  }
}

import type { Location, NwsAlert } from "./types";
import { MAP_DEFAULT_ZOOM, NOAA_SECTORS, SLIDER_SATELLITES, SLIDER_BASE, } from "./config";
import { getAppSettings, saveAppSettings, getPreferredLocation, savePreferredLocation, getWatchlist, getForecastHistory, saveForecastHistory, saveWatchlist, removeCookieValue, } from "./storage";
import { fetchNoaaSectorCatalog, fetchSliderCatalog, fetchAllAlerts, fetchWildfires } from "./api";
import { resolveLocation, searchLocationSuggestions, searchAlertSuggestions, getAlertCentroid, } from "./search";
import { zoomMap, startMapDrag, moveMapDrag, endMapDrag, resetMapView, updateMapTooltip, hideMapTooltip, } from "./map";
import { updateSatelliteForLocation, loadSatelliteSector, getNoaaSectorById, isSatelliteTabLoaded, setSatelliteTabLoaded, getActiveSatelliteSectorId, renderSatelliteProductOptions, renderSatelliteImage, updateSliderForLocation, loadSliderSector, setActiveSource, loadSliderImageWithFallback, resolveSliderSatellite, resolveSliderSector } from "./satellite";
import { setMapCenterAlerts, setMapCenterWildfires, getAllAlerts } from "./alerts";
import { selectTab, togglePanel, formatLocationLabel, normalizeSearchText, showToast } from "./ui";
import { loadBrowseAlerts } from "./panels/alerts";
import { exportSettingsPreset, importSettingsPreset, } from "./settings";
import {
  activeLocation, latestForecast, latestHeatmap,
  activeHeatmapLayer, activeMapHourOffset,
  mapState, activePointers, pinchState,
  elements, chartCanvas, heatmapCanvas, heatmapButtons,
  showAlerts, showWildfires, setShowAlerts, setShowWildfires,
} from "./state";
import { updateCurrentConditions } from "./panels/now";
import {
  drawForecastChart, hideChartTooltip, updateChartTooltip,
} from "./panels/chart";
import {
  updateSettingsUI, renderWatchlistUI, pinCurrentLocation,
  renderForecastHistoryUI,
  clearSavedWatchlist, clearSavedHistory,
  saveCurrentAsPreferredLocation, clearPreferredLocationSetting,
  scheduleHeatmapRefresh,
  renderHeatmap,
  setActiveHeatmapLayer, setActiveMapHourOffset, toggleMapAnimation,
} from "./panels/data";
import {
  loadWeather, selectMapLocation,
} from "./panels/weather-loader";

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let selectedLocationSuggestion: Location | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
let tooltipRaf: number | null = null;
let satelliteOverlayDrag: { startX: number; startY: number; left: number; top: number } | null = null;
let satelliteOverlayResizeDrag: { startX: number; startY: number; width: number; height: number } | null = null;
let mapCenterAlertTimer: ReturnType<typeof setTimeout> | null = null;
let wildfireFetchTimer: ReturnType<typeof setTimeout> | null = null;

async function fetchMapCenterAlerts(): Promise<void> {
  if (!mapState.center) return;
  try {
    const alerts = await fetchAllAlerts();
    setMapCenterAlerts(alerts);
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  } catch {
    setMapCenterAlerts(null);
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  }
}

function scheduleMapCenterAlertFetch(debounceMs = 600): void {
  if (mapCenterAlertTimer) clearTimeout(mapCenterAlertTimer);
  mapCenterAlertTimer = setTimeout(fetchMapCenterAlerts, debounceMs);
}

async function fetchMapCenterWildfires(): Promise<void> {
  const center = mapState.center;
  if (!center || !center.latitude || !center.longitude) return;
  const zoom = Math.round(mapState.zoom);
  const viewSpan = Math.max(1, 360 / Math.pow(2, zoom));
  const bbox = {
    west: center.longitude - viewSpan,
    south: center.latitude - viewSpan,
    east: center.longitude + viewSpan,
    north: center.latitude + viewSpan,
  };
  try {
    const features = await fetchWildfires(bbox);
    setMapCenterWildfires(features);
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  } catch {
    setMapCenterWildfires(null);
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  }
}

function scheduleWildfireFetch(debounceMs = 600): void {
  if (wildfireFetchTimer) clearTimeout(wildfireFetchTimer);
  wildfireFetchTimer = setTimeout(fetchMapCenterWildfires, debounceMs);
}

// Initialize satellite controls
if (elements.satelliteSectorSelect) {
  elements.satelliteSectorSelect.innerHTML = NOAA_SECTORS
    .map((sector) => `<option value="${sector.id}">${sector.name} (${sector.sat})</option>`)
    .join("");
}
if (elements.satelliteSatelliteSelect) {
  elements.satelliteSatelliteSelect.innerHTML = SLIDER_SATELLITES
    .map((sat) => `<option value="${sat.id}">${sat.name}</option>`)
    .join("");
}

function toggleSatelliteOverlay(show?: boolean): void {
  const overlay = elements.satelliteOverlay;
  if (!overlay) return;
  const isVisible = !overlay.hidden;
  const targetState = show ?? !isVisible;

  if (targetState) {
    overlay.hidden = false;
    if (activeLocation && !isSatelliteTabLoaded()) {
      setSatelliteTabLoaded(true);
      const source = elements.satelliteSourceSelect?.value || "noaa";
      const satElements = getSatelliteElements();
      if (source === "slider") {
        updateSliderForLocation(activeLocation, satElements);
      } else {
        updateSatelliteForLocation(activeLocation, satElements);
      }
    }
    const isNarrow = window.matchMedia("(max-width: 768px)").matches;
    if (isNarrow) {
      document.querySelector("#data-panel")?.classList.add("collapsed");
    }
  } else {
    overlay.hidden = true;
  }
}
// --- Event Listeners ---

if (elements.locationForm) {
  elements.locationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const mode = (document.querySelector("#search-mode") as HTMLSelectElement)?.value || "location";
    if (mode === "alerts") return;
    const query = elements.locationInput?.value.trim() || "";
    if (!query) return;
    if (
      selectedLocationSuggestion &&
      normalizeSearchText(formatLocationLabel(selectedLocationSuggestion)) === normalizeSearchText(query)
    ) {
      loadWeather(selectedLocationSuggestion);
      return;
    }
    resolveLocation(query, elements.eventLog)
      .then((location) => {
        selectedLocationSuggestion = location;
        loadWeather(location);
      })
      .catch(() => {
        searchLocationSuggestions(query, elements.eventLog, elements.locationSearchNote, elements.locationSuggestions, elements.locationInput);
        if (elements.locationSearchNote) {
          elements.locationSearchNote.textContent = "Choose the exact location from the suggestions before loading weather.";
        }
      });
  });
}

if (elements.locationInput) {
  elements.locationInput.addEventListener("input", () => {
    selectedLocationSuggestion = null;
    const mode = (document.querySelector("#search-mode") as HTMLSelectElement)?.value || "location";
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      const query = elements.locationInput?.value.trim() || "";
      if (!query) return;
      if (mode === "alerts") {
        const allAlerts = getAllAlerts();
        if (!allAlerts) {
          void loadBrowseAlerts().then(() => {
            searchAlertSuggestions(query, getAllAlerts() || [], elements.locationSuggestions, elements.locationSearchNote, handleAlertSelect);
          });
          return;
        }
        searchAlertSuggestions(query, allAlerts, elements.locationSuggestions, elements.locationSearchNote, handleAlertSelect);
      } else {
        searchLocationSuggestions(query, elements.eventLog, elements.locationSearchNote, elements.locationSuggestions, elements.locationInput);
      }
    }, 180);
  });
}

function handleAlertSelect(alert: NwsAlert): void {
  const centroid = getAlertCentroid(alert);
  if (centroid) {
    selectMapLocation(centroid.lat, centroid.lon);
  } else {
    showToast("This alert doesn't have location data for map navigation.", "info");
  }
}

document.querySelector("#search-mode")?.addEventListener("change", () => {
  const mode = (document.querySelector("#search-mode") as HTMLSelectElement)?.value || "location";
  const input = elements.locationInput;
  const note = elements.locationSearchNote;
  const suggestions = elements.locationSuggestions;
  if (suggestions) suggestions.classList.remove("visible");
  if (input) {
    input.value = "";
    input.placeholder = mode === "alerts"
      ? "Search alerts by location or event type..."
      : "Search for a city, region, or country";
  }
  if (note) {
    note.textContent = mode === "alerts"
      ? "Type a location name or alert type to find active warnings."
      : "Search suggestions will appear as you type.";
  }
  if (mode === "alerts") {
    void loadBrowseAlerts();
  }
});

document.addEventListener("click", (event) => {
  if (elements.locationForm && !elements.locationForm.contains(event.target as Node)) {
    if (elements.locationSuggestions) elements.locationSuggestions.classList.remove("visible");
  }
});

elements.refreshButton?.addEventListener("click", () => {
  const query = activeLocation || elements.locationInput?.value.trim() || getPreferredLocation();
  if (query) loadWeather(query);
});

elements.clearHistoryButton?.addEventListener("click", clearSavedHistory);
elements.pinLocationButton?.addEventListener("click", pinCurrentLocation);

elements.mapHourSlider?.addEventListener("input", () => {
  setActiveMapHourOffset(Number(elements.mapHourSlider?.value), { persist: true });
});

window.addEventListener("resize", () => {
  hideChartTooltip();
  hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    if (latestForecast) drawForecastChart(latestForecast);
    if (latestHeatmap) {
      renderHeatmap(latestHeatmap);
      scheduleHeatmapRefresh(300);
    }
  }, 200);
});

chartCanvas?.addEventListener("pointermove", updateChartTooltip);
chartCanvas?.addEventListener("pointerleave", hideChartTooltip);

if (heatmapCanvas) {
  const onDragStart = () => {
    if (tooltipRaf !== null) { cancelAnimationFrame(tooltipRaf); tooltipRaf = null; }
    hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
  };

  heatmapCanvas.addEventListener("pointerdown", (event) => {
    startMapDrag(event, mapState, activePointers, heatmapCanvas, onDragStart, pinchState);
  });

  heatmapCanvas.addEventListener("pointermove", (event) => {
    moveMapDrag(
      event, mapState, activePointers, pinchState,
      () => {
        hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
        renderHeatmap(latestHeatmap, activeHeatmapLayer);
      },
      () => renderHeatmap(latestHeatmap, activeHeatmapLayer),
      () => { scheduleHeatmapRefresh(); scheduleMapCenterAlertFetch(); scheduleWildfireFetch(); },
      (e) => {
        if (!mapState.drag) {
          if (tooltipRaf !== null) cancelAnimationFrame(tooltipRaf);
          tooltipRaf = requestAnimationFrame(() => {
            tooltipRaf = null;
            updateMapTooltip(e, heatmapCanvas, mapState, activeHeatmapLayer, activeMapHourOffset, {
              mapTooltip: elements.mapTooltip,
              mapHoverIndicator: elements.mapHoverIndicator,
            });
          });
        }
      },
    );
  });

  heatmapCanvas.addEventListener("pointerup", (event) => {
    endMapDrag(
      event, mapState, activePointers, pinchState,
      () => { scheduleHeatmapRefresh(); scheduleMapCenterAlertFetch(); scheduleWildfireFetch(); },
      (lat, lon) => selectMapLocation(lat, lon),
    );
  });

  heatmapCanvas.addEventListener("pointercancel", (event) => {
    endMapDrag(
      event, mapState, activePointers, pinchState,
      () => {},
      () => {},
    );
  });

  heatmapCanvas.addEventListener("pointerleave", () => {
    if (tooltipRaf !== null) { cancelAnimationFrame(tooltipRaf); tooltipRaf = null; }
    hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
  });

  heatmapCanvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomMap(
        event.deltaY > 0 ? -1 : 1,
        mapState,
        () => {
          hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
          renderHeatmap(latestHeatmap, activeHeatmapLayer);
        },
        () => scheduleHeatmapRefresh(),
      );
    },
    { passive: false },
  );
}

elements.mapZoomIn?.addEventListener("click", () => {
  zoomMap(1, mapState, () => {
    hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  }, () => { scheduleHeatmapRefresh(); scheduleMapCenterAlertFetch(); scheduleWildfireFetch(); });
});

elements.mapZoomOut?.addEventListener("click", () => {
  zoomMap(-1, mapState, () => {
    hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  }, () => { scheduleHeatmapRefresh(); scheduleMapCenterAlertFetch(); scheduleWildfireFetch(); });
});

elements.mapReset?.addEventListener("click", () => {
  resetMapView(mapState, MAP_DEFAULT_ZOOM, activeLocation);
  renderHeatmap(latestHeatmap, activeHeatmapLayer);
  scheduleHeatmapRefresh(0);
  scheduleMapCenterAlertFetch(); scheduleWildfireFetch();
});

heatmapButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveHeatmapLayer(button.dataset.layer || "temperature", { persist: true });
  });
});

elements.setDefaultLocationButton?.addEventListener("click", saveCurrentAsPreferredLocation);
elements.resetDefaultLocationButton?.addEventListener("click", clearPreferredLocationSetting);

elements.settingsMapLayer?.addEventListener("change", () => {
  setActiveHeatmapLayer(elements.settingsMapLayer?.value || "temperature", { persist: true });
});

elements.settingsStartHour?.addEventListener("change", () => {
  setActiveMapHourOffset(Number(elements.settingsStartHour?.value), { persist: true });
});

document.querySelectorAll('input[name="units"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!(radio as HTMLInputElement).checked) return;
    saveAppSettings({ useImperial: (radio as HTMLInputElement).value === "imperial" });
    if (activeLocation && latestForecast) updateCurrentConditions(activeLocation, latestForecast);
    if (latestHeatmap) renderHeatmap(latestHeatmap, activeHeatmapLayer);
  });
});

elements.clearWatchlistButton?.addEventListener("click", clearSavedWatchlist);
elements.clearHistorySettingsButton?.addEventListener("click", clearSavedHistory);

elements.satelliteImage?.addEventListener("load", () => {
  if (elements.satelliteEmpty) elements.satelliteEmpty.hidden = true;
});

function getSatelliteElements() {
  return {
    satelliteStatus: elements.satelliteStatus,
    satelliteCopy: elements.satelliteCopy,
    satelliteEmpty: elements.satelliteEmpty,
    satelliteImage: elements.satelliteImage,
    satelliteProductSelect: elements.satelliteProductSelect,
    satelliteSectorSelect: elements.satelliteSectorSelect,
    satelliteSatelliteSelect: elements.satelliteSatelliteSelect,
    satelliteLink: elements.satelliteLink,
  };
}

elements.satelliteSourceSelect?.addEventListener("change", () => {
  const source = elements.satelliteSourceSelect?.value as "noaa" | "slider";
  setActiveSource(source);
  if (elements.satelliteSatelliteWrapper) {
    elements.satelliteSatelliteWrapper.hidden = source !== "slider";
  }
  if (elements.satelliteSectorSelect) {
    if (source === "noaa") {
      elements.satelliteSectorSelect.innerHTML = NOAA_SECTORS
        .map((sector) => `<option value="${sector.id}">${sector.name} (${sector.sat})</option>`)
        .join("");
    } else if (activeLocation) {
      const sat = resolveSliderSatellite(activeLocation);
      if (elements.satelliteSatelliteSelect) elements.satelliteSatelliteSelect.value = sat.id;
      elements.satelliteSectorSelect.innerHTML = sat.sectors
        .map((sector) => `<option value="${sector.id}">${sector.name}</option>`)
        .join("");
    } else {
      const satId = elements.satelliteSatelliteSelect?.value || SLIDER_SATELLITES[0].id;
      const sat = SLIDER_SATELLITES.find((s) => s.id === satId) || SLIDER_SATELLITES[0];
      elements.satelliteSectorSelect.innerHTML = sat.sectors
        .map((sector) => `<option value="${sector.id}">${sector.name}</option>`)
        .join("");
    }
  }
  if (elements.satelliteProductSelect) {
    elements.satelliteProductSelect.innerHTML = `<option value="">Select a location first</option>`;
  }
  if (elements.satelliteLink) {
    elements.satelliteLink.textContent = source === "slider" ? "SLIDER" : "NOAA";
  }
  if (elements.satelliteKicker) {
    elements.satelliteKicker.textContent = source === "slider" ? "SLIDER Satellite" : "NOAA Satellite";
  }
  if (elements.satelliteHeadline) {
    elements.satelliteHeadline.textContent = source === "slider" ? "Global Sector Animation" : "GOES Sector Animation";
  }
  setSatelliteTabLoaded(false);
  if (activeLocation) {
    setSatelliteTabLoaded(true);
    if (source === "slider") {
      updateSliderForLocation(activeLocation, getSatelliteElements());
    } else {
      updateSatelliteForLocation(activeLocation, getSatelliteElements());
    }
  }
});

elements.satelliteSatelliteSelect?.addEventListener("change", () => {
  const satId = elements.satelliteSatelliteSelect?.value || SLIDER_SATELLITES[0].id;
  const sat = SLIDER_SATELLITES.find((s) => s.id === satId) || SLIDER_SATELLITES[0];
  if (elements.satelliteSectorSelect) {
    elements.satelliteSectorSelect.innerHTML = sat.sectors
      .map((sector) => `<option value="${sector.id}">${sector.name}</option>`)
      .join("");
  }
  if (elements.satelliteProductSelect) {
    elements.satelliteProductSelect.innerHTML = `<option value="">Select a location first</option>`;
  }
  setSatelliteTabLoaded(false);
  if (activeLocation) {
    setSatelliteTabLoaded(true);
    const sector = resolveSliderSector(sat, activeLocation);
    loadSliderSector(sat.id, sector.id, { autoSelected: false, elements: getSatelliteElements() });
  }
});

elements.satelliteSectorSelect?.addEventListener("change", () => {
  const source = elements.satelliteSourceSelect?.value || "noaa";
  if (source === "slider") {
    const satId = elements.satelliteSatelliteSelect?.value || SLIDER_SATELLITES[0].id;
    loadSliderSector(satId, elements.satelliteSectorSelect?.value || "", {
      preferredProductKey: "cira_geocolor",
      elements: getSatelliteElements(),
    });
  } else {
    loadSatelliteSector(elements.satelliteSectorSelect?.value || "", {
      preferredProductKey: "geocolor",
      elements: getSatelliteElements(),
    });
  }
});

let satelliteCatalogRequestToken = 0;

elements.satelliteProductSelect?.addEventListener("change", async () => {
  const source = elements.satelliteSourceSelect?.value || "noaa";
  const requestToken = ++satelliteCatalogRequestToken;

  if (source === "slider") {
    const satId = elements.satelliteSatelliteSelect?.value || SLIDER_SATELLITES[0].id;
    const sectorId = elements.satelliteSectorSelect?.value || SLIDER_SATELLITES[0].sectors[0].id;
    try {
      const catalog = await fetchSliderCatalog(satId, sectorId);
      if (requestToken !== satelliteCatalogRequestToken) return;
      const selectedProduct =
        catalog.products.find((product) => product.key === elements.satelliteProductSelect?.value) || catalog.products[0];
      renderSatelliteProductOptions(catalog.products, selectedProduct.key, elements.satelliteProductSelect);
      if (elements.satelliteStatus) {
        elements.satelliteStatus.textContent = `${satId} ${sectorId}`;
        elements.satelliteStatus.className = "status-pill";
      }
      if (elements.satelliteImage) {
        elements.satelliteImage.hidden = false;
        loadSliderImageWithFallback(
          satId, sectorId, selectedProduct.key,
          elements.satelliteImage,
          () => { if (elements.satelliteEmpty) elements.satelliteEmpty.hidden = true; },
          () => {
            if (elements.satelliteStatus) {
              elements.satelliteStatus.textContent = "SLIDER unavailable";
              elements.satelliteStatus.className = "status-pill standby";
            }
            if (elements.satelliteEmpty) {
              elements.satelliteEmpty.textContent = "No SLIDER image available.";
              elements.satelliteEmpty.hidden = false;
            }
            if (elements.satelliteImage) elements.satelliteImage.hidden = true;
          },
        );
      }
      if (elements.satelliteLink) {
        elements.satelliteLink.href = `${SLIDER_BASE}/?sat=${satId}&sector=${sectorId}&product=${selectedProduct.key}&z=0&im=1`;
      }
      if (elements.satelliteEmpty) elements.satelliteEmpty.hidden = true;
    } catch (error) {
      if (requestToken !== satelliteCatalogRequestToken) return;
      if (elements.satelliteEmpty) {
        elements.satelliteEmpty.textContent = (error as Error).message;
        elements.satelliteEmpty.hidden = false;
      }
      if (elements.satelliteImage) elements.satelliteImage.hidden = true;
    }
  } else {
    const sectorId = elements.satelliteSectorSelect?.value || "";
    const sector = getNoaaSectorById(sectorId || getActiveSatelliteSectorId() || NOAA_SECTORS[0].id);
    try {
      const catalog = await fetchNoaaSectorCatalog(sector);
      if (requestToken !== satelliteCatalogRequestToken) return;
      const selectedProduct =
        catalog.products.find((product) => product.key === elements.satelliteProductSelect?.value) || catalog.products[0];
      renderSatelliteProductOptions(
        catalog.products,
        selectedProduct.key,
        elements.satelliteProductSelect,
      );
      renderSatelliteImage(sector, selectedProduct, {
        satelliteStatus: elements.satelliteStatus,
        satelliteCopy: elements.satelliteCopy,
        satelliteLink: elements.satelliteLink,
        satelliteImage: elements.satelliteImage,
        satelliteEmpty: elements.satelliteEmpty,
      });
    } catch (error) {
      if (requestToken !== satelliteCatalogRequestToken) return;
      if (elements.satelliteEmpty) {
        elements.satelliteEmpty.textContent = (error as Error).message;
        elements.satelliteEmpty.hidden = false;
      }
      if (elements.satelliteImage) elements.satelliteImage.hidden = true;
    }
  }
});

// Overlay toggle buttons
function syncOverlayToggles(): void {
  if (elements.alertsToggle) elements.alertsToggle.classList.toggle("active", showAlerts);
  if (elements.wildfiresToggle) elements.wildfiresToggle.classList.toggle("active", showWildfires);
}

elements.alertsToggle?.addEventListener("click", () => {
  setShowAlerts(!showAlerts);
  saveAppSettings({ showAlerts });
  syncOverlayToggles();
  renderHeatmap(latestHeatmap, activeHeatmapLayer);
});

elements.wildfiresToggle?.addEventListener("click", () => {
  setShowWildfires(!showWildfires);
  saveAppSettings({ showWildfires });
  syncOverlayToggles();
  renderHeatmap(latestHeatmap, activeHeatmapLayer);
});

// Satellite map toggle button
document.querySelector("#satellite-toggle")?.addEventListener("click", () => {
  toggleSatelliteOverlay();
});

// Satellite overlay close button
elements.satelliteOverlayClose?.addEventListener("click", () => {
  toggleSatelliteOverlay(false);
});

// Satellite options toggle (collapse/expand advanced controls)
document.querySelector("#satellite-options-toggle")?.addEventListener("click", (event) => {
  const btn = event.currentTarget as HTMLElement;
  const advanced = document.querySelector("#satellite-controls-advanced") as HTMLElement | null;
  if (!advanced) return;
  const expanded = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", String(!expanded));
  advanced.hidden = expanded;
});

// Satellite overlay drag to reposition
let satDragRaf: number | null = null;

elements.satelliteOverlayHeader?.addEventListener("pointerdown", (event) => {
  const overlay = elements.satelliteOverlay;
  if (!overlay || overlay.hidden) return;
  const target = event.target as HTMLElement;
  if (target.closest("select, button, a")) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  satelliteOverlayDrag = {
    startX: event.clientX,
    startY: event.clientY,
    left: overlay.offsetLeft,
    top: overlay.offsetTop,
  };
});

elements.satelliteOverlayHeader?.addEventListener("pointermove", (event) => {
  if (!satelliteOverlayDrag) return;
  if (satDragRaf !== null) cancelAnimationFrame(satDragRaf);
  satDragRaf = requestAnimationFrame(() => {
    satDragRaf = null;
    const overlay = elements.satelliteOverlay;
    if (!overlay || overlay.hidden) return;
    const dx = event.clientX - satelliteOverlayDrag!.startX;
    const dy = event.clientY - satelliteOverlayDrag!.startY;
    const parent = overlay.parentElement!;
    const maxRight = parent.clientWidth - overlay.offsetWidth;
    const maxBottom = parent.clientHeight - overlay.offsetHeight;
    const newLeft = Math.max(0, Math.min(maxRight, satelliteOverlayDrag!.left + dx));
    const newTop = Math.max(0, Math.min(maxBottom, satelliteOverlayDrag!.top + dy));
    overlay.style.left = `${newLeft}px`;
    overlay.style.top = `${newTop}px`;
    overlay.style.right = "auto";
    overlay.style.bottom = "auto";
  });
});

elements.satelliteOverlayHeader?.addEventListener("pointerup", (event) => {
  if (!satelliteOverlayDrag) return;
  satelliteOverlayDrag = null;
  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
});

elements.satelliteOverlayHeader?.addEventListener("pointercancel", () => {
  satelliteOverlayDrag = null;
  if (satDragRaf !== null) { cancelAnimationFrame(satDragRaf); satDragRaf = null; }
});

// Satellite overlay resize
elements.satelliteOverlayResize?.addEventListener("pointerdown", (event) => {
  const overlay = elements.satelliteOverlay;
  if (!overlay || overlay.hidden) return;
  event.preventDefault();
  event.stopPropagation();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  satelliteOverlayResizeDrag = {
    startX: event.clientX,
    startY: event.clientY,
    width: overlay.offsetWidth,
    height: overlay.offsetHeight,
  };
});

elements.satelliteOverlayResize?.addEventListener("pointermove", (event) => {
  if (!satelliteOverlayResizeDrag) return;
  if (satDragRaf !== null) cancelAnimationFrame(satDragRaf);
  satDragRaf = requestAnimationFrame(() => {
    satDragRaf = null;
    const overlay = elements.satelliteOverlay;
    if (!overlay || overlay.hidden) return;
    const dx = event.clientX - satelliteOverlayResizeDrag!.startX;
    const dy = event.clientY - satelliteOverlayResizeDrag!.startY;
    const parent = overlay.parentElement!;
    const newW = Math.max(320, Math.min(parent.clientWidth, satelliteOverlayResizeDrag!.width + dx));
    const newH = Math.max(240, Math.min(parent.clientHeight, satelliteOverlayResizeDrag!.height + dy));
    overlay.style.width = `${newW}px`;
    overlay.style.height = `${newH}px`;
  });
});

elements.satelliteOverlayResize?.addEventListener("pointerup", (event) => {
  if (!satelliteOverlayResizeDrag) return;
  satelliteOverlayResizeDrag = null;
  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
});

elements.satelliteOverlayResize?.addEventListener("pointercancel", () => {
  satelliteOverlayResizeDrag = null;
  if (satDragRaf !== null) { cancelAnimationFrame(satDragRaf); satDragRaf = null; }
});

elements.exportSettingsButton?.addEventListener("click", () => {
  exportSettingsPreset(getForecastHistory, getWatchlist, getPreferredLocation, getAppSettings, elements.eventLog);
});

elements.importSettingsButton?.addEventListener("click", () => {
  elements.importSettingsFile?.click();
});

elements.importSettingsFile?.addEventListener("change", (event) => {
  const [file] = (event.target as HTMLInputElement).files || [];
  importSettingsPreset(file, elements.eventLog, getPreferredLocation, saveAppSettings, savePreferredLocation, removeCookieValue, saveForecastHistory, saveWatchlist, setActiveHeatmapLayer, setActiveMapHourOffset, updateSettingsUI, elements as unknown as Record<string, HTMLElement | null>);
});

elements.mapPlayButton?.addEventListener("click", toggleMapAnimation);

document.addEventListener("keydown", (event) => {
  const tag = (event.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  if ((event.metaKey || event.ctrlKey) && event.key === "k") {
    event.preventDefault();
    elements.locationInput?.focus();
    elements.locationInput?.select();
    return;
  }

  if (event.key === "Escape") {
    hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
    hideChartTooltip();
    if (elements.locationSuggestions) elements.locationSuggestions.classList.remove("visible");
    return;
  }

  const tabIndex = parseInt(event.key, 10);
  if (tabIndex >= 1 && tabIndex <= 9) {
    const tabs = ["now", "hourly", "outlook", "storm", "alerts", "air", "trends", "pins", "history", "settings"];
    selectTab(tabs[tabIndex - 1]);
    return;
  }

  if (event.key === "0") {
    selectTab("system");
    return;
  }
});

// Tab clicks (satellite handled separately)
document.querySelectorAll(".tab-button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tabId = (btn as HTMLElement).dataset.tab || "";
    selectTab(tabId);
    if (tabId === "alerts") {
      void loadBrowseAlerts();
    }
  });
});

document.querySelector("#panel-collapse")?.addEventListener("click", togglePanel);
document.querySelector("#panel-expand")?.addEventListener("click", togglePanel);
document.querySelector("#drawer-peek")?.addEventListener("click", () => {
  document.querySelector("#data-panel")?.classList.remove("collapsed");
});
document.querySelector("#map-tools-toggle")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const popover = document.querySelector("#map-tools-popover") as HTMLElement | null;
  const toggle = e.currentTarget as HTMLElement;
  if (popover) {
    const isOpen = popover.classList.toggle("open");
    toggle.classList.toggle("active", isOpen);
  }
});
document.addEventListener("click", (e) => {
  const popover = document.querySelector("#map-tools-popover") as HTMLElement | null;
  const toggle = document.querySelector("#map-tools-toggle") as HTMLElement | null;
  if (popover && toggle && !popover.contains(e.target as Node) && !toggle.contains(e.target as Node)) {
    popover.classList.remove("open");
    toggle.classList.remove("active");
  }
});

// --- Init ---
selectTab("now");
document.querySelector(".app-shell")?.classList.add("panel-expanded");

const initialSettings = getAppSettings();
setActiveHeatmapLayer(initialSettings.mapLayer);
setActiveMapHourOffset(initialSettings.mapHourOffset);
setShowAlerts(initialSettings.showAlerts);
setShowWildfires(initialSettings.showWildfires);
syncOverlayToggles();
if (elements.satelliteSectorSelect) elements.satelliteSectorSelect.value = NOAA_SECTORS[0].id;
if (elements.satelliteProductSelect) {
  elements.satelliteProductSelect.innerHTML = `<option value="">Select a location first</option>`;
}
if (elements.satelliteSatelliteWrapper) {
  elements.satelliteSatelliteWrapper.hidden = true;
}
renderForecastHistoryUI();
renderWatchlistUI();
updateSettingsUI();

const preferredLocation = getPreferredLocation();
if (preferredLocation) {
  if (elements.locationInput) {
    elements.locationInput.value = typeof preferredLocation === "string"
      ? preferredLocation
      : formatLocationLabel(preferredLocation);
  }
  loadWeather(preferredLocation);
}
scheduleMapCenterAlertFetch(800);
