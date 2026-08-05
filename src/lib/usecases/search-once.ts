import {
  parseTravelQuery,
  type ParseTravelQueryOptions,
} from "../discovery/parse";
import type {
  DiscoveryParseResult,
  DiscoveryQuery,
} from "../discovery/schema";
import {
  createMcpClient,
  type HotelOfferDto,
  type HotelSearchDto,
  type McpCallOutcome,
  type McpClient,
  type TransportSearchDto,
  type TransportVariantDto,
} from "../mcp";
import {
  buildTripCard,
  type TripCard,
} from "../packages/build";

export const PHASE_ONE_DESTINATIONS = [
  "Сочи",
  "Казань",
  "Санкт-Петербург",
] as const;

export type TutuLinkKind = "checkout" | "search_results" | "hotel_page";

export type SearchOnceCard = TripCard<TransportVariantDto, HotelOfferDto> & {
  destination: (typeof PHASE_ONE_DESTINATIONS)[number];
  tutuUrl: string;
  linkKind: TutuLinkKind;
};

type ParseFailure = Exclude<DiscoveryParseResult, { status: "success" }>;

export type SearchOnceResult =
  | ParseFailure
  | {
      status: "success";
      query: DiscoveryQuery;
      cards: SearchOnceCard[];
    }
  | {
      status: "no_offers";
      query: DiscoveryQuery;
      message: string;
    }
  | {
      status: "source_unavailable";
      query: DiscoveryQuery;
      message: string;
    };

export interface SearchOnceOptions {
  client?: McpClient;
  fallback?: ParseTravelQueryOptions["fallback"];
  signal?: AbortSignal;
  today?: Date;
}

interface DirectionResult {
  card?: SearchOnceCard;
  sourceUnavailable: boolean;
}

export async function searchOnce(
  input: string,
  options: SearchOnceOptions = {},
): Promise<SearchOnceResult> {
  const parsed = await parseTravelQuery(input, {
    today: options.today ?? new Date(),
    fallback: options.fallback,
  });
  if (parsed.status !== "success") return parsed;

  const client = options.client ?? createMcpClient();
  const cards: SearchOnceCard[] = [];
  let sourceUnavailable = false;

  // Фаза 1 намеренно не реализует веер: направления обходятся по очереди,
  // параллельны только независимые дорога и жильё одного направления.
  for (const destination of PHASE_ONE_DESTINATIONS) {
    const direction = await searchDirection(
      client,
      parsed.query,
      destination,
      options.signal,
    );
    sourceUnavailable ||= direction.sourceUnavailable;
    if (direction.card) cards.push(direction.card);
  }

  if (cards.length > 0) {
    return { status: "success", query: parsed.query, cards };
  }
  if (sourceUnavailable) {
    return {
      status: "source_unavailable",
      query: parsed.query,
      message: "Туту сейчас не отвечает. Попробуйте повторить поиск позже.",
    };
  }
  return {
    status: "no_offers",
    query: parsed.query,
    message: "По этим параметрам ничего не нашли. Попробуйте увеличить бюджет или изменить даты.",
  };
}

async function searchDirection(
  client: McpClient,
  query: DiscoveryQuery,
  destination: (typeof PHASE_ONE_DESTINATIONS)[number],
  signal: AbortSignal | undefined,
): Promise<DirectionResult> {
  const checkOut = addDays(query.dateWindow.startDate, query.dateWindow.nights);
  const [transportOutcome, hotelOutcome] = await Promise.all([
    client.callTool({
      name: "search_multitransport",
      arguments: {
        origin: query.origin,
        destination,
        departure_date: query.dateWindow.startDate,
        adults: query.travellers.adults,
        optimize_for: "price",
        page_size: 1,
        view: "compact",
      },
      signal,
    }),
    client.callTool({
      name: "search_hotels",
      arguments: {
        city_name: destination,
        check_in: query.dateWindow.startDate,
        check_out: checkOut,
        adults: query.travellers.adults,
        children_ages: query.travellers.childrenAges,
        page_size: 1,
        view: "compact",
      },
      signal,
    }),
  ]);

  const sourceUnavailable =
    transportOutcome.status === "source_unavailable" ||
    hotelOutcome.status === "source_unavailable";
  const transport = transportSearch(transportOutcome);
  const hotel = hotelSearch(hotelOutcome);
  if (!transport || !hotel) return { sourceUnavailable };

  const built = buildTripCard(transport, hotel);
  if (built.status !== "built") return { sourceUnavailable };
  if (built.card.price.total.amount > query.budget.amount) {
    return { sourceUnavailable };
  }

  const link = prepareTutuLink(built.card);
  if (!link) return { sourceUnavailable };

  return {
    sourceUnavailable,
    card: {
      ...built.card,
      destination,
      ...link,
    },
  };
}

function transportSearch(outcome: McpCallOutcome): TransportSearchDto | undefined {
  if (outcome.status === "source_unavailable") return undefined;
  return outcome.data.type === "transport" ? outcome.data : undefined;
}

function hotelSearch(outcome: McpCallOutcome): HotelSearchDto | undefined {
  if (outcome.status === "source_unavailable") return undefined;
  return outcome.data.type === "hotel" ? outcome.data : undefined;
}

function prepareTutuLink(
  card: TripCard<TransportVariantDto, HotelOfferDto>,
): { tutuUrl: string; linkKind: TutuLinkKind } | undefined {
  if (card.transport.checkoutUrl) {
    return { tutuUrl: card.transport.checkoutUrl, linkKind: "checkout" };
  }
  if (card.transport.searchResultsUrl) {
    return {
      tutuUrl: card.transport.searchResultsUrl,
      linkKind: "search_results",
    };
  }
  const hotelUrl = card.hotel.bestOffer.checkoutUrl ?? card.hotel.checkoutUrl;
  return hotelUrl
    ? { tutuUrl: hotelUrl, linkKind: "hotel_page" }
    : undefined;
}

function addDays(startDate: string, days: number): string {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
