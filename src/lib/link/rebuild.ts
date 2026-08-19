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

  // По каждому городу приходит несколько вариантов, и среди них надо найти
  // именно тот, который человек отметил. Раньше бралась первая попавшаяся
  // карточка города, поэтому идентификаторы почти никогда не совпадали и
  // подборка всегда показывала «предложение заменено», даже когда исходный
  // вариант никуда не делся.
  const byDestination = new Map<string, SearchCard[]>();
  for (const card of cards) {
    const key = normalizeCity(card.destination);
    const list = byDestination.get(key);
    if (list) list.push(card);
    else byDestination.set(key, [card]);
  }

  const usedCards = new Set<SearchCard>();
  return payload.offers.flatMap((offer) => {
    const variants = byDestination.get(normalizeCity(offer.destination)) ?? [];
    const available = variants.filter((card) => !usedCards.has(card));
    if (available.length === 0) return [];

    const exact = available.find(
      (card) =>
        card.transport.id === offer.transportOfferId &&
        card.hotel.id === offer.hotelOfferId,
    );
    const sameHotel = available.find(
      (card) => card.hotel.id === offer.hotelOfferId,
    );
    const card = exact ?? sameHotel ?? available[0]!;
    usedCards.add(card);

    return [
      {
        card,
        replaced: card !== exact,
        originalOffer: offer,
      },
    ];
  });
}

async function searchCurrentOffers(
  query: DiscoveryQuery,
  destinations: readonly string[],
): Promise<SearchCard[]> {
  // Собираем все живые варианты, а не по одному на город: среди них ищется
  // тот самый, который человек отметил в ленте.
  const liveCards: SearchCard[] = [];
  const events = fanOutSearch({
    query,
    candidates: destinations.map((name) => ({ name })),
    targetPoolSize: Math.max(destinations.length * 4, destinations.length),
  });
  for await (const event of events) {
    if (event.type === "card" && event.source === "live") {
      liveCards.push(event.card);
    }
  }
  const wanted = new Set(destinations.map(normalizeCity));
  return liveCards.filter((card) =>
    wanted.has(normalizeCity(card.destination)),
  );
}

function normalizeCity(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replaceAll("ё", "е");
}
