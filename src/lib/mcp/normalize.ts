import type {
  GeoPointDto,
  HotelOfferDto,
  HotelSearchDto,
  McpSearchDto,
  MoneyDto,
  TransportLegDto,
  TransportSearchDto,
  TransportSegmentDto,
  TransportVariantDto,
  UnavailableModeDto,
} from "./types";

export class McpPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpPayloadError";
  }
}

export type NormalizedPayload =
  | { status: "success"; data: McpSearchDto }
  | {
      status: "unresolved";
      data: McpSearchDto;
      unavailable: UnavailableModeDto[];
    };

export function normalizeToolResult(result: unknown): NormalizedPayload {
  const toolResult = readTextToolResult(result);
  if (toolResult.isError) {
    if (isUnresolvedHotelCityError(toolResult.text)) {
      return {
        status: "unresolved",
        data: { type: "hotel", hotels: [], meta: {} },
        unavailable: [],
      };
    }
    throw new McpPayloadError("MCP tool returned an error result");
  }

  const payload = parseJsonText(toolResult.text);
  const record = requiredRecord(payload, "tool payload");

  if (Array.isArray(record.variants)) {
    const data = normalizeTransportSearch(record);
    if (
      data.variants.length === 0 &&
      data.meta.unavailable.some(({ reason }) =>
        isUnresolvedDirectionReason(reason),
      )
    ) {
      return {
        status: "unresolved",
        data,
        unavailable: data.meta.unavailable,
      };
    }
    return { status: "success", data };
  }

  if (Array.isArray(record.hotels)) {
    return { status: "success", data: normalizeHotelSearch(record) };
  }

  throw new McpPayloadError("Unsupported MCP payload shape");
}

export function parseTextPayload(result: unknown): unknown {
  const toolResult = readTextToolResult(result);
  if (toolResult.isError) {
    throw new McpPayloadError("MCP tool returned an error result");
  }
  return parseJsonText(toolResult.text);
}

function readTextToolResult(result: unknown): {
  isError: boolean;
  text: string;
} {
  const resultRecord = requiredRecord(result, "tool result");
  if (!Array.isArray(resultRecord.content)) {
    throw new McpPayloadError("MCP tool result has no content array");
  }
  const first = resultRecord.content[0];
  const content = requiredRecord(first, "content[0]");
  if (content.type !== "text" || typeof content.text !== "string") {
    throw new McpPayloadError("MCP tool result content[0] is not text");
  }

  return { isError: resultRecord.isError === true, text: content.text };
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new McpPayloadError("MCP tool text is not valid JSON");
  }
}

function isUnresolvedHotelCityError(text: string): boolean {
  return (
    /\bsearch_hotels\b/i.test(text) &&
    /\bcould\s+not\s+resolve\b/i.test(text) &&
    /\bcity_name\s*=/i.test(text)
  );
}

function isUnresolvedDirectionReason(reason: string): boolean {
  const normalizedReason = reason.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (
    normalizedReason === "no_route" ||
    normalizedReason === "could_not_resolve" ||
    /^(?:city|location|place|origin|destination)_(?:not_found|unresolved)$/.test(
      normalizedReason,
    ) ||
    /^(?:unknown|unresolved)_(?:city|location|place|origin|destination)$/.test(
      normalizedReason,
    )
  );
}

function normalizeTransportSearch(record: Record<string, unknown>): TransportSearchDto {
  const meta = optionalRecord(record.meta) ?? {};
  return {
    type: "transport",
    variants: requiredArray(record.variants, "variants").map(
      normalizeTransportVariant,
    ),
    meta: {
      from: normalizeGeoPoint(meta.from),
      to: normalizeGeoPoint(meta.to),
      unavailable: optionalArray(meta.unavailable).map(normalizeUnavailable),
      page: optionalNumber(meta.page),
      pageSize: optionalNumber(meta.page_size),
      hasMore: optionalBoolean(meta.has_more),
    },
  };
}

function normalizeTransportVariant(
  value: unknown,
  index: number,
): TransportVariantDto {
  const record = requiredRecord(value, `variants[${index}]`);
  return {
    id: requiredString(record.offer_id, `variants[${index}].offer_id`),
    transport: requiredString(
      record.transport,
      `variants[${index}].transport`,
    ),
    price: normalizeMoney(record.price, `variants[${index}].price`),
    durationMinutes: requiredNumber(
      record.duration_min,
      `variants[${index}].duration_min`,
    ),
    carriers: optionalStringArray(record.carriers),
    departureAt: requiredString(
      record.departure_at,
      `variants[${index}].departure_at`,
    ),
    arrivalAt: requiredString(
      record.arrival_at,
      `variants[${index}].arrival_at`,
    ),
    searchResultsUrl: optionalString(record.search_results_url),
    checkoutUrl: optionalString(record.checkout_url),
    legs: optionalArray(record.legs).map(normalizeTransportLeg),
  };
}

function normalizeTransportLeg(value: unknown, index: number): TransportLegDto {
  const record = requiredRecord(value, `leg[${index}]`);
  return {
    label: optionalString(record.label),
    from: requiredString(record.from, `leg[${index}].from`),
    to: requiredString(record.to, `leg[${index}].to`),
    departureAt: requiredString(
      record.departure_at,
      `leg[${index}].departure_at`,
    ),
    arrivalAt: requiredString(
      record.arrival_at,
      `leg[${index}].arrival_at`,
    ),
    durationMinutes: requiredNumber(
      record.duration_min,
      `leg[${index}].duration_min`,
    ),
    segments: optionalArray(record.segments).map(normalizeTransportSegment),
  };
}

function normalizeTransportSegment(
  value: unknown,
  index: number,
): TransportSegmentDto {
  const record = requiredRecord(value, `segment[${index}]`);
  return {
    from: requiredString(record.from, `segment[${index}].from`),
    to: requiredString(record.to, `segment[${index}].to`),
    departureAt: requiredString(
      record.departure_at,
      `segment[${index}].departure_at`,
    ),
    arrivalAt: requiredString(
      record.arrival_at,
      `segment[${index}].arrival_at`,
    ),
    durationMinutes: requiredNumber(
      record.duration_min,
      `segment[${index}].duration_min`,
    ),
    carrier: optionalString(record.carrier),
    voyageNumber: optionalString(record.voyage_no),
  };
}

function normalizeHotelSearch(record: Record<string, unknown>): HotelSearchDto {
  const meta = optionalRecord(record.meta) ?? {};
  const stay = optionalRecord(record.stay);
  return {
    type: "hotel",
    hotels: requiredArray(record.hotels, "hotels").map(normalizeHotelOffer),
    stay: stay
      ? {
          checkIn: requiredString(stay.check_in, "stay.check_in"),
          checkOut: requiredString(stay.check_out, "stay.check_out"),
          nights: requiredNumber(stay.nights, "stay.nights"),
        }
      : undefined,
    meta: {
      searchId: optionalString(meta.search_id),
      geoId: optionalString(meta.geo_id),
      page: optionalNumber(meta.page),
      pageSize: optionalNumber(meta.page_size),
      hasMore: optionalBoolean(meta.has_more),
    },
  };
}

function normalizeHotelOffer(value: unknown, index: number): HotelOfferDto {
  const record = requiredRecord(value, `hotels[${index}]`);
  const bestOffer = optionalRecord(record.best_offer);
  return {
    id: requiredString(record.hotel_id, `hotels[${index}].hotel_id`),
    name: requiredString(record.name, `hotels[${index}].name`),
    stars: optionalNumber(record.stars),
    rating: optionalNumber(record.rating),
    reviewCount: optionalNumber(record.review_count),
    address: optionalString(record.address),
    photos: optionalStringArray(record.photos),
    checkoutUrl: optionalString(record.checkout_url),
    bestOffer: bestOffer
      ? {
          roomName: optionalString(bestOffer.room_name),
          price: normalizeMoney(
            bestOffer.price,
            `hotels[${index}].best_offer.price`,
          ),
          priceBasis: optionalString(bestOffer.price_basis),
          checkoutUrl: optionalString(bestOffer.checkout_url),
          breakfastIncluded: optionalBoolean(bestOffer.breakfast_included),
          freeCancellation: optionalBoolean(bestOffer.free_cancellation),
        }
      : undefined,
  };
}

function normalizeMoney(value: unknown, path: string): MoneyDto {
  const record = requiredRecord(value, path);
  return {
    amount: requiredNumber(record.amount, `${path}.amount`),
    currency: requiredString(record.currency, `${path}.currency`),
  };
}

function normalizeGeoPoint(value: unknown): GeoPointDto | undefined {
  const record = optionalRecord(value);
  if (!record) return undefined;
  return {
    name: requiredString(record.name, "geo.name"),
    geoId: optionalString(record.geo_id),
    region: optionalString(record.region),
    iata: optionalString(record.iata),
  };
}

function normalizeUnavailable(value: unknown, index: number): UnavailableModeDto {
  const record = requiredRecord(value, `meta.unavailable[${index}]`);
  return {
    mode: requiredString(record.mode, `meta.unavailable[${index}].mode`),
    reason: requiredString(record.reason, `meta.unavailable[${index}].reason`),
    detail: optionalString(record.detail),
  };
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new McpPayloadError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredRecord(value, "optional object");
}

function requiredArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new McpPayloadError(`${path} must be an array`);
  }
  return value;
}

function optionalArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return requiredArray(value, "optional array");
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new McpPayloadError(`${path} must be a string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, "optional string");
}

function requiredNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new McpPayloadError(`${path} must be a finite number`);
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
    throw new McpPayloadError("optional boolean must be a boolean");
  }
  return value;
}

function optionalStringArray(value: unknown): string[] {
  return optionalArray(value).map((item, index) =>
    requiredString(item, `string array[${index}]`),
  );
}
