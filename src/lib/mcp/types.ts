export interface MoneyDto {
  amount: number;
  currency: string;
}

export interface GeoPointDto {
  name: string;
  geoId?: string;
  region?: string;
  iata?: string;
}

export interface UnavailableModeDto {
  mode: string;
  reason: string;
  detail?: string;
}

export interface TransportSegmentDto {
  from: string;
  to: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  carrier?: string;
  voyageNumber?: string;
}

export interface TransportLegDto {
  label?: string;
  from: string;
  to: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  segments: TransportSegmentDto[];
}

export interface TransportVariantDto {
  id: string;
  transport: string;
  price: MoneyDto;
  durationMinutes: number;
  carriers: string[];
  departureAt: string;
  arrivalAt: string;
  searchResultsUrl?: string;
  checkoutUrl?: string;
  legs: TransportLegDto[];
}

export interface TransportSearchDto {
  type: "transport";
  variants: TransportVariantDto[];
  meta: {
    from?: GeoPointDto;
    to?: GeoPointDto;
    unavailable: UnavailableModeDto[];
    page?: number;
    pageSize?: number;
    hasMore?: boolean;
  };
}

export interface HotelOfferDto {
  id: string;
  name: string;
  stars?: number;
  rating?: number;
  reviewCount?: number;
  address?: string;
  photos: string[];
  checkoutUrl?: string;
  bestOffer?: {
    roomName?: string;
    price: MoneyDto;
    priceBasis?: string;
    checkoutUrl?: string;
    breakfastIncluded?: boolean;
    freeCancellation?: boolean;
  };
}

export interface HotelSearchDto {
  type: "hotel";
  hotels: HotelOfferDto[];
  stay?: {
    checkIn: string;
    checkOut: string;
    nights: number;
  };
  meta: {
    searchId?: string;
    geoId?: string;
    page?: number;
    pageSize?: number;
    hasMore?: boolean;
  };
}

export type McpSearchDto = TransportSearchDto | HotelSearchDto;

export interface McpTextContent {
  type: string;
  text: string;
  [key: string]: unknown;
}

export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
  [key: string]: unknown;
}

export interface McpToolInvocation {
  name: string;
  arguments?: Record<string, unknown>;
  signal: AbortSignal;
  timeoutMs: number;
}

export type McpToolInvoker = (
  invocation: McpToolInvocation,
) => Promise<unknown>;

export type McpFailureKind =
  | "aborted"
  | "circuit_open"
  | "invalid_response"
  | "network"
  | "timeout";

export type McpCallOutcome =
  | {
      status: "success";
      data: McpSearchDto;
      attempts: number;
    }
  | {
      status: "unresolved";
      data: McpSearchDto;
      unavailable: UnavailableModeDto[];
      attempts: number;
    }
  | {
      status: "source_unavailable";
      failure: { kind: McpFailureKind };
      attempts: number;
    };

export interface McpCallRequest {
  name: string;
  arguments?: Record<string, unknown>;
  /** Remaining budget for this candidate, bounded by the request AbortSignal. */
  budgetMs?: number;
  /** The same signal that owns the complete user request. */
  signal?: AbortSignal;
}

export interface McpClient {
  callTool(request: McpCallRequest): Promise<McpCallOutcome>;
}
