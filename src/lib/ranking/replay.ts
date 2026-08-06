import type { SessionReaction } from "../session";
import {
  rankableCardId,
  type RankableCard,
  type Ranker,
  type RankingContext,
} from "./interface";

export function replayReactions(
  ranker: Ranker,
  reactions: readonly SessionReaction[],
  cards: readonly RankableCard[],
  context: RankingContext,
): Ranker {
  const cardsById = new Map(cards.map((card) => [rankableCardId(card), card]));
  for (const reaction of reactions) {
    const card = cardsById.get(reaction.cardId);
    if (card) ranker.react(reaction, card, context);
  }
  return ranker;
}
