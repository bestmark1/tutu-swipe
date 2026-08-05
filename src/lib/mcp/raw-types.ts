export interface RawMoney {
  amount: number;
  currency: string;
}

export interface RawUnavailableMode {
  mode: string;
  reason: string;
  detail?: string;
}

export interface RawTransportSegment {
  from: string;
  to: string;
  departure_at: string;
  arrival_at: string;
  duration_min: number;
  carrier?: string;
  voyage_no?: string;
  [key: string]: unknown;
}

export interface RawTransportLeg {
  label?: string;
  from: string;
  to: string;
  departure_at: string;
  arrival_at: string;
  duration_min: number;
  segments: RawTransportSegment[];
  [key: string]: unknown;
}

export interface RawTransportVariant {
  offer_id: string;
  transport: string;
  price: RawMoney;
  duration_min: number;
  carriers: string[];
  departure_at: string;
  arrival_at: string;
  search_results_url?: string;
  checkout_url?: string;
  legs: RawTransportLeg[];
  [key: string]: unknown;
}

export interface RawTransportPayload {
  variants: RawTransportVariant[];
  meta: {
    from?: Record<string, unknown> | null;
    to?: Record<string, unknown> | null;
    unavailable?: RawUnavailableMode[];
    page?: number;
    page_size?: number;
    has_more?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RawHotelOffer {
  hotel_id: string;
  name: string;
  best_offer?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface RawHotelPayload {
  hotels: RawHotelOffer[];
  stay?: Record<string, unknown>;
  meta: Record<string, unknown>;
  [key: string]: unknown;
}
