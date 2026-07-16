import type { Location, NoaaSector, NoaaProduct, SliderSatellite, SliderSector, SatelliteSource } from "./types";
import { NOAA_SECTORS, NOAA_AUTO_SECTOR_IDS, SLIDER_SATELLITES, SLIDER_BASE } from "./config";
import { fetchNoaaSectorCatalog, fetchSliderCatalog } from "./api";
import { haversineDistance } from "./geo";
import { addLog, normalizeSearchText } from "./ui";

let activeSource: SatelliteSource = "noaa";

let activeSatelliteSectorId = "";
let activeSatelliteProductKey = "";
let satelliteRequestToken = 0;
let satelliteTabLoaded = false;

export function isSatelliteTabLoaded(): boolean {
  return satelliteTabLoaded;
}

export function setSatelliteTabLoaded(loaded: boolean): void {
  satelliteTabLoaded = loaded;
}

export function getActiveSatelliteSectorId(): string {
  return activeSatelliteSectorId;
}

export function setActiveSatelliteProductKey(key: string): void {
  activeSatelliteProductKey = key;
}

export function getNoaaSectorById(sectorId: string): NoaaSector {
  return NOAA_SECTORS.find((sector) => sector.id === sectorId) || NOAA_SECTORS[0];
}

export function getAutoNoaaSectors(): NoaaSector[] {
  return NOAA_AUTO_SECTOR_IDS.map(getNoaaSectorById);
}

export function getNearestNoaaSector(location: Location, sectors: NoaaSector[] = NOAA_SECTORS): NoaaSector {
  return sectors.reduce(
    (best, sector) => {
      const distance = haversineDistance(
        location.latitude,
        location.longitude,
        sector.latitude,
        sector.longitude,
      );
      return distance < best.distance ? { sector, distance } : best;
    },
    { sector: sectors[0] || NOAA_SECTORS[0], distance: Number.POSITIVE_INFINITY },
  ).sector;
}

function locationMatchesAdmin(location: Location, names: string[]): boolean {
  const admin = normalizeSearchText(location.admin || "");
  return names.some((name) => admin.includes(normalizeSearchText(name)));
}

export function resolveAutoNoaaSector(location: Location): NoaaSector {
  const country = String(location.country || "").toUpperCase();
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);

  if (country === "CA" || country === "CANADA") return getNoaaSectorById("can");

  if (country === "US" || country === "USA" || country === "UNITED STATES") {
    if (locationMatchesAdmin(location, ["alaska"])) return getNoaaSectorById("ak");
    if (locationMatchesAdmin(location, ["hawaii"])) return getNoaaSectorById("hi");
    if (locationMatchesAdmin(location, ["florida", "georgia", "south carolina", "north carolina", "alabama", "mississippi", "tennessee"]))
      return getNoaaSectorById("se");
    if (locationMatchesAdmin(location, ["louisiana", "texas"])) return getNoaaSectorById("sp");
    if (locationMatchesAdmin(location, ["virginia", "maryland", "delaware", "new jersey"]))
      return getNoaaSectorById("eus");
    if (locationMatchesAdmin(location, ["new york", "connecticut", "rhode island", "massachusetts", "vermont", "new hampshire", "maine", "pennsylvania"]))
      return getNoaaSectorById("can");
    if (locationMatchesAdmin(location, ["washington", "oregon", "idaho"])) return getNoaaSectorById("pnw");
    if (locationMatchesAdmin(location, ["california"])) return getNoaaSectorById("wus");
    if (locationMatchesAdmin(location, ["arizona", "nevada", "utah"])) return getNoaaSectorById("psw");
    if (locationMatchesAdmin(location, ["new mexico", "colorado", "wyoming", "montana"])) return getNoaaSectorById("sr");

    if (latitude >= 42) return getNoaaSectorById("can");
    if (longitude <= -122) return getNoaaSectorById(latitude >= 42 ? "pnw" : "wus");
    if (longitude >= -80 && latitude >= 33) return getNoaaSectorById("eus");
    if (latitude >= 29 && longitude >= -91 && longitude <= -80) return getNoaaSectorById("se");
    if (latitude >= 29 && longitude >= -106 && longitude < -91) return getNoaaSectorById("sp");
    if (longitude <= -104) return getNoaaSectorById("sr");
    if (longitude >= -90 && latitude < 30) return getNoaaSectorById("ga");
    return getNoaaSectorById("smv");
  }

  if (country === "MX" || country === "MEXICO") return getNoaaSectorById("mex");
  if (["PR", "PUERTO RICO"].includes(country)) return getNoaaSectorById("pr");
  if (["CU", "DO", "HT", "JM", "BS", "BB", "TT", "AG", "DM", "GD", "KN", "LC", "VC", "AW", "CW", "SX"].includes(country))
    return getNoaaSectorById("car");

  if (latitude >= 48 && longitude >= -110 && longitude <= -52) return getNoaaSectorById("can");
  if (longitude <= -125) return getNoaaSectorById(latitude >= 40 ? "np" : "tpw");
  if (longitude >= -70 && latitude >= 35) return getNoaaSectorById("na");
  if (latitude >= 12 && longitude >= -100 && longitude <= -75) return getNoaaSectorById("cam");
  if (latitude >= 10 && longitude >= -85 && longitude <= -55) return getNoaaSectorById("car");
  if (latitude >= 5 && longitude <= -100) return getNoaaSectorById("eep");
  if (latitude >= 5 && longitude > -100) return getNoaaSectorById("taw");

  return getNearestNoaaSector(location, getAutoNoaaSectors());
}

export function setSatelliteLoadingState(
  message: string,
  elements: {
    satelliteStatus: HTMLElement | null;
    satelliteCopy: HTMLElement | null;
    satelliteEmpty: HTMLElement | null;
    satelliteImage: HTMLImageElement | null;
    satelliteProductSelect: HTMLSelectElement | null;
  },
  sourceLabel = "NOAA",
): void {
  const { satelliteStatus, satelliteCopy, satelliteEmpty, satelliteImage, satelliteProductSelect } = elements;
  if (satelliteStatus) {
    satelliteStatus.textContent = `Loading ${sourceLabel}`;
    satelliteStatus.className = "status-pill standby";
  }
  if (satelliteCopy) satelliteCopy.textContent = message;
  if (satelliteEmpty) {
    satelliteEmpty.textContent = message;
    satelliteEmpty.hidden = false;
  }
  if (satelliteImage) {
    satelliteImage.removeAttribute("src");
    satelliteImage.hidden = true;
  }
  if (satelliteProductSelect) {
    satelliteProductSelect.innerHTML = `<option value="">Loading animations...</option>`;
  }
}

export function renderSatelliteProductOptions(
  products: NoaaProduct[],
  selectedKey: string,
  selectEl: HTMLSelectElement | null,
): void {
  if (!selectEl) return;
  selectEl.innerHTML = products
    .map(
      (product) =>
        `<option value="${product.key}"${product.key === selectedKey ? " selected" : ""}>${product.title}</option>`,
    )
    .join("");
}

export function renderSatelliteImage(
  sector: NoaaSector,
  product: NoaaProduct,
  elements: {
    satelliteStatus: HTMLElement | null;
    satelliteCopy: HTMLElement | null;
    satelliteLink: HTMLAnchorElement | null;
    satelliteImage: HTMLImageElement | null;
    satelliteEmpty: HTMLElement | null;
  },
): void {
  activeSatelliteProductKey = product.key;
  if (elements.satelliteStatus) {
    elements.satelliteStatus.textContent = `${sector.sat} ${sector.name}`;
    elements.satelliteStatus.className = "status-pill";
  }
  if (elements.satelliteCopy) {
    elements.satelliteCopy.textContent = `${product.title} animation for the nearest NOAA sector to the active location. Source imagery updates on NOAA roughly every 10 minutes.`;
  }
  if (elements.satelliteLink) {
    elements.satelliteLink.href = `https://www.star.nesdis.noaa.gov/goes/sector.php?sat=${sector.sat}&sector=${sector.id}`;
  }
  if (elements.satelliteImage) {
    elements.satelliteImage.alt = `${product.title} animation for ${sector.name}`;
    elements.satelliteImage.src = product.url;
    elements.satelliteImage.hidden = false;
  }
  if (elements.satelliteEmpty) {
    elements.satelliteEmpty.hidden = true;
  }
}

interface SatelliteElements {
  satelliteStatus: HTMLElement | null;
  satelliteCopy: HTMLElement | null;
  satelliteEmpty: HTMLElement | null;
  satelliteImage: HTMLImageElement | null;
  satelliteProductSelect: HTMLSelectElement | null;
  satelliteLink: HTMLAnchorElement | null;
  satelliteSectorSelect?: HTMLSelectElement | null;
  satelliteSatelliteSelect?: HTMLSelectElement | null;
}

export async function loadSatelliteSector(
  sectorId: string,
  options: {
    preferredProductKey?: string;
    autoSelected?: boolean;
    elements: SatelliteElements;
  },
): Promise<void> {
  const { preferredProductKey = "", autoSelected = false, elements } = options;
  const sector = getNoaaSectorById(sectorId);
  const requestToken = ++satelliteRequestToken;
  activeSatelliteSectorId = sector.id;
  if (elements.satelliteSectorSelect) elements.satelliteSectorSelect.value = sector.id;

  setSatelliteLoadingState(`Loading NOAA ${sector.name} sector imagery.`, elements, "NOAA");

  try {
    const catalog = await fetchNoaaSectorCatalog(sector);
    if (requestToken !== satelliteRequestToken) return;

    const selectedProduct =
      catalog.products.find((product) => product.key === preferredProductKey) ||
      catalog.products.find((product) => product.key === activeSatelliteProductKey) ||
      catalog.products.find((product) => product.key === "geocolor") ||
      catalog.products[0];

    renderSatelliteProductOptions(catalog.products, selectedProduct.key, elements.satelliteProductSelect);
    renderSatelliteImage(sector, selectedProduct, elements);
    if (autoSelected) {
      addLog(`NOAA sector auto-selected: ${sector.name}.`);
    }
  } catch (error) {
    if (requestToken !== satelliteRequestToken) return;
    if (elements.satelliteStatus) {
      elements.satelliteStatus.textContent = "NOAA unavailable";
      elements.satelliteStatus.className = "status-pill standby";
    }
    if (elements.satelliteCopy) elements.satelliteCopy.textContent = (error as Error).message;
    if (elements.satelliteEmpty) {
      elements.satelliteEmpty.textContent = (error as Error).message;
      elements.satelliteEmpty.hidden = false;
    }
    if (elements.satelliteImage) elements.satelliteImage.hidden = true;
    if (elements.satelliteProductSelect) {
      elements.satelliteProductSelect.innerHTML = `<option value="">No animations available</option>`;
    }
    addLog((error as Error).message);
  }
}

export function updateSatelliteForLocation(
  location: Location,
  elements: Parameters<typeof loadSatelliteSector>[1]["elements"],
): void {
  if (!location) return;
  const autoSector = resolveAutoNoaaSector(location);
  loadSatelliteSector(autoSector.id, { preferredProductKey: activeSatelliteProductKey, autoSelected: true, elements });
}

// ── SLIDER functions ──

export function getActiveSource(): SatelliteSource {
  return activeSource;
}

export function setActiveSource(source: SatelliteSource): void {
  activeSource = source;
}

interface SliderTileConfig {
  seconds: string;
  cadenceMinutes: number;
}

const SLIDER_TILE_CONFIGS: Record<string, SliderTileConfig> = {
  "goes-19": { seconds: "17", cadenceMinutes: 5 },
  "goes-18": { seconds: "17", cadenceMinutes: 5 },
  "himawari": { seconds: "00", cadenceMinutes: 10 },
  "meteosat-0deg": { seconds: "00", cadenceMinutes: 15 },
  "meteosat-9": { seconds: "00", cadenceMinutes: 15 },
  "gk2a": { seconds: "00", cadenceMinutes: 10 },
  "jpss": { seconds: "21", cadenceMinutes: 10 },
};

function getSliderTileConfig(satellite: string): SliderTileConfig {
  return SLIDER_TILE_CONFIGS[satellite] ?? { seconds: "17", cadenceMinutes: 10 };
}

export function getSliderTileUrl(satellite: string, sector: string, product: string, timestamp?: string): string {
  const config = getSliderTileConfig(satellite);
  if (timestamp) {
    const datePath = `${timestamp.slice(0, 4)}/${timestamp.slice(4, 6)}/${timestamp.slice(6, 8)}`;
    return `${SLIDER_BASE}/data/imagery/${datePath}/${satellite}---${sector}/${product}/${timestamp}/00/000_000.png`;
  }
  const now = new Date();
  now.setUTCMinutes(now.getUTCMinutes() - 30);
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = now.getUTCFullYear();
  const m = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const h = pad(now.getUTCHours());
  const min = pad(Math.floor(now.getUTCMinutes() / config.cadenceMinutes) * config.cadenceMinutes);
  const ts = `${y}${m}${d}${h}${min}${config.seconds}`;
  return `${SLIDER_BASE}/data/imagery/${y}/${m}/${d}/${satellite}---${sector}/${product}/${ts}/00/000_000.png`;
}

export function tryNextSliderTimestamp(currentTs: string, satellite?: string): string | null {
  const config = satellite ? getSliderTileConfig(satellite) : { seconds: currentTs.slice(12) || "17", cadenceMinutes: 5 };
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = parseInt(currentTs.slice(0, 4), 10);
  const m = parseInt(currentTs.slice(4, 6), 10) - 1;
  const d = parseInt(currentTs.slice(6, 8), 10);
  const h = parseInt(currentTs.slice(8, 10), 10);
  const min = parseInt(currentTs.slice(10, 12), 10);
  const s = parseInt(currentTs.slice(12, 14), 10) || 0;
  const date = new Date(Date.UTC(y, m, d, h, min, s));
  date.setUTCMinutes(date.getUTCMinutes() - config.cadenceMinutes);
  const y2 = date.getUTCFullYear();
  const m2 = pad(date.getUTCMonth() + 1);
  const d2 = pad(date.getUTCDate());
  const h2 = pad(date.getUTCHours());
  const min2 = pad(date.getUTCMinutes());
  const ts2 = `${y2}${m2}${d2}${h2}${min2}${config.seconds}`;
  if (ts2 < `${currentTs.slice(0, 8)}000000`) return null;
  return ts2;
}

export function resolveSliderSatellite(location: Location): SliderSatellite {
  const country = String(location.country || "").toUpperCase();
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);

  if (["US", "USA", "UNITED STATES", "CA", "CANADA", "MX", "MEXICO"].includes(country)) {
    if (longitude < -125) return SLIDER_SATELLITES.find((s) => s.id === "goes-18")!;
    return SLIDER_SATELLITES.find((s) => s.id === "goes-19")!;
  }

  if (longitude < -130) return SLIDER_SATELLITES.find((s) => s.id === "goes-18")!;
  if (longitude < -35) return SLIDER_SATELLITES.find((s) => s.id === "goes-19")!;
  if (longitude < 35) return SLIDER_SATELLITES.find((s) => s.id === "meteosat-0deg")!;
  if (longitude < 90) return SLIDER_SATELLITES.find((s) => s.id === "meteosat-9")!;
  if (longitude < 135) return SLIDER_SATELLITES.find((s) => s.id === "himawari")!;
  if (latitude > 30) return SLIDER_SATELLITES.find((s) => s.id === "gk2a")!;
  return SLIDER_SATELLITES.find((s) => s.id === "himawari")!;
}

export function resolveSliderSector(satellite: SliderSatellite, location: Location): SliderSector {
  return satellite.sectors.reduce(
    (best, sector) => {
      const distance = haversineDistance(location.latitude, location.longitude, sector.latitude, sector.longitude);
      return distance < best.distance ? { sector, distance } : best;
    },
    { sector: satellite.sectors[0], distance: Number.POSITIVE_INFINITY },
  ).sector;
}

export function loadSliderImageWithFallback(
  satellite: string,
  sector: string,
  productKey: string,
  imgEl: HTMLImageElement,
  onLoad: () => void,
  onError: () => void,
  timestamp?: string,
): void {
  const url = getSliderTileUrl(satellite, sector, productKey, timestamp);
  const nextTs = timestamp ? tryNextSliderTimestamp(timestamp, satellite) : null;

  imgEl.onload = () => {
    imgEl.hidden = false;
    onLoad();
  };

  imgEl.onerror = () => {
    if (nextTs) {
      loadSliderImageWithFallback(satellite, sector, productKey, imgEl, onLoad, onError, nextTs);
    } else {
      onError();
    }
  };

  imgEl.src = url;
}

export async function loadSliderSector(
  satellite: string,
  sector: string,
  options: {
    preferredProductKey?: string;
    autoSelected?: boolean;
    elements: SatelliteElements;
  },
): Promise<void> {
  const { preferredProductKey = "", autoSelected = false, elements } = options;
  const requestToken = ++satelliteRequestToken;
  activeSatelliteSectorId = `${satellite}:${sector}`;
  if (elements.satelliteSectorSelect) elements.satelliteSectorSelect.value = sector;
  if (elements.satelliteSatelliteSelect) elements.satelliteSatelliteSelect.value = satellite;

  setSatelliteLoadingState(`Loading SLIDER ${satellite} ${sector} imagery.`, elements, "SLIDER");

  try {
    const catalog = await fetchSliderCatalog(satellite, sector);
    if (requestToken !== satelliteRequestToken) return;

    const selectedProduct =
      catalog.products.find((product) => product.key === preferredProductKey) ||
      catalog.products.find((product) => product.key === activeSatelliteProductKey) ||
      catalog.products.find((product) => product.key === "cira_geocolor") ||
      catalog.products.find((product) => product.key === "geocolor") ||
      catalog.products[0];

    renderSatelliteProductOptions(catalog.products, selectedProduct.key, elements.satelliteProductSelect);

    if (elements.satelliteStatus) {
      elements.satelliteStatus.textContent = `${satellite} ${sector}`;
      elements.satelliteStatus.className = "status-pill";
    }
    if (elements.satelliteCopy) {
      elements.satelliteCopy.textContent = `${selectedProduct.title} from SLIDER (CIRA/CSU) for ${satellite} ${sector}.`;
    }
    if (elements.satelliteLink) {
      elements.satelliteLink.href = `${SLIDER_BASE}/?sat=${satellite}&sector=${sector}&product=${selectedProduct.key}&z=0&im=1`;
    }
    if (elements.satelliteImage) {
      elements.satelliteImage.hidden = false;
      loadSliderImageWithFallback(
        satellite, sector, selectedProduct.key,
        elements.satelliteImage,
        () => {
          if (elements.satelliteEmpty) elements.satelliteEmpty.hidden = true;
        },
        () => {
          if (elements.satelliteStatus) {
            elements.satelliteStatus.textContent = "SLIDER unavailable";
            elements.satelliteStatus.className = "status-pill standby";
          }
          if (elements.satelliteEmpty) {
            elements.satelliteEmpty.textContent = "No SLIDER image available for this sector/product.";
            elements.satelliteEmpty.hidden = false;
          }
          if (elements.satelliteImage) elements.satelliteImage.hidden = true;
        },
      );
    }
    if (elements.satelliteEmpty) {
      elements.satelliteEmpty.hidden = true;
    }
    activeSatelliteProductKey = selectedProduct.key;

    if (autoSelected) {
      addLog(`SLIDER auto-selected: ${satellite} ${sector}.`);
    }
  } catch (error) {
    if (requestToken !== satelliteRequestToken) return;
    if (elements.satelliteStatus) {
      elements.satelliteStatus.textContent = "SLIDER unavailable";
      elements.satelliteStatus.className = "status-pill standby";
    }
    if (elements.satelliteCopy) elements.satelliteCopy.textContent = (error as Error).message;
    if (elements.satelliteEmpty) {
      elements.satelliteEmpty.textContent = (error as Error).message;
      elements.satelliteEmpty.hidden = false;
    }
    if (elements.satelliteImage) elements.satelliteImage.hidden = true;
    if (elements.satelliteProductSelect) {
      elements.satelliteProductSelect.innerHTML = `<option value="">No products available</option>`;
    }
    addLog((error as Error).message);
  }
}

export function updateSliderForLocation(
  location: Location,
  elements: SatelliteElements,
): void {
  if (!location) return;
  const sat = resolveSliderSatellite(location);
  const sector = resolveSliderSector(sat, location);
  loadSliderSector(sat.id, sector.id, { preferredProductKey: activeSatelliteProductKey, autoSelected: true, elements });
}
