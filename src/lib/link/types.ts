import type { DiscoveryQuery } from "../discovery/schema";

export const SHORTLIST_FORMAT_VERSION = 1 as const;
export const MAX_SHORTLIST_OFFERS = 3;
export const MAX_SHARE_URL_LENGTH = 1_000;

export interface ShortlistOfferRef {
  destination: string;
  transportOfferId: string;
  hotelOfferId: string;
}

export interface ShortlistPayload {
  query: DiscoveryQuery;
  offers: ShortlistOfferRef[];
}

export type DecodeShortlistResult =
  | { ok: true; payload: ShortlistPayload }
  | { ok: false; reason: "invalid" | "unsupported_version" };
