export const VIBE_TAGS = [
  "sea",
  "mountains",
  "city",
  "quiet",
  "active",
  "nature",
  "culture",
] as const;

export type VibeTag = (typeof VIBE_TAGS)[number];

export interface TravellerComposition {
  adults: number;
  childrenAges: number[];
}

export interface DateWindow {
  startDate: string;
  nights: number;
}

export interface TripBudget {
  amount: number;
  currency: "RUB";
  scope: "group_trip_total";
}

export interface DiscoveryQuery {
  origin: string;
  travellers: TravellerComposition;
  dateWindow: DateWindow;
  budget: TripBudget;
  vibeTags: VibeTag[];
}

export type PartialDiscoveryQuery = Partial<DiscoveryQuery>;
export type DiscoveryRequiredField = keyof DiscoveryQuery;

// F04 turns these markers into clarification steps. F03 only reserves the
// contract and never guesses either value.
export type DiscoveryBlockingField = "origin" | "childrenAges";

export interface DiscoveryFallbackRequest {
  input: string;
  today: string;
  parsed: PartialDiscoveryQuery;
  missingFields: DiscoveryRequiredField[];
  blockingFields: DiscoveryBlockingField[];
}

export interface DiscoveryFallbackParser {
  parse(
    request: DiscoveryFallbackRequest,
  ): Promise<PartialDiscoveryQuery | null>;
}

export type DiscoveryParseResult =
  | {
      status: "success";
      source: "rules" | "rules+fallback";
      query: DiscoveryQuery;
    }
  | {
      status: "rejected";
      source: "rules" | "rules+fallback";
      code: "unrecognized" | "incomplete";
      message: string;
      hint: string;
      missingFields: DiscoveryRequiredField[];
      blockingFields: DiscoveryBlockingField[];
    };

export const unavailableDiscoveryFallback: DiscoveryFallbackParser = {
  async parse() {
    return null;
  },
};
