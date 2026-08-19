import type { DiscoveryQuery } from "../discovery/schema";
import { fanOutSearch } from "../search/fanout";
import type { SearchCard } from "../search/stream";
import type { ShortlistOfferRef, ShortlistPayload } from "./types";

export type ShortlistSearch = (
  query: DiscoveryQuery,
  destinations: readonly string[],
) => Promise<readonly SearchCard[]>;

export interface RebuiltShortlistItem {
  card: SearchCard;
  replaced: boolean;
  originalOffer: ShortlistOfferRef;
}

export interface RebuildShortlistOptions {
  search?: ShortlistSearch;
}

export async function rebuildShortlist(
  payload: ShortlistPayload,
  options: RebuildShortlistOptions = {},
): Promise<RebuiltShortlistItem[]> {
  const search = options.search ?? searchCurrentOffers;
  const destinations = payload.offers.map(({ destination }) => destination);
  const cards = await search(payload.query, destinations);
  const cardsByDestination = new Map(
    cards.map((card) => [normalizeCity(card.destination), card]),
  );

  // Пересборка возвращает одну актуальную карточку на город. Если человек
  // лайкнул несколько вариантов одного направления — а это обычное дело, когда
  // город назван прямо, — все они схлопнутся в одну и ту же поездку. Показывать
  // её трижды бессмысленно, поэтому оставляем первое вхождение.
  const usedDestinations = new Set<string>();
  return payload.offers.flatMap((offer) => {
    const key = normalizeCity(offer.destination);
    if (usedDestinations.has(key)) return [];
    const card = cardsByDestination.get(key);
    if (!card) return [];
    usedDestinations.add(key);
    return [
      {
        card,
        replaced:
          card.transport.id !== offer.transportOfferId ||
          card.hotel.id !== offer.hotelOfferId,
        originalOffer: offer,
      },
    ];
  });
}

async function searchCurrentOffers(
  query: DiscoveryQuery,
  destinations: readonly string[],
): Promise<SearchCard[]> {
  const liveCards = new Map<string, SearchCard>();
  const events = fanOutSearch({
    query,
    candidates: destinations.map((name) => ({ name })),
    targetPoolSize: destinations.length,
  });
  for await (const event of events) {
    if (event.type === "card" && event.source === "live") {
      liveCards.set(normalizeCity(event.destination), event.card);
    }
  }
  return destinations.flatMap((destination) => {
    const card = liveCards.get(normalizeCity(destination));
    return card ? [card] : [];
  });
}

function normalizeCity(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replaceAll("ё", "е");
}
