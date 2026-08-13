import { readFileSync } from "node:fs";
import path from "node:path";

import { fullDestinationCatalog } from "../discovery/catalog";
import type {
  HotelOfferDto,
  TransportLegDto,
  TransportSegmentDto,
  TransportVariantDto,
} from "../mcp";
import { buildTripCard } from "../packages/build";
import type { SearchCard } from "./stream";

export const DEFAULT_SNAPSHOT_FILE = path.join(
  process.cwd(),
  "data/snapshot/catalog.json",
);
export const DEFAULT_SNAPSHOT_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

export type SnapshotSearchCard = SearchCard & {
  source: "snapshot";
  snapshotBuiltAt: string;
  priceAgeMs: number;
  priceIsStale: boolean;
};

export interface SnapshotIndex {
  getCards(origin: string, destination: string): readonly SnapshotSearchCard[];
}

export interface LoadSnapshotOptions {
  filePath?: string;
  now?: Date;
  staleAfterMs?: number;
}

export function loadSnapshot(
  options: LoadSnapshotOptions = {},
): SnapshotIndex {
  const now = options.now ?? new Date();
  const staleAfterMs =
    options.staleAfterMs ?? DEFAULT_SNAPSHOT_STALE_AFTER_MS;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 0) {
    throw new TypeError("staleAfterMs must be a non-negative finite number");
  }

  try {
    const document = JSON.parse(
      readFileSync(options.filePath ?? DEFAULT_SNAPSHOT_FILE, "utf8"),
    ) as unknown;
    return createIndex(document, now, staleAfterMs);
  } catch {
    return emptyIndex();
  }
}

function createIndex(
  value: unknown,
  now: Date,
  staleAfterMs: number,
): SnapshotIndex {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2)
  ) {
    return emptyIndex();
  }
  if (!Array.isArray(value.entries)) return emptyIndex();

  const cards = new Map<string, SnapshotSearchCard[]>();
  for (const entry of value.entries) {
    try {
      const parsed = parseEntry(
        entry,
        value.schemaVersion,
        now,
        staleAfterMs,
      );
      cards.set(
        snapshotKey(parsed.origin, parsed.destination),
        parsed.cards,
      );
    } catch {
      // One bad entry must not invalidate the rest of the checked-in snapshot.
    }
  }

  return {
    getCards(origin, destination) {
      return cards.get(snapshotKey(origin, destination)) ?? [];
    },
  };
}

function parseEntry(
  value: unknown,
  schemaVersion: 1 | 2,
  now: Date,
  staleAfterMs: number,
): { origin: string; destination: string; cards: SnapshotSearchCard[] } {
  const entry = requiredRecord(value, "snapshot entry");
  const origin = requiredString(entry.origin, "origin");
  const destination = requiredString(entry.destination, "destination");
  const snapshotBuiltAt = requiredString(entry.builtAt, "builtAt");
  const builtAtMs = Date.parse(snapshotBuiltAt);
  if (!Number.isFinite(builtAtMs)) {
    throw new TypeError("builtAt must be an ISO date");
  }

  const transports = snapshotTransports(entry, schemaVersion).map(
    parseTransport,
  );
  const hotel = parseHotel(entry.hotel);
  const stay = parseStay(entry.stay);
  const adults = snapshotAdults(entry.adults);
  const priceAgeMs = Math.max(0, now.getTime() - builtAtMs);
  const locationType = fullDestinationCatalog
    .find(({ name }) => normalizeCity(name) === normalizeCity(destination))
    ?.locationTypes.join(" ");
  const cards = transports.map((transport): SnapshotSearchCard => {
    const built = buildTripCard(
      { variants: [transport] },
      { hotels: [hotel], stay },
      { adults, locationType },
    );
    if (built.status !== "built") {
      throw new TypeError(`snapshot card cannot be built: ${built.reason}`);
    }

    return {
      ...built.card,
      destination,
      source: "snapshot",
      snapshotBuiltAt,
      priceAgeMs,
      priceIsStale: priceAgeMs > staleAfterMs,
    };
  });
  return {
    origin,
    destination,
    cards,
  };
}

function snapshotTransports(
  entry: Record<string, unknown>,
  schemaVersion: 1 | 2,
): unknown[] {
  if (schemaVersion === 1) return [entry.transport];
  return requiredArray(entry.transports, "transports");
}

function parseTransport(value: unknown): TransportVariantDto {
  const transport = requiredRecord(value, "transport");
  return {
    id: requiredString(transport.offer_id, "transport.offer_id"),
    transport: requiredString(transport.transport, "transport.transport"),
    price: parseMoney(transport.price, "transport.price"),
    durationMinutes: requiredNumber(
      transport.duration_min,
      "transport.duration_min",
    ),
    carriers: optionalStringArray(transport.carriers, "transport.carriers"),
    departureAt: requiredString(
      transport.departure_at,
      "transport.departure_at",
    ),
    arrivalAt: requiredString(
      transport.arrival_at,
      "transport.arrival_at",
    ),
    searchResultsUrl: optionalString(transport.search_results_url),
    legs: optionalArray(transport.legs).map(parseLeg),
  };
}

function parseLeg(value: unknown, index: number): TransportLegDto {
  const leg = requiredRecord(value, `transport.legs[${index}]`);
  return {
    label: optionalString(leg.label),
    from: requiredString(leg.from, `transport.legs[${index}].from`),
    to: requiredString(leg.to, `transport.legs[${index}].to`),
    departureAt: requiredString(
      leg.departure_at,
      `transport.legs[${index}].departure_at`,
    ),
    arrivalAt: requiredString(
      leg.arrival_at,
      `transport.legs[${index}].arrival_at`,
    ),
    durationMinutes: requiredNumber(
      leg.duration_min,
      `transport.legs[${index}].duration_min`,
    ),
    segments: optionalArray(leg.segments).map(parseSegment),
  };
}

function parseSegment(value: unknown, index: number): TransportSegmentDto {
  const segment = requiredRecord(value, `transport.segment[${index}]`);
  return {
    from: requiredString(segment.from, `transport.segment[${index}].from`),
    to: requiredString(segment.to, `transport.segment[${index}].to`),
    departureAt: requiredString(
      segment.departure_at,
      `transport.segment[${index}].departure_at`,
    ),
    arrivalAt: requiredString(
      segment.arrival_at,
      `transport.segment[${index}].arrival_at`,
    ),
    durationMinutes: requiredNumber(
      segment.duration_min,
      `transport.segment[${index}].duration_min`,
    ),
    carrier: optionalString(segment.carrier),
    voyageNumber: optionalString(segment.voyage_no),
  };
}

function parseHotel(value: unknown): HotelOfferDto {
  const hotel = requiredRecord(value, "hotel");
  const bestOffer = requiredRecord(hotel.best_offer, "hotel.best_offer");
  return {
    id: requiredString(hotel.hotel_id, "hotel.hotel_id"),
    name: requiredString(hotel.name, "hotel.name"),
    stars: optionalNumber(hotel.stars),
    rating: optionalNumber(hotel.rating),
    reviewCount: optionalNumber(hotel.review_count),
    address: optionalString(hotel.address),
    photos: optionalStringArray(hotel.photos, "hotel.photos"),
    bestOffer: {
      roomName: optionalString(bestOffer.room_name),
      price: parseMoney(bestOffer.price, "hotel.best_offer.price"),
      priceBasis: optionalString(bestOffer.price_basis),
      breakfastIncluded: optionalBoolean(bestOffer.breakfast_included),
      freeCancellation: optionalBoolean(bestOffer.free_cancellation),
    },
  };
}

function parseStay(value: unknown): {
  checkIn: string;
  checkOut: string;
  nights: number;
} {
  const stay = requiredRecord(value, "stay");
  return {
    checkIn: requiredString(stay.check_in, "stay.check_in"),
    checkOut: requiredString(stay.check_out, "stay.check_out"),
    nights: requiredNumber(stay.nights, "stay.nights"),
  };
}

function parseMoney(
  value: unknown,
  label: string,
): { amount: number; currency: string } {
  const money = requiredRecord(value, label);
  return {
    amount: requiredNumber(money.amount, `${label}.amount`),
    currency: requiredString(money.currency, `${label}.currency`),
  };
}

function snapshotAdults(value: unknown): number {
  // Schema v1 snapshots before 2026-08-12 omitted this field but were built
  // with adults: 2 in scripts/build-snapshot.mjs.
  if (value === undefined) return 2;
  const adults = requiredNumber(value, "adults");
  if (!Number.isInteger(adults) || adults < 1) {
    throw new TypeError("adults must be a positive integer");
  }
  return adults;
}

function emptyIndex(): SnapshotIndex {
  return { getCards: () => [] };
}

function snapshotKey(origin: string, destination: string): string {
  return `${normalizeCity(origin)}\u0000${normalizeCity(destination)}`;
}

function normalizeCity(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replaceAll("ё", "е");
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, "optional string");
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredNumber(value, "optional number");
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new TypeError("optional boolean must be a boolean");
  }
  return value;
}

function optionalArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError("optional value must be an array");
  return value;
}

function requiredArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function optionalStringArray(value: unknown, label: string): string[] {
  return optionalArray(value).map((item, index) =>
    requiredString(item, `${label}[${index}]`),
  );
}
