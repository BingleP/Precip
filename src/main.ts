// Bootstrap redirect: if no saved location, send to welcome page
if (!document.cookie.split("; ").find((row) => row.startsWith("precip.preferredLocation.v1="))) {
  if (!window.location.pathname.includes("welcome")) {
    window.location.replace("welcome.html");
  }
}

import type { Location } from "./types";
import { MAP_DEFAULT_ZOOM, NOAA_SECTORS, } from "./config";
import { getAppSettings, saveAppSettings, getPreferredLocation, savePreferredLocation, getWatchlist, getForecastHistory, saveForecastHistory, saveWatchlist, removeCookieValue, } from "./storage";
import { fetchNoaaSectorCatalog, } from "./api";
import { resolveLocation, searchLocationSuggestions, } from "./search";
import { zoomMap, startMapDrag, moveMapDrag, endMapDrag, resetMapView, updateMapTooltip, hideMapTooltip, } from "./map";
import { updateSatelliteForLocation, loadSatelliteSector, getNoaaSectorById, isSatelliteTabLoaded, setSatelliteTabLoaded, getActiveSatelliteSectorId, renderSatelliteProductOptions, renderSatelliteImage, } from "./satellite";
import { selectTab, togglePanel, formatLocationLabel, normalizeSearchText, } from "./ui";
import { exportSettingsPreset, importSettingsPreset, } from "./settings";
import {
  activeLocation, latestForecast, latestHeatmap,
  activeHeatmapLayer, activeMapHourOffset,
  mapState, activePointers, pinchState,
  elements, chartCanvas, heatmapCanvas, heatmapButtons,
} from "./state";
import {
  updateCurrentConditions,
} from "./panels/now";
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

// Initialize satellite sector select
if (elements.satelliteSectorSelect) {
  elements.satelliteSectorSelect.innerHTML = NOAA_SECTORS
    .map((sector) => `<option value="${sector.id}">${sector.name} (${sector.sat})</option>`)
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
      updateSatelliteForLocation(activeLocation, {
        satelliteStatus: elements.satelliteStatus,
        satelliteCopy: elements.satelliteCopy,
        satelliteEmpty: elements.satelliteEmpty,
        satelliteImage: elements.satelliteImage,
        satelliteProductSelect: elements.satelliteProductSelect,
        satelliteSectorSelect: elements.satelliteSectorSelect,
        satelliteLink: elements.satelliteLink,
      });
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
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      searchLocationSuggestions(
        elements.locationInput?.value.trim() || "",
        elements.eventLog,
        elements.locationSearchNote,
        elements.locationSuggestions,
        elements.locationInput,
      );
    }, 180);
  });
}

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
      () => scheduleHeatmapRefresh(),
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
      () => scheduleHeatmapRefresh(),
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
  }, () => scheduleHeatmapRefresh());
});

elements.mapZoomOut?.addEventListener("click", () => {
  zoomMap(-1, mapState, () => {
    hideMapTooltip({ mapTooltip: elements.mapTooltip, mapHoverIndicator: elements.mapHoverIndicator });
    renderHeatmap(latestHeatmap, activeHeatmapLayer);
  }, () => scheduleHeatmapRefresh());
});

elements.mapReset?.addEventListener("click", () => {
  resetMapView(mapState, MAP_DEFAULT_ZOOM, activeLocation);
  renderHeatmap(latestHeatmap, activeHeatmapLayer);
  scheduleHeatmapRefresh(0);
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

elements.satelliteImage?.addEventListener("error", () => {
  if (elements.satelliteStatus) {
    elements.satelliteStatus.textContent = "NOAA unavailable";
    elements.satelliteStatus.className = "status-pill standby";
  }
  if (elements.satelliteEmpty) {
    elements.satelliteEmpty.textContent = "NOAA animation could not be loaded for this sector.";
    elements.satelliteEmpty.hidden = false;
  }
  if (elements.satelliteImage) elements.satelliteImage.hidden = true;
});

elements.satelliteSectorSelect?.addEventListener("change", () => {
  loadSatelliteSector(elements.satelliteSectorSelect?.value || "", {
    preferredProductKey: "geocolor",
    elements: {
      satelliteStatus: elements.satelliteStatus,
      satelliteCopy: elements.satelliteCopy,
      satelliteEmpty: elements.satelliteEmpty,
      satelliteImage: elements.satelliteImage,
      satelliteProductSelect: elements.satelliteProductSelect,
      satelliteSectorSelect: elements.satelliteSectorSelect,
      satelliteLink: elements.satelliteLink,
    },
  });
});

let satelliteCatalogRequestToken = 0;

elements.satelliteProductSelect?.addEventListener("change", async () => {
  const sectorId = elements.satelliteSectorSelect?.value || "";
  const sector = getNoaaSectorById(sectorId || getActiveSatelliteSectorId() || NOAA_SECTORS[0].id);
  const requestToken = ++satelliteCatalogRequestToken;
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
});

// Satellite map toggle button
document.querySelector("#satellite-toggle")?.addEventListener("click", () => {
  toggleSatelliteOverlay();
});

// Satellite overlay close button
elements.satelliteOverlayClose?.addEventListener("click", () => {
  toggleSatelliteOverlay(false);
});

// Satellite overlay drag to reposition
let satDragRaf: number | null = null;

elements.satelliteOverlayHeader?.addEventListener("pointerdown", (event) => {
  const overlay = elements.satelliteOverlay;
  if (!overlay || overlay.hidden) return;
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
    const tabs = ["now", "hourly", "outlook", "storm", "air", "trends", "pins", "history", "settings"];
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
if (elements.satelliteSectorSelect) elements.satelliteSectorSelect.value = NOAA_SECTORS[0].id;
if (elements.satelliteProductSelect) {
  elements.satelliteProductSelect.innerHTML = `<option value="">Select a location first</option>`;
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
