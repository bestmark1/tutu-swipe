import rawCatalog from "../../../data/destinations.json";

export const LOCATION_TYPES = [
  "sea",
  "mountains",
  "city",
  "nature",
  "treatment",
] as const;

export type LocationType = (typeof LOCATION_TYPES)[number];

export const PRICE_CLASSES = ["low", "medium", "high"] as const;

export type PriceClass = (typeof PRICE_CLASSES)[number];

export const REACHABILITY_CLASSES = ["easy", "medium", "long"] as const;

export type ReachabilityClass = (typeof REACHABILITY_CLASSES)[number];

export const MAJOR_ORIGINS = [
  "Москва",
  "Санкт-Петербург",
  "Казань",
  "Екатеринбург",
  "Новосибирск",
  "Ростов-на-Дону",
] as const;

export type MajorOrigin = (typeof MAJOR_ORIGINS)[number];

export interface Destination {
  name: string;
  locationTypes: readonly LocationType[];
  seasonMonths: readonly number[];
  priceClass: PriceClass;
  reachability: Readonly<Record<MajorOrigin, ReachabilityClass>>;
}

export function validateDestinationCatalog(
  value: unknown,
): asserts value is Destination[] {
  if (!Array.isArray(value) || value.length < 40 || value.length > 60) {
    throw new Error("Destination catalog must contain 40–60 entries");
  }

  const names = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`Destination at index ${index} must be an object`);
    }

    const name = entry.name;
    if (typeof name !== "string" || name.trim() === "") {
      throw new Error(`Destination at index ${index} must have a name`);
    }
    if (names.has(name)) {
      throw new Error(`Duplicate destination name: ${name}`);
    }
    names.add(name);

    assertEnumArray(
      entry.locationTypes,
      LOCATION_TYPES,
      `${name}.locationTypes`,
    );
    assertMonths(entry.seasonMonths, name);

    if (!isOneOf(entry.priceClass, PRICE_CLASSES)) {
      throw new Error(`Invalid price class for ${name}`);
    }

    const reachability = entry.reachability;
    if (!isRecord(reachability)) {
      throw new Error(`Missing reachability for ${name}`);
    }
    const reachabilityKeys = Object.keys(reachability);
    if (
      reachabilityKeys.length !== MAJOR_ORIGINS.length ||
      !MAJOR_ORIGINS.every((origin) =>
        isOneOf(reachability[origin], REACHABILITY_CLASSES),
      )
    ) {
      throw new Error(`Invalid reachability for ${name}`);
    }
  }
}

validateDestinationCatalog(rawCatalog);

export const destinationCatalog: readonly Destination[] = rawCatalog;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly unknown[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return allowed.includes(value);
}

function assertEnumArray<const T extends readonly unknown[]>(
  value: unknown,
  allowed: T,
  field: string,
): asserts value is T[number][] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    new Set(value).size !== value.length ||
    !value.every((item) => isOneOf(item, allowed))
  ) {
    throw new Error(`Invalid ${field}`);
  }
}

function assertMonths(value: unknown, name: string): asserts value is number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    new Set(value).size !== value.length ||
    !value.every(
      (month) => Number.isInteger(month) && month >= 1 && month <= 12,
    )
  ) {
    throw new Error(`Invalid season months for ${name}`);
  }
}
