"use server";

import {
  decodeShortlistFragment,
  rebuildShortlist,
} from "@/lib/link";
import type { SearchCard } from "@/lib/search/stream";

export interface SharedListTrip {
  destination: string;
  hotelName: string;
  totalAmount: number;
  currency: string;
  replaced: boolean;
  /** Проверенный переход на Туту; отсутствует, если в карточке нет ссылки. */
  tutuUrl?: string;
}

export type OpenSharedListResult =
  | { status: "ready"; trips: SharedListTrip[] }
  | {
      status: "invalid_link";
      reason: "invalid" | "unsupported_version";
    }
  | { status: "unavailable" };

export async function openSharedList(
  fragment: string,
): Promise<OpenSharedListResult> {
  let decoded;
  try {
    decoded = decodeShortlistFragment(fragment);
  } catch {
    return { status: "unavailable" };
  }
  if (!decoded.ok) {
    return { status: "invalid_link", reason: decoded.reason };
  }

  try {
    const rebuilt = await rebuildShortlist(decoded.payload);
    if (rebuilt.length === 0) return { status: "unavailable" };
    return {
      status: "ready",
      trips: rebuilt.map(({ card, replaced }) => {
        const link = tutuUrl(card);
        return {
          destination: card.destination,
          hotelName: card.hotel.name,
          totalAmount: card.price.total.amount,
          currency: card.price.total.currency,
          replaced,
          ...(link === undefined ? {} : { tutuUrl: link }),
        };
      }),
    };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Переход на Туту из пересобранной карточки: точный переход, если он есть,
 * иначе результаты поиска. Чужие домены не пропускаются.
 */
function tutuUrl(card: SearchCard): string | undefined {
  const candidates = [
    card.transport.checkoutUrl,
    card.transport.searchResultsUrl,
    card.hotel.bestOffer.checkoutUrl,
    card.hotel.checkoutUrl,
  ];
  return candidates.find(
    (candidate) => candidate !== undefined && isTutuUrl(candidate),
  );
}

function isTutuUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      (url.hostname === "tutu.ru" || url.hostname.endsWith(".tutu.ru"))
    );
  } catch {
    return false;
  }
}
