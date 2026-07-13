import type { Location, NoaaSector, NoaaCatalog, NoaaProduct } from "./types";
import { NOAA_SECTORS, NOAA_AUTO_SECTOR_IDS, SATELLITE_CACHE_TTL_MS } from "./config";
import { fetchNoaaSectorCatalog } from "./api";
import { haversineDistance } from "./geo";
import { addLog } from "./ui";

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
  const normalizeSearchText = (value: string) =>
    String(value ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replaceAll(/[^\w\s,]/g, " ")
      .replaceAll(/\s+/g, " ")
      .trim();
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
): void {
  const { satelliteStatus, satelliteCopy, satelliteEmpty, satelliteImage, satelliteProductSelect } = elements;
  if (satelliteStatus) {
    satelliteStatus.textContent = "Loading NOAA";
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

  setSatelliteLoadingState(`Loading NOAA ${sector.name} sector imagery.`, elements);

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
