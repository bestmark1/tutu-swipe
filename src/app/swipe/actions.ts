"use server";

import type { RankableCard } from "@/lib/ranking";
import type { DiscoveryQuery } from "@/lib/discovery/schema";
import {
  createShortlistLink,
  type CreateShortlistLinkResult,
  type ShortlistOfferRef,
} from "@/lib/link";
import type {
  SessionReaction,
  SignedSessionState,
} from "@/lib/session";
import {
  addSignedSwipeReaction,
  createSignedSwipeSession,
  rankSignedSwipeFeed,
  undoSignedSwipeReaction,
  type ReactionOutcome,
} from "@/lib/usecases/react";

const MAX_SHORTLIST_CANDIDATES = 100;

export interface SwipeShortlistCandidate extends ShortlistOfferRef {
  eventId: string;
}

export async function createSwipeSession(): Promise<SignedSessionState> {
  return createSignedSwipeSession({ sessionId: crypto.randomUUID() });
}

/**
 * Карточки приходят от клиента, потому что сервер их между запросами не хранит:
 * внешнего хранилища у проекта нет. Веса при этом не принимаются — модель
 * пересчитывается здесь из журнала реакций (правило 7 конституции).
 */
export async function addSwipeReaction(
  session: SignedSessionState,
  reaction: SessionReaction,
  cards: RankableCard[] = [],
): Promise<ReactionOutcome> {
  return addSignedSwipeReaction(session, reaction, cards);
}

export async function undoSwipeReaction(
  session: SignedSessionState,
): Promise<SignedSessionState> {
  return undoSignedSwipeReaction(session);
}

export async function rankSwipeFeed(
  session: SignedSessionState,
  cards: RankableCard[] = [],
): Promise<ReactionOutcome["feed"]> {
  return rankSignedSwipeFeed(session, cards);
}

/**
 * Собирает подборку только из лайков проверенного сервером журнала. Карточки
 * приходят от клиента, потому что постоянного хранилища у проекта нет, поэтому
 * их количество и форма ограничиваются до передачи в подписанный фрагмент.
 */
export async function createSwipeShortlist(
  session: SignedSessionState,
  query: DiscoveryQuery,
  candidates: SwipeShortlistCandidate[],
  baseUrl: string,
): Promise<CreateShortlistLinkResult> {
  const byEventId = new Map(
    normalizeShortlistCandidates(candidates).map((candidate) => [
      candidate.eventId,
      candidate,
    ]),
  );

  return createShortlistLink({
    baseUrl,
    query,
    session,
    /**
     * Подборка ограничена тремя поездками (AC31), и брать надо не просто три
     * последних лайка: человек, долайкавший под конец три варианта одного
     * города, получал подборку из одного направления, хотя раньше отметил
     * пять разных. Сначала берём по одной поездке на каждый отмеченный город,
     * от свежих к старым, и только потом добираем остальные.
     */
    selectOffers(journal) {
      const firstPerCity: ShortlistOfferRef[] = [];
      const rest: ShortlistOfferRef[] = [];
      const seenOffers = new Set<string>();
      const seenCities = new Set<string>();

      for (let index = journal.length - 1; index >= 0; index -= 1) {
        const reaction = journal[index];
        if (reaction.type !== "like") continue;
        const candidate = byEventId.get(reaction.cardId);
        if (!candidate) continue;
        const identity = `${candidate.transportOfferId}:${candidate.hotelOfferId}`;
        if (seenOffers.has(identity)) continue;
        seenOffers.add(identity);

        const offer: ShortlistOfferRef = {
          destination: candidate.destination,
          transportOfferId: candidate.transportOfferId,
          hotelOfferId: candidate.hotelOfferId,
        };
        const city = candidate.destination.trim().toLocaleLowerCase("ru-RU");
        if (seenCities.has(city)) rest.push(offer);
        else {
          seenCities.add(city);
          firstPerCity.push(offer);
        }
      }

      return [...firstPerCity, ...rest];
    },
  });
}

function normalizeShortlistCandidates(
  value: unknown,
): SwipeShortlistCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_SHORTLIST_CANDIDATES).filter(
    (candidate): candidate is SwipeShortlistCandidate =>
      typeof candidate === "object" &&
      candidate !== null &&
      typeof candidate.eventId === "string" &&
      candidate.eventId.length > 0 &&
      typeof candidate.destination === "string" &&
      candidate.destination.length > 0 &&
      typeof candidate.transportOfferId === "string" &&
      candidate.transportOfferId.length > 0 &&
      typeof candidate.hotelOfferId === "string" &&
      candidate.hotelOfferId.length > 0,
  );
}
