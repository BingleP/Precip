import type { Location } from "./types";

const COUNTRY_ALIASES: Record<string, string> = {
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  us: "US",
  canada: "CA",
  ca: "CA",
};

type CountryFields = Pick<Location, "country" | "countryCode">;

/**
 * Resolve an ISO-3166 alpha-2 country code from a saved location.
 * Legacy cookies can be missing `countryCode`, so fall back to the country name.
 */
export function normalizeCountryCode(location: CountryFields): string | null {
  const code = (location.countryCode || "").trim().toUpperCase();
  if (code.length === 2) return code;

  const country = (location.country || "").trim().toLowerCase();
  return COUNTRY_ALIASES[country] ?? null;
}

/** Countries where this app can fetch official weather alerts. */
export function getAlertRegion(location: CountryFields): "US" | "CA" | null {
  const code = normalizeCountryCode(location);
  return code === "US" || code === "CA" ? code : null;
}

/** Return a copy of the location with `countryCode` healed when it can be inferred. */
export function withNormalizedCountryCode<T extends Location>(location: T): T {
  const code = normalizeCountryCode(location);
  if (!code || code === location.countryCode) return location;
  return { ...location, countryCode: code };
}
