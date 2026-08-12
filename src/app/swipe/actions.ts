"use server";

import type { RankableCard } from "@/lib/ranking";
import type {
  SessionReaction,
  SignedSessionState,
} from "@/lib/session";
import {
  addSignedSwipeReaction,
  createSignedSwipeSession,
  undoSignedSwipeReaction,
  type ReactionOutcome,
} from "@/lib/usecases/react";

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
