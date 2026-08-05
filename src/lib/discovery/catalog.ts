import { readFileSync } from "node:fs";
import path from "node:path";

import rawCatalog from "../../../data/destinations.json";

const CATALOG_VALIDATION_FILE = path.resolve(
  process.cwd(),
  "data/catalog-validation.json",
);
const CATALOG_VALIDATION_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1_000;

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

export type CatalogProbeStatus =
  | "offers_found"
  | "unresolved"
  | "no_offers_for_dates"
  | "source_unavailable";

export type CatalogDestinationStatus = "suitable" | "unsuitable";

export type CatalogUnsuitableReason = "transport_not_found_from_any_origin";

interface CatalogValidationEntryBase {
  checkedAt: string;
  window: { checkIn: string; checkOut: string };
  transport: {
    status: CatalogProbeStatus;
    byOrigin: Record<string, CatalogProbeStatus>;
    reachableFrom: string[];
  };
  hotels: { status: CatalogProbeStatus };
}

export type CatalogValidationEntry = CatalogValidationEntryBase &
  (
    | { status: "suitable"; reason?: never }
    | { status: "unsuitable"; reason: CatalogUnsuitableReason }
  );

export interface CatalogValidationReport {
  schemaVersion: 2;
  run: {
    status: "in_progress" | "incomplete" | "complete";
    startedAt: string;
    completedAt: string | null;
    catalogHash: string;
    matrix: {
      origins: string[];
      windowStrategy: "next-season-month-v1";
      nights: number;
      referenceDate?: string;
    };
  } | null;
  destinations: Record<string, CatalogValidationEntry>;
}

export interface CatalogValidationState {
  source: "report" | "missing" | "invalid";
  report: CatalogValidationReport | null;
  runAt: string | null;
  stale: boolean;
  unavailableDestinationNames: readonly string[];
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

export function loadCatalogValidation(
  file = CATALOG_VALIDATION_FILE,
  options: { now?: Date; maxAgeDays?: number } = {},
): CatalogValidationState {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    const source = isMissingFileError(error) ? "missing" : "invalid";
    return emptyValidationState(source);
  }

  if (!isCatalogValidationReport(value)) {
    return emptyValidationState("invalid");
  }

  const runAt = value.run?.completedAt ?? value.run?.startedAt ?? null;
  const now = options.now ?? new Date();
  const maxAgeDays = options.maxAgeDays ?? CATALOG_VALIDATION_MAX_AGE_DAYS;
  const runTime = runAt === null ? Number.NaN : Date.parse(runAt);
  const stale =
    Number.isFinite(runTime) &&
    now.getTime() - runTime > maxAgeDays * DAY_MS;
  const unavailableDestinationNames = Object.entries(value.destinations)
    .filter(([, entry]) => entry.status === "unsuitable")
    .map(([name]) => name);

  return {
    source: "report",
    report: value,
    runAt,
    stale,
    unavailableDestinationNames,
  };
}

export function applyCatalogValidation(
  catalog: readonly Destination[],
  report: CatalogValidationReport | null,
): Destination[] {
  if (report === null) return [...catalog];

  const unavailable = new Set(
    Object.entries(report.destinations)
      .filter(([, entry]) => entry.status === "unsuitable")
      .map(([name]) => normalizeCityName(name)),
  );
  return catalog.filter(
    ({ name }) => !unavailable.has(normalizeCityName(name)),
  );
}

export const catalogValidation = loadCatalogValidation();
export const destinationCatalog: readonly Destination[] =
  applyCatalogValidation(rawCatalog, catalogValidation.report);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCatalogValidationReport(
  value: unknown,
): value is CatalogValidationReport {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 2 ||
    !isRecord(value.destinations)
  ) {
    return false;
  }

  if (value.run !== null && !isValidationRun(value.run)) return false;
  return Object.values(value.destinations).every(isValidationEntry);
}

function isValidationRun(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.matrix)) return false;
  return (
    (value.status === "in_progress" ||
      value.status === "incomplete" ||
      value.status === "complete") &&
    typeof value.startedAt === "string" &&
    (value.completedAt === null || typeof value.completedAt === "string") &&
    typeof value.catalogHash === "string" &&
    Array.isArray(value.matrix.origins) &&
    value.matrix.origins.every((origin) => typeof origin === "string") &&
    value.matrix.windowStrategy === "next-season-month-v1" &&
    typeof value.matrix.nights === "number" &&
    (value.matrix.referenceDate === undefined ||
      typeof value.matrix.referenceDate === "string")
  );
}

function isValidationEntry(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isDestinationStatus(value.status) ||
    typeof value.checkedAt !== "string" ||
    !isRecord(value.window) ||
    typeof value.window.checkIn !== "string" ||
    typeof value.window.checkOut !== "string" ||
    !isRecord(value.transport) ||
    !isProbeStatus(value.transport.status) ||
    !isRecord(value.transport.byOrigin) ||
    !Object.values(value.transport.byOrigin).every(isProbeStatus) ||
    !Array.isArray(value.transport.reachableFrom) ||
    !value.transport.reachableFrom.every(
      (origin) => typeof origin === "string",
    ) ||
    !isRecord(value.hotels) ||
    !isProbeStatus(value.hotels.status)
  ) {
    return false;
  }

  const reachableFrom = Object.entries(value.transport.byOrigin)
    .filter(([, status]) => status === "offers_found")
    .map(([origin]) => origin);
  if (!arraysEqual(value.transport.reachableFrom, reachableFrom)) return false;

  return value.status === "suitable"
    ? reachableFrom.length > 0 && value.reason === undefined
    : reachableFrom.length === 0 &&
        value.reason === "transport_not_found_from_any_origin";
}

function isDestinationStatus(value: unknown): value is CatalogDestinationStatus {
  return value === "suitable" || value === "unsuitable";
}

function isProbeStatus(value: unknown): value is CatalogProbeStatus {
  return (
    value === "offers_found" ||
    value === "unresolved" ||
    value === "no_offers_for_dates" ||
    value === "source_unavailable"
  );
}

function emptyValidationState(
  source: "missing" | "invalid",
): CatalogValidationState {
  return {
    source,
    report: null,
    runAt: null,
    stale: false,
    unavailableDestinationNames: [],
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    isRecord(error) && error.code === "ENOENT"
  );
}

function normalizeCityName(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase().replaceAll("ё", "е");
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
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
