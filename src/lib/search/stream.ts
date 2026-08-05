import type { HotelOfferDto, TransportVariantDto } from "../mcp";
import type { TripCard } from "../packages/build";

export type SearchCard = TripCard<TransportVariantDto, HotelOfferDto> & {
  destination: string;
};

export type CandidateErrorReason =
  | "invalid_response"
  | "not_built"
  | "rate_limited"
  | "source_unavailable"
  | "tail_cancelled"
  | "timed_out"
  | "unresolved";

export type SearchEvent =
  | {
      type: "card";
      eventId: string;
      destination: string;
      card: SearchCard;
    }
  | {
      type: "candidate_error";
      destination: string;
      reason: CandidateErrorReason;
    }
  | { type: "done"; pool: SearchCard[] }
  | {
      type: "aborted";
      reason: "request_aborted" | "budget_exhausted";
      pool: SearchCard[];
    }
  | { type: "unavailable"; pool: SearchCard[] };
